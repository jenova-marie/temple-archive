/**
 * Qdrant search helper for RAG queries.
 *
 * Read-only — siri does not own these collections. ninshubur creates
 * and ingests into `ninshubur_messages` and `ninshubur_groups`; we just
 * search them.
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import { withQdrantRetry } from './retry.js'

export interface SearchOptions {
  collection: string
  vector: number[]
  limit?: number
  filter?: Record<string, unknown>
  withPayload?: boolean
}

/**
 * Vector search with optional filter. Returns hits sorted by score
 * descending.
 */
export async function search(
  client: QdrantClient,
  opts: SearchOptions,
): Promise<Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }>> {
  return withQdrantRetry(`search(${opts.collection})`, () =>
    client.search(opts.collection, {
      vector: opts.vector,
      limit: opts.limit ?? 10,
      with_payload: opts.withPayload ?? true,
      ...(opts.filter ? { filter: opts.filter } : {}),
    }),
  ) as Promise<Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }>>
}
