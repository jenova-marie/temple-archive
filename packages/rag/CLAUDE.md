# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@siri/rag` is a **read-only client** over [`ninshubur`](../../../ninshubur)'s wisdom archive. ninshubur ingests Discord conversations between Siri and Jenova into Qdrant + Postgres; siri queries them.

We do not write to either store. Ingestion (grouping, embedding, bookkeeping) is owned by ninshubur.

## Commands

```bash
pnpm build        # Compile TypeScript to dist/
pnpm test         # Run tests once with vitest
pnpm test:watch   # Run tests in watch mode
pnpm typecheck    # Type check without emitting
pnpm clean        # Remove dist/ directory
```

## Architecture

```
                  POST /api/v1/rag/query   ─┐
                                            │
                  searchKnowledge tool ─────┤
                                            ▼
                                       RagStore
                                            │
                            ┌───────────────┼───────────────┐
                            ▼               ▼               ▼
                       VoyageClient    QdrantClient    Drizzle (pg.Pool)
                       (embedQuery)    (search)        (hydrate)
                            │               │               │
                            ▼               ▼               ▼
                     api.voyageai.com  ninshubur_*    ninshubur's
                                       collections     Postgres
```

### Retrieval flow

1. **Embed query** — `VoyageClient.embedQuery()` POSTs to Voyage with `inputType: "query"`. Returns 1024-dim vector.
2. **Qdrant search** — `search()` issues `client.search(collection, { vector, limit, filter, with_payload: true })` against `ninshubur_messages` or `ninshubur_groups`. Filters built from `category` + `channelId` as `must` clauses.
3. **Hydrate** — for each Qdrant hit, look up the source row in ninshubur's Postgres:
   - `messages` (snowflake id, content via `COALESCE(NULLIF(content,''), message_snapshots->0->>'content', '')`, JOIN `users` for author)
   - `message_groups` (UUID id, summary, started/ended timestamps, message_count)
4. Return `RagResult[]` with `{scopeType, scopeId, score, payload, hydrated}`.

### Key files

| File | Purpose |
|---|---|
| `src/voyage.ts` | Direct REST client to Voyage API (the official SDK has a broken ESM build). Auto-batches 128 inputs per request, honors `Retry-After` on 429s. |
| `src/qdrant/retry.ts` | `withQdrantRetry` — exp backoff for transient errors (sockets, 429s, 5xx). |
| `src/qdrant/schema.ts` | `search(client, opts)` helper — wraps the qdrant client call in retry. |
| `src/ninshuburDb.ts` | `createNinshuburDb()` — pg.Pool + Drizzle pointed at ninshubur's DB. Separate from siri's main DB. |
| `src/core.ts` | `queryRag(deps, opts)` — embed → search → hydrate, no Result wrapping. |
| `src/RagStore.ts` | `IRagStore` impl. Wraps `queryRag` with `Result<T, RagError>`, tracing, structured logs. |
| `src/stubs/InMemoryRagStore.ts` | Naive cosine-similarity stub for tests. No external services. |

### Filter shape

We forward ninshubur's filter convention exactly:

```ts
// category=recovery, channelId=12345 →
{
  must: [
    { key: 'category_slugs', match: { value: 'recovery' } },
    { key: 'channel_id',     match: { value: '12345' } },
  ],
}
```

If you add a new filter dimension, follow the same `{key, match: {value}}` shape — it must align with ninshubur's payload index field names.

## Configuration

All connection details come from env vars (sensitive, not in YAML config):

| Env var | Purpose |
|---|---|
| `ENABLE_RAG` | Master switch. `true` to enable. |
| `VOYAGE_API_KEY` | Voyage API key (queries only — ingestion lives in ninshubur). |
| `VOYAGE_MODEL` | Defaults to `voyage-3.5` (1024-dim). Matches ninshubur's env-var convention. |
| `NINSHUBUR_DATABASE_URL` | `postgresql://user:pass@host:port/db` for ninshubur's PG. |
| `NINSHUBUR_DATABASE_SSL` | `true` (self-signed OK), `false`, or unset. |
| `NINSHUBUR_QDRANT_URL` | ninshubur's Qdrant. May be the same instance as siri's. |
| `NINSHUBUR_QDRANT_API_KEY` | Optional. |
| `NINSHUBUR_QDRANT_COLLECTION_MESSAGES` | Default: `ninshubur_messages`. |
| `NINSHUBUR_QDRANT_COLLECTION_GROUPS` | Default: `ninshubur_groups`. |
| `RAG_DEFAULT_SCOPE` | `messages` or `groups`. Default `groups`. |
| `RAG_DEFAULT_LIMIT` | Default `10`. |

Behavior toggles (`enabled`, model, defaults, collection names) also live in `packages/config/src/schema.ts` under `rag.*` so they can come from `siri.agent.yaml`.

## Dependencies

- `@qdrant/js-client-rest` — Qdrant REST client (already used by `@siri/memory` for L4)
- `@anthropic-ai/sdk` — *intentionally listed but currently unused at runtime*; reserved in case the consumer adds tool-call orchestration. Drop it if it stays unused.
- `drizzle-orm` + `pg` — Postgres connection to ninshubur's DB
- `@siri/types`, `@siri/observability`, `@siri/db` — siri internals

## Patterns

### Result-based errors

All public `IRagStore` methods return `Result<T, RagError>`. Internal helpers (`queryRag`, `voyage.embed`) throw, and `RagStore` translates exceptions into typed `RagError`s.

### Tracing

Every public entry point opens a span with `withSpan('RagStore.<method>', ...)`. The trace context is threaded through.

### Read-only

We never call `client.upsert`, `client.createCollection`, `db.insert`, etc. If you find yourself reaching for those, ingestion belongs in ninshubur. The exception is `ensureCollection` — and we removed it for exactly this reason.

## Testing

- Unit tests use mocks for Voyage HTTP, Qdrant client, and Drizzle execute. No external services required.
- `InMemoryRagStore` lets consumer packages exercise `IRagStore` semantics without standing up Voyage or Qdrant.
- An optional integration test (skipped unless `VOYAGE_API_KEY`, `NINSHUBUR_QDRANT_URL`, `NINSHUBUR_DATABASE_URL` set) can be added later for end-to-end verification.
