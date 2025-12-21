import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHealthRouter } from './health.js'
import type { Request, Response } from 'express'

describe('health routes', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let router: ReturnType<typeof createHealthRouter>

  beforeEach(() => {
    vi.clearAllMocks()

    mockReq = {}

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    }

    router = createHealthRouter()
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
    it('returns healthy status', () => {
      const handler = getHandler('get', '/')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
        })
      )
    })

    it('includes timestamp', () => {
      const handler = getHandler('get', '/')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      )
    })

    it('includes uptime', () => {
      const handler = getHandler('get', '/')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          uptime: expect.any(Number),
        })
      )
    })
  })

  describe('GET /ready', () => {
    it('returns ready status', () => {
      const handler = getHandler('get', '/ready')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
        })
      )
    })

    it('includes timestamp', () => {
      const handler = getHandler('get', '/ready')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      )
    })
  })

  describe('GET /live', () => {
    it('returns alive status', () => {
      const handler = getHandler('get', '/live')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'alive',
        })
      )
    })

    it('includes timestamp', () => {
      const handler = getHandler('get', '/live')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      )
    })
  })

  describe('GET /metrics', () => {
    it('sets content type to text/plain', () => {
      const handler = getHandler('get', '/metrics')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.set).toHaveBeenCalledWith('Content-Type', 'text/plain')
    })

    it('returns Prometheus-formatted metrics', () => {
      const handler = getHandler('get', '/metrics')

      handler(mockReq as Request, mockRes as Response)

      expect(mockRes.send).toHaveBeenCalled()
      const metricsText = (mockRes.send as ReturnType<typeof vi.fn>).mock.calls[0][0]

      expect(metricsText).toContain('# HELP')
      expect(metricsText).toContain('# TYPE')
    })

    it('includes uptime metric', () => {
      const handler = getHandler('get', '/metrics')

      handler(mockReq as Request, mockRes as Response)

      const metricsText = (mockRes.send as ReturnType<typeof vi.fn>).mock.calls[0][0]

      expect(metricsText).toContain('recoverysky_uptime_seconds')
    })

    it('includes memory metric', () => {
      const handler = getHandler('get', '/metrics')

      handler(mockReq as Request, mockRes as Response)

      const metricsText = (mockRes.send as ReturnType<typeof vi.fn>).mock.calls[0][0]

      expect(metricsText).toContain('recoverysky_memory_heap_bytes')
    })

    it('includes info metric with version', () => {
      const handler = getHandler('get', '/metrics')

      handler(mockReq as Request, mockRes as Response)

      const metricsText = (mockRes.send as ReturnType<typeof vi.fn>).mock.calls[0][0]

      expect(metricsText).toContain('recoverysky_info')
      expect(metricsText).toContain('version="0.1.0"')
      expect(metricsText).toContain('node_version=')
    })
  })

  describe('router creation', () => {
    it('creates a valid router', () => {
      expect(router).toBeDefined()
      expect(router.stack.length).toBeGreaterThan(0)
    })

    it('registers all health routes', () => {
      const routes = router.stack
        .filter((layer: { route?: { path: string } }) => layer.route)
        .map((layer: { route: { path: string } }) => layer.route.path)

      expect(routes).toContain('/')
      expect(routes).toContain('/ready')
      expect(routes).toContain('/live')
      expect(routes).toContain('/metrics')
    })
  })
})
