/**
 * MemoryExtractor Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MemoryExtractor,
  StubMemoryExtractor,
  DEFAULT_BOOTSTRAP_CONFIG,
} from '../../src/bootstrap/index.js'

// Mock Anthropic client
const createMockClient = (response: string) => ({
  messages: {
    create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: response }],
    }),
  },
})

const mockCtx = {
  traceId: 'trace-1',
  spanId: 'span-1',
  requestId: 'req-1',
  startTime: Date.now(),
}

describe('MemoryExtractor', () => {
  describe('with mock client', () => {
    it('should extract memories from exchange', async () => {
      const mockResponse = JSON.stringify({
        cacheEntries: ['- Mike:person -> User\'s sponsor, very helpful'],
        memories: [
          {
            name: 'Mike',
            type: 'person',
            observation: 'User\'s sponsor, very helpful',
          },
        ],
      })

      const client = createMockClient(mockResponse)
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        {
          userMessage: 'I talked to Mike today',
          assistantResponse: 'That\'s great that you connected with your sponsor!',
        },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).not.toBeNull()
      expect(result.value?.cacheEntries).toHaveLength(1)
      expect(result.value?.cacheEntries[0]).toContain('Mike')
      expect(result.value?.memories).toHaveLength(1)
      expect(result.value?.memories[0].name).toBe('Mike')
      expect(result.value?.memories[0].memoryType).toBe('knowledge')
    })

    it('should return null when nothing to remember', async () => {
      const client = createMockClient('null')
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        {
          userMessage: 'Hi',
          assistantResponse: 'Hello!',
        },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toBeNull()
    })

    it('should pass current cache to avoid duplicates', async () => {
      const mockResponse = JSON.stringify({
        cacheEntries: ['- Tuesday:event -> meeting day'],
        memories: [
          {
            name: 'Tuesday',
            type: 'event',
            observation: 'meeting day',
          },
        ],
      })

      const client = createMockClient(mockResponse)
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      await extractor.extract(
        {
          userMessage: 'Meeting on Tuesday',
          assistantResponse: 'Got it!',
        },
        ['- Mike:person -> sponsor'],
        'user-1',
        mockCtx
      )

      // Verify the prompt included current cache
      const callArg = client.messages.create.mock.calls[0][0]
      expect(callArg.messages[0].content).toContain('Mike:person')
    })

    it('should handle empty cacheEntries response', async () => {
      const mockResponse = JSON.stringify({
        cacheEntries: [],
        memories: [],
      })

      const client = createMockClient(mockResponse)
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        {
          userMessage: 'Just checking in',
          assistantResponse: 'How are you?',
        },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toBeNull()
    })

    it('should handle malformed JSON gracefully', async () => {
      const client = createMockClient('not valid json at all')
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        {
          userMessage: 'Test',
          assistantResponse: 'Test response',
        },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toBeNull()
    })

    it('should filter invalid memory types', async () => {
      const mockResponse = JSON.stringify({
        cacheEntries: ['- Something:invalid_type -> description'],
        memories: [
          {
            name: 'Something',
            type: 'invalid_type',
            observation: 'description',
          },
          {
            name: 'Mike',
            type: 'person',
            observation: 'valid person',
          },
        ],
      })

      const client = createMockClient(mockResponse)
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        {
          userMessage: 'Test',
          assistantResponse: 'Test',
        },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value?.memories).toHaveLength(1)
      expect(result.value?.memories[0].name).toBe('Mike')
    })

    it('should map subtypes to correct memory types', async () => {
      const mockResponse = JSON.stringify({
        cacheEntries: [
          '- Stress:trigger -> work',
          '- Breathing:coping_strategy -> technique',
          '- 30 Days:milestone -> sobriety',
        ],
        memories: [
          { name: 'Stress', type: 'trigger', observation: 'work' },
          { name: 'Breathing', type: 'coping_strategy', observation: 'technique' },
          { name: '30 Days', type: 'milestone', observation: 'sobriety' },
        ],
      })

      const client = createMockClient(mockResponse)
      const extractor = new MemoryExtractor(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        { userMessage: 'Test', assistantResponse: 'Test' },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value?.memories[0].memoryType).toBe('pattern') // trigger -> pattern
      expect(result.value?.memories[1].memoryType).toBe('pattern') // coping_strategy -> pattern
      expect(result.value?.memories[2].memoryType).toBe('decision') // milestone -> decision
    })
  })

  describe('without client', () => {
    it('should return null when no client provided', async () => {
      const extractor = new MemoryExtractor(null, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await extractor.extract(
        {
          userMessage: 'Hello',
          assistantResponse: 'Hi there!',
        },
        [],
        'user-1',
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toBeNull()
    })
  })
})

describe('StubMemoryExtractor', () => {
  it('should always return null', async () => {
    const extractor = new StubMemoryExtractor()

    const result = await extractor.extract(
      {
        userMessage: 'Hello',
        assistantResponse: 'Hi!',
      },
      [],
      'user-1',
      mockCtx
    )

    expect(result.ok).toBe(true)
    expect(result.value).toBeNull()
  })
})
