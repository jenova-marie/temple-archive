import { describe, it, expect } from 'vitest'
import { InMemoryRagStore } from '../src/stubs/InMemoryRagStore.js'
import type { TraceContext } from '@siri/types'

const ctx: TraceContext = {
  traceId: 't',
  spanId: 's',
  requestId: 'r',
  startTime: Date.now(),
}

describe('InMemoryRagStore', () => {
  it('returns empty when no entries', async () => {
    const store = new InMemoryRagStore()
    const result = await store.query({ query: 'anything' }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(0)
  })

  it('ranks group seeds by cosine similarity', async () => {
    const store = new InMemoryRagStore({
      seed: [
        {
          scopeType: 'group',
          scopeId: 'g1',
          vector: [1, 0, 0],
          payload: { summary: 'recovery teaching' },
        },
        {
          scopeType: 'group',
          scopeId: 'g2',
          vector: [0, 1, 0],
          payload: { summary: 'cooking pasta' },
        },
      ],
      embed: () => [1, 0, 0], // query vector aligned with g1
    })

    const result = await store.query({ query: 'q', scope: 'groups' }, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]?.scopeId).toBe('g1')
    expect(result.value[0]?.score).toBeGreaterThan(result.value[1]?.score ?? 0)
  })

  it('respects scope filter (groups vs messages)', async () => {
    const store = new InMemoryRagStore({
      seed: [
        { scopeType: 'group', scopeId: 'g1', vector: [1, 0], payload: {} },
        { scopeType: 'message', scopeId: 'm1', vector: [1, 0], payload: {} },
      ],
      embed: () => [1, 0],
    })

    const groups = await store.query({ query: 'q', scope: 'groups' }, ctx)
    const messages = await store.query({ query: 'q', scope: 'messages' }, ctx)
    if (!groups.ok || !messages.ok) throw new Error('expected ok')
    expect(groups.value).toHaveLength(1)
    expect(groups.value[0]?.scopeType).toBe('group')
    expect(messages.value).toHaveLength(1)
    expect(messages.value[0]?.scopeType).toBe('message')
  })

  it('respects category filter', async () => {
    const store = new InMemoryRagStore({
      seed: [
        {
          scopeType: 'group',
          scopeId: 'g1',
          vector: [1, 0],
          payload: { category_slugs: ['recovery'] },
        },
        {
          scopeType: 'group',
          scopeId: 'g2',
          vector: [1, 0],
          payload: { category_slugs: ['cooking'] },
        },
      ],
      embed: () => [1, 0],
    })

    const result = await store.query(
      { query: 'q', scope: 'groups', category: 'recovery' },
      ctx,
    )
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.scopeId).toBe('g1')
  })

  it('respects channelId filter', async () => {
    const store = new InMemoryRagStore({
      seed: [
        { scopeType: 'group', scopeId: 'g1', vector: [1, 0], payload: { channel_id: '111' } },
        { scopeType: 'group', scopeId: 'g2', vector: [1, 0], payload: { channel_id: '222' } },
      ],
      embed: () => [1, 0],
    })

    const result = await store.query(
      { query: 'q', scope: 'groups', channelId: '222' },
      ctx,
    )
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.scopeId).toBe('g2')
  })

  it('honors limit', async () => {
    const store = new InMemoryRagStore({
      seed: Array.from({ length: 20 }, (_, i) => ({
        scopeType: 'group' as const,
        scopeId: `g${i}`,
        vector: [1, 0],
        payload: {},
      })),
      embed: () => [1, 0],
    })

    const result = await store.query({ query: 'q', limit: 3 }, ctx)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toHaveLength(3)
  })

  it('upsert replaces matching entry', async () => {
    const store = new InMemoryRagStore({
      seed: [{ scopeType: 'group', scopeId: 'g1', vector: [1, 0], payload: { v: 1 } }],
      embed: () => [1, 0],
    })
    store.upsert({ scopeType: 'group', scopeId: 'g1', vector: [1, 0], payload: { v: 2 } })

    const result = await store.query({ query: 'q' }, ctx)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.payload.v).toBe(2)
  })
})
