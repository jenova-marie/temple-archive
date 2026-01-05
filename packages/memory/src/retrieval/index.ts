/**
 * Retrieval Module
 *
 * Unified memory retrieval across L3 and L4 stores.
 */

export {
  MemoryRetrievalService,
  type RetrievalOptions,
  type RankingWeights,
  type ScoredEntity,
  type RetrievalResult,
} from './MemoryRetrievalService.js'

export {
  L3MemoryContextProvider,
  loadL3ContextConfig,
  DEFAULT_L3_CONTEXT_CONFIG,
  type IMemoryContextProvider,
  type L3MemoryContextProviderConfig,
} from './MemoryContextProvider.js'

export {
  QueryPreprocessor,
  DEFAULT_PREPROCESSOR_CONFIG,
  type QueryPreprocessingMode,
  type QueryPreprocessorConfig,
} from './QueryPreprocessor.js'
