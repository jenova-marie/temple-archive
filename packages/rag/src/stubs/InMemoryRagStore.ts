/**
 * In-memory IRagStore stub for tests.
 *
 * Stores a fixed set of pre-seeded "embedded documents" with their
 * vectors and payloads, and does naive cosine similarity at query time.
 * No external services required.
 */

import { ok, type Result, type TraceContext } from '@siri/types'
import type {
  IRagStore,
  RagError,
  RagQueryOptions,
  RagResult,
  RagStats,
  RagScope,
} from '../types.js'

export interface SeedEntry {
  scopeType: 'message' | 'group'
  scopeId: string
  vector: number[]
  payload: Record<string, unknown>
  hydrated?: Record<string, unknown> | null
}

export interface InMemoryRagStoreConfig {
  /** Optional embedder for query strings. Defaults to a deterministic stub. */
  embed?: (text: string) => number[]
  seed?: SeedEntry[]
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return sum
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0))
}

function cosine(a: number[], b: number[]): number {
  const denom = norm(a) * norm(b)
  if (denom === 0) return 0
  return dotProduct(a, b) / denom
}

/** Hash text to a 16-dim deterministic vector — only useful for tests. */
function defaultEmbed(text: string): number[] {
  const dim = 16
  const vec = new Array<number>(dim).fill(0)
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    vec[i % dim] = (vec[i % dim] ?? 0) + ch
  }
  return vec
}

export class InMemoryRagStore implements IRagStore {
  private readonly entries: SeedEntry[]
  private readonly embedFn: (text: string) => number[]

  constructor(config: InMemoryRagStoreConfig = {}) {
    this.entries = config.seed ? [...config.seed] : []
    this.embedFn = config.embed ?? defaultEmbed
  }

  /** Add an entry (useful for ingestion-style tests). */
  upsert(entry: SeedEntry): void {
    const idx = this.entries.findIndex(
      (e) => e.scopeType === entry.scopeType && e.scopeId === entry.scopeId,
    )
    if (idx >= 0) this.entries[idx] = entry
    else this.entries.push(entry)
  }

  async query(
    opts: RagQueryOptions,
    _ctx: TraceContext,
  ): Promise<Result<RagResult[], RagError>> {
    const scope: RagScope = opts.scope ?? 'groups'
    const wantType = scope === 'groups' ? 'group' : 'message'
    const limit = opts.limit ?? 10

    const vector = this.embedFn(opts.query)

    const ranked = this.entries
      .filter((e) => e.scopeType === wantType)
      .filter((e) =>
        opts.category
          ? Array.isArray(e.payload.category_slugs) &&
            (e.payload.category_slugs as string[]).includes(opts.category)
          : true,
      )
      .filter((e) =>
        opts.channelId ? e.payload.channel_id === opts.channelId : true,
      )
      .map((e) => ({ entry: e, score: cosine(vector, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const results: RagResult[] = ranked.map(({ entry, score }) => ({
      scopeType: entry.scopeType,
      scopeId: entry.scopeId,
      score,
      payload: entry.payload,
      hydrated: entry.hydrated ?? null,
    }))
    return ok(results)
  }

  async getStats(_ctx: TraceContext): Promise<Result<RagStats, RagError>> {
    let messages = 0
    let groups = 0
    for (const e of this.entries) {
      if (e.scopeType === 'message') messages++
      else groups++
    }
    return ok({
      qdrant: { messagesCollection: messages, groupsCollection: groups },
    })
  }
}
