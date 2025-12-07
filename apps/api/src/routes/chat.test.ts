import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChatRouter } from './chat.js'
import type { Request, Response } from 'express'
import type { Pipeline } from '@recoverysky/pipeline'
import { ok, err } from '@recoverysky/types'

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

describe('chat routes', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockPipeline: Pipeline
  let router: ReturnType<typeof createChatRouter>

  beforeEach(() => {
    vi.clearAllMocks()

    mockReq = {
      body: {
        message: 'Hello',
        conversationId: 'conv-123',
        userId: 'user-456',
      },
      headers: {},
    }

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    }

    mockPipeline = {
      process: vi.fn(),
    } as unknown as Pipeline

    router = createChatRouter(mockPipeline)
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

  describe('POST /', () => {
    it('returns 400 if message is missing', async () => {
      mockReq.body = { conversationId: 'conv-123', userId: 'user-456' }

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'message is required and must be a string',
      })
    })

    it('returns 400 if message is not a string', async () => {
      mockReq.body = { message: 123, conversationId: 'conv-123', userId: 'user-456' }

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'message is required and must be a string',
      })
    })

    it('returns 400 if conversationId is missing', async () => {
      mockReq.body = { message: 'Hello', userId: 'user-456' }

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'conversationId is required and must be a string',
      })
    })

    it('returns 400 if userId is missing', async () => {
      mockReq.body = { message: 'Hello', conversationId: 'conv-123' }

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'userId is required and must be a string',
      })
    })

    it('processes message through pipeline and returns success response', async () => {
      const mockResult = {
        response: 'Hello! How can I help?',
        messages: {
          user: { id: 'msg-user-1' },
          assistant: { id: 'msg-assistant-1' },
        },
        metrics: {
          totalDuration: 150,
          memoryDuration: 10,
          agentDuration: 100,
          tokensUsed: { input: 50, output: 100 },
          memorySource: 'L1',
        },
        crisisLevel: 1,
        emergencyTriggered: false,
        safetyViolations: [],
        diagnostics: {},
      }

      ;(mockPipeline.process as ReturnType<typeof vi.fn>).mockResolvedValue(ok(mockResult))

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockPipeline.process).toHaveBeenCalledWith(
        {
          message: 'Hello',
          conversationId: 'conv-123',
          userId: 'user-456',
        },
        expect.objectContaining({
          userId: 'user-456',
          sessionId: 'conv-123',
          startTime: expect.any(Number),
        })
      )

      expect(mockRes.json).toHaveBeenCalledWith({
        response: 'Hello! How can I help?',
        conversationId: 'conv-123',
        messageId: 'msg-assistant-1',
        metrics: {
          totalDuration: 150,
          memoryDuration: 10,
          agentDuration: 100,
          tokensUsed: { input: 50, output: 100 },
          memorySource: 'L1',
        },
        crisisLevel: 1,
        emergencyTriggered: false,
        safetyViolations: [],
        diagnostics: {},
      })
    })

    it('uses trace headers when provided', async () => {
      mockReq.headers = {
        'x-trace-id': 'custom-trace-id',
        'x-request-id': 'custom-request-id',
      }

      const mockResult = {
        response: 'Response',
        messages: { user: { id: '1' }, assistant: { id: '2' } },
        metrics: {
          totalDuration: 100,
          memoryDuration: 10,
          agentDuration: 80,
          tokensUsed: { input: 10, output: 20 },
          memorySource: 'L1',
        },
        crisisLevel: 1,
        emergencyTriggered: false,
        safetyViolations: [],
        diagnostics: {},
      }

      ;(mockPipeline.process as ReturnType<typeof vi.fn>).mockResolvedValue(ok(mockResult))

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockPipeline.process).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          traceId: 'custom-trace-id',
          requestId: 'custom-request-id',
        })
      )
    })

    it('returns 500 when pipeline returns error', async () => {
      const pipelineError = {
        kind: 'ProcessingError' as const,
        message: 'Agent failed to respond',
        context: {},
      }

      ;(mockPipeline.process as ReturnType<typeof vi.fn>).mockResolvedValue(err(pipelineError))

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Processing Error',
        message: 'Agent failed to respond',
        kind: 'ProcessingError',
      })
    })

    it('returns 500 on unexpected exceptions', async () => {
      ;(mockPipeline.process as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unexpected error')
      )

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      })
    })

    it('includes emergency triggered flag in response', async () => {
      const mockResult = {
        response: 'I notice you are in crisis. Here are resources...',
        messages: { user: { id: '1' }, assistant: { id: '2' } },
        metrics: {
          totalDuration: 100,
          memoryDuration: 10,
          agentDuration: 80,
          tokensUsed: { input: 10, output: 20 },
          memorySource: 'L1',
        },
        crisisLevel: 9,
        emergencyTriggered: true,
        safetyViolations: [],
        diagnostics: {},
      }

      ;(mockPipeline.process as ReturnType<typeof vi.fn>).mockResolvedValue(ok(mockResult))

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          crisisLevel: 9,
          emergencyTriggered: true,
        })
      )
    })
  })

  describe('router creation', () => {
    it('creates a valid router', () => {
      expect(router).toBeDefined()
      expect(router.stack.length).toBeGreaterThan(0)
    })

    it('registers POST / route', () => {
      const routes = router.stack
        .filter((layer: { route?: { path: string; methods: Record<string, boolean> } }) => layer.route)
        .map((layer: { route: { path: string; methods: Record<string, boolean> } }) => ({
          path: layer.route.path,
          method: layer.route.methods.post ? 'POST' : 'UNKNOWN',
        }))

      expect(routes).toContainEqual({ path: '/', method: 'POST' })
    })
  })
})
