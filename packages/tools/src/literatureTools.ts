/**
 * Literature Tools for the RecoverySky Agent
 *
 * These tools allow Claude to search and retrieve recovery literature:
 * - Semantic search for literature via Qdrant
 * - Get specific passages from books
 * - List available literature
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@recoverysky/observability'
import type { LiteratureRepository } from '@recoverysky/db/stores'
import type { QdrantVectorStore, LiteratureSearchHit } from '@recoverysky/memory'
import type { IEmbeddingProvider, TraceContext } from '@recoverysky/types'

/**
 * Configuration for literature tools
 */
export interface LiteratureToolsConfig {
  /** Maximum search results (default: 10) */
  searchLimit: number
  /** Minimum similarity score (default: 0.2) */
  scoreThreshold: number
}

const DEFAULT_CONFIG: LiteratureToolsConfig = {
  searchLimit: 10,
  // TODO: Re-enable dynamic threshold - text-embedding-3-small produces scores in 0.2-0.4 range
  // Consider: relative threshold (70% of top score) or adaptive minimum with fallback
  scoreThreshold: 0, // Disabled - let agent judge relevance from scores
}

/**
 * Provider instances for literature tools
 * Must be set before tools are used
 */
let literatureRepoInstance: LiteratureRepository | null = null
let qdrantStoreInstance: QdrantVectorStore | null = null
let embeddingProviderInstance: IEmbeddingProvider | null = null
let configInstance: LiteratureToolsConfig = DEFAULT_CONFIG
let traceContextInstance: TraceContext | null = null

/**
 * Set the literature repository instance
 */
export function setLiteratureRepository(repo: LiteratureRepository): void {
  literatureRepoInstance = repo
}

/**
 * Set the Qdrant vector store instance
 */
export function setLiteratureQdrantStore(store: QdrantVectorStore): void {
  qdrantStoreInstance = store
}

/**
 * Set the embedding provider instance
 */
export function setLiteratureEmbeddingProvider(provider: IEmbeddingProvider): void {
  embeddingProviderInstance = provider
}

/**
 * Set the literature tools configuration
 */
export function setLiteratureToolsConfig(config: Partial<LiteratureToolsConfig>): void {
  configInstance = { ...DEFAULT_CONFIG, ...config }
}

/**
 * Set trace context for literature tool operations
 */
export function setLiteratureTraceContext(ctx: TraceContext): void {
  traceContextInstance = ctx
}

/**
 * Clear trace context
 */
export function clearLiteratureTraceContext(): void {
  traceContextInstance = null
}

/**
 * Clear all literature tool instances
 */
export function clearLiteratureRepository(): void {
  literatureRepoInstance = null
  qdrantStoreInstance = null
  embeddingProviderInstance = null
  configInstance = DEFAULT_CONFIG
  traceContextInstance = null
}

function getLiteratureRepo(): LiteratureRepository {
  if (!literatureRepoInstance) {
    throw new Error('Literature tools not initialized - call setLiteratureRepository first')
  }
  return literatureRepoInstance
}

function getQdrantStore(): QdrantVectorStore | null {
  return qdrantStoreInstance
}

function getEmbeddingProvider(): IEmbeddingProvider | null {
  return embeddingProviderInstance
}

function getTraceContext(): TraceContext {
  if (!traceContextInstance) {
    // Return a minimal trace context if none set
    return {
      traceId: 'literature-tool',
      spanId: 'search',
      requestId: `lit_${Date.now()}`,
      userId: 'system',
      sessionId: 'tool',
      startTime: Date.now(),
    }
  }
  return traceContextInstance
}

/**
 * Search recovery literature using semantic search via Qdrant
 */
export const searchLiterature = tool({
  description: `Search recovery literature (books, pamphlets, guides) for relevant passages.
Use this when the user asks about:
- Specific recovery concepts or steps
- Quotes or passages from recovery literature
- Guidance from established recovery programs
- Information from AA, NA, or other recovery texts`,
  inputSchema: z.object({
    query: z.string().describe('Search term - could be a topic, phrase, or keyword'),
    fellowship: z.enum(['AA', 'NA', 'CMA', 'RD', 'all'])
      .default('all')
      .describe('Fellowship to filter by (AA=Alcoholics Anonymous, NA=Narcotics Anonymous, CMA=Crystal Meth Anonymous, RD=Recover Dharma)'),
  }),
  execute: async ({ query, fellowship }) => {
    return withSpan('tool.searchLiterature', async () => {
      const logger = getLogger().child({ tool: 'searchLiterature' })
      const ctx = getTraceContext()
      const limit = configInstance.searchLimit

      logger.info({ query, fellowship, limit }, 'Searching literature (semantic)')

      try {
        const repo = getLiteratureRepo()
        const qdrant = getQdrantStore()
        const embedding = getEmbeddingProvider()

        // If Qdrant and embedding provider are not available, return empty
        if (!qdrant || !embedding) {
          logger.warn('Qdrant or embedding provider not configured, semantic search unavailable')
          return {
            success: false,
            results: [],
            count: 0,
            message: 'Literature search is not fully configured.',
          }
        }

        // Step 1: Generate embedding for query
        const embeddingResult = await embedding.embed(query, ctx, { label: 'literature-query' })
        if (!embeddingResult.ok) {
          logger.error({ error: embeddingResult.error }, 'Failed to generate query embedding')
          return {
            success: false,
            results: [],
            count: 0,
            message: 'Unable to process search query.',
          }
        }

        // Step 2: Search Qdrant literature collection
        const searchResult = await qdrant.searchLiterature(
          embeddingResult.value,
          {
            fellowship: fellowship !== 'all' ? fellowship : undefined,
            limit,
            scoreThreshold: configInstance.scoreThreshold,
          },
          ctx
        )

        if (!searchResult.ok) {
          logger.error({ error: searchResult.error }, 'Qdrant literature search failed')
          return {
            success: false,
            results: [],
            count: 0,
            message: 'Unable to search literature right now.',
          }
        }

        const hits = searchResult.value
        if (hits.length === 0) {
          logger.info('No semantic matches found')
          return {
            success: true,
            results: [],
            count: 0,
            message: `No literature found matching "${query}".`,
          }
        }

        // Step 3: Extract block IDs and hydrate from PostgreSQL
        const blockIds = hits.map((h: LiteratureSearchHit) => h.literatureBlockId)
        const blocksResult = await repo.getBlocksByIds(blockIds)

        if (!blocksResult.ok) {
          logger.error({ error: blocksResult.error }, 'Failed to hydrate blocks from PostgreSQL')
          return {
            success: false,
            results: [],
            count: 0,
            message: 'Unable to retrieve literature content.',
          }
        }

        // Step 4: Build results with scores from Qdrant
        // Create a map of blockId -> score for quick lookup
        const scoreMap = new Map<string, number>(hits.map((h: LiteratureSearchHit) => [h.literatureBlockId, h.score]))

        // Group blocks by literature and include scores
        const resultMap = new Map<string, {
          title: string
          fellowship: string | null
          edition: string | null
          summary: string | null
          passages: Array<{
            page: number | null
            lineStart: number | null
            lineEnd: number | null
            text: string
            score: number
          }>
        }>()

        for (const { block, literature } of blocksResult.value) {
          const litId = literature.id
          const score = scoreMap.get(block.id) ?? 0

          if (!resultMap.has(litId)) {
            resultMap.set(litId, {
              title: literature.title,
              fellowship: literature.fellowship,
              edition: literature.edition,
              summary: literature.summary,
              passages: [],
            })
          }

          resultMap.get(litId)!.passages.push({
            page: block.page,
            lineStart: block.lineStart,
            lineEnd: block.lineEnd,
            text: block.text,
            score,
          })
        }

        // Sort passages by score within each literature
        for (const result of resultMap.values()) {
          result.passages.sort((a, b) => b.score - a.score)
        }

        const results = Array.from(resultMap.values())

        logger.info({ count: results.length, blockCount: blocksResult.value.length }, 'Literature search complete')

        return {
          success: true,
          results,
          count: results.length,
          message: results.length > 0
            ? `Found ${results.length} relevant piece${results.length === 1 ? '' : 's'} of literature with ${blocksResult.value.length} passage${blocksResult.value.length === 1 ? '' : 's'}.`
            : `No literature found matching "${query}".`,
        }
      } catch (error) {
        logger.error({ error }, 'Literature search failed')
        return {
          success: false,
          results: [],
          count: 0,
          message: 'Unable to search literature right now.',
        }
      }
    })
  },
})

/**
 * Get a specific passage from literature by page number
 */
export const getLiteraturePassage = tool({
  description: `Get a specific passage from a piece of recovery literature by page number.
Use when the user asks for a specific page or you need to reference a particular section.`,
  inputSchema: z.object({
    title: z.string().describe('Title of the literature to look up'),
    page: z.number().min(1).describe('Page number to retrieve'),
  }),
  execute: async ({ title, page }) => {
    return withSpan('tool.getLiteraturePassage', async () => {
      const logger = getLogger().child({ tool: 'getLiteraturePassage' })
      logger.info({ title, page }, 'Getting literature passage')

      try {
        const repo = getLiteratureRepo()

        // Find the literature by title
        const searchResult = await repo.searchByTitle(title, 1)
        if (!searchResult.ok || searchResult.value.length === 0) {
          return {
            success: false,
            passage: null,
            message: `Could not find literature titled "${title}".`,
          }
        }

        const lit = searchResult.value[0]
        const blocksResult = await repo.getBlockByPage(lit.id, page)

        if (!blocksResult.ok || blocksResult.value.length === 0) {
          return {
            success: false,
            passage: null,
            message: `No content found on page ${page} of "${title}".`,
          }
        }

        // Combine all blocks on this page
        const pageText = blocksResult.value.map(b => b.text).join('\n')

        logger.info({ title, page }, 'Passage retrieved')

        return {
          success: true,
          passage: {
            title: lit.title,
            page,
            text: pageText,
          },
          message: `Retrieved page ${page} from "${title}".`,
        }
      } catch (error) {
        logger.error({ error }, 'Get passage failed')
        return {
          success: false,
          passage: null,
          message: 'Unable to retrieve passage right now.',
        }
      }
    })
  },
})

/**
 * List all available literature
 */
export const listLiterature = tool({
  description: `List available recovery literature in the database, filtered by fellowship.
Use when the user wants to know what literature is available or needs suggestions.`,
  inputSchema: z.object({
    fellowship: z.enum(['AA', 'NA', 'CMA', 'RD', 'all'])
      .describe('Fellowship to filter by (AA=Alcoholics Anonymous, NA=Narcotics Anonymous, CMA=Crystal Meth Anonymous, RD=Recover Dharma)'),
    limit: z.number().min(1).max(50).default(20).describe('Maximum entries to return'),
  }),
  execute: async ({ fellowship, limit }) => {
    return withSpan('tool.listLiterature', async () => {
      const logger = getLogger().child({ tool: 'listLiterature' })
      logger.info({ fellowship, limit }, 'Listing literature')

      try {
        const repo = getLiteratureRepo()
        const result = fellowship === 'all'
          ? await repo.findAll(limit)
          : await repo.findAll(limit, fellowship)

        if (!result.ok) {
          return {
            success: false,
            literature: [],
            count: 0,
            message: 'Unable to list literature right now.',
          }
        }

        const items = result.value.map(lit => ({
          id: lit.id,
          title: lit.title,
          fellowship: lit.fellowship,
          edition: lit.edition,
          datePublished: lit.datePublished,
          summary: lit.summary,
        }))

        logger.info({ count: items.length, fellowship }, 'Literature listed')

        const fellowshipLabel = fellowship === 'all' ? '' : `${fellowship} `
        return {
          success: true,
          literature: items,
          count: items.length,
          message: items.length > 0
            ? `Found ${items.length} ${fellowshipLabel}piece${items.length === 1 ? '' : 's'} of literature available.`
            : `No ${fellowshipLabel}literature currently available in the database.`,
        }
      } catch (error) {
        logger.error({ error }, 'List literature failed')
        return {
          success: false,
          literature: [],
          count: 0,
          message: 'Unable to list literature right now.',
        }
      }
    })
  },
})

/**
 * All literature tools
 */
export const literatureTools = {
  searchLiterature,
  getLiteraturePassage,
  listLiterature,
}
