/**
 * TopicGenerator Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  TopicGenerator,
  StubTopicGenerator,
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

describe('TopicGenerator', () => {
  describe('generateSearchPhrases', () => {
    it('should generate search phrases from exchanges', async () => {
      const mockResponse = `sponsor relationship
AA meetings
work stress triggers`

      const client = createMockClient(mockResponse)
      const generator = new TopicGenerator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSearchPhrases(
        [
          {
            userMessage: 'I talked to Mike my sponsor today',
            assistantResponse: 'That\'s great!',
          },
        ],
        ['- Mike:person -> sponsor'],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(3)
      expect(result.value).toContain('sponsor relationship')
    })

    it('should return empty array for no exchanges', async () => {
      const client = createMockClient('')
      const generator = new TopicGenerator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSearchPhrases([], [], mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toEqual([])
    })

    it('should limit to 5 phrases', async () => {
      const mockResponse = `phrase 1
phrase 2
phrase 3
phrase 4
phrase 5
phrase 6
phrase 7`

      const client = createMockClient(mockResponse)
      const generator = new TopicGenerator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSearchPhrases(
        [{ userMessage: 'Test', assistantResponse: 'Test' }],
        [],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value?.length).toBeLessThanOrEqual(5)
    })

    it('should filter out long phrases', async () => {
      const longPhrase = 'a'.repeat(150)
      const mockResponse = `short phrase
${longPhrase}
another short phrase`

      const client = createMockClient(mockResponse)
      const generator = new TopicGenerator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSearchPhrases(
        [{ userMessage: 'Test', assistantResponse: 'Test' }],
        [],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
      expect(result.value).not.toContain(longPhrase)
    })

    it('should extract keywords from cache as fallback', async () => {
      const generator = new TopicGenerator(null, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSearchPhrases(
        [{ userMessage: 'Test', assistantResponse: 'Test' }],
        [
          '- Mike:person -> sponsor',
          '- Stress:trigger -> work deadlines',
        ],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value?.some(p => p.includes('Mike'))).toBe(true)
    })
  })

  describe('generateSummary', () => {
    it('should generate topic summary', async () => {
      const mockResponse = 'Discussion about sponsor relationship and coping with work stress.'

      const client = createMockClient(mockResponse)
      const generator = new TopicGenerator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSummary(
        [
          {
            userMessage: 'Work has been stressful',
            assistantResponse: 'I understand. Have you tried any coping strategies?',
          },
        ],
        ['- Stress:trigger -> work deadlines'],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toContain('sponsor')
    })

    it('should return empty string for no data', async () => {
      const client = createMockClient('')
      const generator = new TopicGenerator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSummary([], [], mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toBe('')
    })

    it('should create fallback summary without client', async () => {
      const generator = new TopicGenerator(null, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSummary(
        [{ userMessage: 'Test', assistantResponse: 'Test' }],
        ['- Mike:person -> sponsor', '- Stress:trigger -> work'],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toContain('Mike')
      expect(result.value).toContain('Stress')
    })

    it('should use default summary when no memories', async () => {
      const generator = new TopicGenerator(null, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await generator.generateSummary(
        [{ userMessage: 'Hi', assistantResponse: 'Hello!' }],
        [],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toBe('Recovery support conversation')
    })
  })
})

describe('StubTopicGenerator', () => {
  const generator = new StubTopicGenerator()

  describe('generateSearchPhrases', () => {
    it('should extract names from cache', async () => {
      const result = await generator.generateSearchPhrases(
        [],
        [
          '- Mike:person -> sponsor',
          '- Tuesday:event -> meeting',
          '- Stress:trigger -> work',
        ],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toContain('Mike')
      expect(result.value).toContain('Tuesday')
      expect(result.value).toContain('Stress')
    })

    it('should limit to 3 phrases', async () => {
      const result = await generator.generateSearchPhrases(
        [],
        [
          '- A:type -> a',
          '- B:type -> b',
          '- C:type -> c',
          '- D:type -> d',
        ],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(3)
    })
  })

  describe('generateSummary', () => {
    it('should return conversation summary with memory count', async () => {
      const result = await generator.generateSummary(
        [],
        ['- A:type -> a', '- B:type -> b'],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toContain('2 memories')
    })

    it('should return empty string for no memories', async () => {
      const result = await generator.generateSummary([], [], mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toBe('')
    })
  })
})
