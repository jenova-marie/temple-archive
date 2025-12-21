/**
 * Deep Memory Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeepMemoryService, type IDeepMemorySessionStore } from '../../src/deepmemory/DeepMemoryService.js'
import type { L3EntityWithObservations, Message, TraceContext, SourceEntry } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'

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
  withSpan: vi.fn().mockImplementation((_name, fn) => fn()),
  pipelineMetrics: {
    stageDuration: { record: vi.fn() },
    errors: { add: vi.fn() },
    memoryCacheHits: { add: vi.fn() },
    memoryCacheMisses: { add: vi.fn() },
  },
}))

function createTraceContext(): TraceContext {
  return {
    requestId: 'test-request',
    traceId: 'test-trace',
    spanId: 'test-span',
    startTime: Date.now(),
  }
}

function createMockMessage(id: string, role: 'user' | 'assistant', content: string): Message {
  return {
    id,
    conversationId: 'conv-123',
    userId: 'user-123',
    role,
    content,
    timestamp: Date.now(),
  }
}

function createMockEntity(
  name: string,
  sourceHistory: SourceEntry[] = []
): L3EntityWithObservations {
  return {
    id: `entity-${name}`,
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    aliases: [],
    canonicalType: 'person',
    labels: [],
    importance: 0.8,
    firstSeen: Date.now() - 100000,
    lastSeen: Date.now(),
    mentionCount: 1,
    sourceHistory,
    metadata: {},
    observations: [],
  }
}

describe('DeepMemoryService', () => {
  let mockSessionStore: IDeepMemorySessionStore
  let service: DeepMemoryService

  beforeEach(() => {
    vi.clearAllMocks()

    mockSessionStore = {
      getMessagesAroundId: vi.fn().mockResolvedValue(ok([])),
    }

    service = new DeepMemoryService(mockSessionStore)
  })

  describe('enrichWithContext', () => {
    it('should return entities with empty conversationContexts when no sourceHistory', async () => {
      const entities = [createMockEntity('john')]

      const result = await service.enrichWithContext(entities, 'latest', createTraceContext())

      expect(result).toHaveLength(1)
      expect(result[0].conversationContexts).toEqual([])
    })

    it('should fetch context for entities with sourceHistory', async () => {
      const mockMessages = [
        createMockMessage('msg-1', 'user', 'Tell me about John'),
        createMockMessage('msg-2', 'assistant', 'John is your friend'),
      ]

      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(mockMessages)
      )

      const entities = [
        createMockEntity('john', [
          {
            messageId: 'msg-1',
            conversationId: 'conv-123',
            action: 'created',
            timestamp: Date.now(),
          },
        ]),
      ]

      const result = await service.enrichWithContext(entities, 'latest', createTraceContext())

      expect(result).toHaveLength(1)
      expect(result[0].conversationContexts).toHaveLength(1)
      expect(result[0].conversationContexts[0].action).toBe('created')
      expect(result[0].conversationContexts[0].messages).toEqual(mockMessages)
    })

    it('should handle session store errors gracefully', async () => {
      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        err({ kind: 'ConnectionError', message: 'DB down', context: {} })
      )

      const entities = [
        createMockEntity('john', [
          {
            messageId: 'msg-1',
            conversationId: 'conv-123',
            action: 'created',
            timestamp: Date.now(),
          },
        ]),
      ]

      const result = await service.enrichWithContext(entities, 'latest', createTraceContext())

      // Should return entity but with empty context
      expect(result).toHaveLength(1)
      expect(result[0].conversationContexts).toEqual([])
    })

    it('should skip entries that return empty messages', async () => {
      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]))

      const entities = [
        createMockEntity('john', [
          {
            messageId: 'msg-deleted',
            conversationId: 'conv-123',
            action: 'created',
            timestamp: Date.now(),
          },
        ]),
      ]

      const result = await service.enrichWithContext(entities, 'latest', createTraceContext())

      expect(result[0].conversationContexts).toEqual([])
    })
  })

  describe('strategy: latest', () => {
    it('should only fetch context for most recent entry', async () => {
      const mockMessages = [createMockMessage('msg-3', 'user', 'Latest')]

      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(mockMessages)
      )

      const now = Date.now()
      const entities = [
        createMockEntity('john', [
          { messageId: 'msg-1', conversationId: 'conv-123', action: 'created', timestamp: now - 2000 },
          { messageId: 'msg-2', conversationId: 'conv-123', action: 'updated', timestamp: now - 1000 },
          { messageId: 'msg-3', conversationId: 'conv-123', action: 'updated', timestamp: now },
        ]),
      ]

      await service.enrichWithContext(entities, 'latest', createTraceContext())

      // Should only call for the most recent (msg-3)
      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledTimes(1)
      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledWith(
        'conv-123',
        'msg-3',
        5, // windowBefore
        expect.any(Object),
        2  // windowAfter (5 * 0.5 = 2)
      )
    })
  })

  describe('strategy: created_and_latest', () => {
    it('should fetch context for creation and latest entries', async () => {
      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockMessage('msg', 'user', 'Test')])
      )

      const now = Date.now()
      const entities = [
        createMockEntity('john', [
          { messageId: 'msg-1', conversationId: 'conv-123', action: 'created', timestamp: now - 2000 },
          { messageId: 'msg-2', conversationId: 'conv-123', action: 'updated', timestamp: now - 1000 },
          { messageId: 'msg-3', conversationId: 'conv-123', action: 'updated', timestamp: now },
        ]),
      ]

      await service.enrichWithContext(entities, 'created_and_latest', createTraceContext())

      // Should call for created (msg-1) and latest (msg-3)
      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledTimes(2)
    })

    it('should only fetch once if created is also latest', async () => {
      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockMessage('msg', 'user', 'Test')])
      )

      const entities = [
        createMockEntity('john', [
          { messageId: 'msg-1', conversationId: 'conv-123', action: 'created', timestamp: Date.now() },
        ]),
      ]

      await service.enrichWithContext(entities, 'created_and_latest', createTraceContext())

      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledTimes(1)
    })
  })

  describe('strategy: all', () => {
    it('should fetch context for all entries up to limit', async () => {
      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockMessage('msg', 'user', 'Test')])
      )

      const now = Date.now()
      const entries: SourceEntry[] = []
      for (let i = 0; i < 15; i++) {
        entries.push({
          messageId: `msg-${i}`,
          conversationId: 'conv-123',
          action: 'updated',
          timestamp: now - i * 1000,
        })
      }

      const entities = [createMockEntity('john', entries)]

      await service.enrichWithContext(entities, 'all', createTraceContext())

      // Should be limited to maxEntriesPerEntity (default 10)
      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledTimes(10)
    })
  })

  describe('configuration', () => {
    it('should use custom messageWindow', async () => {
      const customService = new DeepMemoryService(mockSessionStore, { messageWindow: 10 })

      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockMessage('msg', 'user', 'Test')])
      )

      const entities = [
        createMockEntity('john', [
          { messageId: 'msg-1', conversationId: 'conv-123', action: 'created', timestamp: Date.now() },
        ]),
      ]

      await customService.enrichWithContext(entities, 'latest', createTraceContext())

      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledWith(
        'conv-123',
        'msg-1',
        10, // Custom windowBefore
        expect.any(Object),
        5   // windowAfter (10 * 0.5 = 5)
      )
    })

    it('should use custom maxEntriesPerEntity', async () => {
      const customService = new DeepMemoryService(mockSessionStore, { maxEntriesPerEntity: 3 })

      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockMessage('msg', 'user', 'Test')])
      )

      const now = Date.now()
      const entries: SourceEntry[] = []
      for (let i = 0; i < 10; i++) {
        entries.push({
          messageId: `msg-${i}`,
          conversationId: 'conv-123',
          action: 'updated',
          timestamp: now - i * 1000,
        })
      }

      const entities = [createMockEntity('john', entries)]

      await customService.enrichWithContext(entities, 'all', createTraceContext())

      // Should be limited to custom maxEntriesPerEntity (3)
      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledTimes(3)
    })

    it('should expose config via getConfig()', () => {
      const customService = new DeepMemoryService(mockSessionStore, {
        messageWindow: 7,
        maxEntriesPerEntity: 5,
      })

      const config = customService.getConfig()

      expect(config.messageWindow).toBe(7)
      expect(config.maxEntriesPerEntity).toBe(5)
    })
  })

  describe('multiple entities', () => {
    it('should enrich multiple entities', async () => {
      ;(mockSessionStore.getMessagesAroundId as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([createMockMessage('msg', 'user', 'Test')])
      )

      const entities = [
        createMockEntity('john', [
          { messageId: 'msg-1', conversationId: 'conv-123', action: 'created', timestamp: Date.now() },
        ]),
        createMockEntity('jane', [
          { messageId: 'msg-2', conversationId: 'conv-456', action: 'created', timestamp: Date.now() },
        ]),
      ]

      const result = await service.enrichWithContext(entities, 'latest', createTraceContext())

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('john')
      expect(result[1].name).toBe('jane')
      expect(mockSessionStore.getMessagesAroundId).toHaveBeenCalledTimes(2)
    })
  })
})
