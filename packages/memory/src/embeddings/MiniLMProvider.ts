/**
 * MiniLM Embedding Provider - Local 384-dimensional embeddings
 *
 * Uses @xenova/transformers to run all-MiniLM-L6-v2 locally in Node.js.
 * This provides fast, free embeddings for L3 (Neo4j) graph-local operations.
 *
 * For high-precision semantic search, use OpenAI embeddings in L4 (Qdrant).
 */

import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import type { Result } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'

// Dynamic import for @xenova/transformers (ESM)
let pipeline: typeof import('@xenova/transformers').pipeline | null = null

/**
 * Error types for embedding operations
 */
export interface EmbeddingError {
  kind: 'InitError' | 'EmbeddingError' | 'NotInitializedError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * Configuration for MiniLM provider
 */
export interface MiniLMProviderConfig {
  /** Model to use (default: Xenova/all-MiniLM-L6-v2) */
  model?: string
  /** Cache directory for model files */
  cacheDir?: string
  /** Whether to show download progress */
  showProgress?: boolean
}

/**
 * MiniLM Embedding Provider
 *
 * Provides 384-dimensional embeddings using the all-MiniLM-L6-v2 model.
 * Runs entirely locally - no API calls, no costs.
 */
export class MiniLMEmbeddingProvider {
  private extractor: Awaited<ReturnType<typeof import('@xenova/transformers').pipeline>> | null = null
  private readonly config: Required<MiniLMProviderConfig>
  private initialized = false
  private initializing = false

  constructor(config?: MiniLMProviderConfig) {
    this.config = {
      model: config?.model ?? 'Xenova/all-MiniLM-L6-v2',
      cacheDir: config?.cacheDir ?? '',
      showProgress: config?.showProgress ?? false,
    }
  }

  /**
   * Initialize the embedding model.
   * Downloads model on first run (~80MB), cached thereafter.
   */
  async init(): Promise<Result<void, EmbeddingError>> {
    if (this.initialized) {
      return ok(undefined)
    }

    if (this.initializing) {
      // Wait for existing initialization
      while (this.initializing) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return this.initialized
        ? ok(undefined)
        : err({
            kind: 'InitError',
            message: 'Model initialization failed',
            context: {},
          })
    }

    this.initializing = true
    const logger = getLogger().child({ component: 'MiniLMProvider' })

    try {
      logger.info({ model: this.config.model }, 'Initializing MiniLM embedding model')

      // Dynamic import to avoid loading at module level
      if (!pipeline) {
        const transformers = await import('@xenova/transformers')
        pipeline = transformers.pipeline
      }

      // Create feature extraction pipeline
      this.extractor = await pipeline('feature-extraction', this.config.model, {
        progress_callback: this.config.showProgress
          ? (progress: { status: string; progress?: number }) => {
              if (progress.progress !== undefined) {
                logger.debug({ progress: progress.progress }, 'Model download progress')
              }
            }
          : undefined,
      })

      this.initialized = true
      logger.info('MiniLM embedding model initialized successfully')
      return ok(undefined)
    } catch (error) {
      logger.error({ error }, 'Failed to initialize MiniLM embedding model')
      return err({
        kind: 'InitError',
        message: 'Failed to initialize MiniLM model',
        context: { model: this.config.model },
        cause: error,
      })
    } finally {
      this.initializing = false
    }
  }

  /**
   * Generate embeddings for one or more texts.
   *
   * @param texts - Array of texts to embed
   * @returns Array of 384-dimensional embedding vectors
   */
  async embed(texts: string[]): Promise<Result<number[][], EmbeddingError>> {
    return withSpan('MiniLMProvider.embed', async () => {
      const logger = getLogger().child({ component: 'MiniLMProvider' })

      if (!this.initialized || !this.extractor) {
        // Try to initialize if not done
        const initResult = await this.init()
        if (!initResult.ok) {
          return err(initResult.error)
        }
      }

      if (!this.extractor) {
        return err({
          kind: 'NotInitializedError',
          message: 'MiniLM model not initialized',
          context: {},
        })
      }

      const startTime = Date.now()

      try {
        logger.debug({ count: texts.length }, 'Generating MiniLM embeddings')
        const embeddings: number[][] = []

        for (const text of texts) {
          // Run through the model
          // Cast options to any to avoid TypeScript issues with transformers types
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const output = await this.extractor(text, {
            pooling: 'mean',
            normalize: true,
          } as any)

          // Extract the embedding array
          // Output is a Tensor with a data property
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tensorData = (output as any).data
          const embedding = Array.from(tensorData as Float32Array)
          embeddings.push(embedding)
        }

        const durationMs = Date.now() - startTime
        const avgPerText = texts.length > 0 ? Math.round(durationMs / texts.length) : 0

        logger.debug(
          {
            count: texts.length,
            dim: embeddings[0]?.length,
            durationMs,
            avgPerTextMs: avgPerText,
          },
          'MiniLM embeddings generated'
        )

        // Record metrics
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'miniLM_embed' })

        return ok(embeddings)
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.error({ error, durationMs }, 'Failed to generate MiniLM embeddings')
        pipelineMetrics.errors.add(1, { kind: 'miniLM_embedding_error' })
        return err({
          kind: 'EmbeddingError',
          message: 'Failed to generate embeddings',
          context: { textCount: texts.length },
          cause: error,
        })
      }
    })
  }

  /**
   * Generate embedding for a single text.
   */
  async embedOne(text: string): Promise<Result<number[], EmbeddingError>> {
    const result = await this.embed([text])
    if (!result.ok) {
      return result
    }
    return ok(result.value[0])
  }

  /**
   * Check if the model is initialized.
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get the embedding dimensions (384 for MiniLM).
   */
  getDimensions(): number {
    return 384
  }

  /**
   * Get the model name.
   */
  getModel(): string {
    return this.config.model
  }
}
