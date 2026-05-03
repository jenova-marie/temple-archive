/**
 * RAG query core — embed query, search Qdrant, hydrate from Postgres.
 *
 * Read-only against ninshubur's data: ninshubur owns ingestion, siri
 * just searches. Hydration queries match ninshubur's table shape:
 *   - messages: snowflake `id`, `content`, `message_snapshots` JSONB,
 *     `author_id` joined to `users`
 *   - message_groups: UUID `id`, `summary`, `channel_id`, etc.
 *
 * Ported from ninshubur/src/rag/core.ts.
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import { sql } from 'drizzle-orm'

import { search } from './qdrant/schema.js'
import type { NinshuburDb } from './ninshuburDb.js'
import type { VoyageClient } from './voyage.js'
import type { RagQueryOptions, RagResult, RagScope } from './types.js'

export interface QueryRagDeps {
  /** Drizzle client pointed at ninshubur's Postgres. */
  db: NinshuburDb
  qdrant: QdrantClient
  voyage: VoyageClient
  /** Qdrant collection name for per-message vectors. */
  collectionMessages: string
  /** Qdrant collection name for per-group vectors. */
  collectionGroups: string
}

async function hydrateMessage(
  db: NinshuburDb,
  messageId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.execute(
    sql`
      SELECT m.id::text AS id,
             u.username AS author,
             m.created_at AS created_at,
             COALESCE(NULLIF(m.content, ''),
                      m.message_snapshots->0->>'content',
                      '') AS content
      FROM messages m
      LEFT JOIN users u ON u.id = m.author_id
      WHERE m.id = ${messageId}
      LIMIT 1
    `,
  )
  return (rows.rows[0] as Record<string, unknown>) ?? null
}

async function hydrateGroup(
  db: NinshuburDb,
  groupId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.execute(
    sql`
      SELECT g.id::text AS id,
             g.channel_id,
             g.summary,
             g.started_at,
             g.ended_at,
             g.message_count
      FROM message_groups g
      WHERE g.id = ${groupId}::uuid
      LIMIT 1
    `,
  )
  return (rows.rows[0] as Record<string, unknown>) ?? null
}

/**
 * Build a Qdrant filter object from the high-level options.
 *
 * Mirrors ninshubur's filter shape: `category_slugs` array membership
 * and `channel_id` exact match. Combined as a `must` (AND) clause.
 */
function buildFilter(opts: RagQueryOptions): Record<string, unknown> | undefined {
  const must: Array<Record<string, unknown>> = []
  if (opts.category) {
    must.push({ key: 'category_slugs', match: { value: opts.category } })
  }
  if (opts.channelId) {
    must.push({ key: 'channel_id', match: { value: opts.channelId } })
  }
  if (must.length === 0) return undefined
  return { must }
}

/**
 * Run a RAG query end-to-end:
 *   1. Embed the query with Voyage (`inputType: "query"`)
 *   2. Search the appropriate Qdrant collection
 *   3. Hydrate each hit from ninshubur's Postgres
 *
 * No Result wrapping at this layer — RagStore wraps these errors.
 */
export async function queryRag(
  deps: QueryRagDeps,
  opts: RagQueryOptions,
): Promise<RagResult[]> {
  const scope: RagScope = opts.scope ?? 'groups'
  const collection = scope === 'groups' ? deps.collectionGroups : deps.collectionMessages

  const vector = await deps.voyage.embedQuery(opts.query)
  const filter = buildFilter(opts)

  const hits = await search(deps.qdrant, {
    collection,
    vector,
    limit: opts.limit ?? 10,
    filter,
    withPayload: true,
  })

  const results: RagResult[] = []
  for (const hit of hits) {
    const payload = (hit.payload ?? {}) as Record<string, unknown>
    const scopeId =
      typeof payload.scope_id === 'string' ? payload.scope_id : String(hit.id)
    const hydrated =
      scope === 'groups'
        ? await hydrateGroup(deps.db, scopeId)
        : await hydrateMessage(deps.db, scopeId)
    results.push({
      scopeType: scope === 'groups' ? 'group' : 'message',
      scopeId,
      score: hit.score,
      payload,
      hydrated,
    })
  }
  return results
}
