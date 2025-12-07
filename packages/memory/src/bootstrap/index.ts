/**
 * Bootstrap Memory System Exports
 *
 * Provides conversation memory caching and cross-conversation bootstrap.
 */

// Types and configuration
export {
  type BootstrapConfig,
  type CacheMetadata,
  type Exchange,
  type ExtractionResult,
  type IBootstrapOrchestrator,
  type IConversationMemoryCache,
  type IMemoryCacheDeduplicator,
  type IMemoryCachePersistence,
  type IMemoryExtractor,
  type ITopicGenerator,
  DEFAULT_BOOTSTRAP_CONFIG,
  loadBootstrapConfig,
} from './types.js'

// L1 Cache (Redis)
export {
  ConversationMemoryCache,
  InMemoryConversationMemoryCache,
} from './ConversationMemoryCache.js'

// Memory Extraction (Haiku)
export {
  MemoryExtractor,
  StubMemoryExtractor,
} from './MemoryExtractor.js'

// Cache Deduplication & Merge (Haiku)
export {
  MemoryCacheDeduplicator,
  StubMemoryCacheDeduplicator,
} from './MemoryCacheDeduplicator.js'

// Topic Generation (Haiku)
export {
  TopicGenerator,
  StubTopicGenerator,
} from './TopicGenerator.js'

// L1 → L2 Persistence
export {
  MemoryCachePersistence,
  InMemoryMemoryCachePersistence,
} from './MemoryCachePersistence.js'

// Main Orchestrator
export {
  BootstrapOrchestrator,
  StubBootstrapOrchestrator,
  type BootstrapOrchestratorDeps,
} from './BootstrapOrchestrator.js'
