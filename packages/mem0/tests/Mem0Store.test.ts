/**
 * Unit tests for Mem0Store
 *
 * Tests the store implementation with mocked HTTP client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Mem0Store } from '../src/Mem0Store.js'
import type { Mem0HttpClient } from '../src/client.js'
import type { TraceContext } from '@siri/types'

// Mock the observability module
vi.mock('@siri/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: async <T>(_name: string, fn: () => Promise<T>) => fn(),
  pipelineMetrics: {
    errors: { add: vi.fn() },
    memoryCacheHits: { add: vi.fn() },
  },
}))

// Mock trace context
const mockCtx: TraceContext = {
  requestId: 'test-request-id',
  userId: 'test-user',
  conversationId: 'test-conversation',
  startTime: Date.now(),
}

describe('Mem0Store', () => {
  let mockClient: Mem0HttpClient
  let store: Mem0Store

  beforeEach(() => {
    mockClient = {
      request: vi.fn(),
    } as unknown as Mem0HttpClient

    store = new Mem0Store(mockClient)
  })

  describe('addMemory', () => {
    it('should add memory and return normalized response', async () => {
      const rawResponse = {
        results: [
          { id: 'mem-1', memory: 'User likes pizza', event: 'ADD' as const },
          { id: 'mem-2', memory: 'User is vegetarian', event: 'ADD' as const },
        ],
        relations: [],
      }

      vi.mocked(mockClient.request).mockResolvedValue(rawResponse)

      const result = await store.addMemory(
        [{ role: 'user', content: 'I like pizza and I am vegetarian.' }],
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.memoryIds).toEqual(['mem-1', 'mem-2'])
        expect(result.value.results).toHaveLength(2)
        expect(result.value.results[0].event).toBe('ADD')
      }

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/memories', {
        body: {
          messages: [{ role: 'user', content: 'I like pizza and I am vegetarian.' }],
          user_id: 'user-123',
          agent_id: undefined,
          run_id: undefined,
          metadata: undefined,
        },
      })
    })

    it('should include agent_id and metadata when provided', async () => {
      vi.mocked(mockClient.request).mockResolvedValue({ results: [], relations: [] })

      await store.addMemory(
        [{ role: 'user', content: 'Hello' }],
        { userId: 'user-123', agentId: 'agent-1', metadata: { source: 'test' } },
        mockCtx
      )

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/memories', {
        body: {
          messages: [{ role: 'user', content: 'Hello' }],
          user_id: 'user-123',
          agent_id: 'agent-1',
          run_id: undefined,
          metadata: { source: 'test' },
        },
      })
    })

    it('should return error on API failure', async () => {
      const error = new Error('Network error')
      vi.mocked(mockClient.request).mockRejectedValue(error)

      const result = await store.addMemory(
        [{ role: 'user', content: 'Test' }],
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('UnexpectedError')
      }
    })
  })

  describe('searchMemory', () => {
    it('should search and return results array', async () => {
      const rawResponse = {
        results: [
          { id: 'mem-1', memory: 'User likes pizza', score: 0.95, hash: 'abc', userId: 'user-123', metadata: {}, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
          { id: 'mem-2', memory: 'User is vegetarian', score: 0.82, hash: 'def', userId: 'user-123', metadata: {}, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ],
      }

      vi.mocked(mockClient.request).mockResolvedValue(rawResponse)

      const result = await store.searchMemory(
        'food preferences',
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].score).toBe(0.95)
        expect(result.value[1].memory).toBe('User is vegetarian')
      }

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/memories/search', {
        params: {
          user_id: 'user-123',
          q: 'food preferences',
          agent_id: undefined,
          run_id: undefined,
          limit: undefined,
          threshold: undefined,
        },
      })
    })

    it('should pass limit and threshold parameters', async () => {
      vi.mocked(mockClient.request).mockResolvedValue({ results: [] })

      await store.searchMemory(
        'test query',
        { userId: 'user-123', limit: 5, threshold: 0.7 },
        mockCtx
      )

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/memories/search', {
        params: expect.objectContaining({
          limit: 5,
          threshold: 0.7,
        }),
      })
    })

    it('should return empty array when no results', async () => {
      vi.mocked(mockClient.request).mockResolvedValue({ results: [] })

      const result = await store.searchMemory(
        'nonexistent',
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
    })

    it('should handle missing results field gracefully', async () => {
      vi.mocked(mockClient.request).mockResolvedValue({})

      const result = await store.searchMemory(
        'test',
        { userId: 'user-123' },
        mockCtx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
    })
  })

  describe('getMemories', () => {
    it('should get all memories for user', async () => {
      const rawResponse = {
        results: [
          { id: 'mem-1', memory: 'Fact 1', hash: 'abc', userId: 'user-123', metadata: {}, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
          { id: 'mem-2', memory: 'Fact 2', hash: 'def', userId: 'user-123', metadata: {}, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ],
      }

      vi.mocked(mockClient.request).mockResolvedValue(rawResponse)

      const result = await store.getMemories('user-123', undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].id).toBe('mem-1')
      }

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/memories', {
        params: {
          user_id: 'user-123',
          agent_id: undefined,
          run_id: undefined,
        },
      })
    })

    it('should pass agent_id filter', async () => {
      vi.mocked(mockClient.request).mockResolvedValue({ results: [] })

      await store.getMemories('user-123', { agentId: 'agent-1' }, mockCtx)

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/memories', {
        params: {
          user_id: 'user-123',
          agent_id: 'agent-1',
          run_id: undefined,
        },
      })
    })

    it('should return empty array when no memories', async () => {
      vi.mocked(mockClient.request).mockResolvedValue({ results: [] })

      const result = await store.getMemories('new-user', undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
    })
  })

  describe('getMemory', () => {
    it('should get memory by ID', async () => {
      const memory = {
        id: 'mem-123',
        memory: 'User likes hiking',
        hash: 'abc',
        userId: 'user-123',
        metadata: {},
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      }

      vi.mocked(mockClient.request).mockResolvedValue(memory)

      const result = await store.getMemory('mem-123', mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).not.toBeNull()
        expect(result.value?.id).toBe('mem-123')
        expect(result.value?.memory).toBe('User likes hiking')
      }

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/memories/mem-123')
    })

    it('should return null for 404', async () => {
      const { Mem0ApiError } = await import('../src/client.js')
      const error = new Mem0ApiError(404, 'Not found', '/memories/nonexistent')
      vi.mocked(mockClient.request).mockRejectedValue(error)

      const result = await store.getMemory('nonexistent', mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeNull()
      }
    })

    it('should return error for other failures', async () => {
      const { Mem0ApiError } = await import('../src/client.js')
      const error = new Mem0ApiError(500, 'Server error', '/memories/mem-123')
      vi.mocked(mockClient.request).mockRejectedValue(error)

      const result = await store.getMemory('mem-123', mockCtx)

      expect(result.ok).toBe(false)
    })
  })

  describe('updateMemory', () => {
    it('should update memory text', async () => {
      const updatedMemory = {
        id: 'mem-123',
        memory: 'Updated content',
        hash: 'xyz',
        userId: 'user-123',
        metadata: {},
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      }

      vi.mocked(mockClient.request).mockResolvedValue(updatedMemory)

      const result = await store.updateMemory('mem-123', 'Updated content', undefined, mockCtx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.memory).toBe('Updated content')
      }

      expect(mockClient.request).toHaveBeenCalledWith('PUT', '/memories/mem-123', {
        body: {
          data: 'Updated content',
        },
      })
    })
  })

  describe('deleteMemory', () => {
    it('should delete memory by ID', async () => {
      vi.mocked(mockClient.request).mockResolvedValue(undefined)

      const result = await store.deleteMemory('mem-123', mockCtx)

      expect(result.ok).toBe(true)

      expect(mockClient.request).toHaveBeenCalledWith('DELETE', '/memories/mem-123')
    })

    it('should return error on failure', async () => {
      const { Mem0ApiError } = await import('../src/client.js')
      const error = new Mem0ApiError(404, 'Not found', '/memories/nonexistent')
      vi.mocked(mockClient.request).mockRejectedValue(error)

      const result = await store.deleteMemory('nonexistent', mockCtx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('NotFoundError')
      }
    })
  })
})

describe('Error Mapping', () => {
  let mockClient: Mem0HttpClient
  let store: Mem0Store

  beforeEach(() => {
    mockClient = {
      request: vi.fn(),
    } as unknown as Mem0HttpClient

    store = new Mem0Store(mockClient)
  })

  it('should map connection errors', async () => {
    const error = new Error('fetch failed')
    vi.mocked(mockClient.request).mockRejectedValue(error)

    const result = await store.addMemory(
      [{ role: 'user', content: 'Test' }],
      { userId: 'user-123' },
      mockCtx
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('ConnectionError')
    }
  })

  it('should map validation errors (422)', async () => {
    const { Mem0ApiError } = await import('../src/client.js')
    const error = new Mem0ApiError(422, 'Validation failed', '/memories')
    vi.mocked(mockClient.request).mockRejectedValue(error)

    const result = await store.addMemory(
      [{ role: 'user', content: 'Test' }],
      { userId: 'user-123' },
      mockCtx
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('ValidationError')
    }
  })

  it('should map timeout errors', async () => {
    const error = new Error('timeout')
    error.name = 'AbortError'
    vi.mocked(mockClient.request).mockRejectedValue(error)

    const result = await store.searchMemory(
      'test',
      { userId: 'user-123' },
      mockCtx
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('TimeoutError')
    }
  })
})
