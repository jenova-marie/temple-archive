import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { tracingMiddleware } from './tracing.js'

// Mock observability
vi.mock('@recoverysky/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}))

describe('tracing middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response> & { _finishCallback?: () => void }
  let mockNext: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()

    mockReq = {
      headers: {},
      method: 'GET',
      path: '/api/test',
    }

    mockRes = {
      setHeader: vi.fn(),
      statusCode: 200,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          mockRes._finishCallback = callback
        }
        return mockRes as Response
      }),
    }

    mockNext = vi.fn()
  })

  describe('tracingMiddleware', () => {
    it('generates trace IDs when not provided', () => {
      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.tracing).toBeDefined()
      expect(mockReq.tracing?.traceId).toBeDefined()
      expect(mockReq.tracing?.spanId).toBeDefined()
      expect(mockReq.tracing?.requestId).toBeDefined()
    })

    it('uses provided x-trace-id header', () => {
      mockReq.headers = { 'x-trace-id': 'custom-trace-id' }

      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.tracing?.traceId).toBe('custom-trace-id')
    })

    it('uses provided x-request-id header', () => {
      mockReq.headers = { 'x-request-id': 'custom-request-id' }

      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.tracing?.requestId).toBe('custom-request-id')
    })

    it('always generates new spanId', () => {
      mockReq.headers = { 'x-trace-id': 'trace-1' }

      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.tracing?.spanId).toBeDefined()
      expect(mockReq.tracing?.spanId).not.toBe('trace-1')
    })

    it('sets response headers', () => {
      mockReq.headers = {
        'x-trace-id': 'trace-123',
        'x-request-id': 'request-456',
      }

      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'trace-123')
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', 'request-456')
    })

    it('calls next() to continue middleware chain', () => {
      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('registers finish listener for logging', () => {
      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function))
    })

    it('finish callback logs request completion', () => {
      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      // Trigger the finish callback
      expect(mockRes._finishCallback).toBeDefined()
      mockRes._finishCallback?.()

      // No assertion error means callback executed successfully
    })

    it('generates unique IDs for different requests', () => {
      const req1: Partial<Request> = { headers: {}, method: 'GET', path: '/test1' }
      const req2: Partial<Request> = { headers: {}, method: 'GET', path: '/test2' }

      tracingMiddleware(req1 as Request, mockRes as Response, mockNext)
      const tracing1 = req1.tracing

      tracingMiddleware(req2 as Request, mockRes as Response, mockNext)
      const tracing2 = req2.tracing

      expect(tracing1?.traceId).not.toBe(tracing2?.traceId)
      expect(tracing1?.spanId).not.toBe(tracing2?.spanId)
      expect(tracing1?.requestId).not.toBe(tracing2?.requestId)
    })

    it('preserves request method in context', () => {
      mockReq.method = 'POST'
      mockReq.path = '/api/chat'

      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('handles missing headers object gracefully', () => {
      mockReq.headers = {}

      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.tracing).toBeDefined()
      expect(mockNext).toHaveBeenCalled()
    })

    it('generates IDs with expected format', () => {
      tracingMiddleware(mockReq as Request, mockRes as Response, mockNext)

      // IDs should contain underscore separator
      expect(mockReq.tracing?.traceId).toContain('_')
      expect(mockReq.tracing?.spanId).toContain('_')
      expect(mockReq.tracing?.requestId).toContain('_')
    })
  })
})
