/**
 * BootstrapOrchestrator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ok } from '@siri/types'
import {
  BootstrapOrchestrator,
  StubBootstrapOrchestrator,
  InMemoryConversationMemoryCache,
  StubMemoryExtractor,
  StubMemoryCacheDeduplicator,
  StubTopicGenerator,
  InMemoryMemoryCachePersistence,
  DEFAULT_BOOTSTRAP_CONFIG,
  type BootstrapOrchestratorDeps,
} from '../../src/bootstrap/index.js'

const mockCtx = {
  traceId: 'trace-1',
  spanId: 'span-1',
  requestId: 'req-1',
  startTime: Date.now(),
}

// Mock memory store
const createMockMemoryStore = () => ({
  createMemory: vi.fn().mockResolvedValue(ok({ id: 'mem-1' })),
  getMemory: vi.fn().mockResolvedValue(ok(null)),
  updateMemory: vi.fn().mockResolvedValue(ok({})),
  deleteMemory: vi.fn().mockResolvedValue(ok(undefined)),
  addObservation: vi.fn().mockResolvedValue(ok({ id: 'obs-1' })),
  getObservations: vi.fn().mockResolvedValue(ok([])),
  createRelation: vi.fn().mockResolvedValue(ok(undefined)),
  getRelations: vi.fn().mockResolvedValue(ok([])),
  searchMemories: vi.fn().mockResolvedValue(ok([])),
  getRelatedMemories: vi.fn().mockResolvedValue(ok({ related: { descendants: [], ancestors: [] } })),
  findByName: vi.fn().mockResolvedValue(ok([])),
})

// Mock vector store
const createMockVectorStore = () => ({
  indexMessage: vi.fn().mockResolvedValue(ok(undefined)),
  batchIndex: vi.fn().mockResolvedValue(ok(undefined)),
  search: vi.fn().mockResolvedValue(ok([])),
  prune: vi.fn().mockResolvedValue(ok(0)),
})

// Mock embedding provider
const createMockEmbeddingProvider = () => ({
  embed: vi.fn().mockResolvedValue(ok(Array(1536).fill(0))),
  embedBatch: vi.fn().mockResolvedValue(ok([])),
  dimension: 1536,
})

describe('BootstrapOrchestrator', () => {
  let cache: InMemoryConversationMemoryCache
  let persistence: InMemoryMemoryCachePersistence
  let deps: BootstrapOrchestratorDeps
  let orchestrator: BootstrapOrchestrator

  beforeEach(() => {
    cache = new InMemoryConversationMemoryCache(DEFAULT_BOOTSTRAP_CONFIG)
    persistence = new InMemoryMemoryCachePersistence(cache)

    deps = {
      cache,
      extractor: new StubMemoryExtractor(),
      deduplicator: new StubMemoryCacheDeduplicator(),
      topicGenerator: new StubTopicGenerator(),
      persistence,
      memoryStore: createMockMemoryStore() as any,
      vectorStore: createMockVectorStore() as any,
      embeddingProvider: createMockEmbeddingProvider() as any,
    }

    orchestrator = new BootstrapOrchestrator(deps, DEFAULT_BOOTSTRAP_CONFIG)
  })

  describe('processExchange', () => {
    it('should increment exchange count', async () => {
      await cache.add('conv-1', [], 'user-1') // Initialize metadata

      await orchestrator.processExchange(
        { userMessage: 'Hello', assistantResponse: 'Hi!' },
        'conv-1',
        'user-1',
        mockCtx
      )

      const metadata = await cache.getMetadata('conv-1')
      expect(metadata?.exchangeCount).toBe(1)
    })

    it('should not throw on error', async () => {
      // Even with broken deps, should not throw
      const brokenDeps = {
        ...deps,
        cache: {
          ...cache,
          incrementExchangeCount: vi.fn().mockRejectedValue(new Error('Redis error')),
        } as any,
      }
      const brokenOrchestrator = new BootstrapOrchestrator(brokenDeps, DEFAULT_BOOTSTRAP_CONFIG)

      // Should not throw
      await expect(
        brokenOrchestrator.processExchange(
          { userMessage: 'Hello', assistantResponse: 'Hi!' },
          'conv-1',
          'user-1',
          mockCtx
        )
      ).resolves.not.toThrow()
    })
  })

  describe('getMemoryCache', () => {
    it('should return cache entries', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')

      const entries = await orchestrator.getMemoryCache('conv-1')

      expect(entries).toHaveLength(1)
      expect(entries[0]).toContain('Mike')
    })

    it('should return empty array for new conversation', async () => {
      const entries = await orchestrator.getMemoryCache('non-existent')
      expect(entries).toEqual([])
    })
  })

  describe('clearMemoryCache', () => {
    it('should clear L1 cache', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')

      await orchestrator.clearMemoryCache('conv-1', ['L1'])

      const entries = await cache.get('conv-1')
      expect(entries).toEqual([])
    })

    it('should handle multiple levels', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')

      // Should not throw
      await expect(
        orchestrator.clearMemoryCache('conv-1', ['L1', 'L2', 'L4'])
      ).resolves.not.toThrow()
    })
  })

  describe('finalize', () => {
    it('should persist cache to L2', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')

      await orchestrator.finalize('conv-1', 'user-1', mockCtx)

      const persisted = persistence.getAll()
      expect(persisted.get('conv-1')).toBeDefined()
      expect(persisted.get('conv-1')?.memories).toHaveLength(1)
    })

    it('should clear L1 after finalization', async () => {
      await cache.add('conv-1', ['- Mike:person -> sponsor'], 'user-1')

      await orchestrator.finalize('conv-1', 'user-1', mockCtx)

      const entries = await cache.get('conv-1')
      expect(entries).toEqual([])
    })

    it('should not throw on error', async () => {
      const brokenDeps = {
        ...deps,
        persistence: {
          persist: vi.fn().mockRejectedValue(new Error('DB error')),
          load: vi.fn(),
          loadMany: vi.fn(),
        } as any,
      }
      const brokenOrchestrator = new BootstrapOrchestrator(brokenDeps, DEFAULT_BOOTSTRAP_CONFIG)

      await expect(
        brokenOrchestrator.finalize('conv-1', 'user-1', mockCtx)
      ).resolves.not.toThrow()
    })
  })

  describe('with extraction', () => {
    it('should extract memories and add to cache', async () => {
      // Create extractor that returns data
      const mockExtractor = {
        extract: vi.fn().mockResolvedValue(ok({
          cacheEntries: ['- Mike:person -> sponsor'],
          memories: [{
            id: 'mem-1',
            name: 'Mike',
            memoryType: 'knowledge',
            metadata: { subtype: 'person' },
            observations: [{ id: 'obs-1', content: 'sponsor', createdAt: Date.now() }],
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            lastAccessed: Date.now(),
          }],
        })),
      }

      const depsWithExtractor = { ...deps, extractor: mockExtractor as any }
      const orchestratorWithExtractor = new BootstrapOrchestrator(depsWithExtractor, DEFAULT_BOOTSTRAP_CONFIG)

      await orchestratorWithExtractor.processExchange(
        { userMessage: 'I talked to Mike', assistantResponse: 'Great!' },
        'conv-1',
        'user-1',
        mockCtx
      )

      const entries = await cache.get('conv-1')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toContain('Mike')

      // Should have called memory store
      expect(deps.memoryStore.createMemory).toHaveBeenCalled()
    })
  })

  describe('bootstrap window', () => {
    it('should not run bootstrap before start', async () => {
      const searchSpy = vi.spyOn(deps.vectorStore, 'search')

      // Exchange 1 (before bootstrap window)
      await cache.add('conv-1', [], 'user-1')
      await orchestrator.processExchange(
        { userMessage: 'Hello', assistantResponse: 'Hi!' },
        'conv-1',
        'user-1',
        mockCtx
      )

      expect(searchSpy).not.toHaveBeenCalled()
    })

    it('should run bootstrap during window', async () => {
      const config = { ...DEFAULT_BOOTSTRAP_CONFIG, bootstrapStart: 1, bootstrapEnd: 3 }
      const windowOrchestrator = new BootstrapOrchestrator(deps, config)

      // Initialize with exchange count at bootstrap start
      await cache.add('conv-1', [], 'user-1')

      // This should trigger bootstrap (exchange 1)
      await windowOrchestrator.processExchange(
        { userMessage: 'Hello', assistantResponse: 'Hi!' },
        'conv-1',
        'user-1',
        mockCtx
      )

      // Topic generator should have been called for search phrases
      // (StubTopicGenerator extracts names from cache, but cache is empty here)
    })
  })
})

describe('StubBootstrapOrchestrator', () => {
  const stub = new StubBootstrapOrchestrator()

  it('should do nothing on processExchange', async () => {
    await expect(
      stub.processExchange(
        { userMessage: 'Hello', assistantResponse: 'Hi!' },
        'conv-1',
        'user-1',
        mockCtx
      )
    ).resolves.not.toThrow()
  })

  it('should do nothing on finalize', async () => {
    await expect(
      stub.finalize('conv-1', 'user-1', mockCtx)
    ).resolves.not.toThrow()
  })

  it('should return empty cache', async () => {
    const entries = await stub.getMemoryCache('conv-1')
    expect(entries).toEqual([])
  })

  it('should do nothing on clearMemoryCache', async () => {
    await expect(
      stub.clearMemoryCache('conv-1', ['L1', 'L2'])
    ).resolves.not.toThrow()
  })
})
