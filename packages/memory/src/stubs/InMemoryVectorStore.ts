/**
 * In-memory stub implementation of L4 Vector Store (Qdrant)
 */

import type {
  IVectorStore,
  Message,
  SemanticMatch,
  VectorSearchOptions,
  StoreError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

interface StoredVector {
  id: string
  vector: number[]
  payload: {
    userId: string
    conversationId: string
    timestamp: number
    role: string
    content: string
    entities?: string[]
    topics?: string[]
    crisisLevel?: number
  }
}

export class InMemoryVectorStore implements IVectorStore {
  private vectors: Map<string, StoredVector> = new Map()

  async indexMessage(
    message: Message,
    embedding: number[],
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryVectorStore.indexMessage', async () => {
      const logger = getLogger().child({
        messageId: message.id,
        conversationId: message.conversationId,
        requestId: ctx.requestId,
      })

      this.vectors.set(message.id, {
        id: message.id,
        vector: embedding,
        payload: {
          userId: message.userId,
          conversationId: message.conversationId,
          timestamp: message.timestamp,
          role: message.role,
          content: message.content,
          entities: message.metadata?.entities,
          topics: message.metadata?.topics,
          crisisLevel: message.metadata?.crisisLevel,
        },
      })

      logger.debug('Message indexed in L4')
      return ok(undefined)
    })
  }

  async batchIndex(
    messages: Message[],
    embeddings: number[][],
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryVectorStore.batchIndex', async () => {
      const logger = getLogger().child({ count: messages.length, requestId: ctx.requestId })

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i]
        const embedding = embeddings[i]

        this.vectors.set(message.id, {
          id: message.id,
          vector: embedding,
          payload: {
            userId: message.userId,
            conversationId: message.conversationId,
            timestamp: message.timestamp,
            role: message.role,
            content: message.content,
            entities: message.metadata?.entities,
            topics: message.metadata?.topics,
            crisisLevel: message.metadata?.crisisLevel,
          },
        })
      }

      logger.debug('Batch indexed in L4')
      return ok(undefined)
    })
  }

  async search(
    queryEmbedding: number[],
    options: VectorSearchOptions,
    ctx: TraceContext
  ): Promise<Result<SemanticMatch[], StoreError>> {
    return withSpan('InMemoryVectorStore.search', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      const {
        userId,
        conversationId,
        daysBack = 90,
        excludeCrisisLevels = [],
        requiredTopics = [],
        limit = 20,
        scoreThreshold = 0.7,
      } = options

      const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
      const candidates: Array<StoredVector & { score: number }> = []

      for (const stored of this.vectors.values()) {
        // Apply filters
        if (userId && stored.payload.userId !== userId) continue
        if (conversationId && stored.payload.conversationId !== conversationId) continue
        if (stored.payload.timestamp < cutoff) continue
        if (
          excludeCrisisLevels.length > 0 &&
          stored.payload.crisisLevel !== undefined &&
          excludeCrisisLevels.includes(stored.payload.crisisLevel)
        ) {
          continue
        }
        if (
          requiredTopics.length > 0 &&
          (!stored.payload.topics ||
            !requiredTopics.some((t) => stored.payload.topics?.includes(t)))
        ) {
          continue
        }

        // Calculate similarity
        const score = this.cosineSimilarity(queryEmbedding, stored.vector)

        if (score >= scoreThreshold) {
          candidates.push({ ...stored, score })
        }
      }

      // Sort by score descending and take top N
      candidates.sort((a, b) => b.score - a.score)
      const results = candidates.slice(0, limit).map((c) => ({
        id: c.id,
        score: c.score,
        content: c.payload.content,
        metadata: {
          conversationId: c.payload.conversationId,
          timestamp: c.payload.timestamp,
          role: c.payload.role,
        },
      }))

      logger.debug({ count: results.length }, 'Vector search completed in L4')
      return ok(results)
    })
  }

  async prune(olderThanDays: number, ctx: TraceContext): Promise<Result<number, StoreError>> {
    return withSpan('InMemoryVectorStore.prune', async () => {
      const logger = getLogger().child({ olderThanDays, requestId: ctx.requestId })

      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      let deleted = 0

      for (const [id, stored] of this.vectors.entries()) {
        if (stored.payload.timestamp < cutoff) {
          this.vectors.delete(id)
          deleted++
        }
      }

      logger.debug({ deleted }, 'Vectors pruned from L4')
      return ok(deleted)
    })
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.vectors.clear()
  }

  /**
   * Get vector count (for monitoring)
   */
  size(): number {
    return this.vectors.size
  }
}
