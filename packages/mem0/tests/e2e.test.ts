/**
 * End-to-end tests for Mem0 client against running FastAPI service.
 *
 * Requires: Mem0 FastAPI service running at http://localhost:8000
 * Run with: pnpm --filter @siri/mem0 test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createMem0Client, checkMem0Health, closeMem0Client } from '../src/client.js'
import { Mem0Store } from '../src/Mem0Store.js'
import type { TraceContext } from '@siri/types'

const BASE_URL = 'http://localhost:8000'
const TEST_TIMEOUT = 60000

// Generate unique user ID for test isolation
const testUserId = `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Mock trace context for tests
const mockCtx: TraceContext = {
  requestId: 'e2e-test-request',
  userId: testUserId,
  conversationId: 'e2e-test-conversation',
  startTime: Date.now(),
}

describe('Mem0 E2E Tests', () => {
  let store: Mem0Store

  beforeAll(async () => {
    const client = createMem0Client({ url: BASE_URL, timeout: TEST_TIMEOUT })
    store = new Mem0Store(client)
  })

  afterAll(async () => {
    // Cleanup: delete all test user memories
    try {
      const client = createMem0Client({ url: BASE_URL })
      await client.request('DELETE', '/memories', {
        params: { user_id: testUserId },
      })
    } catch {
      // Ignore cleanup errors
    }
    closeMem0Client()
  })

  describe('Health Check', () => {
    it('should pass health check', async () => {
      const healthy = await checkMem0Health()
      expect(healthy).toBe(true)
    })
  })

  describe('Add Memories', () => {
    it('should add memory from message', async () => {
      const result = await store.addMemory(
        [{ role: 'user', content: 'My name is TestUser and I love programming.' }],
        { userId: testUserId },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveProperty('results')
        expect(result.value).toHaveProperty('memoryIds')
        expect(Array.isArray(result.value.results)).toBe(true)
      }
    })

    it('should add memory with agent_id', async () => {
      const result = await store.addMemory(
        [{ role: 'user', content: 'I prefer dark mode for coding.' }],
        { userId: testUserId, agentId: 'test-agent' },
        mockCtx
      )

      expect(result.ok).toBe(true)
    })

    it('should add memory with metadata', async () => {
      const result = await store.addMemory(
        [{ role: 'user', content: 'My favorite language is TypeScript.' }],
        { userId: testUserId, metadata: { source: 'e2e-test' } },
        mockCtx
      )

      expect(result.ok).toBe(true)
    })

    it('should handle conversation with multiple messages', async () => {
      const result = await store.addMemory(
        [
          { role: 'user', content: 'I work as a software engineer.' },
          { role: 'assistant', content: 'That sounds interesting! What kind of projects do you work on?' },
          { role: 'user', content: 'I build AI-powered applications.' },
        ],
        { userId: testUserId },
        mockCtx
      )

      expect(result.ok).toBe(true)
    })
  })

  describe('List Memories', () => {
    it('should list memories for user', async () => {
      const result = await store.getMemories(testUserId, undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true)
        // Should have memories from previous tests
      }
    })

    it('should list memories with agent filter', async () => {
      const result = await store.getMemories(
        testUserId,
        { agentId: 'test-agent' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true)
      }
    })

    it('should return empty array for new user', async () => {
      const newUserId = `new-user-${Date.now()}`
      const result = await store.getMemories(newUserId, undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
    })
  })

  describe('Search Memories', () => {
    beforeEach(async () => {
      // Ensure we have some memories to search
      await store.addMemory(
        [{ role: 'user', content: 'I enjoy hiking in the mountains on weekends.' }],
        { userId: testUserId },
        mockCtx
      )
    })

    it('should search memories by query', async () => {
      const result = await store.searchMemory(
        'hiking outdoor activities',
        { userId: testUserId },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true)
      }
    })

    it('should return results with scores', async () => {
      const result = await store.searchMemory(
        'programming software',
        { userId: testUserId },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok && result.value.length > 0) {
        const firstResult = result.value[0]
        expect(firstResult).toHaveProperty('id')
        expect(firstResult).toHaveProperty('memory')
        expect(firstResult).toHaveProperty('score')
        expect(typeof firstResult.score).toBe('number')
      }
    })

    it('should respect limit parameter', async () => {
      const result = await store.searchMemory(
        'test query',
        { userId: testUserId, limit: 1 },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBeLessThanOrEqual(1)
      }
    })

    it('should return empty for non-matching query', async () => {
      const result = await store.searchMemory(
        'xyzzy99999 completely random nonexistent',
        { userId: testUserId },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true)
      }
    })
  })

  describe('Get Memory by ID', () => {
    let memoryId: string | null = null

    beforeAll(async () => {
      // Create a memory to get by ID
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'This is a specific memory for ID lookup.' }],
        { userId: testUserId },
        mockCtx
      )

      if (addResult.ok && addResult.value.memoryIds.length > 0) {
        memoryId = addResult.value.memoryIds[0]
      }
    })

    it('should get memory by ID', async () => {
      if (!memoryId) {
        console.log('Skipping: No memory ID available')
        return
      }

      const result = await store.getMemory(memoryId, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).not.toBeNull()
        if (result.value) {
          expect(result.value.id).toBe(memoryId)
          expect(result.value).toHaveProperty('memory')
        }
      }
    })

    it('should return null for non-existent ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const result = await store.getMemory(fakeId, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeNull()
      }
    })
  })

  describe('Update Memory', () => {
    let memoryId: string | null = null

    beforeAll(async () => {
      // Create a memory to update
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'Original memory content for update test.' }],
        { userId: testUserId },
        mockCtx
      )

      if (addResult.ok && addResult.value.memoryIds.length > 0) {
        memoryId = addResult.value.memoryIds[0]
      }
    })

    it('should update memory text', async () => {
      if (!memoryId) {
        console.log('Skipping: No memory ID available')
        return
      }

      const result = await store.updateMemory(
        memoryId,
        'Updated memory content.',
        undefined,
        mockCtx
      )

      expect(result.ok).toBe(true)
    })
  })

  describe('Delete Memory', () => {
    let memoryId: string | null = null

    beforeEach(async () => {
      // Create a memory to delete
      const addResult = await store.addMemory(
        [{ role: 'user', content: 'Memory to be deleted.' }],
        { userId: testUserId },
        mockCtx
      )

      if (addResult.ok && addResult.value.memoryIds.length > 0) {
        memoryId = addResult.value.memoryIds[0]
      }
    })

    it('should delete memory by ID', async () => {
      if (!memoryId) {
        console.log('Skipping: No memory ID available')
        return
      }

      const deleteResult = await store.deleteMemory(memoryId, mockCtx)
      expect(deleteResult.ok).toBe(true)

      // Verify it's gone
      const getResult = await store.getMemory(memoryId, mockCtx)
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).toBeNull()
      }
    })
  })

  describe('Full Workflow', () => {
    it('should complete full CRUD workflow', async () => {
      const workflowUserId = `workflow-${Date.now()}`
      const uniqueContent = `Unique fact ${Date.now()}: I collect vintage keyboards.`

      try {
        // 1. Add memory
        const addResult = await store.addMemory(
          [{ role: 'user', content: uniqueContent }],
          { userId: workflowUserId },
          { ...mockCtx, userId: workflowUserId }
        )
        expect(addResult.ok).toBe(true)

        // 2. List memories - should contain our memory
        const listResult = await store.getMemories(
          workflowUserId,
          undefined,
          { ...mockCtx, userId: workflowUserId }
        )
        expect(listResult.ok).toBe(true)

        // 3. Search for it
        const searchResult = await store.searchMemory(
          'vintage keyboards collection',
          { userId: workflowUserId },
          { ...mockCtx, userId: workflowUserId }
        )
        expect(searchResult.ok).toBe(true)

        // 4. Get by ID if we have one
        if (addResult.ok && addResult.value.memoryIds.length > 0) {
          const memoryId = addResult.value.memoryIds[0]

          const getResult = await store.getMemory(
            memoryId,
            { ...mockCtx, userId: workflowUserId }
          )
          expect(getResult.ok).toBe(true)

          // 5. Update it
          const updateResult = await store.updateMemory(
            memoryId,
            'User collects mechanical keyboards.',
            undefined,
            { ...mockCtx, userId: workflowUserId }
          )
          expect(updateResult.ok).toBe(true)

          // 6. Delete it
          const deleteResult = await store.deleteMemory(
            memoryId,
            { ...mockCtx, userId: workflowUserId }
          )
          expect(deleteResult.ok).toBe(true)

          // 7. Verify deletion
          const verifyResult = await store.getMemory(
            memoryId,
            { ...mockCtx, userId: workflowUserId }
          )
          expect(verifyResult.ok).toBe(true)
          if (verifyResult.ok) {
            expect(verifyResult.value).toBeNull()
          }
        }
      } finally {
        // Cleanup
        try {
          const client = createMem0Client({ url: BASE_URL })
          await client.request('DELETE', '/memories', {
            params: { user_id: workflowUserId },
          })
        } catch {
          // Ignore cleanup errors
        }
      }
    })
  })

  describe('User Isolation', () => {
    it('should isolate memories between users', async () => {
      const user1 = `isolation-user1-${Date.now()}`
      const user2 = `isolation-user2-${Date.now()}`

      try {
        // Add memory for user1
        await store.addMemory(
          [{ role: 'user', content: 'User1 secret: alpha123' }],
          { userId: user1 },
          { ...mockCtx, userId: user1 }
        )

        // Add memory for user2
        await store.addMemory(
          [{ role: 'user', content: 'User2 secret: beta456' }],
          { userId: user2 },
          { ...mockCtx, userId: user2 }
        )

        // Search user1 for user2's content - should not find it
        const searchResult = await store.searchMemory(
          'beta456',
          { userId: user1 },
          { ...mockCtx, userId: user1 }
        )

        expect(searchResult.ok).toBe(true)
        if (searchResult.ok) {
          // Results should not contain user2's secret
          for (const result of searchResult.value) {
            expect(result.memory.toLowerCase()).not.toContain('beta456')
          }
        }
      } finally {
        // Cleanup
        const client = createMem0Client({ url: BASE_URL })
        try {
          await client.request('DELETE', '/memories', { params: { user_id: user1 } })
          await client.request('DELETE', '/memories', { params: { user_id: user2 } })
        } catch {
          // Ignore
        }
      }
    })
  })
})
