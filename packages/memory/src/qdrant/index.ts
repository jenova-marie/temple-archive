/**
 * Qdrant module exports
 */

export {
  createQdrantClient,
  getQdrantClient,
  closeQdrantClient,
  checkQdrantHealth,
  type QdrantClientConfig,
  type QdrantClient,
} from './client.js'

export {
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
} from './schema.js'

export {
  BM25SparseEmbedding,
  getBM25Embedder,
  generateSparseVector,
  tokenize,
  type SparseVector,
  type BM25Config,
} from './bm25.js'
