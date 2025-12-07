import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Neo4jKnowledgeStore } from './Neo4jKnowledgeStore.js'
import type { Entity, TraceContext } from '@recoverysky/types'

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
}))

const createTraceContext = (): TraceContext => ({
  requestId: `req_${Date.now()}`,
  spanId: 'span-123',
  traceId: 'trace-123',
  startTime: Date.now(),
})

// Create mock session
const createMockSession = () => ({
  run: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
})

// Create mock driver
const createMockDriver = () => {
  const mockSession = createMockSession()
  return {
    session: vi.fn().mockReturnValue(mockSession),
    _mockSession: mockSession,
  }
}

describe('Neo4jKnowledgeStore', () => {
  let mockDriver: ReturnType<typeof createMockDriver>
  let store: Neo4jKnowledgeStore

  beforeEach(() => {
    vi.clearAllMocks()
    mockDriver = createMockDriver()
    store = new Neo4jKnowledgeStore(mockDriver as unknown as import('neo4j-driver').Driver)
  })

  describe('upsertEntity', () => {
    it('should upsert an entity successfully', async () => {
      const entity: Entity = {
        entityId: 'entity_1',
        name: 'John',
        type: 'person',
        firstMentioned: Date.now(),
        lastMentioned: Date.now(),
        properties: { userId: 'user_1', importance: 0.8 },
      }

      mockDriver._mockSession.run.mockResolvedValue({ records: [] })

      const result = await store.upsertEntity(entity, createTraceContext())

      expect(result.ok).toBe(true)
      expect(mockDriver._mockSession.run).toHaveBeenCalled()
      expect(mockDriver._mockSession.close).toHaveBeenCalled()
    })

    it('should handle errors gracefully', async () => {
      const entity: Entity = {
        entityId: 'entity_1',
        name: 'John',
        type: 'person',
        firstMentioned: Date.now(),
        lastMentioned: Date.now(),
      }

      mockDriver._mockSession.run.mockRejectedValue(new Error('Neo4j error'))

      const result = await store.upsertEntity(entity, createTraceContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('UnexpectedError')
      }
    })
  })

  describe('createRelationship', () => {
    it('should create a relationship successfully', async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] })

      const result = await store.createRelationship(
        'john',
        'work',
        'triggers',
        { strength: 0.9 },
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      expect(mockDriver._mockSession.run).toHaveBeenCalled()
    })

    it('should sanitize relationship type', async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] })

      await store.createRelationship(
        'john',
        'work',
        'helps-with',
        { strength: 0.5 },
        createTraceContext()
      )

      // The query should contain sanitized relationship type (HELPS_WITH)
      const callArg = mockDriver._mockSession.run.mock.calls[0][0]
      expect(callArg).toContain('HELPS_WITH')
    })
  })

  describe('getRelatedEntities', () => {
    it('should return related entities', async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                entityId: 'entity_2',
                name: 'sponsor',
                type: 'person',
                firstMentioned: { toNumber: () => Date.now() },
                lastMentioned: { toNumber: () => Date.now() },
                properties: '{"importance": 0.9}',
              },
            }),
          },
        ],
      })

      const result = await store.getRelatedEntities('john', 2, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].name).toBe('sponsor')
      }
    })

    it('should return empty array when no related entities', async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] })

      const result = await store.getRelatedEntities('isolated', 2, createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(0)
      }
    })
  })

  describe('searchEntities', () => {
    it('should search entities by pattern', async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                entityId: 'entity_1',
                name: 'john doe',
                type: 'person',
                firstMentioned: { toNumber: () => Date.now() },
                lastMentioned: { toNumber: () => Date.now() },
              },
            }),
          },
        ],
      })

      const result = await store.searchEntities('john', createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].name).toBe('john doe')
      }
    })
  })

  describe('deleteEntity', () => {
    it('should delete an entity', async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] })

      const result = await store.deleteEntity('entity_1', createTraceContext())

      expect(result.ok).toBe(true)
      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('DETACH DELETE'),
        expect.any(Object)
      )
    })
  })

  describe('getEntityCount', () => {
    it('should return entity count', async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({ toNumber: () => 42 }),
          },
        ],
      })

      const result = await store.getEntityCount(createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(42)
      }
    })
  })

  describe('getRelationshipCount', () => {
    it('should return relationship count', async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({ toNumber: () => 15 }),
          },
        ],
      })

      const result = await store.getRelationshipCount(createTraceContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(15)
      }
    })
  })
})
