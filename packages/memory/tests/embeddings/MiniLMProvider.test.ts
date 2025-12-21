/**
 * MiniLM Embedding Provider Tests
 *
 * Tests for the local 384-dimensional embedding provider.
 * Uses mocked transformers pipeline to avoid model downloads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MiniLMEmbeddingProvider } from '../../src/embeddings/MiniLMProvider.js'

// Mock the @xenova/transformers module
vi.mock('@xenova/transformers', () => {
  const mockPipeline = vi.fn()
  return {
    pipeline: mockPipeline,
  }
})

describe('MiniLMEmbeddingProvider', () => {
  let provider: MiniLMEmbeddingProvider
  let mockExtractor: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()

    // Create mock extractor that returns fake embeddings
    mockExtractor = vi.fn().mockImplementation((text: string) => {
      // Return a mock tensor with 384-dim embedding
      const embedding = new Float32Array(384).fill(0.1)
      return Promise.resolve({
        data: embedding,
      })
    })

    // Setup pipeline mock to return our extractor
    const { pipeline } = await import('@xenova/transformers')
    ;(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockExtractor)

    provider = new MiniLMEmbeddingProvider()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should not be initialized by default', () => {
      expect(provider.isInitialized()).toBe(false)
    })

    it('should initialize successfully', async () => {
      const result = await provider.init()

      expect(result.ok).toBe(true)
      expect(provider.isInitialized()).toBe(true)
    })

    it('should only initialize once', async () => {
      const { pipeline } = await import('@xenova/transformers')

      await provider.init()
      await provider.init()

      // Pipeline should only be called once
      expect(pipeline).toHaveBeenCalledTimes(1)
    })

    it('should handle initialization errors', async () => {
      const { pipeline } = await import('@xenova/transformers')
      ;(pipeline as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Model load failed'))

      const freshProvider = new MiniLMEmbeddingProvider()
      const result = await freshProvider.init()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('InitError')
        expect(result.error.message).toContain('Failed to initialize')
      }
    })
  })

  describe('embed', () => {
    it('should auto-initialize if not initialized', async () => {
      expect(provider.isInitialized()).toBe(false)

      const result = await provider.embed(['test text'])

      expect(result.ok).toBe(true)
      expect(provider.isInitialized()).toBe(true)
    })

    it('should generate embeddings for single text', async () => {
      await provider.init()

      const result = await provider.embed(['Hello world'])

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]).toHaveLength(384)
      }
    })

    it('should generate embeddings for multiple texts', async () => {
      await provider.init()

      const texts = ['First text', 'Second text', 'Third text']
      const result = await provider.embed(texts)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(3)
        result.value.forEach((embedding) => {
          expect(embedding).toHaveLength(384)
        })
      }
    })

    it('should call extractor for each text', async () => {
      await provider.init()

      const texts = ['One', 'Two']
      await provider.embed(texts)

      expect(mockExtractor).toHaveBeenCalledTimes(2)
      expect(mockExtractor).toHaveBeenCalledWith('One', expect.any(Object))
      expect(mockExtractor).toHaveBeenCalledWith('Two', expect.any(Object))
    })

    it('should handle embedding errors', async () => {
      await provider.init()
      mockExtractor.mockRejectedValue(new Error('Embedding failed'))

      const result = await provider.embed(['test'])

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('EmbeddingError')
      }
    })
  })

  describe('embedOne', () => {
    it('should generate embedding for single text', async () => {
      await provider.init()

      const result = await provider.embedOne('Single text')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(384)
      }
    })

    it('should return first embedding from batch', async () => {
      await provider.init()

      const result = await provider.embedOne('Test')

      expect(result.ok).toBe(true)
      expect(mockExtractor).toHaveBeenCalledTimes(1)
    })
  })

  describe('configuration', () => {
    it('should return correct dimensions', () => {
      expect(provider.getDimensions()).toBe(384)
    })

    it('should return default model name', () => {
      expect(provider.getModel()).toBe('Xenova/all-MiniLM-L6-v2')
    })

    it('should use custom model when configured', () => {
      const customProvider = new MiniLMEmbeddingProvider({
        model: 'custom/model',
      })

      expect(customProvider.getModel()).toBe('custom/model')
    })
  })
})
