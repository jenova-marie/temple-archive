import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGuidesRouter } from './guides.js'
import type { Request, Response } from 'express'
import type { Container } from '../container.js'

// Mock observability
vi.mock('@pippa/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}))

describe('guides routes', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockContainer: Partial<Container>
  let router: ReturnType<typeof createGuidesRouter>

  beforeEach(() => {
    vi.clearAllMocks()

    mockReq = {
      headers: {},
    }

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    }

    mockContainer = {
      listSystemPrompts: vi.fn().mockResolvedValue([
        { id: 'prompt-1', name: 'pippa', description: null },
        { id: 'prompt-2', name: 'custom-guide', description: 'A custom guide' },
      ]),
    }

    router = createGuidesRouter(mockContainer as Container)
  })

  // Helper to find and execute route handler
  function getHandler(method: string, path: string) {
    const stack = router.stack
    for (const layer of stack) {
      if (layer.route) {
        const route = layer.route
        if (route.path === path && route.methods[method]) {
          return route.stack[0].handle
        }
      }
    }
    throw new Error(`Handler not found for ${method} ${path}`)
  }

  describe('GET /', () => {
    it('returns list of available guides', async () => {
      const handler = getHandler('get', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith({
        guides: [
          { id: 'prompt-1', name: 'pippa', description: null },
          { id: 'prompt-2', name: 'custom-guide', description: 'A custom guide' },
        ],
      })
    })

    it('returns empty array when no guides available', async () => {
      mockContainer.listSystemPrompts = vi.fn().mockResolvedValue([])

      const handler = getHandler('get', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith({
        guides: [],
      })
    })

    it('calls container.listSystemPrompts', async () => {
      const handler = getHandler('get', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockContainer.listSystemPrompts).toHaveBeenCalled()
    })

    it('returns 500 on unexpected error', async () => {
      mockContainer.listSystemPrompts = vi.fn().mockRejectedValue(
        new Error('Database connection failed')
      )

      const handler = getHandler('get', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Database connection failed',
      })
    })

    it('returns error message for non-Error exceptions', async () => {
      mockContainer.listSystemPrompts = vi.fn().mockRejectedValue('String error')

      const handler = getHandler('get', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'String error',
      })
    })
  })

  describe('router creation', () => {
    it('creates a valid router', () => {
      expect(router).toBeDefined()
      expect(router.stack.length).toBeGreaterThan(0)
    })

    it('registers GET / route', () => {
      const routes = router.stack
        .filter((layer: { route?: { path: string; methods: Record<string, boolean> } }) => layer.route)
        .map((layer: { route: { path: string; methods: Record<string, boolean> } }) => ({
          path: layer.route.path,
          method: layer.route.methods.get ? 'GET' : 'UNKNOWN',
        }))

      expect(routes).toContainEqual({ path: '/', method: 'GET' })
    })
  })
})
