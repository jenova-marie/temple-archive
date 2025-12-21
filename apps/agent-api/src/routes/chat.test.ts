import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChatRouter } from './chat.js'
import type { Request, Response } from 'express'
import type { Pipeline, PreflightResult } from '@pippa/pipeline'
import type { CrisisCheckResult } from '@pippa/types'

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

// Mock ai SDK
vi.mock('ai', () => ({
  streamText: vi.fn(() => ({
    toUIMessageStream: vi.fn(),
    text: Promise.resolve('Mock response'),
  })),
  convertToModelMessages: vi.fn((messages) => messages.map((m: { role: string; content?: string; parts?: Array<{ text?: string }> }) => ({
    role: m.role,
    content: m.content || m.parts?.[0]?.text || '',
  }))),
  stepCountIs: vi.fn((count: number) => ({ count })),
  pipeUIMessageStreamToResponse: vi.fn(),
  // Required by @pippa/tools for tool definitions
  tool: vi.fn((config) => config),
}))

// Mock anthropic
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((model: string) => ({ modelId: model })),
}))

/**
 * Helper to create valid Vercel AI SDK format request body
 * Note: 'id' is no longer required - matches existing API
 */
function createValidBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }], id: 'msg-1' }
    ],
    ...overrides,
  }
}

/**
 * Helper to create authenticated user (simulates JWT auth)
 */
function createAuthUser(overrides: Partial<Request['user']> = {}) {
  return {
    id: 'user-456',
    email: 'test@example.com',
    name: 'Test User',
    roles: [],
    claims: { sub: 'user-456' },
    ...overrides,
  } as Request['user']
}

/**
 * Create mock crisis check result
 */
function createMockCrisisCheck(overrides: Partial<CrisisCheckResult> = {}): CrisisCheckResult {
  return {
    level: 1,
    patterns: [],
    triggerEmergency: false,
    action: 'continue',
    processingTimeMs: 5,
    ...overrides,
  }
}

/**
 * Create mock preflight result
 */
function createMockPreflightResult(overrides: Partial<PreflightResult> = {}): PreflightResult {
  return {
    systemPrompt: 'You are Sky, a recovery companion.',
    tools: [],
    context: {
      messages: [],
      sessionState: {
        startTime: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        crisisLevel: 1,
      },
    },
    crisisCheck: createMockCrisisCheck(),
    memoryContext: null,
    memoryStats: {
      source: 'NONE',
      cacheHits: 0,
      cacheMisses: 0,
    },
    ...overrides,
  }
}

describe('chat routes', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockPipeline: Pipeline
  let router: ReturnType<typeof createChatRouter>

  beforeEach(() => {
    vi.clearAllMocks()

    mockReq = {
      body: createValidBody(),
      headers: {},
      user: createAuthUser(),
    }

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      headersSent: false,
    }

    mockPipeline = {
      preflight: vi.fn().mockResolvedValue({
        ok: true,
        value: createMockPreflightResult(),
      }),
      postProcess: vi.fn().mockResolvedValue(undefined),
      getDeps: vi.fn().mockReturnValue({
        memoryToolAccess: 'off',
        crisisHandler: {
          handle: vi.fn().mockResolvedValue({ ok: true, value: {} }),
        },
      }),
    } as unknown as Pipeline

    const mockLoadUserData = vi.fn().mockResolvedValue({
      userId: 'user-456',
      email: 'test@example.com',
      displayName: 'Test User',
      profile: null,
    })

    router = createChatRouter({ pipeline: mockPipeline, loadUserData: mockLoadUserData })
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
    it('returns 400 if messages is missing', async () => {
      mockReq.body = { ...createValidBody(), messages: undefined }
      delete mockReq.body.messages

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Bad Request',
      }))
    })

    it('returns 400 if messages is empty array', async () => {
      mockReq.body = createValidBody({ messages: [] })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Bad Request',
      }))
    })

    it('returns 400 if no user message found in messages', async () => {
      mockReq.body = createValidBody({
        messages: [
          { role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }], id: 'msg-1' }
        ]
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'No user message found in messages array',
      })
    })

    it('calls pipeline.preflight with correct input', async () => {
      mockReq.body = createValidBody({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'Hello Sky' }], id: 'msg-1' }
        ]
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockPipeline.preflight).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Hello Sky',
          userId: 'user-456',
        }),
        expect.objectContaining({
          userId: 'user-456',
        })
      )
    })

    it('extracts text from last user message parts', async () => {
      mockReq.body = createValidBody({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'First message' }], id: 'msg-1' },
          { role: 'assistant', parts: [{ type: 'text', text: 'Response' }], id: 'msg-2' },
          { role: 'user', parts: [{ type: 'text', text: 'Second message' }], id: 'msg-3' },
        ]
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockPipeline.preflight).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Second message',
        }),
        expect.anything()
      )
    })

    it('uses userId from authenticated JWT user', async () => {
      mockReq.user = createAuthUser({ id: 'jwt-user-123' })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockPipeline.preflight).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'jwt-user-123',
        }),
        expect.objectContaining({
          userId: 'jwt-user-123',
        })
      )
    })

    it('falls back to content field when parts is not available', async () => {
      mockReq.body = createValidBody({
        messages: [
          { role: 'user', content: 'Fallback content', id: 'msg-1' }
        ]
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockPipeline.preflight).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Fallback content',
        }),
        expect.anything()
      )
    })

    it('returns 500 when preflight fails', async () => {
      ;(mockPipeline.preflight as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: { kind: 'CrisisError', message: 'Crisis check failed' },
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Processing Error',
      }))
    })

    it('handles emergency crisis by calling crisis handler', async () => {
      const mockCrisisHandler = {
        handle: vi.fn().mockResolvedValue({ ok: true, value: { prependMessage: 'Emergency resources' } }),
      }
      ;(mockPipeline.getDeps as ReturnType<typeof vi.fn>).mockReturnValue({
        memoryToolAccess: 'off',
        crisisHandler: mockCrisisHandler,
      })
      ;(mockPipeline.preflight as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: createMockPreflightResult({
          crisisCheck: createMockCrisisCheck({
            level: 9,
            triggerEmergency: true,
          }),
        }),
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockCrisisHandler.handle).toHaveBeenCalled()
    })

    it('returns 500 JSON on unexpected exceptions', async () => {
      ;(mockPipeline.preflight as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      const handler = getHandler('post', '/')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      })
    })
  })

  describe('GET /health', () => {
    it('returns health status', async () => {
      const handler = getHandler('get', '/health')
      await handler(mockReq as Request, mockRes as Response)

      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'healthy',
        timestamp: expect.any(String),
      })
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
          method: layer.route.methods.post ? 'POST' : layer.route.methods.get ? 'GET' : 'UNKNOWN',
        }))

      expect(routes).toContainEqual({ path: '/', method: 'POST' })
    })

    it('registers GET /health route', () => {
      const routes = router.stack
        .filter((layer: { route?: { path: string; methods: Record<string, boolean> } }) => layer.route)
        .map((layer: { route: { path: string; methods: Record<string, boolean> } }) => ({
          path: layer.route.path,
          method: layer.route.methods.get ? 'GET' : 'UNKNOWN',
        }))

      expect(routes).toContainEqual({ path: '/health', method: 'GET' })
    })
  })
})
