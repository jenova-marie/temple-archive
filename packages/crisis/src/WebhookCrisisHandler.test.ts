import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { WebhookCrisisHandler } from './WebhookCrisisHandler.js'
import type { CrisisCheckResult, CrisisLevel } from '@recoverysky/types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: 'span-123',
  traceId: 'trace-123',
})

const createCrisisResult = (level: CrisisLevel): CrisisCheckResult => ({
  level,
  patterns: [
    {
      type: 'suicidal_ideation',
      confidence: 0.9,
      matchedText: 'want to end it all',
    },
  ],
  triggerEmergency: level >= 9,
  action: level >= 9 ? 'emergency_protocol' : level >= 7 ? 'inject_resources' : 'monitor',
  processingTimeMs: 5,
})

describe('WebhookCrisisHandler', () => {
  let handler: WebhookCrisisHandler

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    handler = new WebhookCrisisHandler({
      webhookUrl: 'https://example.com/crisis-webhook',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should throw if webhookUrl is not provided', () => {
      expect(() => {
        new WebhookCrisisHandler({ webhookUrl: '' })
      }).toThrow('webhookUrl is required')
    })

    it('should accept valid configuration', () => {
      const h = new WebhookCrisisHandler({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret123',
        minLevelToAlert: 8,
        timeoutMs: 10000,
        retries: 3,
      })
      expect(h).toBeDefined()
    })
  })

  describe('handle', () => {
    it('should provide emergency resources for level 9+', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const ctx = createTraceContext()
      const result = await handler.handle(
        createCrisisResult(9),
        'user-123',
        'conv-456',
        ctx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.prependMessage).toContain('safety is the most important')
        expect(result.value.resources).toBeDefined()
        expect(result.value.resources!.length).toBeGreaterThan(0)
        expect(result.value.actionsTaken).toContain('emergency_resources_provided')
        expect(result.value.teamAlerted).toBe(true)
      }
    })

    it('should provide recovery resources for level 7-8', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const ctx = createTraceContext()
      const result = await handler.handle(
        createCrisisResult(7),
        'user-123',
        'conv-456',
        ctx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.prependMessage).toContain('struggling')
        expect(result.value.resources).toBeDefined()
        expect(result.value.actionsTaken).toContain('resources_injected')
        expect(result.value.teamAlerted).toBe(true)
      }
    })

    it('should flag for review for level 4-6', async () => {
      const ctx = createTraceContext()
      const result = await handler.handle(
        createCrisisResult(5),
        'user-123',
        'conv-456',
        ctx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.prependMessage).toBeUndefined()
        expect(result.value.resources).toBeUndefined()
        expect(result.value.actionsTaken).toContain('flagged_for_review')
        expect(result.value.teamAlerted).toBe(false) // Level 5 < default minLevelToAlert (7)
      }
    })

    it('should not alert for levels below threshold', async () => {
      const ctx = createTraceContext()
      const result = await handler.handle(
        createCrisisResult(3),
        'user-123',
        'conv-456',
        ctx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.teamAlerted).toBe(false)
        expect(result.value.actionsTaken).not.toContain('webhook_triggered')
      }

      // Webhook should not be called
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should send webhook with correct payload', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const ctx = createTraceContext()
      const crisisResult = createCrisisResult(8)

      await handler.handle(crisisResult, 'user-123', 'conv-456', ctx)

      // Wait for async webhook to fire
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/crisis-webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        })
      )

      // Verify payload structure
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body).toMatchObject({
        userId: 'user-123',
        conversationId: 'conv-456',
        crisisLevel: 8,
        action: 'inject_resources',
        requestId: ctx.requestId,
      })
      expect(body.timestamp).toBeDefined()
      expect(body.patterns).toHaveLength(1)
    })

    it('should include HMAC signature when secret is provided', async () => {
      const secret = 'my-webhook-secret'
      const secureHandler = new WebhookCrisisHandler({
        webhookUrl: 'https://example.com/crisis-webhook',
        webhookSecret: secret,
      })

      mockFetch.mockResolvedValue({ ok: true })

      const ctx = createTraceContext()
      await secureHandler.handle(createCrisisResult(8), 'user-123', 'conv-456', ctx)

      // Wait for async webhook to fire
      await vi.runAllTimersAsync()

      const callArgs = mockFetch.mock.calls[0]
      const headers = callArgs[1].headers
      const body = callArgs[1].body

      // Verify signature header exists
      expect(headers['X-Crisis-Signature']).toBeDefined()

      // Verify signature is correct
      const expectedSignature = createHmac('sha256', secret).update(body).digest('hex')
      expect(headers['X-Crisis-Signature']).toBe(`sha256=${expectedSignature}`)
    })

    it('should respect custom minLevelToAlert', async () => {
      const customHandler = new WebhookCrisisHandler({
        webhookUrl: 'https://example.com/crisis-webhook',
        minLevelToAlert: 9,
      })

      mockFetch.mockResolvedValue({ ok: true })

      const ctx = createTraceContext()
      const result = await customHandler.handle(
        createCrisisResult(8),
        'user-123',
        'conv-456',
        ctx
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.teamAlerted).toBe(false)
      }

      // Webhook should not be called for level 8 when threshold is 9
      await vi.runAllTimersAsync()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should retry on webhook failure', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true })

      const ctx = createTraceContext()
      await handler.handle(createCrisisResult(8), 'user-123', 'conv-456', ctx)

      // Wait for all retries
      await vi.runAllTimersAsync()

      // Should have called 3 times (initial + 2 retries)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should handle webhook network errors with retry', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true })

      const ctx = createTraceContext()
      await handler.handle(createCrisisResult(8), 'user-123', 'conv-456', ctx)

      // Wait for retries
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not block response on webhook failure', async () => {
      // Make webhook hang
      mockFetch.mockImplementation(() => new Promise(() => {}))

      const ctx = createTraceContext()
      const startTime = Date.now()

      const result = await handler.handle(createCrisisResult(8), 'user-123', 'conv-456', ctx)

      const duration = Date.now() - startTime

      // Handle should return immediately, not wait for webhook
      expect(result.ok).toBe(true)
      expect(duration).toBeLessThan(100) // Should be near-instant

      if (result.ok) {
        expect(result.value.teamAlerted).toBe(true)
        expect(result.value.actionsTaken).toContain('webhook_triggered')
      }
    })

    it('should include all patterns in webhook payload', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const crisisResult: CrisisCheckResult = {
        level: 9,
        patterns: [
          { type: 'suicidal_ideation', confidence: 0.9, matchedText: 'end it all' },
          { type: 'hopelessness', confidence: 0.8, matchedText: 'no hope' },
          { type: 'isolation', confidence: 0.7, matchedText: 'all alone' },
        ],
        triggerEmergency: true,
        action: 'emergency_protocol',
        processingTimeMs: 3,
      }

      const ctx = createTraceContext()
      await handler.handle(crisisResult, 'user-123', 'conv-456', ctx)

      await vi.runAllTimersAsync()

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.patterns).toHaveLength(3)
      expect(body.patterns[0].type).toBe('suicidal_ideation')
      expect(body.patterns[1].type).toBe('hopelessness')
      expect(body.patterns[2].type).toBe('isolation')
    })
  })
})
