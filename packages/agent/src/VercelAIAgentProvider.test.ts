import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VercelAIAgentProvider } from './VercelAIAgentProvider.js'
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
  pipelineMetrics: {
    tokensUsed: { add: vi.fn() },
    errors: { add: vi.fn() },
  },
}))

// Mock the Vercel AI SDK
const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

// Mock Anthropic
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((model: string) => ({ modelId: model })),
}))

function createTraceContext(): TraceContext {
  return {
    traceId: 'test-trace-id',
    spanId: 'test-span-id',
    requestId: 'test-request-id',
    startTime: Date.now(),
  }
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}`,
    conversationId: 'conv-1',
    role: 'user',
    content: 'Test message',
    timestamp: Date.now(),
    ...overrides,
  }
}

function createAgentInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    userMessage: 'Hello, how are you?',
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

describe('VercelAIAgentProvider', () => {
  let provider: VercelAIAgentProvider
  let ctx: TraceContext

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new VercelAIAgentProvider()
    ctx = createTraceContext()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('constructor', () => {
    it('uses default config values', () => {
      const p = new VercelAIAgentProvider()
      expect(p).toBeInstanceOf(VercelAIAgentProvider)
    })

    it('accepts custom config', () => {
      const p = new VercelAIAgentProvider({
        model: 'claude-3-opus-20240229',
        maxTokens: 8192,
        maxSteps: 10,
        temperature: 0.5,
      })
      expect(p).toBeInstanceOf(VercelAIAgentProvider)
    })
  })

  describe('generate', () => {
    it('returns successful response from Claude', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Hello! I am doing well, thank you for asking.',
        finishReason: 'stop',
        usage: {
          promptTokens: 50,
          completionTokens: 20,
        },
        toolCalls: [],
        steps: [],
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.content).toBe('Hello! I am doing well, thank you for asking.')
        expect(result.value.usage.inputTokens).toBe(50)
        expect(result.value.usage.outputTokens).toBe(20)
        expect(result.value.stopReason).toBe('end_turn')
        expect(result.value.toolCalls).toEqual([])
      }
    })

    it('includes conversation history in messages', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Response',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 10 },
        toolCalls: [],
      })

      const historyMessages = [
        createMessage({ role: 'user', content: 'Previous question' }),
        createMessage({ role: 'assistant', content: 'Previous answer' }),
      ]

      const input = createAgentInput({
        context: {
          messages: historyMessages,
          sessionState: {
            startTime: Date.now(),
            lastActivity: Date.now(),
            messageCount: 2,
            crisisLevel: 0,
          },
        },
      })

      await provider.generate(input, ctx)

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
            { role: 'user', content: 'Hello, how are you?' },
          ]),
        })
      )
    })

    it('converts tool calls to internal format', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Let me find meetings for you.',
        finishReason: 'tool-calls',
        usage: { promptTokens: 60, completionTokens: 30 },
        toolCalls: [
          {
            toolCallId: 'call-123',
            toolName: 'findMeetings',
            args: { type: 'aa', location: 'Seattle' },
          },
        ],
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.toolCalls).toHaveLength(1)
        expect(result.value.toolCalls[0]).toEqual({
          toolId: 'call-123',
          name: 'findMeetings',
          arguments: { type: 'aa', location: 'Seattle' },
          result: undefined,
        })
        expect(result.value.stopReason).toBe('tool_use')
      }
    })

    it('handles rate limit errors', async () => {
      mockGenerateText.mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('RateLimitError')
        expect(result.error.message).toContain('Rate limit')
      }
    })

    it('handles context length errors', async () => {
      mockGenerateText.mockRejectedValue({
        message: 'maximum context length exceeded',
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('ContextLengthError')
        expect(result.error.message).toContain('too long')
      }
    })

    it('handles timeout errors', async () => {
      mockGenerateText.mockRejectedValue({
        message: 'Request timeout',
        code: 'ETIMEDOUT',
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('TimeoutError')
      }
    })

    it('handles tool execution errors', async () => {
      mockGenerateText.mockRejectedValue({
        message: 'tool execution failed',
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('ToolError')
      }
    })

    it('handles unknown errors as ProviderError', async () => {
      mockGenerateText.mockRejectedValue({
        message: 'Unknown server error',
        status: 500,
      })

      const input = createAgentInput()
      const result = await provider.generate(input, ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('ProviderError')
      }
    })

    it('maps different finish reasons correctly', async () => {
      const finishReasons = [
        { reason: 'stop', expected: 'end_turn' },
        { reason: 'end_turn', expected: 'end_turn' },
        { reason: 'length', expected: 'max_tokens' },
        { reason: 'max_tokens', expected: 'max_tokens' },
        { reason: 'tool-calls', expected: 'tool_use' },
        { reason: 'tool_use', expected: 'tool_use' },
        { reason: 'stop_sequence', expected: 'stop_sequence' },
        { reason: 'unknown', expected: 'end_turn' },
      ]

      for (const { reason, expected } of finishReasons) {
        mockGenerateText.mockResolvedValue({
          text: 'Response',
          finishReason: reason,
          usage: { promptTokens: 10, completionTokens: 5 },
          toolCalls: [],
        })

        const result = await provider.generate(createAgentInput(), ctx)

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.stopReason).toBe(expected)
        }
      }
    })
  })

  describe('stream', () => {
    it('yields text chunks word by word', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Hello world',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
      })

      const input = createAgentInput()
      const chunks: unknown[] = []

      for await (const chunk of provider.stream(input, ctx)) {
        chunks.push(chunk)
      }

      expect(chunks).toContainEqual({ type: 'text', content: 'Hello ' })
      expect(chunks).toContainEqual({ type: 'text', content: 'world ' })
      expect(chunks).toContainEqual({ type: 'done' })
    })

    it('yields tool calls before text', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Found meetings',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [
          {
            toolCallId: 'call-456',
            toolName: 'findMeetings',
            args: { type: 'aa' },
          },
        ],
      })

      const input = createAgentInput()
      const chunks: unknown[] = []

      for await (const chunk of provider.stream(input, ctx)) {
        chunks.push(chunk)
      }

      // Tool call should come before text
      const toolCallIndex = chunks.findIndex(
        (c: unknown) => (c as { type: string }).type === 'tool_call'
      )
      const textIndex = chunks.findIndex(
        (c: unknown) => (c as { type: string }).type === 'text'
      )

      expect(toolCallIndex).toBeLessThan(textIndex)
      expect(chunks[toolCallIndex]).toEqual({
        type: 'tool_call',
        toolCall: {
          toolId: 'call-456',
          name: 'findMeetings',
          arguments: { type: 'aa' },
        },
      })
    })

    it('yields error chunk on failure', async () => {
      mockGenerateText.mockRejectedValue({
        message: 'API error',
        status: 500,
      })

      const input = createAgentInput()
      const chunks: unknown[] = []

      try {
        for await (const chunk of provider.stream(input, ctx)) {
          chunks.push(chunk)
        }
      } catch {
        // Expected to throw after yielding error
      }

      // Should have an error chunk with the error message
      const errorChunk = chunks.find((c: unknown) => (c as { type: string }).type === 'error')
      expect(errorChunk).toBeDefined()
      expect((errorChunk as { error: string }).error).toBeDefined()
    })
  })
})
