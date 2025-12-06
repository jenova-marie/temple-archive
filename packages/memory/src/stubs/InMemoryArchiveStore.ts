/**
 * In-memory stub implementation of Archive Store (S3)
 */

import type {
  IArchiveStore,
  ArchivedConversation,
  ArchiveListItem,
  StoreError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

export class InMemoryArchiveStore implements IArchiveStore {
  private archives: Map<string, ArchivedConversation> = new Map()

  async archiveConversation(
    conversation: ArchivedConversation,
    ctx: TraceContext
  ): Promise<Result<string, StoreError>> {
    return withSpan('InMemoryArchiveStore.archiveConversation', async () => {
      const logger = getLogger().child({
        conversationId: conversation.conversationId,
        requestId: ctx.requestId,
      })

      const key = this.generateKey(conversation)

      this.archives.set(key, {
        ...conversation,
        archivedAt: Date.now(),
      })

      logger.debug({ key }, 'Conversation archived')
      return ok(key)
    })
  }

  async getArchivedConversation(
    key: string,
    ctx: TraceContext
  ): Promise<Result<ArchivedConversation, StoreError>> {
    return withSpan('InMemoryArchiveStore.getArchivedConversation', async () => {
      const logger = getLogger().child({ key, requestId: ctx.requestId })

      const archived = this.archives.get(key)

      if (!archived) {
        logger.debug('Archived conversation not found')
        return err({
          kind: 'NotFoundError',
          message: `Archive not found: ${key}`,
          context: { key },
        })
      }

      logger.debug('Archived conversation retrieved')
      return ok(archived)
    })
  }

  async listArchives(
    userId: string,
    options: { limit?: number; after?: string },
    ctx: TraceContext
  ): Promise<Result<ArchiveListItem[], StoreError>> {
    return withSpan('InMemoryArchiveStore.listArchives', async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId })
      const { limit = 100, after } = options

      const items: ArchiveListItem[] = []
      let foundAfter = !after

      for (const [key, conv] of this.archives.entries()) {
        if (conv.userId !== userId) continue

        if (!foundAfter) {
          if (key === after) {
            foundAfter = true
          }
          continue
        }

        items.push({
          key,
          conversationId: conv.conversationId,
          archivedAt: conv.archivedAt,
          size: JSON.stringify(conv).length,
        })

        if (items.length >= limit) break
      }

      logger.debug({ count: items.length }, 'Archives listed')
      return ok(items)
    })
  }

  private generateKey(conversation: ArchivedConversation): string {
    const date = new Date(conversation.archivedAt)
    return [
      'conversations',
      `year=${date.getFullYear()}`,
      `month=${String(date.getMonth() + 1).padStart(2, '0')}`,
      `day=${String(date.getDate()).padStart(2, '0')}`,
      `conversation_${conversation.conversationId}.json`,
    ].join('/')
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.archives.clear()
  }

  /**
   * Get archive count (for monitoring)
   */
  size(): number {
    return this.archives.size
  }
}
