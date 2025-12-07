/**
 * Memory Cache Persistence - L1 (Redis) → L2 (PostgreSQL)
 *
 * Handles persisting conversation memory caches and loading from past conversations.
 */

import type { Result, StoreError } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'
import { eq, inArray } from 'drizzle-orm'
import type { IMemoryCachePersistence, IConversationMemoryCache } from './types.js'

/**
 * Database client interface (matches Drizzle pattern)
 */
interface DbClient {
  select: () => any
  insert: (table: any) => any
  update: (table: any) => any
  delete: (table: any) => any
}

/**
 * Memory cache table shape (matches schema)
 */
interface MemoryCacheTable {
  id: any
  conversationId: any
  userId: any
  memories: any
  topicSummary: any
  createdAt: any
  updatedAt: any
}

/**
 * PostgreSQL-backed memory cache persistence
 */
export class MemoryCachePersistence implements IMemoryCachePersistence {
  constructor(
    private readonly db: DbClient,
    private readonly table: MemoryCacheTable,
    private readonly cache: IConversationMemoryCache
  ) {}

  async persist(
    conversationId: string,
    userId: string,
    topicSummary?: string
  ): Promise<Result<void, StoreError>> {
    return withSpan('MemoryCachePersistence.persist', async () => {
      const logger = getLogger().child({
        component: 'MemoryCachePersistence',
        conversationId,
      })

      try {
        // Get memories from L1
        const memories = await this.cache.get(conversationId)

        if (memories.length === 0) {
          logger.debug('No memories to persist')
          return ok(undefined)
        }

        // Upsert to L2
        await this.db
          .insert(this.table)
          .values({
            conversationId,
            userId,
            memories,
            topicSummary: topicSummary ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: this.table.conversationId,
            set: {
              memories,
              topicSummary: topicSummary ?? null,
              updatedAt: new Date(),
            },
          })

        logger.info({ count: memories.length }, 'Persisted L1 cache to L2')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to persist memory cache')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to persist memory cache',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }

  async load(conversationId: string): Promise<Result<string[], StoreError>> {
    return withSpan('MemoryCachePersistence.load', async () => {
      const logger = getLogger().child({
        component: 'MemoryCachePersistence',
        conversationId,
      })

      try {
        const rows = await this.db
          .select()
          .from(this.table)
          .where(eq(this.table.conversationId, conversationId))
          .limit(1)

        if (rows.length === 0) {
          logger.debug('No cached memories found in L2')
          return ok([])
        }

        const memories = rows[0].memories as string[]
        logger.debug({ count: memories.length }, 'Loaded memories from L2')
        return ok(memories)
      } catch (error) {
        logger.error({ error }, 'Failed to load memory cache')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to load memory cache',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }

  async loadMany(conversationIds: string[]): Promise<Result<string[], StoreError>> {
    return withSpan('MemoryCachePersistence.loadMany', async () => {
      const logger = getLogger().child({
        component: 'MemoryCachePersistence',
        count: conversationIds.length,
      })

      if (conversationIds.length === 0) {
        return ok([])
      }

      try {
        const rows = await this.db
          .select()
          .from(this.table)
          .where(inArray(this.table.conversationId, conversationIds))

        // Flatten all memories from all conversations
        const allMemories: string[] = []
        for (const row of rows) {
          const memories = row.memories as string[]
          allMemories.push(...memories)
        }

        logger.debug(
          { conversations: rows.length, memories: allMemories.length },
          'Loaded memories from multiple L2 conversations'
        )
        return ok(allMemories)
      } catch (error) {
        logger.error({ error }, 'Failed to load memory caches')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to load memory caches',
          context: { conversationIds },
          cause: error,
        })
      }
    })
  }

  /**
   * Delete cached memories for a conversation
   */
  async delete(conversationId: string): Promise<Result<void, StoreError>> {
    return withSpan('MemoryCachePersistence.delete', async () => {
      const logger = getLogger().child({
        component: 'MemoryCachePersistence',
        conversationId,
      })

      try {
        await this.db
          .delete(this.table)
          .where(eq(this.table.conversationId, conversationId))

        logger.debug('Deleted memory cache from L2')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to delete memory cache')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to delete memory cache',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }
}

/**
 * Stub implementation for testing
 */
export class InMemoryMemoryCachePersistence implements IMemoryCachePersistence {
  private store: Map<string, { userId: string; memories: string[]; topicSummary?: string }> = new Map()

  constructor(private readonly cache: IConversationMemoryCache) {}

  async persist(
    conversationId: string,
    userId: string,
    topicSummary?: string
  ): Promise<Result<void, StoreError>> {
    const memories = await this.cache.get(conversationId)
    this.store.set(conversationId, { userId, memories, topicSummary })
    return ok(undefined)
  }

  async load(conversationId: string): Promise<Result<string[], StoreError>> {
    const entry = this.store.get(conversationId)
    return ok(entry?.memories ?? [])
  }

  async loadMany(conversationIds: string[]): Promise<Result<string[], StoreError>> {
    const allMemories: string[] = []
    for (const id of conversationIds) {
      const entry = this.store.get(id)
      if (entry) {
        allMemories.push(...entry.memories)
      }
    }
    return ok(allMemories)
  }

  async delete(conversationId: string): Promise<Result<void, StoreError>> {
    this.store.delete(conversationId)
    return ok(undefined)
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.store.clear()
  }

  /** Get all stored data (for testing) */
  getAll(): Map<string, { userId: string; memories: string[]; topicSummary?: string }> {
    return new Map(this.store)
  }
}
