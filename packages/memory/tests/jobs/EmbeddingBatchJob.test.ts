/**
 * Embedding Batch Job Tests
 *
 * Tests for the background embedding processor that generates
 * dual-store embeddings (L3: MiniLM 384-dim, L4: OpenAI 1536-dim).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmbeddingBatchJob } from '../../src/jobs/EmbeddingBatchJob.js'
import type { Neo4jKnowledgeStore } from '../../src/stores/Neo4jKnowledgeStore.js'
import type { QdrantVectorStore } from '../../src/stores/QdrantVectorStore.js'
import type { MiniLMEmbeddingProvider } from '../../src/embeddings/MiniLMProvider.js'
import type { OpenAIEmbeddingProvider } from '../../src/providers/OpenAIEmbeddingProvider.js'
import type { TraceContext } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'

function createTraceContext(): TraceContext {
  return {
    requestId: 'test-request',
    traceId: 'test-trace',
    spanId: 'test-span',
    startTime: Date.now(),
  }
}

describe('EmbeddingBatchJob', () => {
  let mockNeo4jStore: Partial<Neo4jKnowledgeStore>
  let mockQdrantStore: Partial<QdrantVectorStore>
  let mockMiniLM: Partial<MiniLMEmbeddingProvider>
  let mockOpenAI: Partial<OpenAIEmbeddingProvider>
  let job: EmbeddingBatchJob

  beforeEach(() => {
    vi.useFakeTimers()

    // Mock Neo4j store
    mockNeo4jStore = {
      getUnembeddedItems: vi.fn().mockResolvedValue(ok([])),
      batchUpdateEmbeddings: vi.fn().mockResolvedValue(ok(undefined)),
    }

    // Mock Qdrant store (without batchUpsertEntities by default)
    mockQdrantStore = {}

    // Mock MiniLM provider
    mockMiniLM = {
      embed: vi.fn().mockResolvedValue(ok([[0.1, 0.2, 0.3]])),
    }

    // Mock OpenAI provider
    mockOpenAI = {
      embedBatch: vi.fn().mockResolvedValue(ok([[0.4, 0.5, 0.6]])),
    }

    job = new EmbeddingBatchJob(
      mockNeo4jStore as Neo4jKnowledgeStore,
      mockQdrantStore as QdrantVectorStore,
      mockMiniLM as MiniLMEmbeddingProvider,
      mockOpenAI as OpenAIEmbeddingProvider,
      { intervalMs: 1000, batchSize: 10, runImmediately: false }
    )
  })

  afterEach(() => {
    job.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('lifecycle', () => {
    it('should not be running initially', () => {
      expect(job.isRunning()).toBe(false)
      expect(job.isProcessing()).toBe(false)
    })

    it('should start and stop correctly', () => {
      job.start()
      expect(job.isRunning()).toBe(true)

      job.stop()
      expect(job.isRunning()).toBe(false)
    })

    it('should not start twice', () => {
      job.start()
      job.start()

      expect(job.isRunning()).toBe(true)
    })

    it('should be idempotent when stopping', () => {
      job.stop()
      job.stop()

      expect(job.isRunning()).toBe(false)
    })
  })

  describe('runOnce', () => {
    it('should return 0 when no items need embedding', async () => {
      const count = await job.runOnce(createTraceContext())

      expect(count).toBe(0)
      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledWith(10, expect.any(Object))
    })

    it('should process pending items', async () => {
      const pendingItems = [
        { id: 'entity-1', type: 'entity' as const, text: 'John Smith' },
        { id: 'obs-1', type: 'observation' as const, text: 'Works at Google' },
      ]

      ;(mockNeo4jStore.getUnembeddedItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(pendingItems)
      )
      ;(mockMiniLM.embed as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ])
      )
      ;(mockOpenAI.embedBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([
          [0.7, 0.8, 0.9],
          [1.0, 1.1, 1.2],
        ])
      )

      const count = await job.runOnce(createTraceContext())

      expect(count).toBe(2)
      expect(mockMiniLM.embed).toHaveBeenCalledWith(['John Smith', 'Works at Google'])
      expect(mockOpenAI.embedBatch).toHaveBeenCalledWith(
        ['John Smith', 'Works at Google'],
        expect.any(Object)
      )
    })

    it('should update Neo4j with L3 embeddings', async () => {
      const pendingItems = [{ id: 'entity-1', type: 'entity' as const, text: 'Test' }]

      ;(mockNeo4jStore.getUnembeddedItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(pendingItems)
      )
      ;(mockMiniLM.embed as ReturnType<typeof vi.fn>).mockResolvedValue(ok([[0.1, 0.2, 0.3]]))

      await job.runOnce(createTraceContext())

      expect(mockNeo4jStore.batchUpdateEmbeddings).toHaveBeenCalledWith(
        [{ id: 'entity-1', type: 'entity', embedding: [0.1, 0.2, 0.3] }],
        expect.any(Object)
      )
    })

    it('should handle getUnembeddedItems errors', async () => {
      ;(mockNeo4jStore.getUnembeddedItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        err({ kind: 'ConnectionError', message: 'Neo4j down', context: {} })
      )

      const count = await job.runOnce(createTraceContext())

      expect(count).toBe(0)
    })

    it('should handle L3 embedding errors', async () => {
      const pendingItems = [{ id: 'entity-1', type: 'entity' as const, text: 'Test' }]

      ;(mockNeo4jStore.getUnembeddedItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(pendingItems)
      )
      ;(mockMiniLM.embed as ReturnType<typeof vi.fn>).mockResolvedValue(
        err({ kind: 'EmbeddingError', message: 'MiniLM failed', context: {} })
      )

      const count = await job.runOnce(createTraceContext())

      expect(count).toBe(0)
      expect(mockNeo4jStore.batchUpdateEmbeddings).not.toHaveBeenCalled()
    })

    it('should continue with L3 only when L4 fails', async () => {
      const pendingItems = [{ id: 'entity-1', type: 'entity' as const, text: 'Test' }]

      ;(mockNeo4jStore.getUnembeddedItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(pendingItems)
      )
      ;(mockMiniLM.embed as ReturnType<typeof vi.fn>).mockResolvedValue(ok([[0.1, 0.2]]))
      ;(mockOpenAI.embedBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
        err({ kind: 'EmbeddingError', message: 'OpenAI failed', context: {} })
      )

      const count = await job.runOnce(createTraceContext())

      // Should still succeed with L3 embeddings
      expect(count).toBe(1)
      expect(mockNeo4jStore.batchUpdateEmbeddings).toHaveBeenCalled()
    })

    it('should not process if already processing', async () => {
      const pendingItems = [{ id: 'entity-1', type: 'entity' as const, text: 'Test' }]

      // Make getUnembeddedItems slow
      ;(mockNeo4jStore.getUnembeddedItems as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(ok(pendingItems)), 100)
          })
      )

      // Start first run
      const run1 = job.runOnce(createTraceContext())

      // Try to start second run immediately
      const run2 = job.runOnce(createTraceContext())

      // Second run should return 0 immediately
      const count2 = await run2
      expect(count2).toBe(0)

      // Advance timer to complete first run
      await vi.advanceTimersByTimeAsync(100)
      await run1
    })
  })

  describe('scheduled execution', () => {
    it('should run immediately when runImmediately is true', async () => {
      const immediateJob = new EmbeddingBatchJob(
        mockNeo4jStore as Neo4jKnowledgeStore,
        mockQdrantStore as QdrantVectorStore,
        mockMiniLM as MiniLMEmbeddingProvider,
        mockOpenAI as OpenAIEmbeddingProvider,
        { intervalMs: 1000, runImmediately: true }
      )

      immediateJob.start()

      // Should have called getUnembeddedItems immediately
      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalled()

      immediateJob.stop()
    })

    it('should schedule next run after interval', async () => {
      job.start()

      // Initially not called (runImmediately: false)
      expect(mockNeo4jStore.getUnembeddedItems).not.toHaveBeenCalled()

      // Advance by interval
      await vi.advanceTimersByTimeAsync(1000)

      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledTimes(1)

      // Advance again
      await vi.advanceTimersByTimeAsync(1000)

      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledTimes(2)
    })

    it('should stop scheduling when stopped', async () => {
      job.start()

      await vi.advanceTimersByTimeAsync(1000)
      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledTimes(1)

      job.stop()

      await vi.advanceTimersByTimeAsync(2000)
      // Should not have been called again
      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledTimes(1)
    })
  })

  describe('configuration', () => {
    it('should use default config values', () => {
      const defaultJob = new EmbeddingBatchJob(
        mockNeo4jStore as Neo4jKnowledgeStore,
        mockQdrantStore as QdrantVectorStore,
        mockMiniLM as MiniLMEmbeddingProvider,
        mockOpenAI as OpenAIEmbeddingProvider
      )

      // Default batchSize is 100
      defaultJob.start()

      // Verify via mock call
      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledWith(100, expect.any(Object))

      defaultJob.stop()
    })

    it('should respect custom batch size', async () => {
      const customJob = new EmbeddingBatchJob(
        mockNeo4jStore as Neo4jKnowledgeStore,
        mockQdrantStore as QdrantVectorStore,
        mockMiniLM as MiniLMEmbeddingProvider,
        mockOpenAI as OpenAIEmbeddingProvider,
        { batchSize: 50 }
      )

      await customJob.runOnce(createTraceContext())

      expect(mockNeo4jStore.getUnembeddedItems).toHaveBeenCalledWith(50, expect.any(Object))
    })
  })
})
