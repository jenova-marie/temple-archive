/**
 * Deep Memory Service
 *
 * Enriches L3 entities with conversation context from their sourceHistory.
 * Retrieves the original messages around when an entity was created/updated,
 * providing the agent with richer context about what was discussed.
 */

import { getLogger, withSpan } from '@recoverysky/observability'
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
    window: number,
    ctx: TraceContext
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
  /** Number of messages before and after target to retrieve (default: 5) */
  messageWindow?: number
  /** Maximum number of sourceHistory entries to process per entity (default: 10) */
  maxEntriesPerEntity?: number
}

/**
 * Deep Memory Service
 *
 * Enriches entities with conversation context from L2 (PostgreSQL).
 * Uses sourceHistory to find original messages and retrieves ±N messages
 * around each extraction event.
 */
export class DeepMemoryService {
  private readonly messageWindow: number
  private readonly maxEntriesPerEntity: number

  constructor(
    private readonly sessionStore: IDeepMemorySessionStore,
    config?: DeepMemoryServiceConfig
  ) {
    this.messageWindow = config?.messageWindow ?? 5
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
      const logger = getLogger().child({
        entityCount: entities.length,
        strategy,
        requestId: ctx.requestId,
      })

      const enriched: EnrichedL3Entity[] = []

      for (const entity of entities) {
        const sourceEntries = this.selectEntries(entity.sourceHistory ?? [], strategy)
        const contexts: ConversationContext[] = []

        for (const entry of sourceEntries) {
          const messagesResult = await this.sessionStore.getMessagesAroundId(
            entry.conversationId,
            entry.messageId,
            this.messageWindow,
            ctx
          )

          if (messagesResult.ok && messagesResult.value.length > 0) {
            contexts.push({
              action: entry.action,
              timestamp: entry.timestamp,
              messages: messagesResult.value,
            })
          }
        }

        enriched.push({
          ...entity,
          conversationContexts: contexts,
        })
      }

      logger.debug(
        {
          entitiesEnriched: enriched.length,
          totalContexts: enriched.reduce((sum, e) => sum + e.conversationContexts.length, 0),
        },
        'Entities enriched with Deep Memory context'
      )

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
      messageWindow: this.messageWindow,
      maxEntriesPerEntity: this.maxEntriesPerEntity,
    }
  }
}
