import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

// Mock observability - must be in vi.mock factory
vi.mock('@siri/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  pipelineMetrics: {
    errors: { add: vi.fn() },
  },
}))

// Import after mocks
import { HttpError, errorHandler, notFoundHandler } from './errorHandler.js'
import { pipelineMetrics } from '@siri/observability'

describe('errorHandler middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()

    mockReq = {
      tracing: {
        requestId: 'test-request-id',
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        startTime: Date.now(),
      },
      path: '/api/test',
      method: 'GET',
    }

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    mockNext = vi.fn()
  })

  describe('HttpError', () => {
    it('creates error with status code and message', () => {
      const error = new HttpError(400, 'Bad request')

      expect(error.statusCode).toBe(400)
      expect(error.message).toBe('Bad request')
      expect(error.name).toBe('HttpError')
    })

    it('creates error with optional code', () => {
      const error = new HttpError(404, 'Not found', 'RESOURCE_NOT_FOUND')

      expect(error.statusCode).toBe(404)
      expect(error.message).toBe('Not found')
      expect(error.code).toBe('RESOURCE_NOT_FOUND')
    })

    it('inherits from Error', () => {
      const error = new HttpError(500, 'Server error')

      expect(error instanceof Error).toBe(true)
    })
  })

  describe('errorHandler', () => {
    it('handles HttpError with correct status', () => {
      const error = new HttpError(400, 'Validation failed', 'VALIDATION_ERROR')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
      })
    })

    it('uses default error code if not provided', () => {
      const error = new HttpError(403, 'Forbidden')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Error',
        message: 'Forbidden',
      })
    })

    it('handles 401 unauthorized', () => {
      const error = new HttpError(401, 'Unauthorized', 'AUTH_REQUIRED')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
    })

    it('handles 404 not found', () => {
      const error = new HttpError(404, 'Resource not found', 'NOT_FOUND')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(404)
    })

    it('handles 500 internal error', () => {
      const error = new HttpError(500, 'Database connection failed', 'DB_ERROR')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(500)
    })

    it('handles standard Error as 500', () => {
      const error = new Error('Something went wrong')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: expect.any(String),
      })
    })

    it('hides error details in production', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const error = new Error('Sensitive database error details')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      })

      process.env.NODE_ENV = originalEnv
    })

    it('shows error details in development', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'

      const error = new Error('Detailed error message')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Detailed error message',
      })

      process.env.NODE_ENV = originalEnv
    })

    it('records error metric', () => {
      const error = new Error('Test error')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(pipelineMetrics.errors.add).toHaveBeenCalledWith(1, {
        error_kind: 'Error',
      })
    })

    it('records HttpError metric with correct name', () => {
      const error = new HttpError(400, 'Bad request')

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(pipelineMetrics.errors.add).toHaveBeenCalledWith(1, {
        error_kind: 'HttpError',
      })
    })

    it('handles missing tracing context', () => {
      mockReq.tracing = undefined

      const error = new HttpError(400, 'Bad request')

      // Should not throw
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
    })
  })

  describe('notFoundHandler', () => {
    it('returns 404 with path info', () => {
      mockReq.method = 'GET'
      mockReq.path = '/api/unknown'

      notFoundHandler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(404)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Cannot GET /api/unknown',
      })
    })

    it('includes HTTP method in message', () => {
      mockReq.method = 'POST'
      mockReq.path = '/api/resource'

      notFoundHandler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Cannot POST /api/resource',
      })
    })

    it('handles DELETE method', () => {
      mockReq.method = 'DELETE'
      mockReq.path = '/api/item/123'

      notFoundHandler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Cannot DELETE /api/item/123',
      })
    })
  })
})
