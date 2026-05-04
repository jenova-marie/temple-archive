/**
 * RAG Tools for the Siri Agent
 *
 * Read-only client over ninshubur's wisdom archive (Qdrant + Postgres).
 * Exposes `searchKnowledge` so the model can fetch relevant teachings
 * and conversations on demand.
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@siri/observability'
import type { TraceContext } from '@siri/types'
import type { IRagStore, RagResult } from '@siri/rag'

// ============================================================================
// Dependency Injection
// ============================================================================

let ragStoreInstance: IRagStore | null = null
let currentTraceContext: TraceContext | null = null

/**
 * Set the RAG store instance.
 * Called once during container initialization.
 */
export function setRagToolStore(store: IRagStore): void {
  ragStoreInstance = store
}

/**
 * Set the current trace context for RAG tools.
 * Must be called at the start of each request/pipeline run.
 */
export function setRagToolTraceContext(ctx: TraceContext): void {
  currentTraceContext = ctx
}

/**
 * Clear the current trace context.
 * Should be called after each request completes.
 */
export function clearRagToolTraceContext(): void {
  currentTraceContext = null
}

function getRagStore(): IRagStore {
  if (!ragStoreInstance) {
    throw new Error('RAG tools not initialized — call setRagToolStore first')
  }
  return ragStoreInstance
}

function getTraceContext(): TraceContext {
  if (!currentTraceContext) {
    throw new Error(
      'TraceContext not set — call setRagToolTraceContext before using RAG tools',
    )
  }
  return currentTraceContext
}

/**
 * Format a single hit for the model. Prefer hydrated source row over
 * the lighter Qdrant payload when available.
 */
function formatResult(r: RagResult): Record<string, unknown> {
  if (r.scopeType === 'group') {
    return {
      id: r.scopeId,
      type: 'teaching',
      score: r.score,
      summary: r.payload.summary ?? r.hydrated?.summary ?? null,
      channelId: r.payload.channel_id ?? r.hydrated?.channel_id ?? null,
      startedAt: r.payload.started_at ?? r.hydrated?.started_at ?? null,
      endedAt: r.payload.ended_at ?? r.hydrated?.ended_at ?? null,
      messageCount: r.payload.message_count ?? r.hydrated?.message_count ?? null,
      categorySlugs: r.payload.category_slugs ?? null,
    }
  }
  return {
    id: r.scopeId,
    type: 'message',
    score: r.score,
    content: r.hydrated?.content ?? r.payload.text ?? null,
    author: r.hydrated?.author ?? null,
    createdAt: r.hydrated?.created_at ?? r.payload.created_at ?? null,
    channelId: r.payload.channel_id ?? null,
    categorySlugs: r.payload.category_slugs ?? null,
  }
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Search the wisdom archive — ninshubur's gathered teachings and
 * conversations between Siri and Jenova.
 */
export const searchKnowledge = tool({
  description: `Search the Temple of Inanna's Light archive — gathered teachings, conversations, and answers from past discussions between Siri and Jenova. Use when:
- The user asks about something likely to be in past conversations
- You need recovery wisdom, philosophical teachings, or specific guidance
- The user asks "what did we talk about" or references something from before
- You want to ground a response in real prior dialogue rather than improvise

Returns the top-K most semantically relevant hits with scores and metadata.`,
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Semantic search query — phrase as the question or topic you are looking for.',
      ),
    scope: z
      .enum(['messages', 'groups'])
      .optional()
      .describe(
        'Granular individual messages vs. grouped teaching units. Defaults to "groups" — usually more useful since they carry summaries.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('How many hits to retrieve (1–12, default 6).'),
    category: z
      .string()
      .optional()
      .describe(
        "Optional category slug filter (e.g. 'recovery', 'lesson'). Omit unless the user asked for a specific kind of teaching.",
      ),
    channelId: z
      .string()
      .optional()
      .describe('Optional Discord channel snowflake to scope the search to one channel.'),
  }),
  execute: async ({ query, scope, limit, category, channelId }) => {
    return withSpan('tool.searchKnowledge', async () => {
      const logger = getLogger().child({ tool: 'searchKnowledge' })
      // Defaults applied here rather than via Zod .default() — keeps the
      // streamed args shape stable for clients that strict-check the
      // argsText delta sequence (e.g., assistant-ui).
      const resolvedScope = scope ?? 'groups'
      const resolvedLimit = limit ?? 6
      logger.info(
        { query, scope: resolvedScope, limit: resolvedLimit, category, channelId },
        'Searching wisdom archive',
      )

      try {
        const store = getRagStore()
        const ctx = getTraceContext()

        const result = await store.query(
          { query, scope: resolvedScope, limit: resolvedLimit, category, channelId },
          ctx,
        )

        if (!result.ok) {
          logger.warn({ error: result.error }, 'RAG search failed')
          return {
            success: false,
            results: [],
            message: 'Unable to search the archive right now.',
          }
        }

        const formatted = result.value.map(formatResult)
        logger.info({ count: formatted.length }, 'Archive hits returned')

        return {
          success: true,
          results: formatted,
          count: formatted.length,
          message:
            formatted.length > 0
              ? `Found ${formatted.length} relevant ${resolvedScope === 'groups' ? 'teachings' : 'messages'}.`
              : `No archive matches for "${query}".`,
        }
      } catch (error) {
        logger.error({ error }, 'RAG search threw')
        return {
          success: false,
          results: [],
          message: 'Archive search encountered an error.',
        }
      }
    })
  },
})

// ============================================================================
// Tool Collections
// ============================================================================

export const ragTools = {
  searchKnowledge,
}

/**
 * Get RAG tools if the store is configured.
 */
export function getRagTools(): Record<string, unknown> {
  if (!ragStoreInstance) return {}
  return ragTools
}
