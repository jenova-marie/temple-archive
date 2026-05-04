import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'
import { createGuidesRouter } from './guides.js'
import type { SystemPromptRepository } from '@siri/db'

vi.mock('@siri/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}))

interface RouteLayer {
  route?: { path: string; stack: Array<{ method: string; handle: (req: Request, res: Response, next: () => void) => unknown }> }
}

function getHandler(repo: SystemPromptRepository) {
  const router = createGuidesRouter({ systemPromptRepo: repo })
  // Express Router stores handlers in `stack`; for `router.get('/', ...)` the
  // route layer's stack[0].handle is our async function.
  const layer = (router.stack as RouteLayer[]).find((l) => l.route?.path === '/')
  if (!layer?.route) throw new Error('GET / handler not found on guides router')
  const stack = layer.route.stack
  const get = stack.find((s) => s.method === 'get')
  if (!get) throw new Error('GET method handler not found on guides router')
  return get.handle
}

function makeRow(overrides: Partial<{
  id: string
  name: string
  variables: Record<string, unknown>
}> = {}) {
  return {
    id: overrides.id ?? 'prompt-id',
    name: overrides.name ?? 'siri',
    content: 'system prompt content',
    variables: overrides.variables ?? {},
    active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }
}

function createRes() {
  const res: Partial<Response> & { _body?: unknown; _status?: number } = {}
  res.status = vi.fn(function (this: Response, code: number) {
    res._status = code
    return this
  } as Response['status'])
  res.json = vi.fn((body: unknown) => {
    res._body = body
    return res as Response
  })
  return res as Response & { _body?: unknown; _status?: number }
}

describe('GET /api/v1/guides', () => {
  let findAllActive: ReturnType<typeof vi.fn>
  let repo: SystemPromptRepository

  beforeEach(() => {
    findAllActive = vi.fn()
    repo = { findAllActive } as unknown as SystemPromptRepository
  })

  it('returns empty list when there are no active prompts', async () => {
    findAllActive.mockResolvedValue({ ok: true, value: [] })
    const handler = getHandler(repo)
    const res = createRes()

    await handler({} as Request, res, () => {})

    expect(res._status).toBeUndefined() // no explicit status = 200
    expect(res._body).toEqual({ guides: [] })
  })

  it('maps row.name to guide.id and titlecases the display name when no variables.displayName', async () => {
    findAllActive.mockResolvedValue({
      ok: true,
      value: [makeRow({ name: 'siri' })],
    })
    const handler = getHandler(repo)
    const res = createRes()

    await handler({} as Request, res, () => {})

    expect(res._body).toEqual({
      guides: [{ id: 'siri', name: 'Siri', description: '' }],
    })
  })

  it('prefers variables.displayName and variables.description when present', async () => {
    findAllActive.mockResolvedValue({
      ok: true,
      value: [
        makeRow({
          name: 'siri',
          variables: {
            displayName: 'Siri',
            description: 'Your personal AI companion',
          },
        }),
      ],
    })
    const handler = getHandler(repo)
    const res = createRes()

    await handler({} as Request, res, () => {})

    const body = res._body as { guides: Array<{ id: string; name: string; description: string }> }
    expect(body.guides[0]).toEqual({
      id: 'siri',
      name: 'Siri',
      description: 'Your personal AI companion',
    })
  })

  it('sorts guides alphabetically by id', async () => {
    findAllActive.mockResolvedValue({
      ok: true,
      value: [
        makeRow({ name: 'zelda' }),
        makeRow({ name: 'archivist' }),
        makeRow({ name: 'siri' }),
      ],
    })
    const handler = getHandler(repo)
    const res = createRes()

    await handler({} as Request, res, () => {})

    const body = res._body as { guides: Array<{ id: string }> }
    expect(body.guides.map((g) => g.id)).toEqual([
      'archivist',
      'siri',
      'zelda',
    ])
  })

  it('returns 500 on repository error', async () => {
    findAllActive.mockResolvedValue({
      ok: false,
      error: {
        kind: 'DatabaseError',
        message: 'connection refused',
        context: {},
        timestamp: Date.now(),
      },
    })
    const handler = getHandler(repo)
    const res = createRes()

    await handler({} as Request, res, () => {})

    expect(res._status).toBe(500)
    const body = res._body as { error: string }
    expect(body.error).toBe('InternalError')
  })

  it('ignores non-string displayName/description values', async () => {
    findAllActive.mockResolvedValue({
      ok: true,
      value: [
        makeRow({
          name: 'oracle',
          variables: { displayName: 42, description: { foo: 'bar' } },
        }),
      ],
    })
    const handler = getHandler(repo)
    const res = createRes()

    await handler({} as Request, res, () => {})

    const body = res._body as { guides: Array<{ id: string; name: string; description: string }> }
    expect(body.guides[0]).toEqual({
      id: 'oracle',
      name: 'Oracle',
      description: '',
    })
  })
})
