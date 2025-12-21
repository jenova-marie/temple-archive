/**
 * Deep Memory Service
 *
 * Enriches L3 entities with conversation context from their sourceHistory.
 * Retrieves the original messages around when an entity was created/updated,
 * providing the agent with richer context about what was discussed.
 */

import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import type {
  L3EntityWithObservations,
  EnrichedL3Entity,
  ConversationContext,
  SourceEntry,
  Message,
  TraceContext,
  Result,
  StoreError,
} from '@recoverysky/types'

/**
 * Interface for session store with message retrieval capability.
 * Matches PostgresSessionStore.getMessagesAroundId signature.
 */
export interface IDeepMemorySessionStore {
  getMessagesAroundId(
    conversationId: string,
    messageId: string,
    windowBefore: number,
    ctx: TraceContext,
    windowAfter?: number
  ): Promise<Result<Message[], StoreError>>
}

/**
 * Strategy for selecting which sourceHistory entries to fetch context for.
 */
export type ContextStrategy = 'latest' | 'created_and_latest' | 'all'

/**
 * Configuration for Deep Memory Service
 */
export interface DeepMemoryServiceConfig {
  /** Number of messages before target to retrieve (default: 5) */
  messageWindow?: number
  /** Ratio for messages after target (default: 0.5, so 5 before = 2 after) */
  messageWindowAfterRatio?: number
  /** Maximum number of sourceHistory entries to process per entity (default: 10) */
  maxEntriesPerEntity?: number
}

/**
 * Deep Memory Service
 *
 * Enriches entities with conversation context from L2 (PostgreSQL).
 * Uses sourceHistory to find original messages and retrieves messages
 * around each extraction event (more before than after, since context
 * leading up to extraction is more valuable).
 */
export class DeepMemoryService {
  private readonly messageWindowBefore: number
  private readonly messageWindowAfter: number
  private readonly maxEntriesPerEntity: number

  constructor(
    private readonly sessionStore: IDeepMemorySessionStore,
    config?: DeepMemoryServiceConfig
  ) {
    this.messageWindowBefore = config?.messageWindow ?? 5
    const afterRatio = config?.messageWindowAfterRatio ?? 0.5
    this.messageWindowAfter = Math.floor(this.messageWindowBefore * afterRatio)
    this.maxEntriesPerEntity = config?.maxEntriesPerEntity ?? 10
  }

  /**
   * Enrich entities with conversation context from their sourceHistory.
   *
   * @param entities - Entities to enrich (must have sourceHistory)
   * @param strategy - Which sourceHistory entries to include context for
   * @param ctx - Trace context
   * @returns Entities with conversationContexts populated
   */
  async enrichWithContext(
    entities: L3EntityWithObservations[],
    strategy: ContextStrategy = 'latest',
    ctx: TraceContext
  ): Promise<EnrichedL3Entity[]> {
    return withSpan('DeepMemoryService.enrichWithContext', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        entityCount: entities.length,
        strategy,
        messageWindowBefore: this.messageWindowBefore,
        messageWindowAfter: this.messageWindowAfter,
        requestId: ctx.requestId,
      })

      if (entities.length === 0) {
        logger.debug('No entities to enrich')
        return []
      }

      logger.debug('Starting Deep Memory enrichment')

      const enriched: EnrichedL3Entity[] = []
      let totalSourceEntries = 0
      let successfulFetches = 0
      let failedFetches = 0

      for (const entity of entities) {
        const sourceEntries = this.selectEntries(entity.sourceHistory ?? [], strategy)
        totalSourceEntries += sourceEntries.length
        const contexts: ConversationContext[] = []

        for (const entry of sourceEntries) {
          const messagesResult = await this.sessionStore.getMessagesAroundId(
            entry.conversationId,
            entry.messageId,
            this.messageWindowBefore,
            ctx,
            this.messageWindowAfter
          )

          if (messagesResult.ok && messagesResult.value.length > 0) {
            contexts.push({
              action: entry.action,
              timestamp: entry.timestamp,
              messages: messagesResult.value,
            })
            successfulFetches++
          } else if (!messagesResult.ok) {
            failedFetches++
            logger.debug(
              { entityName: entity.name, messageId: entry.messageId, error: messagesResult.error },
              'Failed to fetch context for sourceHistory entry'
            )
          }
        }

        enriched.push({
          ...entity,
          conversationContexts: contexts,
        })
      }

      const durationMs = Date.now() - startTime
      const totalContexts = enriched.reduce((sum, e) => sum + e.conversationContexts.length, 0)
      const totalMessages = enriched.reduce(
        (sum, e) => sum + e.conversationContexts.reduce((s, c) => s + c.messages.length, 0),
        0
      )

      logger.info(
        {
          entitiesEnriched: enriched.length,
          totalSourceEntries,
          totalContexts,
          totalMessages,
          successfulFetches,
          failedFetches,
          durationMs,
        },
        'Deep Memory enrichment complete'
      )

      // Record metrics
      pipelineMetrics.stageDuration.record(durationMs, { stage: 'deep_memory_enrich' })
      if (failedFetches > 0) {
        pipelineMetrics.errors.add(failedFetches, { kind: 'deep_memory_fetch_error' })
      }

      return enriched
    })
  }

  /**
   * Select which sourceHistory entries to fetch context for based on strategy.
   *
   * @param entries - All sourceHistory entries
   * @param strategy - Selection strategy
   * @returns Selected entries (limited by maxEntriesPerEntity)
   */
  private selectEntries(entries: SourceEntry[], strategy: ContextStrategy): SourceEntry[] {
    if (entries.length === 0) {
      return []
    }

    // Sort by timestamp descending (most recent first)
    const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp)

    let selected: SourceEntry[]

    switch (strategy) {
      case 'latest':
        // Just the most recent entry
        selected = [sorted[0]]
        break

      case 'created_and_latest':
        // The creation event + most recent (if different)
        const created = sorted.find((e) => e.action === 'created')
        const latest = sorted[0]

        if (created && created.messageId !== latest.messageId) {
          selected = [created, latest]
        } else if (created) {
          selected = [created]
        } else {
          selected = [latest]
        }
        break

      case 'all':
        // All entries, limited by maxEntriesPerEntity
        selected = sorted.slice(0, this.maxEntriesPerEntity)
        break

      default:
        selected = [sorted[0]]
    }

    return selected
  }

  /**
   * Get configuration values.
   */
  getConfig(): Required<DeepMemoryServiceConfig> {
    return {
      messageWindow: this.messageWindowBefore,
      messageWindowAfterRatio: this.messageWindowAfter / this.messageWindowBefore,
      maxEntriesPerEntity: this.maxEntriesPerEntity,
    }
  }
}
