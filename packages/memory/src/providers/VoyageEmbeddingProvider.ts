/**
 * Voyage AI Embedding Provider
 *
 * Generates embeddings using Voyage AI (default: voyage-3.5, 1024-dim).
 *
 * Voyage's official `voyageai` npm SDK ships a broken ESM build, so we talk
 * to the REST endpoint directly. The wire format is small and stable.
 */

import type {
  IEmbeddingProvider,
  EmbeddingError,
  EmbeddingOptions,
  TraceContext,
  Result,
} from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan } from '@siri/observability'

const VOYAGE_BASE = 'https://api.voyageai.com/v1'

const DEFAULT_MODEL = 'voyage-3.5'
const DEFAULT_DIMENSION = 1024
/** Voyage caps each request at 128 inputs. */
const MAX_BATCH = 128
const DEFAULT_TIMEOUT = 30000
const MAX_RETRIES = 6

export interface VoyageEmbeddingConfig {
  /** Voyage API key (defaults to VOYAGE_API_KEY env var) */
  apiKey?: string
  /** Model to use (default: voyage-3.5) */
  model?: string
  /** Maximum texts per batch request (default: 128, Voyage's limit) */
  batchSize?: number
  /** Request timeout in ms (default: 30000) */
  timeout?: number
}

interface VoyageEmbedResponse {
  object: string
  data: Array<{ object: string; embedding: number[]; index: number }>
  model: string
  usage: { total_tokens: number }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class VoyageEmbeddingProvider implements IEmbeddingProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly batchSize: number
  private readonly timeout: number
  readonly dimension: number = DEFAULT_DIMENSION

  constructor(config: VoyageEmbeddingConfig = {}) {
    const apiKey = config.apiKey ?? process.env.VOYAGE_API_KEY

    if (!apiKey) {
      throw new Error(
        'Voyage API key is required. Set VOYAGE_API_KEY or pass apiKey in config.',
      )
    }

    this.apiKey = apiKey
    this.model = config.model ?? process.env.VOYAGE_MODEL ?? DEFAULT_MODEL
    this.batchSize = Math.min(config.batchSize ?? MAX_BATCH, MAX_BATCH)
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
  }

  async embed(
    text: string,
    ctx: TraceContext,
    options?: EmbeddingOptions,
  ): Promise<Result<number[], EmbeddingError>> {
    return withSpan('VoyageEmbeddingProvider.embed', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        textLength: text.length,
        ...(options?.label && { label: options.label }),
      })

      try {
        // 'query' input_type produces vectors better tuned for retrieval.
        // For document storage paths we still pass 'document'; we infer
        // from the label since it's the only signal available here.
        const inputType =
          options?.label === 'memory_prompt_query' || options?.label === 'query'
            ? 'query'
            : 'document'

        const response = await this.postEmbed([text], inputType, logger)
        const first = response.data[0]?.embedding

        if (!first) {
          logger.error('No embedding returned from Voyage')
          return err({
            kind: 'ProviderError',
            message: 'No embedding returned from Voyage',
            context: { model: this.model },
          })
        }

        logger.debug(
          {
            dimension: first.length,
            tokens: response.usage.total_tokens,
            ...(options?.label && { label: options.label }),
          },
          'Embedding generated',
        )
        return ok(first)
      } catch (error) {
        return this.handleError(error, logger)
      }
    })
  }

  async embedBatch(
    texts: string[],
    ctx: TraceContext,
  ): Promise<Result<number[][], EmbeddingError>> {
    return withSpan('VoyageEmbeddingProvider.embedBatch', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        textCount: texts.length,
      })

      if (texts.length === 0) {
        return ok([])
      }

      try {
        const allEmbeddings: number[][] = []

        for (let i = 0; i < texts.length; i += this.batchSize) {
          const batch = texts.slice(i, i + this.batchSize)
          const response = await this.postEmbed(batch, 'document', logger)

          const sortedData = response.data
            .slice()
            .sort((a, b) => a.index - b.index)

          for (const item of sortedData) {
            allEmbeddings.push(item.embedding)
          }

          logger.debug(
            {
              batchStart: i,
              batchEnd: i + batch.length,
              total: texts.length,
              tokens: response.usage.total_tokens,
            },
            'Batch embedding completed',
          )
        }

        logger.debug({ count: allEmbeddings.length }, 'All embeddings generated')
        return ok(allEmbeddings)
      } catch (error) {
        return this.handleError(error, logger)
      }
    })
  }

  private async postEmbed(
    texts: string[],
    inputType: 'document' | 'query',
    logger: ReturnType<typeof getLogger>,
  ): Promise<VoyageEmbedResponse> {
    let attempt = 0
    while (true) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeout)

      let response: Response
      try {
        response = await fetch(`${VOYAGE_BASE}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            input: texts,
            model: this.model,
            input_type: inputType,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (response.ok) {
        return (await response.json()) as VoyageEmbedResponse
      }

      const body = await response.text().catch(() => '')
      const retryable = response.status === 429 || response.status >= 500

      if (retryable && attempt < MAX_RETRIES) {
        attempt += 1
        const retryAfterHeader = response.headers.get('retry-after')
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN
        const waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000
            : Math.min(60_000, 1000 * 2 ** attempt) +
              Math.floor(Math.random() * 500)
        logger.warn(
          {
            status: response.status,
            attempt,
            waitMs,
            batch: texts.length,
          },
          `voyage embed ${response.status} — retrying after ${Math.round(waitMs / 1000)}s`,
        )
        await sleep(waitMs)
        continue
      }

      const error: VoyageHTTPError = Object.assign(
        new Error(`voyage embed ${response.status}: ${body}`),
        { status: response.status, body },
      )
      throw error
    }
  }

  private handleError(
    error: unknown,
    logger: ReturnType<typeof getLogger>,
  ): Result<never, EmbeddingError> {
    const httpErr = error as VoyageHTTPError | undefined
    if (httpErr && typeof httpErr.status === 'number') {
      logger.error(
        { status: httpErr.status, message: httpErr.message },
        'Voyage API error',
      )

      if (httpErr.status === 429) {
        return err({
          kind: 'RateLimitError',
          message: 'Voyage rate limit exceeded',
          context: { status: httpErr.status },
        })
      }

      if (httpErr.status === 400 && /context length|too long/i.test(httpErr.message)) {
        return err({
          kind: 'InputTooLongError',
          message: 'Input text exceeds maximum length',
          context: { message: httpErr.message },
        })
      }

      return err({
        kind: 'ProviderError',
        message: httpErr.message,
        context: { status: httpErr.status, body: httpErr.body },
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

interface VoyageHTTPError extends Error {
  status: number
  body?: string
}
