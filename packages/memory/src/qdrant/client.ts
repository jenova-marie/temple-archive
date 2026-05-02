/**
 * Qdrant Client Factory
 *
 * Provides client creation and management for the Qdrant vector store.
 * Follows the same patterns as the Redis client module.
 */

import { QdrantClient } from '@qdrant/js-client-rest'
import { getLogger } from '@siri/observability'

export interface QdrantClientConfig {
  /** Qdrant server URL (default: QDRANT_URL env var or http://localhost:6333) */
  url?: string
  /** API key for Qdrant Cloud (default: QDRANT_API_KEY env var) */
  apiKey?: string
  /** Request timeout in ms (default: 30000) */
  timeout?: number
}

const DEFAULT_URL = 'http://localhost:6333'
const DEFAULT_TIMEOUT = 30000

let _client: QdrantClient | null = null

/**
 * Create a new Qdrant client instance
 */
export function createQdrantClient(config: QdrantClientConfig = {}): QdrantClient {
  const logger = getLogger().child({ component: 'qdrant-client' })

  const url = config.url ?? process.env.QDRANT_URL ?? DEFAULT_URL
  const apiKey = config.apiKey ?? process.env.QDRANT_API_KEY
  const timeout = config.timeout ?? DEFAULT_TIMEOUT

  logger.info({ url, hasApiKey: !!apiKey, timeout }, 'Creating Qdrant client')

  const client = new QdrantClient({
    url,
    apiKey,
    timeout,
  })

  _client = client
  return client
}

/**
 * Get the singleton Qdrant client instance
 * Creates one with default config if not already created
 */
export function getQdrantClient(): QdrantClient {
  if (!_client) {
    _client = createQdrantClient()
  }
  return _client
}

/**
 * Close the Qdrant client connection
 * Note: The REST client doesn't maintain persistent connections,
 * but this provides a consistent API with other clients
 */
export function closeQdrantClient(): void {
  const logger = getLogger().child({ component: 'qdrant-client' })
  logger.info('Closing Qdrant client')
  _client = null
}

/**
 * Check if Qdrant is healthy and reachable
 */
export async function checkQdrantHealth(): Promise<boolean> {
  const logger = getLogger().child({ component: 'qdrant-client' })

  try {
    const client = getQdrantClient()
    // Use getCollections as a health check - it's a simple read operation
    await client.getCollections()
    logger.debug('Qdrant health check passed')
    return true
  } catch (error) {
    logger.warn({ error }, 'Qdrant health check failed')
    return false
  }
}

export type { QdrantClient }
