/**
 * RAG public types.
 *
 * siri queries ninshubur's Qdrant collections and hydrates from
 * ninshubur's Postgres. We don't own the corpus — only the query path.
 */

import type { Result, TraceContext } from '@siri/types'

/** Scope of a RAG vector — message-level chunks vs grouped teaching units. */
export type RagScope = 'messages' | 'groups'

export interface RagQueryOptions {
  /** Natural-language query. Embedded as `inputType: 'query'`. */
  query: string
  /** Which collection to search. Defaults to `'groups'`. */
  scope?: RagScope
  /** Max hits to return. Defaults to 10. */
  limit?: number
  /** Optional category slug filter (matches ninshubur's `category_slugs`). */
  category?: string
  /** Optional Discord channel snowflake to scope the search. */
  channelId?: string
}

export interface RagResult {
  scopeType: 'message' | 'group'
  /** Original ninshubur source row primary key (snowflake or UUID, as text). */
  scopeId: string
  /** Cosine similarity score from Qdrant. */
  score: number
  /** Raw Qdrant payload. */
  payload: Record<string, unknown>
  /** Full source row from ninshubur's Postgres, or null if hydration failed. */
  hydrated: Record<string, unknown> | null
}

export interface RagStats {
  /** Per-collection point counts from Qdrant. */
  qdrant: { messagesCollection: number; groupsCollection: number }
}

export type RagErrorKind =
  | 'EmbeddingError'
  | 'QdrantError'
  | 'PostgresError'
  | 'ValidationError'
  | 'NotFoundError'
  | 'UnexpectedError'

export interface RagError {
  kind: RagErrorKind
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

export interface IRagStore {
  query(opts: RagQueryOptions, ctx: TraceContext): Promise<Result<RagResult[], RagError>>
  getStats(ctx: TraceContext): Promise<Result<RagStats, RagError>>
}
