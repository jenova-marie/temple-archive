import { describe, it, expect, vi } from 'vitest'
import { RagStore } from '../src/RagStore.js'
import type { TraceContext } from '@siri/types'

const ctx: TraceContext = {
  traceId: 't',
  spanId: 's',
  requestId: 'r',
  startTime: Date.now(),
}

function makeStore(overrides: {
  search?: ReturnType<typeof vi.fn>
  embedQuery?: ReturnType<typeof vi.fn>
  dbExecute?: ReturnType<typeof vi.fn>
  collectionExists?: ReturnType<typeof vi.fn>
  getCollection?: ReturnType<typeof vi.fn>
} = {}): RagStore {
  return new RagStore({
    db: {
      execute: overrides.dbExecute ?? vi.fn().mockResolvedValue({ rows: [] }),
    } as never,
    qdrant: {
      search: overrides.search ?? vi.fn().mockResolvedValue([]),
      collectionExists:
        overrides.collectionExists ?? vi.fn().mockResolvedValue({ exists: true }),
      getCollection:
        overrides.getCollection ??
        vi.fn().mockResolvedValue({ points_count: 0 }),
    } as never,
    voyage: {
      embedQuery: overrides.embedQuery ?? vi.fn().mockResolvedValue([0.1]),
    } as never,
    collectionMessages: 'ninshubur_messages',
    collectionGroups: 'ninshubur_groups',
  })
}

describe('RagStore', () => {
  it('returns ValidationError on empty query', async () => {
    const store = makeStore()
    const result = await store.query({ query: '' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('ValidationError')
  })

  it('returns ok with results on happy path', async () => {
    const store = makeStore({
      search: vi.fn().mockResolvedValue([
        { id: 'pid', score: 0.9, payload: { scope_id: 'g1', summary: 'x' } },
      ]),
    })

    const result = await store.query({ query: 'hello' }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0]?.scopeId).toBe('g1')
    }
  })

  it('classifies voyage errors as EmbeddingError', async () => {
    const store = makeStore({
      embedQuery: vi.fn().mockRejectedValue(new Error('voyage embed 401: bad key')),
    })

    const result = await store.query({ query: 'hi' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('EmbeddingError')
  })

  it('classifies qdrant errors as QdrantError', async () => {
    const store = makeStore({
      search: vi.fn().mockRejectedValue(new Error('qdrant collection not found')),
    })

    const result = await store.query({ query: 'hi' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('QdrantError')
  })

  it('returns Qdrant point counts in stats', async () => {
    const store = makeStore({
      collectionExists: vi.fn().mockResolvedValue({ exists: true }),
      getCollection: vi.fn().mockResolvedValue({ points_count: 42 }),
    })

    const result = await store.getStats(ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.qdrant.messagesCollection).toBe(42)
      expect(result.value.qdrant.groupsCollection).toBe(42)
    }
  })

  it('returns 0 counts for non-existent collections without throwing', async () => {
    const store = makeStore({
      collectionExists: vi.fn().mockResolvedValue({ exists: false }),
    })

    const result = await store.getStats(ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.qdrant.messagesCollection).toBe(0)
      expect(result.value.qdrant.groupsCollection).toBe(0)
    }
  })
})
