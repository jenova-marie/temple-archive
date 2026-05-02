/**
 * @siri/mem0 - Mem0 Memory Store (L5)
 *
 * Provides integration with Mem0 FastAPI service for
 * intelligent memory extraction, deduplication, and retrieval.
 */

// Client factory
export {
  Mem0HttpClient,
  Mem0ApiError,
  createMem0Client,
  getMem0Client,
  closeMem0Client,
  checkMem0Health,
} from './client.js'

// Store implementation
export { Mem0Store } from './Mem0Store.js'

// Transform utilities (snake_case → camelCase)
export {
  snakeToCamel,
  transformKeys,
  transformMemory,
  transformSearchResult,
  transformAddResult,
  transformMemories,
  transformSearchResults,
  transformAddResults,
} from './transform.js'

// Types
export type {
  Mem0ClientConfig,
  IMem0Store,
  Mem0Message,
  AddMemoryOptions,
  AddMemoryResponse,
  Mem0AddResult,
  Mem0AddRawResponse,
  SearchMemoryOptions,
  Mem0Memory,
  Mem0SearchResult,
  Mem0SearchRawResponse,
  Mem0GetMemoriesRawResponse,
  GetMemoriesOptions,
} from './types.js'

// Stubs for testing
export { InMemoryMem0Store } from './stubs/index.js'
