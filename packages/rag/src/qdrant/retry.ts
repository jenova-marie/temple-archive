/**
 * Qdrant retry utility — exponential backoff for transient network/server errors.
 *
 * Long embed runs occasionally hit `SocketError: other side closed`, idle
 * connection drops, brief 5xx blips, etc. — these are recoverable and worth
 * retrying. Non-transient errors (4xx other than 429, schema mismatches,
 * auth failures) propagate immediately.
 *
 * Ported from ninshubur/src/llm/qdrant.ts.
 */

import { getLogger } from '@siri/observability'

const QDRANT_MAX_RETRIES = 5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRetryableQdrantError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  if (msg.includes('fetch failed')) return true
  if (msg.includes('other side closed')) return true
  if (msg.includes('socket')) return true
  if (msg.includes('econnreset')) return true
  if (msg.includes('etimedout')) return true
  if (msg.includes('ehostunreach')) return true
  if (msg.includes('eai_again')) return true
  const status = (err as { status?: number }).status
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true
  return false
}

/**
 * Wrap a Qdrant client call with exponential-backoff retry on
 * transient network/server errors.
 */
export async function withQdrantRetry<T>(
  description: string,
  fn: () => Promise<T>,
): Promise<T> {
  const logger = getLogger().child({ component: 'qdrant-retry' })
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= QDRANT_MAX_RETRIES || !isRetryableQdrantError(err)) {
        throw err
      }
      attempt += 1
      const waitMs = Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
      const status = (err as { status?: number }).status
      logger.warn(
        {
          description,
          attempt,
          waitMs,
          status,
          message: err instanceof Error ? err.message : String(err),
        },
        `qdrant ${description} retrying after ${Math.round(waitMs / 1000)}s`,
      )
      await sleep(waitMs)
    }
  }
}
