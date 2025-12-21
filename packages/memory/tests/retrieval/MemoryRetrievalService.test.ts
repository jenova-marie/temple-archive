/**
 * Memory Retrieval Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRetrievalService } from '../../src/retrieval/MemoryRetrievalService.js'
import type { Neo4jKnowledgeStore } from '../../src/stores/Neo4jKnowledgeStore.js'
import type { DeepMemoryService } from '../../src/deepmemory/DeepMemoryService.js'
import type { MiniLMEmbeddingProvider } from '../../src/embeddings/MiniLMProvider.js'
import type { TraceContext, Entity } from '@pippa/types'
import { ok, err } from '@pippa/types'

// Mock observability
vi.mock('@pippa/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: vi.fn().mockImplementation((_name, fn) => fn()),
  pipelineMetrics: {
    stageDuration: { record: vi.fn() },
    errors: { add: vi.fn() },
    memoryCacheHits: { add: vi.fn() },
    memoryCacheMisses: { add: vi.fn() },
  },
}))

function createTraceContext(): TraceContext {
  return {
    requestId: 'test-request',
    traceId: 'test-trace',
    spanId: 'test-span',
    startTime: Date.now(),
  }
}

function createMockEntity(name: string, importance = 0.5): Entity {
  return {
    entityId: `entity-${name}`,
    name,
    type: 'person',
    firstMentioned: Date.now() - 100000,
    lastMentioned: Date.now(),
    properties: { importance },
  }
}

describe('MemoryRetrievalService', () => {
  let mockNeo4jStore: Partial<Neo4jKnowledgeStore>
  let mockDeepMemory: Partial<DeepMemoryService>
  let mockMiniLM: Partial<MiniLMEmbeddingProvider>
  let service: MemoryRetrievalService

  beforeEach(() => {
    vi.clearAllMocks()

    mockNeo4jStore = {
      searchEntities: vi.fn().mockResolvedValue(ok([])),
      getEntityObservations: vi.fn().mockResolvedValue(ok([])),
    }

    mockDeepMemory = {
      enrichWithContext: vi.fn().mockImplementation((entities) =>
        Promise.resolve(entities.map((e: any) => ({ ...e, conversationContexts: [] })))
      ),
    }

    mockMiniLM = {
      embedOne: vi.fn().mockResolvedValue(ok([0.1, 0.2, 0.3])),
    }

    service = new MemoryRetrievalService(
      mockNeo4jStore as Neo4jKnowledgeStore,
      mockMiniLM as MiniLMEmbeddingProvider,
      mockDeepMemory as DeepMemoryService
    )
  })

  describe('retrieve', () => {
    it('should return empty result when no entities found', async () => {
      const result = await service.retrieve('test query', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.entities).toHaveLength(0)
        expect(result.value.totalMatched).toBe(0)
        expect(result.value.formattedContext).toBe('')
      }
    })

    it('should search and return entities', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john', 0.8), createMockEntity('jane', 0.7)])
      )

      const result = await service.retrieve('john jane', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.entities).toHaveLength(2)
        expect(result.value.totalMatched).toBe(2)
      }
    })

    it('should call search with query', async () => {
      await service.retrieve('find john', 'user-123', {}, createTraceContext())

      expect(mockNeo4jStore.searchEntities).toHaveBeenCalledWith(
        'find john',
        expect.any(Object)
      )
    })

    it('should generate embedding when MiniLM is available', async () => {
      await service.retrieve('test', 'user-123', {}, createTraceContext())

      expect(mockMiniLM.embedOne).toHaveBeenCalledWith('test')
    })

    it('should work without MiniLM', async () => {
      const serviceNoMiniLM = new MemoryRetrievalService(
        mockNeo4jStore as Neo4jKnowledgeStore,
        null,
        mockDeepMemory as DeepMemoryService
      )

      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john')])
      )

      const result = await serviceNoMiniLM.retrieve('test', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
    })

    it('should fetch observations when includeObservations is true', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john')])
      )
      ;(mockNeo4jStore.getEntityObservations as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([{ id: 'obs-1', content: 'Works at Google', createdAt: Date.now(), conversationId: 'c1', messageId: 'm1', confidence: 0.9 }])
      )

      await service.retrieve('john', 'user-123', { includeObservations: true }, createTraceContext())

      expect(mockNeo4jStore.getEntityObservations).toHaveBeenCalled()
    })

    it('should not fetch observations when includeObservations is false', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john')])
      )

      await service.retrieve('john', 'user-123', { includeObservations: false }, createTraceContext())

      expect(mockNeo4jStore.getEntityObservations).not.toHaveBeenCalled()
    })

    it('should enrich with Deep Memory when enabled', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john')])
      )

      await service.retrieve(
        'john',
        'user-123',
        { includeConversationContext: true },
        createTraceContext()
      )

      expect(mockDeepMemory.enrichWithContext).toHaveBeenCalled()
    })

    it('should not enrich with Deep Memory when disabled', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john')])
      )

      await service.retrieve(
        'john',
        'user-123',
        { includeConversationContext: false },
        createTraceContext()
      )

      expect(mockDeepMemory.enrichWithContext).not.toHaveBeenCalled()
    })

    it('should respect limit option', async () => {
      const entities = Array.from({ length: 20 }, (_, i) => createMockEntity(`person-${i}`))
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(ok(entities))

      const result = await service.retrieve('test', 'user-123', { limit: 5 }, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.entities).toHaveLength(5)
        expect(result.value.totalMatched).toBe(20)
      }
    })

    it('should handle search errors gracefully', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        err({ kind: 'ConnectionError', message: 'DB down', context: {} })
      )

      const result = await service.retrieve('test', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.entities).toHaveLength(0)
      }
    })
  })

  describe('deduplication', () => {
    it('should deduplicate entities by name', async () => {
      const entities = [
        createMockEntity('john', 0.8),
        createMockEntity('john', 0.6), // Duplicate
        createMockEntity('jane', 0.7),
      ]
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(ok(entities))

      const result = await service.retrieve('john jane', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.entities).toHaveLength(2)
        // Should keep the one with higher importance
        const johnEntity = result.value.entities.find((e) => e.name === 'john')
        expect(johnEntity).toBeDefined()
      }
    })
  })

  describe('ranking', () => {
    it('should rank entities by score', async () => {
      const entities = [
        createMockEntity('low', 0.2),
        createMockEntity('high', 0.9),
        createMockEntity('medium', 0.5),
      ]
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(ok(entities))

      const result = await service.retrieve('test', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Higher importance entities should come first
        expect(result.value.entities[0].name).toBe('high')
      }
    })

    it('should filter by minScore', async () => {
      const entities = [
        createMockEntity('low', 0.1),
        createMockEntity('high', 0.9),
      ]
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(ok(entities))

      // Use a very high minScore to filter most entities
      const result = await service.retrieve('test', 'user-123', { minScore: 0.8 }, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Higher minScore should result in fewer entities
        expect(result.value.entities.length).toBeLessThan(2)
      }
    })
  })

  describe('formatting', () => {
    it('should format entities for agent prompt', async () => {
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockEntity('john', 0.8)])
      )

      const result = await service.retrieve('john', 'user-123', {}, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.formattedContext).toContain('## Memory Context')
        expect(result.value.formattedContext).toContain('john')
      }
    })

    it('should respect maxTokens limit', async () => {
      const entities = Array.from({ length: 100 }, (_, i) => createMockEntity(`person-${i}`))
      ;(mockNeo4jStore.searchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(ok(entities))

      const result = await service.retrieve('test', 'user-123', { maxTokens: 100 }, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Should stop adding entities when token budget is reached
        expect(result.value.tokenCount).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('getWeights', () => {
    it('should return default weights', () => {
      const weights = service.getWeights()

      expect(weights.semanticWeight).toBe(0.4)
      expect(weights.recencyWeight).toBe(0.2)
      expect(weights.importanceWeight).toBe(0.2)
      expect(weights.frequencyWeight).toBe(0.1)
      expect(weights.centralityWeight).toBe(0.1)
    })

    it('should use custom weights', () => {
      const customService = new MemoryRetrievalService(
        mockNeo4jStore as Neo4jKnowledgeStore,
        null,
        null,
        { semanticWeight: 0.6, recencyWeight: 0.4 }
      )

      const weights = customService.getWeights()

      expect(weights.semanticWeight).toBe(0.6)
      expect(weights.recencyWeight).toBe(0.4)
    })
  })
})
