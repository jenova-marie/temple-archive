/**
 * Conversation Memory Cache - L1 Redis Storage
 *
 * Stores pre-formatted memory strings for a conversation.
 * These are sent directly to the LLM with each request.
 */

import type { Redis } from 'ioredis'
import { getLogger } from '@recoverysky/observability'
import type { IConversationMemoryCache, CacheMetadata, BootstrapConfig } from './types.js'

/**
 * Redis key generators for memory cache
 */
const MemoryCacheKeys = {
  /** Memory entries (List of strings) */
  entries: (conversationId: string): string =>
    `memory:cache:${conversationId}:entries`,

  /** Cache metadata (Hash) */
  metadata: (conversationId: string): string =>
    `memory:cache:${conversationId}:meta`,
} as const

/**
 * Redis-backed conversation memory cache
 */
export class ConversationMemoryCache implements IConversationMemoryCache {
  private readonly ttlSeconds: number
  private readonly maxEntries: number

  constructor(
    private readonly redis: Redis,
    config: BootstrapConfig
  ) {
    this.ttlSeconds = config.cacheTTLHours * 60 * 60
    this.maxEntries = config.cacheLimit === 'all' ? Infinity :
                      config.cacheLimit === 'none' ? 0 :
                      config.cacheLimit
  }

  /**
   * Get all memory entries for a conversation
   */
  async get(conversationId: string): Promise<string[]> {
    const logger = getLogger().child({ conversationId, component: 'ConversationMemoryCache' })

    try {
      const key = MemoryCacheKeys.entries(conversationId)
      const entries = await this.redis.lrange(key, 0, -1)

      logger.debug({ count: entries.length }, 'Retrieved memory cache entries')
      return entries
    } catch (error) {
      logger.error({ error }, 'Failed to get memory cache entries')
      return []
    }
  }

  /**
   * Add new entries to the cache
   */
  async add(conversationId: string, entries: string[], userId: string): Promise<void> {
    const logger = getLogger().child({ conversationId, component: 'ConversationMemoryCache' })

    if (entries.length === 0 || this.maxEntries === 0) {
      return
    }

    try {
      const entriesKey = MemoryCacheKeys.entries(conversationId)
      const metaKey = MemoryCacheKeys.metadata(conversationId)

      const pipeline = this.redis.pipeline()

      // Add entries to the list
      pipeline.rpush(entriesKey, ...entries)

      // Trim to max entries (keep the most recent)
      if (this.maxEntries !== Infinity) {
        pipeline.ltrim(entriesKey, -this.maxEntries, -1)
      }

      // Refresh TTL
      pipeline.expire(entriesKey, this.ttlSeconds)

      // Update metadata
      pipeline.hset(metaKey, {
        conversationId,
        userId,
        lastUpdated: String(Date.now()),
      })
      pipeline.hincrby(metaKey, 'entryCount', entries.length)
      pipeline.expire(metaKey, this.ttlSeconds)

      await pipeline.exec()

      logger.debug({ added: entries.length }, 'Added entries to memory cache')
    } catch (error) {
      logger.error({ error }, 'Failed to add entries to memory cache')
    }
  }

  /**
   * Replace entire cache (after dedup/merge)
   */
  async replace(conversationId: string, entries: string[], userId: string): Promise<void> {
    const logger = getLogger().child({ conversationId, component: 'ConversationMemoryCache' })

    try {
      const entriesKey = MemoryCacheKeys.entries(conversationId)
      const metaKey = MemoryCacheKeys.metadata(conversationId)

      const pipeline = this.redis.pipeline()

      // Delete existing entries
      pipeline.del(entriesKey)

      // Add new entries (if any and if not 'none' limit)
      if (entries.length > 0 && this.maxEntries > 0) {
        const entriesToStore = this.maxEntries === Infinity
          ? entries
          : entries.slice(-this.maxEntries)

        pipeline.rpush(entriesKey, ...entriesToStore)
        pipeline.expire(entriesKey, this.ttlSeconds)
      }

      // Update metadata
      pipeline.hset(metaKey, {
        conversationId,
        userId,
        entryCount: String(entries.length),
        lastUpdated: String(Date.now()),
      })
      pipeline.expire(metaKey, this.ttlSeconds)

      await pipeline.exec()

      logger.debug({ count: entries.length }, 'Replaced memory cache entries')
    } catch (error) {
      logger.error({ error }, 'Failed to replace memory cache entries')
    }
  }

  /**
   * Clear cache for a conversation
   */
  async clear(conversationId: string): Promise<void> {
    const logger = getLogger().child({ conversationId, component: 'ConversationMemoryCache' })

    try {
      const entriesKey = MemoryCacheKeys.entries(conversationId)
      const metaKey = MemoryCacheKeys.metadata(conversationId)

      await this.redis.del(entriesKey, metaKey)

      logger.debug('Cleared memory cache')
    } catch (error) {
      logger.error({ error }, 'Failed to clear memory cache')
    }
  }

  /**
   * Get cache metadata
   */
  async getMetadata(conversationId: string): Promise<CacheMetadata | null> {
    const logger = getLogger().child({ conversationId, component: 'ConversationMemoryCache' })

    try {
      const metaKey = MemoryCacheKeys.metadata(conversationId)
      const data = await this.redis.hgetall(metaKey)

      if (!data || Object.keys(data).length === 0) {
        return null
      }

      return {
        conversationId: data.conversationId || conversationId,
        userId: data.userId || '',
        entryCount: parseInt(data.entryCount || '0', 10),
        exchangeCount: parseInt(data.exchangeCount || '0', 10),
        lastUpdated: parseInt(data.lastUpdated || '0', 10),
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get memory cache metadata')
      return null
    }
  }

  /**
   * Increment exchange count and return new value
   */
  async incrementExchangeCount(conversationId: string): Promise<number> {
    const logger = getLogger().child({ conversationId, component: 'ConversationMemoryCache' })

    try {
      const metaKey = MemoryCacheKeys.metadata(conversationId)

      const pipeline = this.redis.pipeline()
      pipeline.hincrby(metaKey, 'exchangeCount', 1)
      pipeline.hget(metaKey, 'exchangeCount')
      pipeline.expire(metaKey, this.ttlSeconds)

      const results = await pipeline.exec()

      // hincrby returns the new value
      const newCount = results?.[0]?.[1] as number ?? 1

      logger.debug({ exchangeCount: newCount }, 'Incremented exchange count')
      return newCount
    } catch (error) {
      logger.error({ error }, 'Failed to increment exchange count')
      return 0
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryConversationMemoryCache implements IConversationMemoryCache {
  private caches: Map<string, string[]> = new Map()
  private metadata: Map<string, CacheMetadata> = new Map()
  private maxEntries: number

  constructor(config: BootstrapConfig) {
    this.maxEntries = config.cacheLimit === 'all' ? Infinity :
                      config.cacheLimit === 'none' ? 0 :
                      config.cacheLimit
  }

  async get(conversationId: string): Promise<string[]> {
    return this.caches.get(conversationId) ?? []
  }

  async add(conversationId: string, entries: string[], userId: string): Promise<void> {
    if (entries.length === 0 || this.maxEntries === 0) return

    const existing = this.caches.get(conversationId) ?? []
    let combined = [...existing, ...entries]

    if (this.maxEntries !== Infinity) {
      combined = combined.slice(-this.maxEntries)
    }

    this.caches.set(conversationId, combined)

    const meta = this.metadata.get(conversationId) ?? {
      conversationId,
      userId,
      entryCount: 0,
      exchangeCount: 0,
      lastUpdated: Date.now(),
    }
    meta.entryCount = combined.length
    meta.lastUpdated = Date.now()
    this.metadata.set(conversationId, meta)
  }

  async replace(conversationId: string, entries: string[], userId: string): Promise<void> {
    const toStore = this.maxEntries === Infinity
      ? entries
      : entries.slice(-this.maxEntries)

    this.caches.set(conversationId, toStore)

    this.metadata.set(conversationId, {
      conversationId,
      userId,
      entryCount: toStore.length,
      exchangeCount: this.metadata.get(conversationId)?.exchangeCount ?? 0,
      lastUpdated: Date.now(),
    })
  }

  async clear(conversationId: string): Promise<void> {
    this.caches.delete(conversationId)
    this.metadata.delete(conversationId)
  }

  async getMetadata(conversationId: string): Promise<CacheMetadata | null> {
    return this.metadata.get(conversationId) ?? null
  }

  async incrementExchangeCount(conversationId: string): Promise<number> {
    let meta = this.metadata.get(conversationId)
    if (!meta) {
      // Create metadata if it doesn't exist
      meta = {
        conversationId,
        userId: '',
        entryCount: 0,
        exchangeCount: 0,
        lastUpdated: Date.now(),
      }
      this.metadata.set(conversationId, meta)
    }
    meta.exchangeCount++
    meta.lastUpdated = Date.now()
    return meta.exchangeCount
  }

  /** Clear all data (for testing) */
  clearAll(): void {
    this.caches.clear()
    this.metadata.clear()
  }
}
