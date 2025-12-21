/**
 * Memory Retrieval Service
 *
 * Unified retrieval across L3 (Neo4j) and L4 (Qdrant) with:
 * - Multi-channel parallel search
 * - Result merging and deduplication
 * - Deep Memory context enrichment
 * - Ranking and scoring
 * - Token budget fitting
 */

import { getLogger, withSpan, pipelineMetrics } from '@pippa/observability'
import type {
  L3Entity,
  L3EntityWithObservations,
  EnrichedL3Entity,
  TraceContext,
  Result,
  StoreError,
} from '@pippa/types'
import { ok, err } from '@pippa/types'
import type { Neo4jKnowledgeStore } from '../stores/Neo4jKnowledgeStore.js'
import type { DeepMemoryService, ContextStrategy } from '../deepmemory/DeepMemoryService.js'
import type { MiniLMEmbeddingProvider } from '../embeddings/MiniLMProvider.js'

/**
 * Retrieval options
 */
export interface RetrievalOptions {
  /** Maximum entities to return */
  limit?: number
  /** Maximum tokens for formatted output */
  maxTokens?: number
  /** Include observations in results */
  includeObservations?: boolean
  /** Include Deep Memory conversation context */
  includeConversationContext?: boolean
  /** Deep Memory context strategy */
  contextStrategy?: ContextStrategy
  /** Minimum relevance score (0-1) */
  minScore?: number
}

/**
 * Ranking weights
 */
export interface RankingWeights {
  /** Weight for semantic similarity (default: 0.4) */
  semanticWeight: number
  /** Weight for recency (default: 0.2) */
  recencyWeight: number
  /** Weight for importance (default: 0.2) */
  importanceWeight: number
  /** Weight for mention frequency (default: 0.1) */
  frequencyWeight: number
  /** Weight for graph centrality (default: 0.1) */
  centralityWeight: number
}

/**
 * Scored entity with relevance score
 */
export interface ScoredEntity extends L3EntityWithObservations {
  /** Combined relevance score */
  score: number
  /** Individual score components */
  scoreComponents?: {
    semantic?: number
    recency?: number
    importance?: number
    frequency?: number
    centrality?: number
  }
}

/**
 * Retrieval result
 */
export interface RetrievalResult {
  /** Retrieved entities with scores and context */
  entities: EnrichedL3Entity[]
  /** Total entities matched before limit */
  totalMatched: number
  /** Approximate token count */
  tokenCount: number
  /** Formatted context string for agent */
  formattedContext: string
}

/**
 * Default ranking weights
 */
const DEFAULT_WEIGHTS: RankingWeights = {
  semanticWeight: 0.4,
  recencyWeight: 0.2,
  importanceWeight: 0.2,
  frequencyWeight: 0.1,
  centralityWeight: 0.1,
}

/**
 * Default retrieval options
 */
const DEFAULT_OPTIONS: Required<RetrievalOptions> = {
  limit: 10,
  maxTokens: 2000,
  includeObservations: true,
  includeConversationContext: true,
  contextStrategy: 'latest',
  minScore: 0.1,
}

/**
 * Memory Retrieval Service
 */
export class MemoryRetrievalService {
  private readonly weights: RankingWeights

  constructor(
    private readonly neo4jStore: Neo4jKnowledgeStore,
    private readonly miniLM: MiniLMEmbeddingProvider | null,
    private readonly deepMemory: DeepMemoryService | null,
    weights?: Partial<RankingWeights>
  ) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights }
  }

  /**
   * Retrieve relevant entities for a query.
   */
  async retrieve(
    query: string,
    userId: string,
    options: RetrievalOptions = {},
    ctx: TraceContext
  ): Promise<Result<RetrievalResult, StoreError>> {
    return withSpan('MemoryRetrievalService.retrieve', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        userId,
        queryLength: query.length,
        requestId: ctx.requestId,
      })

      const opts = { ...DEFAULT_OPTIONS, ...options }

      logger.debug(
        {
          limit: opts.limit,
          maxTokens: opts.maxTokens,
          includeObservations: opts.includeObservations,
          includeConversationContext: opts.includeConversationContext,
          contextStrategy: opts.contextStrategy,
          minScore: opts.minScore,
        },
        'Starting L3 memory retrieval'
      )

      try {
        // 1. Generate query embedding for future semantic search
        // Note: Semantic search via embedding will be added when Neo4j vector index is ready
        let hasEmbedding = false
        const embedStartTime = Date.now()
        if (this.miniLM) {
          const embedResult = await this.miniLM.embedOne(query)
          if (embedResult.ok) {
            hasEmbedding = true
            logger.debug(
              { durationMs: Date.now() - embedStartTime },
              'Query embedding generated for semantic search'
            )
          } else {
            logger.debug({ error: embedResult.error }, 'Query embedding generation failed')
          }
        }

        // 2. Search channels - currently using text-based search
        // Fulltext search on entity names
        const searchStartTime = Date.now()
        const searchResult = await this.neo4jStore.searchEntities(query, ctx)
        const searchDurationMs = Date.now() - searchStartTime

        let searchResults: L3Entity[] = []
        if (searchResult.ok) {
          // Convert legacy Entity to L3Entity format
          searchResults = searchResult.value.map((e) => ({
            id: e.entityId,
            name: e.name,
            displayName: e.name,
            aliases: [],
            canonicalType: (e.type as L3Entity['canonicalType']) || 'concept',
            labels: [],
            importance: ((e.properties as Record<string, unknown>)?.importance as number) ?? 0.5,
            firstSeen: e.firstMentioned,
            lastSeen: e.lastMentioned,
            mentionCount: 1,
            sourceHistory: [],
            metadata: e.properties ?? {},
          }))
          logger.debug(
            { found: searchResults.length, durationMs: searchDurationMs },
            'Entity search completed'
          )
        } else {
          logger.debug(
            { error: searchResult.error, query: query.slice(0, 100), durationMs: searchDurationMs },
            'Entity search failed - full error details'
          )
          logger.warn({ errorKind: searchResult.error.kind, durationMs: searchDurationMs }, 'Entity search failed')
        }

        // 3. Merge and deduplicate
        const merged = this.mergeResults(searchResults)
        logger.debug({ before: searchResults.length, after: merged.length }, 'Results merged and deduplicated')

        // 4. Get observations for entities
        let entitiesWithObs: L3EntityWithObservations[] = []
        if (opts.includeObservations && merged.length > 0) {
          const obsStartTime = Date.now()
          entitiesWithObs = await this.fetchObservations(merged, ctx)
          const totalObs = entitiesWithObs.reduce((sum, e) => sum + e.observations.length, 0)
          logger.debug(
            { entities: merged.length, observations: totalObs, durationMs: Date.now() - obsStartTime },
            'Observations fetched'
          )
        } else {
          entitiesWithObs = merged.map((e) => ({ ...e, observations: [] }))
        }

        // 5. Score and rank
        const scoreStartTime = Date.now()
        const scored = this.scoreEntities(entitiesWithObs, hasEmbedding)
        const ranked = scored
          .filter((e) => e.score >= opts.minScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, opts.limit)

        const filteredOut = scored.length - ranked.length
        logger.debug(
          {
            scored: scored.length,
            returned: ranked.length,
            filteredByScore: filteredOut,
            durationMs: Date.now() - scoreStartTime,
          },
          'Entities scored and ranked'
        )

        // 6. Deep Memory enrichment
        let enriched: EnrichedL3Entity[]
        if (opts.includeConversationContext && this.deepMemory && ranked.length > 0) {
          // Deep Memory enrichment is logged internally
          enriched = await this.deepMemory.enrichWithContext(
            ranked,
            opts.contextStrategy,
            ctx
          )
        } else {
          enriched = ranked.map((e) => ({ ...e, conversationContexts: [] }))
          if (ranked.length > 0 && !this.deepMemory) {
            logger.debug('Deep Memory not configured, skipping enrichment')
          }
        }

        // 7. Format and fit to token budget
        const formatStartTime = Date.now()
        const formatted = this.formatForAgent(enriched, opts.maxTokens)
        logger.debug(
          { tokenCount: formatted.tokenCount, maxTokens: opts.maxTokens, durationMs: Date.now() - formatStartTime },
          'Context formatted for agent'
        )

        const totalDurationMs = Date.now() - startTime
        logger.info(
          {
            totalMatched: merged.length,
            returned: enriched.length,
            tokenCount: formatted.tokenCount,
            durationMs: totalDurationMs,
            hasEmbedding,
            deepMemoryEnabled: opts.includeConversationContext && !!this.deepMemory,
          },
          'L3 memory retrieval complete'
        )

        // Record metrics
        pipelineMetrics.stageDuration.record(totalDurationMs, { stage: 'l3_memory_retrieval' })
        pipelineMetrics.stageDuration.record(searchDurationMs, { stage: 'l3_entity_search' })

        return ok({
          entities: enriched,
          totalMatched: merged.length,
          tokenCount: formatted.tokenCount,
          formattedContext: formatted.text,
        })
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.debug(
          { error, stack: error instanceof Error ? error.stack : undefined, query: query.slice(0, 100), durationMs },
          'L3 memory retrieval failed - full error'
        )
        logger.error({ errorMessage: error instanceof Error ? error.message : String(error), durationMs }, 'L3 memory retrieval failed')
        pipelineMetrics.errors.add(1, { kind: 'l3_retrieval_error' })
        return err({
          kind: 'UnexpectedError',
          message: 'Memory retrieval failed',
          context: { query: query.slice(0, 50) },
          cause: error,
        })
      }
    })
  }

  /**
   * Merge results from multiple search channels, deduplicating by entity name.
   */
  private mergeResults(entities: L3Entity[]): L3Entity[] {
    const byName = new Map<string, L3Entity>()

    for (const entity of entities) {
      const key = entity.name.toLowerCase()
      const existing = byName.get(key)

      if (!existing) {
        byName.set(key, entity)
      } else {
        // Keep the one with higher importance or more recent
        if (entity.importance > existing.importance) {
          byName.set(key, entity)
        } else if (
          entity.importance === existing.importance &&
          entity.lastSeen > existing.lastSeen
        ) {
          byName.set(key, entity)
        }
      }
    }

    return Array.from(byName.values())
  }

  /**
   * Fetch observations for entities.
   */
  private async fetchObservations(
    entities: L3Entity[],
    ctx: TraceContext
  ): Promise<L3EntityWithObservations[]> {
    const results: L3EntityWithObservations[] = []

    for (const entity of entities) {
      const obsResult = await this.neo4jStore.getEntityObservations(
        entity.name,
        { limit: 5 },
        ctx
      )

      results.push({
        ...entity,
        observations: obsResult.ok ? obsResult.value : [],
      })
    }

    return results
  }

  /**
   * Score entities based on multiple signals.
   */
  private scoreEntities(
    entities: L3EntityWithObservations[],
    hasEmbedding: boolean
  ): ScoredEntity[] {
    const now = Date.now()
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000

    // Find max values for normalization
    const maxMentions = Math.max(...entities.map((e) => e.mentionCount), 1)

    return entities.map((entity) => {
      const components: ScoredEntity['scoreComponents'] = {}

      // Semantic score placeholder
      // TODO: Real semantic score would come from vector similarity search
      components.semantic = hasEmbedding && entity.embedding ? 0.7 : 0.5

      // Recency score (decay over time)
      const ageMs = now - entity.lastSeen
      components.recency = Math.max(0, 1 - ageMs / oneWeekMs)

      // Importance score (already 0-1)
      components.importance = entity.importance

      // Frequency score (normalized by max)
      components.frequency = entity.mentionCount / maxMentions

      // Centrality score (placeholder - would need graph analysis)
      components.centrality = 0.5

      // Combined weighted score
      const score =
        components.semantic * this.weights.semanticWeight +
        components.recency * this.weights.recencyWeight +
        components.importance * this.weights.importanceWeight +
        components.frequency * this.weights.frequencyWeight +
        components.centrality * this.weights.centralityWeight

      return {
        ...entity,
        score,
        scoreComponents: components,
      }
    })
  }

  /**
   * Format entities for agent prompt, respecting token budget.
   */
  private formatForAgent(
    entities: EnrichedL3Entity[],
    maxTokens: number
  ): { text: string; tokenCount: number } {
    if (entities.length === 0) {
      return { text: '', tokenCount: 0 }
    }

    let output = '## Memory Context\n\n'
    let estimatedTokens = 10 // Header

    for (const entity of entities) {
      const entityBlock = this.formatEntity(entity)
      const blockTokens = this.estimateTokens(entityBlock)

      if (estimatedTokens + blockTokens > maxTokens) {
        break
      }

      output += entityBlock
      estimatedTokens += blockTokens
    }

    return { text: output, tokenCount: estimatedTokens }
  }

  /**
   * Format a single entity for the prompt.
   */
  private formatEntity(entity: EnrichedL3Entity): string {
    let block = `### ${entity.displayName} (${entity.canonicalType})\n`

    if (entity.labels.length > 0) {
      block += `Labels: ${entity.labels.join(', ')}\n`
    }

    // Recent observations
    if (entity.observations.length > 0) {
      block += '\nRecent observations:\n'
      for (const obs of entity.observations.slice(0, 3)) {
        block += `- ${obs.content}\n`
      }
    }

    // Conversation context (from Deep Memory)
    if (entity.conversationContexts.length > 0) {
      const ctx = entity.conversationContexts[0]
      block += '\nOriginal context:\n'
      for (const msg of ctx.messages.slice(0, 4)) {
        const role = msg.role === 'user' ? 'You' : 'Pippa'
        block += `> ${role}: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`
      }
    }

    block += '\n'
    return block
  }

  /**
   * Rough token estimation (4 chars per token average).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Get current ranking weights.
   */
  getWeights(): RankingWeights {
    return { ...this.weights }
  }
}
