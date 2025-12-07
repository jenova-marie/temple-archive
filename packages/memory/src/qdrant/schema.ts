/**
 * Qdrant Collection Schema
 *
 * Defines the collection configuration and payload schema for the messages collection.
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import { getLogger } from '@recoverysky/observability'
import { createHash } from 'crypto'

// Collection configuration constants
export const COLLECTION_NAME = 'messages'
export const VECTOR_SIZE = 1536 // OpenAI text-embedding-3-small dimensions
export const DISTANCE_METRIC = 'Cosine'

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
 */
export async function ensureCollection(
  client: QdrantClient,
  collectionName: string = COLLECTION_NAME,
  vectorSize: number = VECTOR_SIZE
): Promise<void> {
  const logger = getLogger().child({ component: 'qdrant-schema', collectionName })

  try {
    // Check if collection exists
    const collections = await client.getCollections()
    const exists = collections.collections.some((c) => c.name === collectionName)

    if (exists) {
      logger.debug('Collection already exists')
      return
    }

    logger.info({ vectorSize, distance: DISTANCE_METRIC }, 'Creating collection')

    // Create collection with vector configuration
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: DISTANCE_METRIC,
        on_disk: true, // Enable on-disk storage for durability
      },
      // Configure optimizers for better performance
      optimizers_config: {
        default_segment_number: 2,
        indexing_threshold: 20000,
      },
    })

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

    logger.info('Collection created successfully with payload indexes')
  } catch (error) {
    logger.error({ error }, 'Failed to ensure collection exists')
    throw error
  }
}
