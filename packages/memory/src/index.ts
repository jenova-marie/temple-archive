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
  SEARCH_MODE,
  DENSE_VECTOR_NAME,
  SPARSE_VECTOR_NAME,
  ensureCollection,
  messageIdToPointId,
  type MessagePayload,
  type QdrantSearchMode,
  // BM25 sparse vector generation
  BM25SparseEmbedding,
  getBM25Embedder,
  generateSparseVector,
  tokenize,
  type SparseVector,
  type BM25Config,
} from './qdrant/index.js'

// Neo4j client and utilities
export {
  createNeo4jDriver,
  createSession,
  verifyConnectivity,
  closeDriver,
  initializeSchema,
  dropSchema,
  clearData,
  SCHEMA_STATEMENTS,
  type Neo4jConfig,
} from './neo4j/index.js'

// Store implementations
export { RedisContextStore, type RedisContextStoreConfig } from './stores/index.js'
export { QdrantVectorStore, type QdrantVectorStoreConfig, type LiteratureSearchHit, type LiteratureSearchOptions } from './stores/index.js'

// MCP-compatible Memory Store (new)
export { Neo4jMemoryStore, type Neo4jMemoryStoreConfig } from './stores/Neo4jMemoryStore.js'
export { InMemoryMemoryStore } from './stores/InMemoryMemoryStore.js'

// Legacy Knowledge Store (deprecated - use Neo4jMemoryStore instead)
export { Neo4jKnowledgeStore } from './stores/Neo4jKnowledgeStore.js'

// Entity extraction
export {
  EntityExtractor,
  DEFAULT_EXTRACTOR_CONFIG,
  type ExtractionMode,
  type EntityType,
  type EntityExtractorConfig,
  type ExtractedEntity,
  type ExtractedRelationship,
  type ExtractionResult,
  type ExtractionError,
} from './extraction/index.js'

// Memory context builder
export {
  MemoryContextBuilder,
  DEFAULT_CONTEXT_CONFIG,
  type MemoryContextMode,
  type MemoryContextBuilderConfig,
  type Subgraph,
  type RetrievedRelationship,
} from './context/index.js'

// Embedding providers
export { OpenAIEmbeddingProvider, type OpenAIEmbeddingConfig } from './providers/index.js'

// L3 Memory embeddings (local MiniLM)
export {
  MiniLMEmbeddingProvider,
  type MiniLMProviderConfig,
  type EmbeddingError,
} from './embeddings/index.js'

// Re-export stubs for easy access
export {
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
  InMemoryArchiveStore,
} from './stubs/index.js'

// Bootstrap memory system
export {
  // Types and config
  type BootstrapConfig,
  type CacheMetadata,
  type Exchange,
  type ExtractionResult as BootstrapExtractionResult,
  type IBootstrapOrchestrator,
  type IConversationMemoryCache,
  type IMemoryCacheDeduplicator,
  type IMemoryCachePersistence,
  type IMemoryExtractor,
  type ITopicGenerator,
  DEFAULT_BOOTSTRAP_CONFIG,
  loadBootstrapConfig,
  // Implementations
  ConversationMemoryCache,
  InMemoryConversationMemoryCache,
  MemoryExtractor,
  StubMemoryExtractor,
  MemoryCacheDeduplicator,
  StubMemoryCacheDeduplicator,
  TopicGenerator,
  StubTopicGenerator,
  MemoryCachePersistence,
  InMemoryMemoryCachePersistence,
  BootstrapOrchestrator,
  StubBootstrapOrchestrator,
  type BootstrapOrchestratorDeps,
} from './bootstrap/index.js'

// Context compaction
export {
  ContextCompactor,
  StubContextCompactor,
  type CompactionConfig,
  type CompactionError,
  type IContextCompactor,
  type SummaryMetadata,
  DEFAULT_COMPACTION_CONFIG,
  loadCompactionConfig,
} from './compaction/index.js'

// L3 Memory background jobs
export {
  EmbeddingBatchJob,
  type EmbeddingBatchJobConfig,
  type UnembeddedItem,
} from './jobs/index.js'

// Deep Memory (source context enrichment)
export {
  DeepMemoryService,
  type IDeepMemorySessionStore,
  type ContextStrategy,
  type DeepMemoryServiceConfig,
} from './deepmemory/index.js'

// Memory Retrieval (unified multi-channel search)
export {
  MemoryRetrievalService,
  type RetrievalOptions,
  type RankingWeights,
  type ScoredEntity,
  type RetrievalResult,
  // L3 Context Provider (drop-in replacement for MemoryContextBuilder)
  L3MemoryContextProvider,
  loadL3ContextConfig,
  DEFAULT_L3_CONTEXT_CONFIG,
  type IMemoryContextProvider,
  type L3MemoryContextProviderConfig,
} from './retrieval/index.js'

// Migrations
export {
  migrateToL3Memory,
  isMigrationNeeded,
  getMigrationStatus,
  type MigrationResult,
} from './migrations/index.js'
