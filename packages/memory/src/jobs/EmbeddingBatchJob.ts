/**
 * Embedding Batch Job - Background processor for dual-store embeddings
 *
 * Processes entities and observations that need embeddings in batches.
 * Generates both L3 (384-dim MiniLM) and L4 (1536-dim OpenAI) embeddings.
 *
 * Runs on a configurable interval (default 30 seconds).
 */

import { getLogger, withSpan } from '@recoverysky/observability'
import type { TraceContext } from '@recoverysky/types'
import type { MiniLMEmbeddingProvider } from '../embeddings/MiniLMProvider.js'
import type { OpenAIEmbeddingProvider } from '../providers/OpenAIEmbeddingProvider.js'
import type { Neo4jKnowledgeStore } from '../stores/Neo4jKnowledgeStore.js'
import type { QdrantVectorStore } from '../stores/QdrantVectorStore.js'

/**
 * Configuration for the embedding batch job
 */
export interface EmbeddingBatchJobConfig {
  /** Interval between batch runs in milliseconds (default: 30000) */
  intervalMs?: number
  /** Maximum items to process per batch (default: 100) */
  batchSize?: number
  /** Whether to run immediately on start (default: true) */
  runImmediately?: boolean
}

/**
 * Item needing embedding
 */
export interface UnembeddedItem {
  /** Item ID */
  id: string
  /** Item type: 'entity' or 'observation' */
  type: 'entity' | 'observation'
  /** Text content to embed */
  text: string
}

/**
 * Embedding Batch Job
 *
 * Periodically finds entities and observations without embeddings,
 * generates embeddings using both MiniLM (L3) and OpenAI (L4),
 * and stores them in the respective stores.
 */
export class EmbeddingBatchJob {
  private readonly config: Required<EmbeddingBatchJobConfig>
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private processing = false

  constructor(
    private readonly neo4jStore: Neo4jKnowledgeStore,
    private readonly qdrantStore: QdrantVectorStore,
    private readonly miniLM: MiniLMEmbeddingProvider,
    private readonly openAI: OpenAIEmbeddingProvider,
    config?: EmbeddingBatchJobConfig
  ) {
    this.config = {
      intervalMs: config?.intervalMs ?? 30000,
      batchSize: config?.batchSize ?? 100,
      runImmediately: config?.runImmediately ?? true,
    }
  }

  /**
   * Start the batch job.
   */
  start(): void {
    if (this.running) {
      return
    }

    const logger = getLogger().child({ component: 'EmbeddingBatchJob' })
    logger.info({ intervalMs: this.config.intervalMs }, 'Starting embedding batch job')

    this.running = true

    if (this.config.runImmediately) {
      // Run immediately, then schedule
      this.tick()
    } else {
      // Schedule first run
      this.scheduleNext()
    }
  }

  /**
   * Stop the batch job.
   */
  stop(): void {
    if (!this.running) {
      return
    }

    const logger = getLogger().child({ component: 'EmbeddingBatchJob' })
    logger.info('Stopping embedding batch job')

    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * Check if the job is running.
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Check if currently processing a batch.
   */
  isProcessing(): boolean {
    return this.processing
  }

  /**
   * Run a single batch (for testing or manual triggering).
   */
  async runOnce(ctx: TraceContext): Promise<number> {
    return this.processQueue(ctx)
  }

  /**
   * Schedule the next tick.
   */
  private scheduleNext(): void {
    if (!this.running) {
      return
    }

    this.timer = setTimeout(() => this.tick(), this.config.intervalMs)
  }

  /**
   * Execute one tick of the batch job.
   */
  private async tick(): Promise<void> {
    if (!this.running) {
      return
    }

    const logger = getLogger().child({ component: 'EmbeddingBatchJob' })
    const now = Date.now()
    const ctx: TraceContext = {
      requestId: `embed-batch-${now}`,
      traceId: `trace-${now}`,
      spanId: `span-${now}`,
      startTime: now,
    }

    try {
      await this.processQueue(ctx)
    } catch (error) {
      logger.error({ error }, 'Embedding batch job tick failed')
    }

    // Schedule next tick
    this.scheduleNext()
  }

  /**
   * Process the embedding queue.
   */
  private async processQueue(ctx: TraceContext): Promise<number> {
    return withSpan('EmbeddingBatchJob.processQueue', async () => {
      const logger = getLogger().child({
        component: 'EmbeddingBatchJob',
        requestId: ctx.requestId,
      })

      if (this.processing) {
        logger.debug('Already processing, skipping')
        return 0
      }

      this.processing = true

      try {
        // 1. Find items needing embeddings
        const pendingResult = await this.neo4jStore.getUnembeddedItems(
          this.config.batchSize,
          ctx
        )

        if (!pendingResult.ok) {
          logger.error({ error: pendingResult.error }, 'Failed to get unembedded items')
          return 0
        }

        const pending = pendingResult.value
        if (pending.length === 0) {
          logger.debug('No items need embedding')
          return 0
        }

        logger.info({ count: pending.length }, 'Processing embedding batch')

        // 2. Generate L3 embeddings (MiniLM - local)
        const texts = pending.map((item) => item.text)
        const l3Result = await this.miniLM.embed(texts)

        if (!l3Result.ok) {
          logger.error({ error: l3Result.error }, 'Failed to generate L3 embeddings')
          return 0
        }

        // 3. Generate L4 embeddings (OpenAI)
        const l4Result = await this.openAI.embedBatch(texts, ctx)

        if (!l4Result.ok) {
          logger.error({ error: l4Result.error }, 'Failed to generate L4 embeddings')
          // Continue with just L3 embeddings if L4 fails
        }

        // 4. Update Neo4j with L3 embeddings
        const updateResult = await this.neo4jStore.batchUpdateEmbeddings(
          pending.map((item, i) => ({
            id: item.id,
            type: item.type,
            embedding: l3Result.value[i],
          })),
          ctx
        )

        if (!updateResult.ok) {
          logger.error({ error: updateResult.error }, 'Failed to update L3 embeddings')
        }

        // 5. Update Qdrant with L4 embeddings (if available)
        // TODO: Add batchUpsertEntities method to QdrantVectorStore
        if (l4Result.ok && 'batchUpsertEntities' in this.qdrantStore) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const qdrantResult = await (this.qdrantStore as any).batchUpsertEntities(
            pending.map((item, i) => ({
              id: item.id,
              type: item.type,
              text: item.text,
              embedding: l4Result.value[i],
            })),
            ctx
          )

          if (!qdrantResult.ok) {
            logger.error({ error: qdrantResult.error }, 'Failed to update L4 embeddings')
          }
        } else if (l4Result.ok) {
          logger.debug('Skipping L4 embedding storage - batchUpsertEntities not implemented')
        }

        logger.info({ processed: pending.length }, 'Embedding batch complete')
        return pending.length
      } finally {
        this.processing = false
      }
    })
  }
}
