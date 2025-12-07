export { MemoryOrchestrator } from './MemoryOrchestrator.js'
export type { MemoryOrchestratorConfig, MemoryRetrievalResult, MemoryError } from './MemoryOrchestrator.js'

// Redis client and utilities
export {
  createRedisClient,
  getRedisClient,
  closeRedisClient,
  checkRedisHealth,
  type RedisClient,
  type RedisClientConfig,
  RedisKeys,
  RedisTTL,
  RedisDefaults,
} from './redis/index.js'

// Qdrant client and utilities
export {
  createQdrantClient,
  getQdrantClient,
  closeQdrantClient,
  checkQdrantHealth,
  type QdrantClientConfig,
  type QdrantClient,
  COLLECTION_NAME,
  VECTOR_SIZE,
  DISTANCE_METRIC,
  ensureCollection,
  messageIdToPointId,
  type MessagePayload,
} from './qdrant/index.js'

// Store implementations
export { RedisContextStore, type RedisContextStoreConfig } from './stores/index.js'
export { QdrantVectorStore, type QdrantVectorStoreConfig } from './stores/index.js'

// Embedding providers
export { OpenAIEmbeddingProvider, type OpenAIEmbeddingConfig } from './providers/index.js'

// Re-export stubs for easy access
export {
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
  InMemoryArchiveStore,
} from './stubs/index.js'
