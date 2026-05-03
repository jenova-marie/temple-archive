/**
 * @siri/rag — Retrieval-Augmented Generation client.
 *
 * Read-only consumer of ninshubur's wisdom archive (Qdrant collections
 * + Postgres source data). Provides:
 *   - Voyage AI query embedding
 *   - Qdrant retry-wrapped search
 *   - Hydration from ninshubur's Postgres
 *   - Public `IRagStore` for query + stats
 *
 * Ingestion (grouping, embedding, bookkeeping) is owned by ninshubur —
 * siri does not write to either store.
 */

export { RagStore } from './RagStore.js'
export type { RagStoreConfig } from './RagStore.js'

export { queryRag } from './core.js'
export type { QueryRagDeps } from './core.js'

export { VoyageClient } from './voyage.js'
export type {
  VoyageClientConfig,
  EmbedOptions,
  EmbedResult,
  EmbedInputType,
} from './voyage.js'

export { search } from './qdrant/schema.js'
export type { SearchOptions } from './qdrant/schema.js'
export { withQdrantRetry, isRetryableQdrantError } from './qdrant/retry.js'

export {
  createNinshuburDb,
  resolveNinshuburSsl,
} from './ninshuburDb.js'
export type {
  NinshuburDb,
  NinshuburDbConfig,
  NinshuburDbHandle,
} from './ninshuburDb.js'

export type {
  IRagStore,
  RagQueryOptions,
  RagResult,
  RagStats,
  RagError,
  RagErrorKind,
  RagScope,
} from './types.js'
