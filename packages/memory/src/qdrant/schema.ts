/**
 * Qdrant Collection Schema
 *
 * Defines the collection configuration and payload schema for the messages collection.
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import { getLogger } from '@recoverysky/observability'
import { createHash } from 'crypto'

// Collection configuration constants
export const COLLECTION_NAME = process.env.QDRANT_COLLECTION_NAME ?? 'messages'
export const VECTOR_SIZE = 1536 // OpenAI text-embedding-3-small dimensions
export const DISTANCE_METRIC = 'Cosine'

// Search mode: 'hybrid' (dense + sparse BM25) or 'simple' (dense only)
export type QdrantSearchMode = 'hybrid' | 'simple'
export const SEARCH_MODE: QdrantSearchMode =
  (process.env.QDRANT_SEARCH_MODE as QdrantSearchMode) ?? 'hybrid'

// Named vector configuration for hybrid mode
export const DENSE_VECTOR_NAME = 'dense'
export const SPARSE_VECTOR_NAME = 'sparse'

/**
 * Payload schema for message vectors
 */
export interface MessagePayload {
  /** User identifier for filtering */
  userId: string
  /** Conversation identifier for filtering */
  conversationId: string
  /** Original message ID */
  messageId: string
  /** Message role (user/assistant) */
  role: string
  /** Message content for retrieval */
  content: string
  /** Unix timestamp in ms for time-based filtering */
  timestamp: number
  /** Crisis level for exclusion filtering */
  crisisLevel?: number
  /** Extracted entities */
  entities?: string[]
  /** Extracted topics */
  topics?: string[]
}

/**
 * Generate a deterministic UUID from a message ID
 * Qdrant requires numeric or UUID point IDs, so we hash the message ID
 * to create a valid UUID that's consistent across operations.
 */
export function messageIdToPointId(messageId: string): string {
  const hash = createHash('sha256').update(messageId).digest('hex')
  // Format as UUID: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-')
}

/**
 * Ensure the messages collection exists with correct configuration
 * Creates the collection if it doesn't exist
 *
 * - Simple mode: Single unnamed dense vector
 * - Hybrid mode: Named vectors (dense + sparse BM25)
 */
export async function ensureCollection(
  client: QdrantClient,
  collectionName: string = COLLECTION_NAME,
  vectorSize: number = VECTOR_SIZE,
  searchMode: QdrantSearchMode = SEARCH_MODE
): Promise<void> {
  const logger = getLogger().child({ component: 'qdrant-schema', collectionName, searchMode })

  try {
    // Check if collection exists
    const collections = await client.getCollections()
    const exists = collections.collections.some((c) => c.name === collectionName)

    if (exists) {
      logger.debug('Collection already exists')
      return
    }

    logger.info({ vectorSize, distance: DISTANCE_METRIC, searchMode }, 'Creating collection')

    if (searchMode === 'hybrid') {
      // Hybrid mode: named vectors (dense + sparse)
      await client.createCollection(collectionName, {
        vectors: {
          [DENSE_VECTOR_NAME]: {
            size: vectorSize,
            distance: DISTANCE_METRIC,
            on_disk: true,
          },
        },
        sparse_vectors: {
          [SPARSE_VECTOR_NAME]: {
            // BM25 sparse vectors - no fixed size, index for efficiency
            index: {
              on_disk: true,
            },
          },
        },
        optimizers_config: {
          default_segment_number: 2,
          indexing_threshold: 20000,
        },
      })
      logger.debug('Created collection with dense + sparse vectors for hybrid search')
    } else {
      // Simple mode: single unnamed dense vector
      await client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: DISTANCE_METRIC,
          on_disk: true,
        },
        optimizers_config: {
          default_segment_number: 2,
          indexing_threshold: 20000,
        },
      })
      logger.debug('Created collection with single dense vector for simple search')
    }

    // Create payload indexes for efficient filtering
    logger.debug('Creating payload indexes')

    await client.createPayloadIndex(collectionName, {
      field_name: 'userId',
      field_schema: 'keyword',
    })

    await client.createPayloadIndex(collectionName, {
      field_name: 'conversationId',
      field_schema: 'keyword',
    })

    await client.createPayloadIndex(collectionName, {
      field_name: 'timestamp',
      field_schema: 'integer',
    })

    logger.info({ searchMode }, 'Collection created successfully with payload indexes')
  } catch (error) {
    logger.error({ error }, 'Failed to ensure collection exists')
    throw error
  }
}
