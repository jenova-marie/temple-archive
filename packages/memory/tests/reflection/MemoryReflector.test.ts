/**
 * MemoryReflector Unit Tests
 *
 * Tests for the Memory Reflector system that automatically extracts
 * insights, observations, and reinforcements from conversation exchanges.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MemoryReflector,
  type ReflectionContext,
  type ReflectionResult,
  type MemoryReflectorConfig,
} from '../../src/reflection/MemoryReflector.js'
import type { Message, TraceContext, L3Entity, L3Observation } from '@siri/types'
import { ok, err } from '@siri/types'

// Mock observability to avoid side effects
vi.mock('@siri/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: <T>(_name: string, fn: () => T) => fn(),
  pipelineMetrics: {
    stageDuration: { record: vi.fn() },
    errors: { add: vi.fn() },
  },
}))

// Helper to create mock Anthropic client
function createMockAnthropicClient(response: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: response }],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'end_turn',
      }),
    },
  }
}

// Helper to create a mock Neo4j knowledge store
function createMockKnowledgeStore() {
  return {
    ensureSelfEntity: vi.fn().mockResolvedValue(ok({ id: 'self_123', name: 'user_456_self' })),
    getUserInsights: vi.fn().mockResolvedValue(ok([])),
    createObservation: vi.fn().mockResolvedValue(ok({ id: 'obs_123' })),
    createL3Relationship: vi.fn().mockResolvedValue(ok(undefined)),
    reinforceObservation: vi.fn().mockResolvedValue(ok(undefined)),
    getEntityObservations: vi.fn().mockResolvedValue(ok([])),
  }
}

// Helper to create test trace context
function createTestContext(): TraceContext {
  return {
    traceId: 'test-trace-id',
    spanId: 'test-span-id',
    requestId: 'test-request-id',
    startTime: Date.now(),
  }
}

// Helper to create a test user message
function createUserMessage(content: string, userId = 'user_456'): Message {
  return {
    id: 'msg_user_1',
    conversationId: 'conv_123',
    userId,
    role: 'user',
    content,
    timestamp: Date.now(),
  }
}

// Helper to create a test assistant message
function createAssistantMessage(content: string, userId = 'user_456'): Message {
  return {
    id: 'msg_assistant_1',
    conversationId: 'conv_123',
    userId,
    role: 'assistant',
    content,
    timestamp: Date.now(),
  }
}

// Helper to create a test reflection context
function createReflectionContext(
  userContent = 'Hello, I prefer morning meetings.',
  assistantContent = 'Got it! I\'ll note that you prefer morning meetings.'
): ReflectionContext {
  return {
    userMessage: createUserMessage(userContent),
    assistantMessage: createAssistantMessage(assistantContent),
    toolCalls: [],
    recentInsights: [],
    mentionedEntities: [],
  }
}

// Valid JSON response with all types
const FULL_RESPONSE = JSON.stringify({
  insights: [
    { content: 'User prefers morning meetings', confidence: 0.9, relatedEntities: [] },
  ],
  observations: [
    { entityName: 'john', content: 'Works with the user', confidence: 0.85 },
  ],
  reinforcements: [
    { observationId: 'obs_existing_1', reason: 'User mentioned this again' },
  ],
})

// Empty response
const EMPTY_RESPONSE = JSON.stringify({
  insights: [],
  observations: [],
  reinforcements: [],
})

describe('MemoryReflector', () => {
  let ctx: TraceContext

  beforeEach(() => {
    ctx = createTestContext()
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const config = reflector.getConfig()
      expect(config.insightLimit).toBe(10)
      expect(config.entityLimit).toBe(5)
      expect(config.minConfidence).toBe(0.5)
      expect(config.model).toBe('claude-haiku-4-5')
    })

    it('merges provided config with defaults', () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any, {
        insightLimit: 20,
        minConfidence: 0.7,
      })

      const config = reflector.getConfig()
      expect(config.insightLimit).toBe(20)
      expect(config.minConfidence).toBe(0.7)
      expect(config.entityLimit).toBe(5) // default preserved
      expect(config.model).toBe('claude-haiku-4-5') // default preserved
    })
  })

  describe('reflect()', () => {
    it('calls Anthropic with correct parameters', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      await reflector.reflect(context, ctx)

      expect(anthropic.messages.create).toHaveBeenCalledTimes(1)
      const callArgs = anthropic.messages.create.mock.calls[0][0]
      expect(callArgs.model).toBe('claude-haiku-4-5')
      expect(callArgs.max_tokens).toBe(1024)
      expect(callArgs.system).toContain('memory curator')
      expect(callArgs.messages[0].content).toContain('Hello, I prefer morning meetings.')
    })

    it('returns empty result when no content found', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.insights).toHaveLength(0)
        expect(result.value.observations).toHaveLength(0)
        expect(result.value.reinforcements).toHaveLength(0)
      }
    })

    it('parses insights, observations, and reinforcements correctly', async () => {
      const anthropic = createMockAnthropicClient(FULL_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.insights).toHaveLength(1)
        expect(result.value.insights[0].content).toBe('User prefers morning meetings')
        expect(result.value.insights[0].confidence).toBe(0.9)

        expect(result.value.observations).toHaveLength(1)
        expect(result.value.observations[0].entityName).toBe('john')
        expect(result.value.observations[0].content).toBe('Works with the user')

        expect(result.value.reinforcements).toHaveLength(1)
        expect(result.value.reinforcements[0].observationId).toBe('obs_existing_1')
      }
    })

    it('includes tool calls in context to avoid duplicates', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()
      context.toolCalls = [
        { id: 'tc_1', name: 'saveNote', arguments: { content: 'Test note' } },
      ]

      await reflector.reflect(context, ctx)

      const callArgs = anthropic.messages.create.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('MEMORY TOOLS ALREADY USED')
      expect(callArgs.messages[0].content).toContain('saveNote')
    })

    it('includes recent insights to avoid duplicates', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()
      context.recentInsights = [
        {
          id: 'insight_1',
          content: 'User likes coffee',
          confidence: 0.9,
          createdAt: Date.now(),
        } as L3Observation,
      ]

      await reflector.reflect(context, ctx)

      const callArgs = anthropic.messages.create.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('RECENT USER INSIGHTS')
      expect(callArgs.messages[0].content).toContain('User likes coffee')
    })

    it('includes mentioned entities for observation context', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()
      context.mentionedEntities = [
        {
          id: 'ent_1',
          name: 'john_smith',
          displayName: 'John Smith',
          canonicalType: 'person',
          labels: ['friend'],
        } as L3Entity,
      ]

      await reflector.reflect(context, ctx)

      const callArgs = anthropic.messages.create.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('ENTITIES MENTIONED')
      expect(callArgs.messages[0].content).toContain('John Smith')
    })

    it('handles LLM errors gracefully', async () => {
      const anthropic = {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
        },
      }
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('UnexpectedError')
        expect(result.error.message).toContain('API rate limit exceeded')
      }
    })

    it('handles non-text LLM responses', async () => {
      const anthropic = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'tool_use', id: 'tool_1' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      }
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.insights).toHaveLength(0)
        expect(result.value.observations).toHaveLength(0)
        expect(result.value.reinforcements).toHaveLength(0)
      }
    })

    it('handles malformed JSON in response', async () => {
      const anthropic = createMockAnthropicClient('This is not valid JSON')
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.insights).toHaveLength(0)
        expect(result.value.observations).toHaveLength(0)
        expect(result.value.reinforcements).toHaveLength(0)
      }
    })

    it('extracts JSON from markdown code blocks', async () => {
      const responseWithMarkdown = '```json\n' + FULL_RESPONSE + '\n```'
      const anthropic = createMockAnthropicClient(responseWithMarkdown)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.insights).toHaveLength(1)
      }
    })

    it('filters out malformed insights', async () => {
      const response = JSON.stringify({
        insights: [
          { content: 'Valid insight', confidence: 0.9 },
          { content: 'Missing confidence' }, // Invalid - no confidence
          { confidence: 0.8 }, // Invalid - no content
          'not an object', // Invalid - not an object
        ],
        observations: [],
        reinforcements: [],
      })
      const anthropic = createMockAnthropicClient(response)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.insights).toHaveLength(1)
        expect(result.value.insights[0].content).toBe('Valid insight')
      }
    })

    it('filters out malformed observations', async () => {
      const response = JSON.stringify({
        insights: [],
        observations: [
          { entityName: 'john', content: 'Valid', confidence: 0.9 },
          { entityName: 'jane', content: 'Missing confidence' }, // Invalid
          { content: 'Missing entityName', confidence: 0.8 }, // Invalid
        ],
        reinforcements: [],
      })
      const anthropic = createMockAnthropicClient(response)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.observations).toHaveLength(1)
        expect(result.value.observations[0].entityName).toBe('john')
      }
    })

    it('filters out malformed reinforcements', async () => {
      const response = JSON.stringify({
        insights: [],
        observations: [],
        reinforcements: [
          { observationId: 'obs_1', reason: 'Valid' },
          { reason: 'Missing observationId' }, // Invalid
          'not an object', // Invalid
        ],
      })
      const anthropic = createMockAnthropicClient(response)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)
      const context = createReflectionContext()

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.reinforcements).toHaveLength(1)
        expect(result.value.reinforcements[0].observationId).toBe('obs_1')
      }
    })
  })

  describe('persist()', () => {
    it('creates self entity before persisting insights', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [{ content: 'Test insight', confidence: 0.8 }],
        observations: [],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.ensureSelfEntity).toHaveBeenCalledWith('user_456', ctx)
      expect(store.createObservation).toHaveBeenCalledWith(
        'user_456_self',
        expect.objectContaining({
          content: 'Test insight',
          confidence: 0.8,
          messageId: 'msg_1',
          conversationId: 'conv_123',
        }),
        ctx
      )
    })

    it('skips self entity creation when no insights', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [],
        observations: [{ entityName: 'john', content: 'Test', confidence: 0.9 }],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.ensureSelfEntity).not.toHaveBeenCalled()
    })

    it('creates entity observations', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [],
        observations: [
          { entityName: 'john', content: 'Works at Acme', confidence: 0.85 },
          { entityName: 'jane', content: 'Lives in NYC', confidence: 0.9 },
        ],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.createObservation).toHaveBeenCalledTimes(2)
      expect(store.createObservation).toHaveBeenCalledWith(
        'john',
        expect.objectContaining({ content: 'Works at Acme' }),
        ctx
      )
      expect(store.createObservation).toHaveBeenCalledWith(
        'jane',
        expect.objectContaining({ content: 'Lives in NYC' }),
        ctx
      )
    })

    it('processes reinforcements', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [],
        observations: [],
        reinforcements: [
          { observationId: 'obs_1', reason: 'Confirmed again' },
        ],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.reinforceObservation).toHaveBeenCalledWith(
        'obs_1',
        'msg_1',
        'conv_123',
        0.1,
        ctx
      )
    })

    it('skips insights below minConfidence', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any, {
        minConfidence: 0.7,
      })

      const result: ReflectionResult = {
        insights: [
          { content: 'High confidence', confidence: 0.8 },
          { content: 'Low confidence', confidence: 0.5 }, // Below threshold
        ],
        observations: [],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      // Only one insight should be persisted (ensureSelfEntity + createObservation for high confidence)
      expect(store.createObservation).toHaveBeenCalledTimes(1)
      expect(store.createObservation).toHaveBeenCalledWith(
        'user_456_self',
        expect.objectContaining({ content: 'High confidence' }),
        ctx
      )
    })

    it('skips observations below minConfidence', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any, {
        minConfidence: 0.8,
      })

      const result: ReflectionResult = {
        insights: [],
        observations: [
          { entityName: 'john', content: 'High', confidence: 0.9 },
          { entityName: 'jane', content: 'Low', confidence: 0.6 }, // Below threshold
        ],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.createObservation).toHaveBeenCalledTimes(1)
      expect(store.createObservation).toHaveBeenCalledWith(
        'john',
        expect.objectContaining({ content: 'High' }),
        ctx
      )
    })

    it('links insights to related entities', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [
          {
            content: 'User works with John on projects',
            confidence: 0.9,
            relatedEntities: ['john', 'projects'],
          },
        ],
        observations: [],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.createL3Relationship).toHaveBeenCalledTimes(2)
      expect(store.createL3Relationship).toHaveBeenCalledWith(
        'user_456_self',
        'john',
        'insight_about',
        expect.any(Object),
        ctx
      )
      expect(store.createL3Relationship).toHaveBeenCalledWith(
        'user_456_self',
        'projects',
        'insight_about',
        expect.any(Object),
        ctx
      )
    })

    it('handles observation creation failures gracefully', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      store.createObservation.mockResolvedValue(err({
        kind: 'NotFoundError',
        message: 'Entity not found',
        context: {},
      }))
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [],
        observations: [
          { entityName: 'nonexistent', content: 'Test', confidence: 0.9 },
        ],
        reinforcements: [],
      }

      // Should not throw
      await expect(
        reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)
      ).resolves.not.toThrow()
    })

    it('handles reinforcement failures gracefully', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      store.reinforceObservation.mockResolvedValue(err({
        kind: 'NotFoundError',
        message: 'Observation not found',
        context: {},
      }))
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [],
        observations: [],
        reinforcements: [
          { observationId: 'nonexistent', reason: 'Test' },
        ],
      }

      // Should not throw
      await expect(
        reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)
      ).resolves.not.toThrow()
    })

    it('handles self entity creation failure gracefully', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      store.ensureSelfEntity.mockResolvedValue(err({
        kind: 'ConnectionError',
        message: 'Database unavailable',
        context: {},
      }))
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [{ content: 'Test insight', confidence: 0.8 }],
        observations: [],
        reinforcements: [],
      }

      // Should not throw - insights just won't be persisted
      await expect(
        reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)
      ).resolves.not.toThrow()
    })

    it('does nothing when result is empty', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any)

      const result: ReflectionResult = {
        insights: [],
        observations: [],
        reinforcements: [],
      }

      await reflector.persist(result, 'user_456', 'msg_1', 'conv_123', ctx)

      expect(store.ensureSelfEntity).not.toHaveBeenCalled()
      expect(store.createObservation).not.toHaveBeenCalled()
      expect(store.reinforceObservation).not.toHaveBeenCalled()
    })
  })

  describe('getConfig()', () => {
    it('returns a copy of the config', () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any, {
        insightLimit: 15,
      })

      const config1 = reflector.getConfig()
      const config2 = reflector.getConfig()

      expect(config1).toEqual(config2)
      expect(config1).not.toBe(config2) // Different objects
    })
  })

  describe('custom model configuration', () => {
    it('uses custom model when configured', async () => {
      const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
      const store = createMockKnowledgeStore()
      const reflector = new MemoryReflector(anthropic as any, store as any, {
        model: 'claude-3-sonnet-20241022',
      })
      const context = createReflectionContext()

      await reflector.reflect(context, ctx)

      const callArgs = anthropic.messages.create.mock.calls[0][0]
      expect(callArgs.model).toBe('claude-3-sonnet-20241022')
    })
  })
})

describe('MemoryReflector prompt building', () => {
  let ctx: TraceContext

  beforeEach(() => {
    ctx = createTestContext()
    vi.clearAllMocks()
  })

  it('limits recent insights to insightLimit', async () => {
    const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
    const store = createMockKnowledgeStore()
    const reflector = new MemoryReflector(anthropic as any, store as any, {
      insightLimit: 2,
    })
    const context = createReflectionContext()
    context.recentInsights = Array.from({ length: 5 }, (_, i) => ({
      id: `insight_${i}`,
      content: `Insight ${i}`,
      confidence: 0.9,
      createdAt: Date.now(),
    })) as L3Observation[]

    await reflector.reflect(context, ctx)

    const callArgs = anthropic.messages.create.mock.calls[0][0]
    // Should only include 2 insights
    expect(callArgs.messages[0].content).toContain('Insight 0')
    expect(callArgs.messages[0].content).toContain('Insight 1')
    expect(callArgs.messages[0].content).not.toContain('Insight 2')
  })

  it('limits mentioned entities to entityLimit', async () => {
    const anthropic = createMockAnthropicClient(EMPTY_RESPONSE)
    const store = createMockKnowledgeStore()
    const reflector = new MemoryReflector(anthropic as any, store as any, {
      entityLimit: 2,
    })
    const context = createReflectionContext()
    context.mentionedEntities = Array.from({ length: 5 }, (_, i) => ({
      id: `ent_${i}`,
      name: `entity_${i}`,
      displayName: `Entity ${i}`,
      canonicalType: 'person',
    })) as L3Entity[]

    await reflector.reflect(context, ctx)

    const callArgs = anthropic.messages.create.mock.calls[0][0]
    // Should only include 2 entities
    expect(callArgs.messages[0].content).toContain('Entity 0')
    expect(callArgs.messages[0].content).toContain('Entity 1')
    expect(callArgs.messages[0].content).not.toContain('Entity 2')
  })
})
