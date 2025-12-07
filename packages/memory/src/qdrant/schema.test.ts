import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  COLLECTION_NAME,
  VECTOR_SIZE,
  DISTANCE_METRIC,
  messageIdToPointId,
  ensureCollection,
} from './schema.js'

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
}))

describe('qdrant/schema', () => {
  describe('constants', () => {
    it('has correct collection name', () => {
      expect(COLLECTION_NAME).toBe('messages')
    })

    it('has correct vector size for OpenAI embeddings', () => {
      expect(VECTOR_SIZE).toBe(1536)
    })

    it('uses Cosine distance metric', () => {
      expect(DISTANCE_METRIC).toBe('Cosine')
    })
  })

  describe('messageIdToPointId', () => {
    it('returns a valid UUID format', () => {
      const pointId = messageIdToPointId('msg-123')

      // UUID format: 8-4-4-4-12
      const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
      expect(pointId).toMatch(uuidRegex)
    })

    it('returns deterministic result for same input', () => {
      const id1 = messageIdToPointId('msg-abc')
      const id2 = messageIdToPointId('msg-abc')

      expect(id1).toBe(id2)
    })

    it('returns different results for different inputs', () => {
      const id1 = messageIdToPointId('msg-123')
      const id2 = messageIdToPointId('msg-456')

      expect(id1).not.toBe(id2)
    })

    it('handles empty string', () => {
      const pointId = messageIdToPointId('')

      expect(pointId).toBeDefined()
      expect(pointId.length).toBe(36) // UUID length
    })

    it('handles long message IDs', () => {
      const longId = 'a'.repeat(1000)
      const pointId = messageIdToPointId(longId)

      expect(pointId.length).toBe(36)
    })

    it('handles special characters', () => {
      const pointId = messageIdToPointId('msg-!@#$%^&*()')

      expect(pointId).toBeDefined()
      expect(pointId.length).toBe(36)
    })
  })

  describe('ensureCollection', () => {
    let mockClient: {
      getCollections: ReturnType<typeof vi.fn>
      createCollection: ReturnType<typeof vi.fn>
      createPayloadIndex: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      vi.clearAllMocks()
      mockClient = {
        getCollections: vi.fn(),
        createCollection: vi.fn(),
        createPayloadIndex: vi.fn(),
      }
    })

    it('does nothing if collection already exists', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [{ name: 'messages' }],
      })

      await ensureCollection(mockClient as any)

      expect(mockClient.createCollection).not.toHaveBeenCalled()
      expect(mockClient.createPayloadIndex).not.toHaveBeenCalled()
    })

    it('creates collection if it does not exist', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      })
      mockClient.createCollection.mockResolvedValue(undefined)
      mockClient.createPayloadIndex.mockResolvedValue(undefined)

      await ensureCollection(mockClient as any)

      expect(mockClient.createCollection).toHaveBeenCalledWith(
        'messages',
        expect.objectContaining({
          vectors: expect.objectContaining({
            size: 1536,
            distance: 'Cosine',
            on_disk: true,
          }),
        })
      )
    })

    it('creates payload indexes after collection', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      })
      mockClient.createCollection.mockResolvedValue(undefined)
      mockClient.createPayloadIndex.mockResolvedValue(undefined)

      await ensureCollection(mockClient as any)

      // Should create 3 indexes: userId, conversationId, timestamp
      expect(mockClient.createPayloadIndex).toHaveBeenCalledTimes(3)

      expect(mockClient.createPayloadIndex).toHaveBeenCalledWith(
        'messages',
        { field_name: 'userId', field_schema: 'keyword' }
      )
      expect(mockClient.createPayloadIndex).toHaveBeenCalledWith(
        'messages',
        { field_name: 'conversationId', field_schema: 'keyword' }
      )
      expect(mockClient.createPayloadIndex).toHaveBeenCalledWith(
        'messages',
        { field_name: 'timestamp', field_schema: 'integer' }
      )
    })

    it('uses custom collection name', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      })
      mockClient.createCollection.mockResolvedValue(undefined)
      mockClient.createPayloadIndex.mockResolvedValue(undefined)

      await ensureCollection(mockClient as any, 'custom-collection')

      expect(mockClient.createCollection).toHaveBeenCalledWith(
        'custom-collection',
        expect.anything()
      )
    })

    it('uses custom vector size', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      })
      mockClient.createCollection.mockResolvedValue(undefined)
      mockClient.createPayloadIndex.mockResolvedValue(undefined)

      await ensureCollection(mockClient as any, 'messages', 768)

      expect(mockClient.createCollection).toHaveBeenCalledWith(
        'messages',
        expect.objectContaining({
          vectors: expect.objectContaining({
            size: 768,
          }),
        })
      )
    })

    it('throws error if getCollections fails', async () => {
      mockClient.getCollections.mockRejectedValue(new Error('Connection failed'))

      await expect(ensureCollection(mockClient as any)).rejects.toThrow('Connection failed')
    })

    it('throws error if createCollection fails', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      })
      mockClient.createCollection.mockRejectedValue(new Error('Create failed'))

      await expect(ensureCollection(mockClient as any)).rejects.toThrow('Create failed')
    })

    it('throws error if createPayloadIndex fails', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      })
      mockClient.createCollection.mockResolvedValue(undefined)
      mockClient.createPayloadIndex.mockRejectedValue(new Error('Index failed'))

      await expect(ensureCollection(mockClient as any)).rejects.toThrow('Index failed')
    })

    it('checks for exact collection name match', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [{ name: 'messages-archive' }, { name: 'other' }],
      })
      mockClient.createCollection.mockResolvedValue(undefined)
      mockClient.createPayloadIndex.mockResolvedValue(undefined)

      await ensureCollection(mockClient as any)

      // Should create because 'messages' doesn't exist, only 'messages-archive'
      expect(mockClient.createCollection).toHaveBeenCalled()
    })
  })
})
