/**
 * MemoryCachePersistence Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryMemoryCachePersistence,
  InMemoryConversationMemoryCache,
  DEFAULT_BOOTSTRAP_CONFIG,
} from '../../src/bootstrap/index.js'

describe('InMemoryMemoryCachePersistence', () => {
  let cache: InMemoryConversationMemoryCache
  let persistence: InMemoryMemoryCachePersistence

  beforeEach(() => {
    cache = new InMemoryConversationMemoryCache(DEFAULT_BOOTSTRAP_CONFIG)
    persistence = new InMemoryMemoryCachePersistence(cache)
  })

  describe('persist', () => {
    it('should persist L1 cache to L2', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor', '- Tuesday:event -> meeting'], 'user-1')

      const result = await persistence.persist('conv-1', 'user-1', 'Topic summary')

      expect(result.ok).toBe(true)

      // Verify persisted data
      const stored = persistence.getAll()
      expect(stored.get('conv-1')).toBeDefined()
      expect(stored.get('conv-1')?.memories).toHaveLength(2)
      expect(stored.get('conv-1')?.userId).toBe('user-1')
      expect(stored.get('conv-1')?.topicSummary).toBe('Topic summary')
    })

    it('should persist without topic summary', async () => {
      await cache.add('conv-1', ['- Entry:type -> data'], 'user-1')

      const result = await persistence.persist('conv-1', 'user-1')

      expect(result.ok).toBe(true)

      const stored = persistence.getAll()
      expect(stored.get('conv-1')?.topicSummary).toBeUndefined()
    })

    it('should handle empty cache', async () => {
      const result = await persistence.persist('conv-1', 'user-1')

      expect(result.ok).toBe(true)

      const stored = persistence.getAll()
      expect(stored.get('conv-1')?.memories).toEqual([])
    })
  })

  describe('load', () => {
    it('should load persisted memories', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')
      await persistence.persist('conv-1', 'user-1')

      const result = await persistence.load('conv-1')

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(1)
      expect(result.value?.[0]).toContain('Mike')
    })

    it('should return empty array for non-existent conversation', async () => {
      const result = await persistence.load('non-existent')

      expect(result.ok).toBe(true)
      expect(result.value).toEqual([])
    })
  })

  describe('loadMany', () => {
    it('should load memories from multiple conversations', async () => {
      await cache.add('conv-1', ['- A:type -> a'], 'user-1')
      await persistence.persist('conv-1', 'user-1')
      cache.clearAll()

      await cache.add('conv-2', ['- B:type -> b', '- C:type -> c'], 'user-1')
      await persistence.persist('conv-2', 'user-1')

      const result = await persistence.loadMany(['conv-1', 'conv-2'])

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(3)
    })

    it('should return empty array for empty input', async () => {
      const result = await persistence.loadMany([])

      expect(result.ok).toBe(true)
      expect(result.value).toEqual([])
    })

    it('should skip non-existent conversations', async () => {
      await cache.add('conv-1', ['- A:type -> a'], 'user-1')
      await persistence.persist('conv-1', 'user-1')

      const result = await persistence.loadMany(['conv-1', 'non-existent'])

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(1)
    })
  })

  describe('delete', () => {
    it('should delete persisted data', async () => {
      await cache.add('conv-1', ['- A:type -> a'], 'user-1')
      await persistence.persist('conv-1', 'user-1')

      const deleteResult = await persistence.delete('conv-1')
      expect(deleteResult.ok).toBe(true)

      const loadResult = await persistence.load('conv-1')
      expect(loadResult.value).toEqual([])
    })

    it('should handle deleting non-existent data', async () => {
      const result = await persistence.delete('non-existent')
      expect(result.ok).toBe(true)
    })
  })

  describe('clear', () => {
    it('should clear all persisted data', async () => {
      await cache.add('conv-1', ['- A:type -> a'], 'user-1')
      await persistence.persist('conv-1', 'user-1')
      cache.clearAll()

      await cache.add('conv-2', ['- B:type -> b'], 'user-1')
      await persistence.persist('conv-2', 'user-1')

      persistence.clear()

      expect(persistence.getAll().size).toBe(0)
    })
  })
})
