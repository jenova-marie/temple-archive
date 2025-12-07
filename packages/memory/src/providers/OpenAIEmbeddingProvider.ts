/**
 * OpenAI Embedding Provider
 *
 * Generates embeddings using OpenAI's text-embedding-3-small model.
 * This provider is used for semantic search in the memory system.
 */

import OpenAI from 'openai'
import type {
  IEmbeddingProvider,
  EmbeddingError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

export interface OpenAIEmbeddingConfig {
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string
  /** Model to use (default: text-embedding-3-small) */
  model?: string
  /** Maximum texts per batch request (default: 100) */
  batchSize?: number
  /** Request timeout in ms (default: 30000) */
  timeout?: number
}

const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_DIMENSION = 1536
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_TIMEOUT = 30000

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private readonly client: OpenAI
  private readonly model: string
  private readonly batchSize: number
  readonly dimension: number = DEFAULT_DIMENSION

  constructor(config: OpenAIEmbeddingConfig = {}) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY or pass apiKey in config.')
    }

    this.client = new OpenAI({
      apiKey,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    })

    this.model = config.model ?? DEFAULT_MODEL
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string, ctx: TraceContext): Promise<Result<number[], EmbeddingError>> {
    return withSpan('OpenAIEmbeddingProvider.embed', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        textLength: text.length,
      })

      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: text,
        })

        const embedding = response.data[0]?.embedding

        if (!embedding) {
          logger.error('No embedding returned from OpenAI')
          return err({
            kind: 'ProviderError',
            message: 'No embedding returned from OpenAI',
            context: { model: this.model },
          })
        }

        logger.debug({ dimension: embedding.length }, 'Embedding generated')
        return ok(embedding)
      } catch (error) {
        return this.handleError(error, logger)
      }
    })
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async embedBatch(
    texts: string[],
    ctx: TraceContext
  ): Promise<Result<number[][], EmbeddingError>> {
    return withSpan('OpenAIEmbeddingProvider.embedBatch', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        textCount: texts.length,
      })

      if (texts.length === 0) {
        return ok([])
      }

      try {
        const allEmbeddings: number[][] = []

        // Process in batches to avoid rate limits
        for (let i = 0; i < texts.length; i += this.batchSize) {
          const batch = texts.slice(i, i + this.batchSize)

          const response = await this.client.embeddings.create({
            model: this.model,
            input: batch,
          })

          // Sort by index to ensure correct ordering
          const sortedData = response.data.sort((a, b) => a.index - b.index)

          for (const item of sortedData) {
            allEmbeddings.push(item.embedding)
          }

          logger.debug(
            { batchStart: i, batchEnd: i + batch.length, total: texts.length },
            'Batch embedding completed'
          )
        }

        logger.debug({ count: allEmbeddings.length }, 'All embeddings generated')
        return ok(allEmbeddings)
      } catch (error) {
        return this.handleError(error, logger)
      }
    })
  }

  /**
   * Check if error is an OpenAI API error (using duck typing for testability)
   */
  private isAPIError(error: unknown): error is { status: number; message: string; headers?: Record<string, string> } {
    return (
      error !== null &&
      typeof error === 'object' &&
      'status' in error &&
      typeof (error as Record<string, unknown>).status === 'number' &&
      'message' in error &&
      typeof (error as Record<string, unknown>).message === 'string'
    )
  }

  /**
   * Handle OpenAI API errors
   */
  private handleError(
    error: unknown,
    logger: ReturnType<typeof getLogger>
  ): Result<never, EmbeddingError> {
    if (this.isAPIError(error)) {
      logger.error({ status: error.status, message: error.message }, 'OpenAI API error')

      if (error.status === 429) {
        return err({
          kind: 'RateLimitError',
          message: 'OpenAI rate limit exceeded',
          context: { status: error.status, retryAfter: error.headers?.['retry-after'] },
        })
      }

      if (error.status === 400 && error.message.includes('maximum context length')) {
        return err({
          kind: 'InputTooLongError',
          message: 'Input text exceeds maximum length',
          context: { message: error.message },
        })
      }

      return err({
        kind: 'ProviderError',
        message: error.message,
        context: { status: error.status },
      })
    }

    logger.error({ error }, 'Unexpected embedding error')
    return err({
      kind: 'UnexpectedError',
      message: error instanceof Error ? error.message : 'Unknown error',
      context: {},
    })
  }
}
