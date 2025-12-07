import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockAgentProvider } from './MockAgentProvider.js'
import type { AgentInput, TraceContext, Message } from '@recoverysky/types'

// Mock observability
vi.mock('@recoverysky/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}))

function createTraceContext(): TraceContext {
  return {
    traceId: 'test-trace-id',
    spanId: 'test-span-id',
    requestId: 'test-request-id',
    startTime: Date.now(),
  }
}

function createAgentInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    userMessage: 'Hello',
    systemPrompt: 'You are a helpful assistant.',
    context: {
      messages: [],
      sessionState: {
        startTime: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        crisisLevel: 0,
      },
    },
    ...overrides,
  }
}

describe('MockAgentProvider', () => {
  let provider: MockAgentProvider
  let ctx: TraceContext

  beforeEach(() => {
    provider = new MockAgentProvider({ delayMs: 0 }) // No delay for faster tests
    ctx = createTraceContext()
  })

  describe('constructor', () => {
    it('uses default config values', () => {
      const p = new MockAgentProvider()
      expect(p).toBeInstanceOf(MockAgentProvider)
    })

    it('accepts custom config', () => {
      const p = new MockAgentProvider({
        delayMs: 50,
        defaultResponse: 'Custom response',
      })
      expect(p).toBeInstanceOf(MockAgentProvider)
    })
  })

  describe('generate', () => {
    it('returns successful response', async () => {
      const input = createAgentInput({ userMessage: 'Test message' })
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.content).toBeDefined()
        expect(result.value.toolCalls).toEqual([])
        expect(result.value.model).toBe('mock-model')
        expect(result.value.stopReason).toBe('end_turn')
      }
    })

    it('calculates token usage based on message length', async () => {
      const input = createAgentInput({ userMessage: 'A short message' })
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(Math.ceil(input.userMessage.length / 4))
        expect(result.value.usage.outputTokens).toBe(Math.ceil(result.value.content.length / 4))
      }
    })

    describe('contextual responses', () => {
      it('returns crisis response for suicidal messages', async () => {
        const input = createAgentInput({ userMessage: 'I want to die' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toContain('988')
          expect(result.value.content).toContain('Suicide')
        }
      })

      it('returns relapse response for relapse messages', async () => {
        const input = createAgentInput({ userMessage: 'I had a relapse yesterday' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toContain('honest')
          expect(result.value.content.toLowerCase()).toContain('relapse')
        }
      })

      it('returns greeting response for hello', async () => {
        const input = createAgentInput({ userMessage: 'Hello there!' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toContain('Hi')
          expect(result.value.content).toContain('Sky')
        }
      })

      it('returns mood response for feeling messages', async () => {
        const input = createAgentInput({ userMessage: 'I am feeling anxious' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toContain('sharing')
        }
      })

      it('returns meeting response for AA/NA requests', async () => {
        const input = createAgentInput({ userMessage: 'Can you find an AA meeting?' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toContain('meeting')
        }
      })
    })

    describe('custom mock responses', () => {
      it('returns custom response for trigger phrase', async () => {
        provider.setMockResponse('weather', 'It is sunny today!')

        const input = createAgentInput({ userMessage: 'What is the weather like?' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toBe('It is sunny today!')
        }
      })

      it('clears mock responses', async () => {
        provider.setMockResponse('special', 'Special response')
        provider.clearMockResponses()

        const input = createAgentInput({ userMessage: 'This is special' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).not.toBe('Special response')
        }
      })

      it('matches trigger case-insensitively', async () => {
        provider.setMockResponse('WEATHER', 'Weather response')

        // Use a message that doesn't trigger contextual responses
        const input = createAgentInput({ userMessage: 'what is the WEATHER today' })
        const result = await provider.generate(input, ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.content).toBe('Weather response')
        }
      })
    })
  })

  describe('stream', () => {
    it('yields text chunks word by word', async () => {
      provider = new MockAgentProvider({
        delayMs: 0,
        defaultResponse: 'One two three',
      })

      // Use a message that doesn't trigger contextual responses
      const input = createAgentInput({ userMessage: 'random message xyz' })
      const chunks: unknown[] = []

      for await (const chunk of provider.stream(input, ctx)) {
        chunks.push(chunk)
      }

      const textChunks = chunks.filter((c: unknown) => (c as { type: string }).type === 'text')
      expect(textChunks).toHaveLength(3)
      expect(textChunks[0]).toEqual({ type: 'text', content: 'One ' })
      expect(textChunks[1]).toEqual({ type: 'text', content: 'two ' })
      expect(textChunks[2]).toEqual({ type: 'text', content: 'three ' })
    })

    it('ends with done chunk', async () => {
      provider = new MockAgentProvider({
        delayMs: 0,
        defaultResponse: 'Short',
      })

      // Use a message that doesn't trigger contextual responses
      const input = createAgentInput({ userMessage: 'random message xyz' })
      const chunks: unknown[] = []

      for await (const chunk of provider.stream(input, ctx)) {
        chunks.push(chunk)
      }

      const lastChunk = chunks[chunks.length - 1]
      expect(lastChunk).toEqual({ type: 'done' })
    })

    it('returns final response', async () => {
      provider = new MockAgentProvider({
        delayMs: 0,
        defaultResponse: 'Test response',
      })

      // Use a message that doesn't trigger contextual responses
      const input = createAgentInput({ userMessage: 'random message xyz' })
      let finalResponse

      const generator = provider.stream(input, ctx)
      let result = await generator.next()
      while (!result.done) {
        result = await generator.next()
      }
      finalResponse = result.value

      expect(finalResponse.content).toBe('Test response')
      expect(finalResponse.model).toBe('mock-model')
    })
  })
})
