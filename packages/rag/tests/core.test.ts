import { describe, it, expect, vi } from 'vitest'
import { queryRag } from '../src/core.js'
import type { QueryRagDeps } from '../src/core.js'

function makeDeps(overrides: Partial<QueryRagDeps> = {}): QueryRagDeps {
  return {
    db: {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as QueryRagDeps['db'],
    qdrant: {
      search: vi.fn().mockResolvedValue([]),
    } as unknown as QueryRagDeps['qdrant'],
    voyage: {
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as QueryRagDeps['voyage'],
    collectionMessages: 'ninshubur_messages',
    collectionGroups: 'ninshubur_groups',
    ...overrides,
  }
}

describe('queryRag', () => {
  it('embeds query as inputType=query and searches groups by default', async () => {
    const search = vi.fn().mockResolvedValue([])
    const embedQuery = vi.fn().mockResolvedValue([0.5, 0.6])
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
      voyage: { embedQuery } as unknown as QueryRagDeps['voyage'],
    })

    await queryRag(deps, { query: 'recovery wisdom' })

    expect(embedQuery).toHaveBeenCalledWith('recovery wisdom')
    expect(search).toHaveBeenCalledTimes(1)
    // qdrant.search(collection, params) — collection is the 1st arg
    expect(search.mock.calls[0]![0]).toBe('ninshubur_groups')
    const params = search.mock.calls[0]![1]
    expect(params.vector).toEqual([0.5, 0.6])
    expect(params.limit).toBe(10)
    expect(params.with_payload).toBe(true)
    expect(params.filter).toBeUndefined()
  })

  it('uses messages collection when scope=messages', async () => {
    const search = vi.fn().mockResolvedValue([])
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
    })

    await queryRag(deps, { query: 'q', scope: 'messages' })
    expect(search.mock.calls[0]![0]).toBe('ninshubur_messages')
  })

  it('forwards category filter as a must clause', async () => {
    const search = vi.fn().mockResolvedValue([])
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
    })

    await queryRag(deps, { query: 'q', category: 'recovery' })
    const filter = search.mock.calls[0]![1].filter
    expect(filter).toEqual({
      must: [{ key: 'category_slugs', match: { value: 'recovery' } }],
    })
  })

  it('forwards channelId filter and combines with category', async () => {
    const search = vi.fn().mockResolvedValue([])
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
    })

    await queryRag(deps, { query: 'q', category: 'lesson', channelId: '12345' })
    const filter = search.mock.calls[0]![1].filter
    expect(filter).toEqual({
      must: [
        { key: 'category_slugs', match: { value: 'lesson' } },
        { key: 'channel_id', match: { value: '12345' } },
      ],
    })
  })

  it('hydrates groups when scope=groups', async () => {
    const search = vi.fn().mockResolvedValue([
      { id: 'pid-1', score: 0.9, payload: { scope_id: 'group-uuid-1' } },
    ])
    const dbExecute = vi.fn().mockResolvedValue({
      rows: [{ id: 'group-uuid-1', summary: 'a teaching about acceptance' }],
    })
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
      db: { execute: dbExecute } as unknown as QueryRagDeps['db'],
    })

    const results = await queryRag(deps, { query: 'q', scope: 'groups' })

    expect(results).toHaveLength(1)
    expect(results[0]?.scopeType).toBe('group')
    expect(results[0]?.scopeId).toBe('group-uuid-1')
    expect(results[0]?.score).toBe(0.9)
    expect(results[0]?.hydrated).toEqual({
      id: 'group-uuid-1',
      summary: 'a teaching about acceptance',
    })
  })

  it('hydrates messages when scope=messages', async () => {
    const search = vi.fn().mockResolvedValue([
      { id: 'pid-1', score: 0.85, payload: { scope_id: '1234567890' } },
    ])
    const dbExecute = vi.fn().mockResolvedValue({
      rows: [{ id: '1234567890', author: 'jenova', content: 'hi siri' }],
    })
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
      db: { execute: dbExecute } as unknown as QueryRagDeps['db'],
    })

    const results = await queryRag(deps, { query: 'q', scope: 'messages' })

    expect(results[0]?.scopeType).toBe('message')
    expect(results[0]?.scopeId).toBe('1234567890')
    expect(results[0]?.hydrated).toEqual({
      id: '1234567890',
      author: 'jenova',
      content: 'hi siri',
    })
  })

  it('returns null hydrated when source row missing', async () => {
    const search = vi.fn().mockResolvedValue([
      { id: 'pid-1', score: 0.5, payload: { scope_id: 'unknown-id' } },
    ])
    const dbExecute = vi.fn().mockResolvedValue({ rows: [] })
    const deps = makeDeps({
      qdrant: { search } as unknown as QueryRagDeps['qdrant'],
      db: { execute: dbExecute } as unknown as QueryRagDeps['db'],
    })

    const results = await queryRag(deps, { query: 'q' })
    expect(results[0]?.hydrated).toBeNull()
  })
})
