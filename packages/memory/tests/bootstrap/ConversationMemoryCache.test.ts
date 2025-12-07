/**
 * ConversationMemoryCache Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryConversationMemoryCache,
  DEFAULT_BOOTSTRAP_CONFIG,
} from '../../src/bootstrap/index.js'

describe('InMemoryConversationMemoryCache', () => {
  let cache: InMemoryConversationMemoryCache

  beforeEach(() => {
    cache = new InMemoryConversationMemoryCache(DEFAULT_BOOTSTRAP_CONFIG)
  })

  describe('get', () => {
    it('should return empty array for new conversation', async () => {
      const entries = await cache.get('conv-1')
      expect(entries).toEqual([])
    })

    it('should return cached entries', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')
      const entries = await cache.get('conv-1')
      expect(entries).toEqual(['- Mike:person -> sponsor'])
    })
  })

  describe('add', () => {
    it('should add entries to cache', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')
      await cache.add('conv-1', ['- Tuesday:event -> meeting day'], 'user-1')

      const entries = await cache.get('conv-1')
      expect(entries).toHaveLength(2)
      expect(entries).toContain('- Mike:person -> sponsor')
      expect(entries).toContain('- Tuesday:event -> meeting day')
    })

    it('should not add empty entries', async () => {
      await cache.add('conv-1', [], 'user-1')
      const entries = await cache.get('conv-1')
      expect(entries).toEqual([])
    })

    it('should respect cache limit', async () => {
      const limitedCache = new InMemoryConversationMemoryCache({
        ...DEFAULT_BOOTSTRAP_CONFIG,
        cacheLimit: 3,
      })

      await limitedCache.add('conv-1', ['entry-1', 'entry-2', 'entry-3'], 'user-1')
      await limitedCache.add('conv-1', ['entry-4', 'entry-5'], 'user-1')

      const entries = await limitedCache.get('conv-1')
      expect(entries).toHaveLength(3)
      // Should keep the most recent entries
      expect(entries).toContain('entry-3')
      expect(entries).toContain('entry-4')
      expect(entries).toContain('entry-5')
    })

    it('should handle cacheLimit: none', async () => {
      const noneCache = new InMemoryConversationMemoryCache({
        ...DEFAULT_BOOTSTRAP_CONFIG,
        cacheLimit: 'none',
      })

      await noneCache.add('conv-1', ['entry-1'], 'user-1')
      const entries = await noneCache.get('conv-1')
      expect(entries).toEqual([])
    })

    it('should handle cacheLimit: all', async () => {
      const allCache = new InMemoryConversationMemoryCache({
        ...DEFAULT_BOOTSTRAP_CONFIG,
        cacheLimit: 'all',
      })

      const manyEntries = Array.from({ length: 100 }, (_, i) => `entry-${i}`)
      await allCache.add('conv-1', manyEntries, 'user-1')

      const entries = await allCache.get('conv-1')
      expect(entries).toHaveLength(100)
    })
  })

  describe('replace', () => {
    it('should replace all entries', async () => {
      await cache.add('conv-1', ['old-1', 'old-2'], 'user-1')
      await cache.replace('conv-1', ['new-1', 'new-2', 'new-3'], 'user-1')

      const entries = await cache.get('conv-1')
      expect(entries).toHaveLength(3)
      expect(entries).toEqual(['new-1', 'new-2', 'new-3'])
    })

    it('should respect cache limit on replace', async () => {
      const limitedCache = new InMemoryConversationMemoryCache({
        ...DEFAULT_BOOTSTRAP_CONFIG,
        cacheLimit: 2,
      })

      await limitedCache.replace('conv-1', ['a', 'b', 'c', 'd'], 'user-1')
      const entries = await limitedCache.get('conv-1')
      expect(entries).toHaveLength(2)
      expect(entries).toEqual(['c', 'd'])
    })
  })

  describe('clear', () => {
    it('should clear all entries', async () => {
      await cache.add('conv-1', ['entry-1', 'entry-2'], 'user-1')
      await cache.clear('conv-1')

      const entries = await cache.get('conv-1')
      expect(entries).toEqual([])
    })

    it('should clear metadata', async () => {
      await cache.add('conv-1', ['entry-1'], 'user-1')
      await cache.clear('conv-1')

      const metadata = await cache.getMetadata('conv-1')
      expect(metadata).toBeNull()
    })
  })

  describe('getMetadata', () => {
    it('should return null for new conversation', async () => {
      const metadata = await cache.getMetadata('conv-1')
      expect(metadata).toBeNull()
    })

    it('should return metadata after adding entries', async () => {
      await cache.add('conv-1', ['entry-1', 'entry-2'], 'user-1')

      const metadata = await cache.getMetadata('conv-1')
      expect(metadata).not.toBeNull()
      expect(metadata?.conversationId).toBe('conv-1')
      expect(metadata?.userId).toBe('user-1')
      expect(metadata?.entryCount).toBe(2)
      expect(metadata?.exchangeCount).toBe(0)
      expect(metadata?.lastUpdated).toBeGreaterThan(0)
    })
  })

  describe('incrementExchangeCount', () => {
    it('should increment exchange count', async () => {
      await cache.add('conv-1', ['entry-1'], 'user-1')

      const count1 = await cache.incrementExchangeCount('conv-1')
      expect(count1).toBe(1)

      const count2 = await cache.incrementExchangeCount('conv-1')
      expect(count2).toBe(2)

      const metadata = await cache.getMetadata('conv-1')
      expect(metadata?.exchangeCount).toBe(2)
    })

    it('should create metadata and return 1 for new conversation', async () => {
      const count = await cache.incrementExchangeCount('conv-1')
      expect(count).toBe(1)

      const metadata = await cache.getMetadata('conv-1')
      expect(metadata?.exchangeCount).toBe(1)
    })
  })

  describe('clearAll', () => {
    it('should clear all conversations', async () => {
      await cache.add('conv-1', ['entry-1'], 'user-1')
      await cache.add('conv-2', ['entry-2'], 'user-2')

      cache.clearAll()

      expect(await cache.get('conv-1')).toEqual([])
      expect(await cache.get('conv-2')).toEqual([])
    })
  })
})
