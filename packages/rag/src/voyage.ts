/**
 * Voyage AI embeddings client.
 *
 * The official `voyageai` npm SDK ships a broken ESM build (its own
 * internals reference `dist/esm/api/index.jsx` which doesn't exist on
 * disk). Loading the module crashes Node, so we talk to the REST
 * endpoint directly. The wire format is small and stable.
 *
 * Ported from ninshubur/src/llm/voyage.ts.
 */

import { getLogger } from '@siri/observability'

const VOYAGE_BASE = 'https://api.voyageai.com/v1'

/** Voyage caps each request at 128 inputs. */
const MAX_BATCH = 128

/** Retry budget for transient failures (429s, 5xx). */
const MAX_RETRIES = 6

export type EmbedInputType = 'document' | 'query'

export interface VoyageClientConfig {
  apiKey: string
  /** Default model used when not specified per-call. */
  defaultModel?: string
}

export interface EmbedOptions {
  texts: string[]
  inputType: EmbedInputType
  /** Override the default model. */
  model?: string
}

export interface EmbedResult {
  vectors: number[][]
  totalTokens: number
  model: string
  dim: number
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

export class VoyageClient {
  private readonly apiKey: string
  private readonly defaultModel: string

  constructor(config: VoyageClientConfig) {
    if (!config.apiKey) {
      throw new Error('VoyageClient requires an apiKey')
    }
    this.apiKey = config.apiKey
    this.defaultModel = config.defaultModel ?? 'voyage-3.5'
  }

  /**
   * Embed a list of texts. Automatically chunks into batches of 128 and
   * concatenates result vectors in input order.
   */
  async embed(opts: EmbedOptions): Promise<EmbedResult> {
    const model = opts.model ?? this.defaultModel
    const vectors: number[][] = []
    let totalTokens = 0
    let dim = 0

    const logger = getLogger().child({ component: 'voyage', model })

    for (let offset = 0; offset < opts.texts.length; offset += MAX_BATCH) {
      const slice = opts.texts.slice(offset, offset + MAX_BATCH)
      const response = await this.postEmbed(slice, opts.inputType, model)

      if (response.data.length !== slice.length) {
        logger.warn(
          { expected: slice.length, got: response.data.length },
          'voyage returned fewer embeddings than inputs',
        )
      }

      response.data.sort((a, b) => a.index - b.index)
      for (const entry of response.data) {
        vectors.push(entry.embedding)
        if (dim === 0 && entry.embedding.length > 0) dim = entry.embedding.length
      }
      totalTokens += response.usage.total_tokens
    }

    return { vectors, totalTokens, model, dim }
  }

  /** Embed a single query string with `inputType: 'query'`. */
  async embedQuery(text: string, model?: string): Promise<number[]> {
    const result = await this.embed({ texts: [text], inputType: 'query', model })
    const first = result.vectors[0]
    if (!first) throw new Error('voyage returned no embedding for query')
    return first
  }

  private async postEmbed(
    texts: string[],
    inputType: EmbedInputType,
    model: string,
  ): Promise<VoyageEmbedResponse> {
    const logger = getLogger().child({ component: 'voyage', model })

    let attempt = 0
    while (true) {
      const response = await fetch(`${VOYAGE_BASE}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model,
          input_type: inputType,
        }),
      })

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
            : Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500)
        logger.warn(
          { status: response.status, attempt, waitMs, batch: texts.length },
          `voyage embed ${response.status} — retrying after ${Math.round(waitMs / 1000)}s`,
        )
        await sleep(waitMs)
        continue
      }

      throw new Error(`voyage embed ${response.status}: ${body}`)
    }
  }
}
