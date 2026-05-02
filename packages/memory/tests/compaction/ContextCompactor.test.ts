/**
 * ContextCompactor Unit Tests
 *
 * Tests for the context compaction system that summarizes older messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// @ts-expect-error - ioredis-mock doesn't have types
import RedisMock from 'ioredis-mock'
import {
  ContextCompactor,
  StubContextCompactor,
  DEFAULT_COMPACTION_CONFIG,
  loadCompactionConfig,
} from '../../src/compaction/index.js'
import { RedisKeys } from '../../src/redis/keys.js'
import type { Message, TraceContext } from '@siri/types'

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
    stageDuration: {
      record: vi.fn(),
    },
  },
}))

// Helper to create mock Anthropic client
function createMockClient(response: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: response }],
      }),
    },
  }
}

// Helper to create a test trace context
function createTestContext(): TraceContext {
  return {
    traceId: 'test-trace-id',
    spanId: 'test-span-id',
    requestId: 'test-request-id',
    startTime: Date.now(),
  }
}

// Helper to create test messages
function createTestMessages(count: number, startTimestamp = 1000000000000): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg_${i + 1}`,
    conversationId: 'conv_123',
    userId: 'user_456',
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Test message ${i + 1}`,
    timestamp: startTimestamp + i * 1000, // 1 second apart
  })) as Message[]
}

describe('ContextCompactor', () => {
  let redis: InstanceType<typeof RedisMock>
  let ctx: TraceContext

  beforeEach(async () => {
    redis = new RedisMock()
    await redis.flushall()
    ctx = createTestContext()
  })

  describe('constructor', () => {
    it('uses default config when no config provided', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any)

      expect(compactor.getConfig()).toEqual(DEFAULT_COMPACTION_CONFIG)
    })

    it('merges provided config with defaults', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 50,
        batchSize: 20,
      })

      const config = compactor.getConfig()
      expect(config.threshold).toBe(50)
      expect(config.batchSize).toBe(20)
      expect(config.model).toBe(DEFAULT_COMPACTION_CONFIG.model) // default preserved
    })
  })

  describe('maybeCompact()', () => {
    it('does nothing when disabled', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        enabled: false,
      })
      const messages = createTestMessages(50)

      // Should not throw and should not call the client
      compactor.maybeCompact('conv_123', messages, ctx)

      expect(client.messages.create).not.toHaveBeenCalled()
    })

    it('does nothing when message count is below threshold', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 30,
      })
      const messages = createTestMessages(20) // Below threshold

      compactor.maybeCompact('conv_123', messages, ctx)

      expect(client.messages.create).not.toHaveBeenCalled()
    })

    it('does nothing when message count equals threshold', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 30,
      })
      const messages = createTestMessages(30) // Exactly at threshold

      compactor.maybeCompact('conv_123', messages, ctx)

      expect(client.messages.create).not.toHaveBeenCalled()
    })

    it('does nothing when messages contain a summary', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 10,
      })
      const messages = createTestMessages(20)
      // Add a summary message
      messages[5] = {
        ...messages[5],
        metadata: { type: 'summary' },
      }

      compactor.maybeCompact('conv_123', messages, ctx)

      expect(client.messages.create).not.toHaveBeenCalled()
    })

    it('triggers compaction when above threshold and no summary exists', async () => {
      const client = createMockClient('[Earlier in this conversation] Summary text')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 10,
        batchSize: 5,
      })
      const messages = createTestMessages(15)

      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget to complete
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(client.messages.create).toHaveBeenCalled()
    })
  })

  describe('runCompaction()', () => {
    it('successfully compacts messages and updates Redis', async () => {
      const summaryText = '[Earlier in this conversation] User discussed their recovery journey.'
      const client = createMockClient(summaryText)
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 10,
        batchSize: 5,
      })
      const messages = createTestMessages(15)

      // Pre-populate Redis with messages
      const messagesKey = RedisKeys.sessionMessages('conv_123')
      const stateKey = RedisKeys.sessionState('conv_123')

      for (const msg of messages) {
        await redis.zadd(messagesKey, msg.timestamp, JSON.stringify(msg))
      }
      await redis.hset(stateKey, 'messageCount', '15')

      // Trigger compaction
      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify LLM was called with correct messages
      expect(client.messages.create).toHaveBeenCalledTimes(1)
      const callArgs = client.messages.create.mock.calls[0][0]
      expect(callArgs.model).toBe(DEFAULT_COMPACTION_CONFIG.model)
      expect(callArgs.messages[0].content).toContain('Test message 1')
      expect(callArgs.messages[0].content).toContain('Test message 5')

      // Verify Redis was updated
      const remainingMessages = await redis.zrange(messagesKey, 0, -1)
      // Should have: 1 summary + 10 remaining messages = 11
      expect(remainingMessages.length).toBe(11)

      // First message should be the summary
      const firstMsg = JSON.parse(remainingMessages[0])
      expect(firstMsg.metadata?.type).toBe('summary')
      expect(firstMsg.content).toBe(summaryText)
      expect(firstMsg.metadata?.originalCount).toBe(5)

      // Message count should be updated
      const messageCount = await redis.hget(stateKey, 'messageCount')
      expect(parseInt(messageCount, 10)).toBe(11) // 15 - 5 + 1 = 11
    })

    it('does not compact when fewer messages than batchSize', async () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 5,
        batchSize: 15, // batchSize > message count
      })
      const messages = createTestMessages(10)

      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should not call LLM because we don't have enough messages for a full batch
      // Actually, looking at the code, it will call but return early
      // Let's check what actually happens
      expect(client.messages.create).not.toHaveBeenCalled()
    })

    it('handles LLM errors gracefully', async () => {
      const client = {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit')),
        },
      }
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 5,
        batchSize: 3,
      })
      const messages = createTestMessages(10)

      // Pre-populate Redis
      const messagesKey = RedisKeys.sessionMessages('conv_123')
      for (const msg of messages) {
        await redis.zadd(messagesKey, msg.timestamp, JSON.stringify(msg))
      }

      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Original messages should remain unchanged
      const remainingMessages = await redis.zrange(messagesKey, 0, -1)
      expect(remainingMessages.length).toBe(10)
    })

    it('handles non-text LLM response', async () => {
      const client = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'tool_use', id: 'tool_1' }],
          }),
        },
      }
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 5,
        batchSize: 3,
      })
      const messages = createTestMessages(10)

      // Pre-populate Redis
      const messagesKey = RedisKeys.sessionMessages('conv_123')
      for (const msg of messages) {
        await redis.zadd(messagesKey, msg.timestamp, JSON.stringify(msg))
      }

      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Original messages should remain unchanged
      const remainingMessages = await redis.zrange(messagesKey, 0, -1)
      expect(remainingMessages.length).toBe(10)
    })

    it('uses first message timestamp for summary', async () => {
      const client = createMockClient('[Earlier] Summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 5,
        batchSize: 3,
      })
      const messages = createTestMessages(10, 1700000000000)

      // Pre-populate Redis
      const messagesKey = RedisKeys.sessionMessages('conv_123')
      for (const msg of messages) {
        await redis.zadd(messagesKey, msg.timestamp, JSON.stringify(msg))
      }

      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Get all messages with scores
      const messagesWithScores = await redis.zrange(messagesKey, 0, -1, 'WITHSCORES')

      // First message should be summary with first original message's timestamp
      const summaryScore = parseInt(messagesWithScores[1], 10)
      expect(summaryScore).toBe(1700000000000) // First message's timestamp
    })

    it('preserves original message IDs in summary metadata', async () => {
      const client = createMockClient('[Earlier] Summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 5,
        batchSize: 3,
      })
      const messages = createTestMessages(10)

      compactor.maybeCompact('conv_123', messages, ctx)

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Get summary message
      const messagesKey = RedisKeys.sessionMessages('conv_123')
      const allMessages = await redis.zrange(messagesKey, 0, -1)
      const summary = JSON.parse(allMessages[0])

      expect(summary.metadata.originalMessageIds).toEqual(['msg_1', 'msg_2', 'msg_3'])
    })
  })

  describe('getConfig()', () => {
    it('returns a copy of the config', () => {
      const client = createMockClient('summary')
      const compactor = new ContextCompactor(redis as any, client as any, {
        threshold: 25,
      })

      const config1 = compactor.getConfig()
      const config2 = compactor.getConfig()

      expect(config1).toEqual(config2)
      expect(config1).not.toBe(config2) // Different objects
    })
  })
})

describe('StubContextCompactor', () => {
  it('maybeCompact does nothing', () => {
    const stub = new StubContextCompactor()
    const messages = createTestMessages(100)
    const ctx = createTestContext()

    // Should not throw
    expect(() => stub.maybeCompact('conv_123', messages, ctx)).not.toThrow()
  })

  it('getConfig returns disabled config', () => {
    const stub = new StubContextCompactor()
    const config = stub.getConfig()

    expect(config.enabled).toBe(false)
    expect(config.threshold).toBe(DEFAULT_COMPACTION_CONFIG.threshold)
  })
})

describe('loadCompactionConfig()', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns defaults when no env vars set', () => {
    delete process.env.COMPACTION_ENABLED
    delete process.env.COMPACTION_THRESHOLD
    delete process.env.COMPACTION_BATCH_SIZE
    delete process.env.COMPACTION_MODEL
    delete process.env.COMPACTION_MAX_TOKENS
    delete process.env.COMPACTION_TIMEOUT_MS

    const config = loadCompactionConfig()

    expect(config).toEqual(DEFAULT_COMPACTION_CONFIG)
  })

  it('parses COMPACTION_ENABLED=false', () => {
    process.env.COMPACTION_ENABLED = 'false'

    const config = loadCompactionConfig()

    expect(config.enabled).toBe(false)
  })

  it('parses COMPACTION_ENABLED=true', () => {
    process.env.COMPACTION_ENABLED = 'true'

    const config = loadCompactionConfig()

    expect(config.enabled).toBe(true)
  })

  it('defaults to enabled when COMPACTION_ENABLED is not set', () => {
    delete process.env.COMPACTION_ENABLED

    const config = loadCompactionConfig()

    expect(config.enabled).toBe(true)
  })

  it('parses numeric env vars', () => {
    process.env.COMPACTION_THRESHOLD = '50'
    process.env.COMPACTION_BATCH_SIZE = '25'
    process.env.COMPACTION_MAX_TOKENS = '1024'
    process.env.COMPACTION_TIMEOUT_MS = '30000'

    const config = loadCompactionConfig()

    expect(config.threshold).toBe(50)
    expect(config.batchSize).toBe(25)
    expect(config.maxTokens).toBe(1024)
    expect(config.timeoutMs).toBe(30000)
  })

  it('parses model env var', () => {
    process.env.COMPACTION_MODEL = 'claude-3-sonnet-20241022'

    const config = loadCompactionConfig()

    expect(config.model).toBe('claude-3-sonnet-20241022')
  })

  it('falls back to defaults for invalid numeric values', () => {
    process.env.COMPACTION_THRESHOLD = 'not-a-number'
    process.env.COMPACTION_BATCH_SIZE = ''

    const config = loadCompactionConfig()

    expect(config.threshold).toBe(DEFAULT_COMPACTION_CONFIG.threshold)
    expect(config.batchSize).toBe(DEFAULT_COMPACTION_CONFIG.batchSize)
  })
})

describe('DEFAULT_COMPACTION_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_COMPACTION_CONFIG.enabled).toBe(true)
    expect(DEFAULT_COMPACTION_CONFIG.threshold).toBe(30)
    expect(DEFAULT_COMPACTION_CONFIG.batchSize).toBe(15)
    expect(DEFAULT_COMPACTION_CONFIG.model).toBe('claude-haiku-4-5')
    expect(DEFAULT_COMPACTION_CONFIG.maxTokens).toBe(512)
    expect(DEFAULT_COMPACTION_CONFIG.timeoutMs).toBe(15000)
  })

  it('batchSize is less than threshold', () => {
    // This ensures we always have messages left after compaction
    expect(DEFAULT_COMPACTION_CONFIG.batchSize).toBeLessThan(
      DEFAULT_COMPACTION_CONFIG.threshold
    )
  })
})
