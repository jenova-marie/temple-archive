import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TraceContext } from '@recoverysky/types'

// Use vi.hoisted to create mock functions and classes that can be used in vi.mock
const { mockCreate, MockAPIError } = vi.hoisted(() => {
  const mockCreate = vi.fn()

  class MockAPIError extends Error {
    status: number
    headers?: Record<string, string>
    constructor(status: number, message: string, headers?: Record<string, string>) {
      super(message)
      this.status = status
      this.headers = headers
      this.name = 'APIError'
    }
  }

  return { mockCreate, MockAPIError }
})

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: mockCreate,
      },
    })),
    APIError: MockAPIError,
  }
})

// Import after mocking
import { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider.js'

function createTestContext(): TraceContext {
  return {
    traceId: 'trace-123',
    spanId: 'span-456',
    requestId: 'req-789',
    startTime: Date.now(),
  }
}

describe('OpenAIEmbeddingProvider', () => {
  let provider: OpenAIEmbeddingProvider
  const ctx = createTestContext()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-api-key'
    provider = new OpenAIEmbeddingProvider()
  })

  describe('constructor', () => {
    it('throws if no API key provided', () => {
      delete process.env.OPENAI_API_KEY
      expect(() => new OpenAIEmbeddingProvider()).toThrow('OpenAI API key is required')
    })

    it('accepts API key from config', () => {
      delete process.env.OPENAI_API_KEY
      expect(() => new OpenAIEmbeddingProvider({ apiKey: 'custom-key' })).not.toThrow()
    })

    it('has correct dimension', () => {
      expect(provider.dimension).toBe(1536)
    })
  })

  describe('embed', () => {
    it('returns embedding for text', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random())
      mockCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0 }],
      })

      const result = await provider.embed('Hello world', ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual(mockEmbedding)
        expect(result.value.length).toBe(1536)
      }
    })

    it('returns error when no embedding returned', async () => {
      mockCreate.mockResolvedValue({ data: [] })

      const result = await provider.embed('Hello world', ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('ProviderError')
        expect(result.error.message).toContain('No embedding returned')
      }
    })

    it('handles rate limit errors', async () => {
      mockCreate.mockRejectedValue(new MockAPIError(429, 'Rate limit exceeded', { 'retry-after': '60' }))

      const result = await provider.embed('Hello world', ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('RateLimitError')
      }
    })

    it('handles input too long errors', async () => {
      mockCreate.mockRejectedValue(new MockAPIError(400, 'maximum context length exceeded'))

      const result = await provider.embed('Hello world', ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('InputTooLongError')
      }
    })

    it('handles generic API errors', async () => {
      mockCreate.mockRejectedValue(new MockAPIError(500, 'Internal server error'))

      const result = await provider.embed('Hello world', ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('ProviderError')
      }
    })

    it('handles unexpected errors', async () => {
      mockCreate.mockRejectedValue(new Error('Network failure'))

      const result = await provider.embed('Hello world', ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('UnexpectedError')
        expect(result.error.message).toContain('Network failure')
      }
    })
  })

  describe('embedBatch', () => {
    it('returns empty array for empty input', async () => {
      const result = await provider.embedBatch([], ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('returns embeddings for multiple texts', async () => {
      const embedding1 = Array.from({ length: 1536 }, () => 0.1)
      const embedding2 = Array.from({ length: 1536 }, () => 0.2)

      mockCreate.mockResolvedValue({
        data: [
          { embedding: embedding1, index: 0 },
          { embedding: embedding2, index: 1 },
        ],
      })

      const result = await provider.embedBatch(['Hello', 'World'], ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBe(2)
        expect(result.value[0]).toEqual(embedding1)
        expect(result.value[1]).toEqual(embedding2)
      }
    })

    it('sorts embeddings by index', async () => {
      const embedding1 = Array.from({ length: 1536 }, () => 0.1)
      const embedding2 = Array.from({ length: 1536 }, () => 0.2)

      // Return in wrong order
      mockCreate.mockResolvedValue({
        data: [
          { embedding: embedding2, index: 1 },
          { embedding: embedding1, index: 0 },
        ],
      })

      const result = await provider.embedBatch(['First', 'Second'], ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value[0]).toEqual(embedding1)
        expect(result.value[1]).toEqual(embedding2)
      }
    })

    it('processes large batches in chunks', async () => {
      // Create provider with small batch size
      const smallBatchProvider = new OpenAIEmbeddingProvider({ batchSize: 2 })

      const mockEmbedding = Array.from({ length: 1536 }, () => 0.5)

      // Mock to return correct number of embeddings per batch
      mockCreate
        .mockResolvedValueOnce({
          data: [
            { embedding: mockEmbedding, index: 0 },
            { embedding: mockEmbedding, index: 1 },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            { embedding: mockEmbedding, index: 0 },
            { embedding: mockEmbedding, index: 1 },
          ],
        })
        .mockResolvedValueOnce({
          data: [{ embedding: mockEmbedding, index: 0 }],
        })

      const texts = ['a', 'b', 'c', 'd', 'e']
      const result = await smallBatchProvider.embedBatch(texts, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.length).toBe(5)
      }
      // Should be called 3 times: [a,b], [c,d], [e]
      expect(mockCreate).toHaveBeenCalledTimes(3)
    })

    it('handles errors during batch processing', async () => {
      mockCreate.mockRejectedValue(new MockAPIError(429, 'Rate limit'))

      const result = await provider.embedBatch(['Hello', 'World'], ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('RateLimitError')
      }
    })
  })
})
