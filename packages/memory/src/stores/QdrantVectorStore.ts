/**
 * Qdrant-backed L4 Vector Store
 *
 * Provides semantic search across all conversation history using Qdrant.
 * Implements the IVectorStore interface for the memory orchestrator.
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import type {
  IVectorStore,
  Message,
  SemanticMatch,
  VectorSearchOptions,
  StoreError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import {
  COLLECTION_NAME,
  VECTOR_SIZE,
  SEARCH_MODE,
  DENSE_VECTOR_NAME,
  SPARSE_VECTOR_NAME,
  ensureCollection,
  messageIdToPointId,
  type MessagePayload,
  type QdrantSearchMode,
} from '../qdrant/schema.js'
import { getBM25Embedder } from '../qdrant/bm25.js'

export interface QdrantVectorStoreConfig {
  /** Collection name (default: 'messages') */
  collectionName?: string
  /** Vector dimensions (default: 1536) */
  vectorSize?: number
  /** Minimum similarity score (default: 0.7) */
  scoreThreshold?: number
  /** Batch size for bulk operations (default: 100) */
  batchSize?: number
  /** Search mode: 'hybrid' (dense + text) or 'simple' (dense only) */
  searchMode?: QdrantSearchMode
}

/**
 * Map Qdrant errors to StoreError types
 */
function mapQdrantError(error: unknown): StoreError {
  const e = error as Error & { status?: number; code?: string }
  const message = e?.message ?? 'Unknown Qdrant error'
  const status = e?.status
  const code = e?.code

  // Connection errors
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    message.includes('ECONNRESET') ||
    message.includes('fetch failed')
  ) {
    return {
      kind: 'ConnectionError',
      message: `Qdrant connection failed: ${message}`,
      context: { code, status },
      cause: error,
    }
  }

  // Timeout errors
  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return {
      kind: 'TimeoutError',
      message: `Qdrant operation timed out: ${message}`,
      context: { code, status },
      cause: error,
    }
  }

  // Validation errors (400)
  if (status === 400) {
    return {
      kind: 'ValidationError',
      message: `Qdrant validation error: ${message}`,
      context: { status },
      cause: error,
    }
  }

  // Not found (404)
  if (status === 404) {
    return {
      kind: 'NotFoundError',
      message: `Qdrant resource not found: ${message}`,
      context: { status },
      cause: error,
    }
  }

  return {
    kind: 'UnexpectedError',
    message: `Qdrant error: ${message}`,
    context: { code, status },
    cause: error,
  }
}

export class QdrantVectorStore implements IVectorStore {
  private readonly collectionName: string
  private readonly vectorSize: number
  private readonly scoreThreshold: number
  private readonly batchSize: number
  private readonly searchMode: QdrantSearchMode
  private collectionInitialized = false

  constructor(
    private readonly client: QdrantClient,
    config: QdrantVectorStoreConfig = {}
  ) {
    this.collectionName = config.collectionName ?? COLLECTION_NAME
    this.vectorSize = config.vectorSize ?? VECTOR_SIZE
    this.scoreThreshold = config.scoreThreshold ?? 0.7
    this.batchSize = config.batchSize ?? 100
    this.searchMode = config.searchMode ?? SEARCH_MODE
  }

  /**
   * Ensure collection exists before operations
   */
  private async ensureCollectionExists(): Promise<void> {
    if (this.collectionInitialized) return

    await ensureCollection(this.client, this.collectionName, this.vectorSize, this.searchMode)
    this.collectionInitialized = true
  }

  /**
   * Initialize the vector store - creates collection if it doesn't exist.
   * Call this on startup to ensure collection is ready before first operation.
   */
  async init(): Promise<void> {
    const logger = getLogger().child({ component: 'QdrantVectorStore', method: 'init' })
    logger.info({ collectionName: this.collectionName, searchMode: this.searchMode }, 'Starting Qdrant init')
    try {
      await this.ensureCollectionExists()
      logger.info('Qdrant init completed successfully')
    } catch (error) {
      logger.error({ error }, 'Qdrant init failed')
      throw error
    }
  }

  /**
   * Index a single message with its embedding
   * In hybrid mode, also generates and stores BM25 sparse vector
   */
  async indexMessage(
    message: Message,
    embedding: number[],
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('QdrantVectorStore.indexMessage', async () => {
      const logger = getLogger().child({
        messageId: message.id,
        conversationId: message.conversationId,
        role: message.role,
        requestId: ctx.requestId,
        searchMode: this.searchMode,
      })

      try {
        await this.ensureCollectionExists()

        const pointId = messageIdToPointId(message.id)
        const payload = {
          userId: message.userId,
          conversationId: message.conversationId,
          messageId: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          crisisLevel: message.metadata?.crisisLevel,
          entities: message.metadata?.entities,
          topics: message.metadata?.topics,
        } as Record<string, unknown>

        if (this.searchMode === 'hybrid') {
          // Generate BM25 sparse vector from content
          const sparseVector = getBM25Embedder().embed(message.content)

          await this.client.upsert(this.collectionName, {
            wait: true,
            points: [
              {
                id: pointId,
                vector: {
                  [DENSE_VECTOR_NAME]: embedding,
                  [SPARSE_VECTOR_NAME]: sparseVector,
                },
                payload,
              },
            ],
          })
          logger.debug({ role: message.role }, 'Message indexed with dense + sparse vectors')
        } else {
          // Simple mode: single dense vector
          await this.client.upsert(this.collectionName, {
            wait: true,
            points: [
              {
                id: pointId,
                vector: embedding,
                payload,
              },
            ],
          })
          logger.debug({ role: message.role }, 'Message indexed with dense vector only')
        }

        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to index message in Qdrant')
        pipelineMetrics.errors.add(1, { error_kind: 'qdrant_index' })
        return err(mapQdrantError(error))
      }
    })
  }

  /**
   * Batch index multiple messages with their embeddings
   * In hybrid mode, also generates BM25 sparse vectors for each message
   */
  async batchIndex(
    messages: Message[],
    embeddings: number[][],
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('QdrantVectorStore.batchIndex', async () => {
      const logger = getLogger().child({
        count: messages.length,
        requestId: ctx.requestId,
        searchMode: this.searchMode,
      })

      if (messages.length === 0) {
        logger.debug('No messages to batch index')
        return ok(undefined)
      }

      if (messages.length !== embeddings.length) {
        return err({
          kind: 'ValidationError',
          message: 'Messages and embeddings arrays must have the same length',
          context: { messagesCount: messages.length, embeddingsCount: embeddings.length },
        })
      }

      try {
        await this.ensureCollectionExists()

        // Generate sparse vectors if in hybrid mode
        const bm25 = this.searchMode === 'hybrid' ? getBM25Embedder() : null

        // Process in batches
        for (let i = 0; i < messages.length; i += this.batchSize) {
          const batchMessages = messages.slice(i, i + this.batchSize)
          const batchEmbeddings = embeddings.slice(i, i + this.batchSize)

          const points = batchMessages.map((message, idx) => {
            const payload = {
              userId: message.userId,
              conversationId: message.conversationId,
              messageId: message.id,
              role: message.role,
              content: message.content,
              timestamp: message.timestamp,
              crisisLevel: message.metadata?.crisisLevel,
              entities: message.metadata?.entities,
              topics: message.metadata?.topics,
            } as Record<string, unknown>

            if (this.searchMode === 'hybrid' && bm25) {
              const sparseVector = bm25.embed(message.content)
              return {
                id: messageIdToPointId(message.id),
                vector: {
                  [DENSE_VECTOR_NAME]: batchEmbeddings[idx],
                  [SPARSE_VECTOR_NAME]: sparseVector,
                },
                payload,
              }
            } else {
              return {
                id: messageIdToPointId(message.id),
                vector: batchEmbeddings[idx],
                payload,
              }
            }
          })

          await this.client.upsert(this.collectionName, {
            wait: true,
            points,
          })

          logger.debug(
            { batchStart: i, batchEnd: i + batchMessages.length, total: messages.length },
            'Batch indexed in Qdrant'
          )
        }

        logger.info({ count: messages.length, mode: this.searchMode }, 'All messages batch indexed in Qdrant L4')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to batch index in Qdrant')
        pipelineMetrics.errors.add(1, { error_kind: 'qdrant_batch_index' })
        return err(mapQdrantError(error))
      }
    })
  }

  /**
   * Search for semantically similar messages
   * In hybrid mode, combines dense vector similarity with BM25 sparse keyword matching
   */
  async search(
    queryEmbedding: number[],
    options: VectorSearchOptions,
    ctx: TraceContext
  ): Promise<Result<SemanticMatch[], StoreError>> {
    return withSpan('QdrantVectorStore.search', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        userId: options.userId,
        conversationId: options.conversationId,
        searchMode: this.searchMode,
      })

      const {
        userId,
        conversationId,
        daysBack = 90,
        excludeCrisisLevels = [],
        requiredTopics = [],
        limit = 20,
        scoreThreshold = this.scoreThreshold,
        queryText,
      } = options

      try {
        await this.ensureCollectionExists()

        // Build filter conditions
        const mustConditions: Array<Record<string, unknown>> = []
        const mustNotConditions: Array<Record<string, unknown>> = []

        // Filter by userId (required for user-scoped searches)
        if (userId) {
          mustConditions.push({
            key: 'userId',
            match: { value: userId },
          })
        }

        // Filter by conversationId (optional)
        if (conversationId) {
          mustConditions.push({
            key: 'conversationId',
            match: { value: conversationId },
          })
        }

        // Filter by timestamp (daysBack)
        const cutoffTimestamp = Date.now() - daysBack * 24 * 60 * 60 * 1000
        mustConditions.push({
          key: 'timestamp',
          range: { gte: cutoffTimestamp },
        })

        // Exclude crisis levels
        for (const level of excludeCrisisLevels) {
          mustNotConditions.push({
            key: 'crisisLevel',
            match: { value: level },
          })
        }

        // Required topics (any match)
        if (requiredTopics.length > 0) {
          mustConditions.push({
            key: 'topics',
            match: { any: requiredTopics },
          })
        }

        // Build the filter object
        const filter: Record<string, unknown> = {}
        if (mustConditions.length > 0) {
          filter.must = mustConditions
        }
        if (mustNotConditions.length > 0) {
          filter.must_not = mustNotConditions
        }

        let results: SemanticMatch[]

        if (this.searchMode === 'hybrid') {
          // Hybrid mode: use named vectors
          if (queryText) {
            // Full hybrid: dense + sparse with RRF fusion
            logger.debug({ queryText }, 'Using hybrid search (dense + sparse BM25)')
            results = await this.hybridSearch(queryEmbedding, queryText, filter, limit, scoreThreshold)
          } else {
            // Dense-only search in hybrid collection (use named vector)
            logger.debug('Using dense-only search in hybrid collection')
            const searchResult = await this.client.search(this.collectionName, {
              vector: {
                name: DENSE_VECTOR_NAME,
                vector: queryEmbedding,
              },
              filter: Object.keys(filter).length > 0 ? filter : undefined,
              limit,
              score_threshold: scoreThreshold,
              with_payload: true,
            })

            results = this.mapSearchResults(searchResult)
          }
        } else {
          // Simple mode: single unnamed dense vector
          const searchResult = await this.client.search(this.collectionName, {
            vector: queryEmbedding,
            filter: Object.keys(filter).length > 0 ? filter : undefined,
            limit,
            score_threshold: scoreThreshold,
            with_payload: true,
          })

          results = this.mapSearchResults(searchResult)
        }

        logger.debug({ count: results.length, mode: this.searchMode }, 'Qdrant L4 search completed')
        pipelineMetrics.memoryCacheHits.add(results.length > 0 ? 1 : 0, { tier: 'L4' })

        return ok(results)
      } catch (error) {
        logger.error({ error }, 'Qdrant search failed')
        pipelineMetrics.errors.add(1, { error_kind: 'qdrant_search' })
        return err(mapQdrantError(error))
      }
    })
  }

  /**
   * Map Qdrant search results to SemanticMatch array
   */
  private mapSearchResults(searchResult: Array<{ payload?: Record<string, unknown> | null; score: number }>): SemanticMatch[] {
    return searchResult.map((point) => {
      const payload = point.payload as unknown as MessagePayload
      return {
        id: payload.messageId,
        score: point.score,
        content: payload.content,
        metadata: {
          conversationId: payload.conversationId,
          timestamp: payload.timestamp,
          role: payload.role,
        },
      }
    })
  }

  /**
   * Hybrid search combining dense vector similarity with BM25 sparse keyword matching
   * Uses Qdrant's query API with prefetch for RRF (Reciprocal Rank Fusion)
   */
  private async hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    filter: Record<string, unknown>,
    limit: number,
    _scoreThreshold: number
  ): Promise<SemanticMatch[]> {
    const filterObj = Object.keys(filter).length > 0 ? filter : undefined

    // Generate sparse vector from query text
    const sparseVector = getBM25Embedder().embed(queryText)

    // Use Qdrant's query API with prefetch for hybrid search
    // This performs RRF (Reciprocal Rank Fusion) to combine dense + sparse results
    const queryResult = await this.client.query(this.collectionName, {
      prefetch: [
        {
          // Dense vector search
          query: queryEmbedding,
          using: DENSE_VECTOR_NAME,
          filter: filterObj,
          limit: limit * 2, // Fetch more for fusion
        },
        {
          // Sparse BM25 vector search
          query: {
            indices: sparseVector.indices,
            values: sparseVector.values,
          },
          using: SPARSE_VECTOR_NAME,
          filter: filterObj,
          limit: limit * 2,
        },
      ],
      query: {
        fusion: 'rrf', // Reciprocal Rank Fusion to combine results
      },
      limit,
      with_payload: true,
    })

    return queryResult.points.map((point) => {
      const payload = point.payload as unknown as MessagePayload
      return {
        id: payload.messageId,
        score: point.score,
        content: payload.content,
        metadata: {
          conversationId: payload.conversationId,
          timestamp: payload.timestamp,
          role: payload.role,
        },
      }
    })
  }

  /**
   * Prune vectors older than specified days
   */
  async prune(olderThanDays: number, ctx: TraceContext): Promise<Result<number, StoreError>> {
    return withSpan('QdrantVectorStore.prune', async () => {
      const logger = getLogger().child({
        olderThanDays,
        requestId: ctx.requestId,
      })

      try {
        await this.ensureCollectionExists()

        const cutoffTimestamp = Date.now() - olderThanDays * 24 * 60 * 60 * 1000

        // Use scroll to find points to delete
        let deletedCount = 0
        let offset: string | number | undefined = undefined
        const pointIdsToDelete: string[] = []

        // Scroll through all points matching the timestamp filter
        do {
          const scrollResult = await this.client.scroll(this.collectionName, {
            filter: {
              must: [
                {
                  key: 'timestamp',
                  range: { lt: cutoffTimestamp },
                },
              ],
            },
            limit: this.batchSize,
            offset,
            with_payload: false,
            with_vector: false,
          })

          for (const point of scrollResult.points) {
            pointIdsToDelete.push(point.id as string)
          }

          // next_page_offset can be string, number, or null/undefined
          const nextOffset = scrollResult.next_page_offset
          offset = typeof nextOffset === 'string' || typeof nextOffset === 'number'
            ? nextOffset
            : undefined
        } while (offset !== undefined)

        // Delete points in batches
        if (pointIdsToDelete.length > 0) {
          for (let i = 0; i < pointIdsToDelete.length; i += this.batchSize) {
            const batch = pointIdsToDelete.slice(i, i + this.batchSize)
            await this.client.delete(this.collectionName, {
              wait: true,
              points: batch,
            })
            deletedCount += batch.length
          }
        }

        logger.info({ deleted: deletedCount }, 'Qdrant L4 pruning completed')
        return ok(deletedCount)
      } catch (error) {
        logger.error({ error }, 'Qdrant pruning failed')
        pipelineMetrics.errors.add(1, { error_kind: 'qdrant_prune' })
        return err(mapQdrantError(error))
      }
    })
  }

  /**
   * Get point count in collection (for monitoring)
   */
  async getPointCount(): Promise<number> {
    try {
      await this.ensureCollectionExists()
      const info = await this.client.getCollection(this.collectionName)
      return info.points_count ?? 0
    } catch {
      return 0
    }
  }

  /**
   * Check if collection exists
   */
  async collectionExists(): Promise<boolean> {
    try {
      const collections = await this.client.getCollections()
      return collections.collections.some((c) => c.name === this.collectionName)
    } catch {
      return false
    }
  }
}
