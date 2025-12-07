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

// Store implementations
export { RedisContextStore, type RedisContextStoreConfig } from './stores/index.js'

// Re-export stubs for easy access
export {
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
  InMemoryArchiveStore,
} from './stubs/index.js'
