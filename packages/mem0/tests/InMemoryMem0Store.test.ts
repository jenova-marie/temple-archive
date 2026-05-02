/**
 * Unit tests for InMemoryMem0Store stub
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryMem0Store } from '../src/stubs/InMemoryMem0Store.js'
import type { TraceContext } from '@siri/types'

// Mock trace context
const mockCtx: TraceContext = {
  requestId: 'test-request',
  userId: 'test-user',
  conversationId: 'test-conversation',
  startTime: Date.now(),
}

describe('InMemoryMem0Store', () => {
  let store: InMemoryMem0Store

  beforeEach(() => {
    store = new InMemoryMem0Store()
  })

  describe('addMemory', () => {
    it('should add memories from user messages', async () => {
      const result = await store.addMemory(
        [
          { role: 'user', content: 'I love hiking in the mountains.' },
          { role: 'assistant', content: 'That sounds fun!' },
        ],
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Should only extract from user messages
        expect(result.value.memoryIds).toHaveLength(1)
        expect(result.value.results).toHaveLength(1)
        expect(result.value.results[0].event).toBe('ADD')
        expect(result.value.results[0].memory).toBe('I love hiking in the mountains.')
      }
    })

    it('should store memories with correct user ID', async () => {
      await store.addMemory(
        [{ role: 'user', content: 'Test memory' }],
        { userId: 'user-123' },
        mockCtx
      )

      const getResult = await store.getMemories('user-123', undefined, mockCtx)

      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).toHaveLength(1)
        expect(getResult.value[0].userId).toBe('user-123')
      }
    })

    it('should handle empty messages', async () => {
      const result = await store.addMemory([], { userId: 'user-123' }, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.memoryIds).toHaveLength(0)
      }
    })

    it('should include metadata in stored memory', async () => {
      await store.addMemory(
        [{ role: 'user', content: 'Test' }],
        { userId: 'user-123', metadata: { source: 'test' } },
        mockCtx
      )

      const getResult = await store.getMemories('user-123', undefined, mockCtx)

      expect(getResult.ok).toBe(true)
      if (getResult.ok && getResult.value.length > 0) {
        expect(getResult.value[0].metadata).toEqual({ source: 'test' })
      }
    })
  })

  describe('searchMemory', () => {
    beforeEach(async () => {
      await store.addMemory(
        [{ role: 'user', content: 'I love programming in TypeScript.' }],
        { userId: 'user-123' },
        mockCtx
      )
      await store.addMemory(
        [{ role: 'user', content: 'I enjoy hiking outdoors.' }],
        { userId: 'user-123' },
        mockCtx
      )
      await store.addMemory(
        [{ role: 'user', content: 'Pizza is my favorite food.' }],
        { userId: 'user-123' },
        mockCtx
      )
    })

    it('should find matching memories', async () => {
      const result = await store.searchMemory(
        'programming TypeScript',
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0)
        expect(result.value[0]).toHaveProperty('score')
      }
    })

    it('should return results sorted by score', async () => {
      const result = await store.searchMemory(
        'TypeScript',
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok && result.value.length > 1) {
        expect(result.value[0].score).toBeGreaterThanOrEqual(result.value[1].score)
      }
    })

    it('should respect limit parameter', async () => {
      const result = await store.searchMemory(
        'love enjoy favorite',
        { userId: 'user-123', limit: 1 },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBeLessThanOrEqual(1)
      }
    })

    it('should filter by user ID', async () => {
      await store.addMemory(
        [{ role: 'user', content: 'Other user memory' }],
        { userId: 'other-user' },
        mockCtx
      )

      const result = await store.searchMemory(
        'memory',
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        for (const mem of result.value) {
          expect(mem.userId).toBe('user-123')
        }
      }
    })
  })

  describe('getMemories', () => {
    beforeEach(async () => {
      await store.addMemory(
        [{ role: 'user', content: 'Memory 1' }],
        { userId: 'user-123' },
        mockCtx
      )
      await store.addMemory(
        [{ role: 'user', content: 'Memory 2' }],
        { userId: 'user-123', agentId: 'agent-1' },
        mockCtx
      )
    })

    it('should get all memories for user', async () => {
      const result = await store.getMemories('user-123', undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBe(2)
      }
    })

    it('should filter by agent ID', async () => {
      const result = await store.getMemories('user-123', { agentId: 'agent-1' }, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBe(1)
        expect(result.value[0].agentId).toBe('agent-1')
      }
    })

    it('should return empty for new user', async () => {
      const result = await store.getMemories('new-user', undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
    })
  })

  describe('getMemory', () => {
    it('should get memory by ID', async () => {
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'Specific memory' }],
        { userId: 'user-123' },
        mockCtx
      )

      expect(addResult.ok).toBe(true)
      if (!addResult.ok) return

      const memoryId = addResult.value.memoryIds[0]
      const result = await store.getMemory(memoryId, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).not.toBeNull()
        expect(result.value?.id).toBe(memoryId)
        expect(result.value?.memory).toBe('Specific memory')
      }
    })

    it('should return null for non-existent ID', async () => {
      const result = await store.getMemory('nonexistent-id', mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeNull()
      }
    })
  })

  describe('updateMemory', () => {
    it('should update memory text', async () => {
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'Original content' }],
        { userId: 'user-123' },
        mockCtx
      )

      expect(addResult.ok).toBe(true)
      if (!addResult.ok) return

      const memoryId = addResult.value.memoryIds[0]
      const updateResult = await store.updateMemory(
        memoryId,
        'Updated content',
        undefined,
        mockCtx
      )

      expect(updateResult.ok).toBe(true)
      if (updateResult.ok) {
        expect(updateResult.value.memory).toBe('Updated content')
      }

      // Verify it was updated
      const getResult = await store.getMemory(memoryId, mockCtx)
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value?.memory).toBe('Updated content')
      }
    })

    it('should return error for non-existent memory', async () => {
      const result = await store.updateMemory(
        'nonexistent',
        'New content',
        undefined,
        mockCtx
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('NotFoundError')
      }
    })

    it('should merge metadata on update', async () => {
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'Test' }],
        { userId: 'user-123', metadata: { original: true } },
        mockCtx
      )

      expect(addResult.ok).toBe(true)
      if (!addResult.ok) return

      const memoryId = addResult.value.memoryIds[0]
      const updateResult = await store.updateMemory(
        memoryId,
        'Updated',
        { updated: true },
        mockCtx
      )

      expect(updateResult.ok).toBe(true)
      if (updateResult.ok) {
        expect(updateResult.value.metadata).toEqual({
          original: true,
          updated: true,
        })
      }
    })
  })

  describe('deleteMemory', () => {
    it('should delete memory by ID', async () => {
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'To be deleted' }],
        { userId: 'user-123' },
        mockCtx
      )

      expect(addResult.ok).toBe(true)
      if (!addResult.ok) return

      const memoryId = addResult.value.memoryIds[0]
      const deleteResult = await store.deleteMemory(memoryId, mockCtx)

      expect(deleteResult.ok).toBe(true)

      // Verify it was deleted
      const getResult = await store.getMemory(memoryId, mockCtx)
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).toBeNull()
      }
    })

    it('should return error for non-existent memory', async () => {
      const result = await store.deleteMemory('nonexistent', mockCtx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('NotFoundError')
      }
    })
  })

  describe('clear and size', () => {
    it('should clear all memories', async () => {
      await store.addMemory(
        [{ role: 'user', content: 'Memory 1' }],
        { userId: 'user-1' },
        mockCtx
      )
      await store.addMemory(
        [{ role: 'user', content: 'Memory 2' }],
        { userId: 'user-2' },
        mockCtx
      )

      expect(store.size()).toBe(2)

      store.clear()

      expect(store.size()).toBe(0)
    })

    it('should report correct size', async () => {
      expect(store.size()).toBe(0)

      await store.addMemory(
        [{ role: 'user', content: 'Test' }],
        { userId: 'user-123' },
        mockCtx
      )

      expect(store.size()).toBe(1)

      await store.addMemory(
        [
          { role: 'user', content: 'One' },
          { role: 'user', content: 'Two' },
        ],
        { userId: 'user-123' },
        mockCtx
      )

      expect(store.size()).toBe(3)
    })
  })
})
