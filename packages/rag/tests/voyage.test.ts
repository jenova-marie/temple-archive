import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VoyageClient } from '../src/voyage.js'

const originalFetch = global.fetch

describe('VoyageClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
  })

  it('throws when constructed without an apiKey', () => {
    expect(() => new VoyageClient({ apiKey: '' })).toThrow(/apiKey/)
  })

  it('embeds a single query and returns vector', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
          model: 'voyage-3.5',
          usage: { total_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const client = new VoyageClient({ apiKey: 'va-test' })
    const vec = await client.embedQuery('hello world')

    expect(vec).toEqual([0.1, 0.2, 0.3])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.input).toEqual(['hello world'])
    expect(body.input_type).toBe('query')
    expect(body.model).toBe('voyage-3.5')
  })

  it('chunks batches >128 into multiple requests', async () => {
    let call = 0
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      call++
      const body = JSON.parse((init as RequestInit).body as string)
      const inputs = body.input as string[]
      return new Response(
        JSON.stringify({
          object: 'list',
          data: inputs.map((_, i) => ({
            object: 'embedding',
            embedding: [call, i],
            index: i,
          })),
          model: 'voyage-3.5',
          usage: { total_tokens: inputs.length },
        }),
        { status: 200 },
      )
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const client = new VoyageClient({ apiKey: 'va-test' })
    const texts = Array.from({ length: 200 }, (_, i) => `t${i}`)
    const result = await client.embed({ texts, inputType: 'document' })

    expect(fetchMock).toHaveBeenCalledTimes(2) // 200 → 128 + 72
    expect(result.vectors).toHaveLength(200)
    expect(result.totalTokens).toBe(200)
    expect(result.dim).toBe(2)
  })

  it('throws on non-retryable 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('bad request', { status: 400 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const client = new VoyageClient({ apiKey: 'va-test' })
    await expect(client.embedQuery('hi')).rejects.toThrow(/voyage embed 400/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // no retry
  })
})
