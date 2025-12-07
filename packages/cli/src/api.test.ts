import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock config module - use arrow functions that return values
vi.mock('./config.js', () => ({
  getApiUrl: () => 'http://localhost:3333',
  getUserId: () => 'test-user-id',
  getConversationId: () => 'test-conversation-id',
}))

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Import after mocks
import { sendMessage, checkHealth, getMetrics } from './api.js'

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('sendMessage', () => {
    it('sends message to correct endpoint', async () => {
      const mockResponse = {
        response: 'Hello! How can I help?',
        conversationId: 'test-conversation-id',
        messageId: 'msg-123',
        crisisLevel: 1,
        emergencyTriggered: false,
        metrics: {
          totalDuration: 100,
          memoryDuration: 10,
          agentDuration: 80,
          tokensUsed: { input: 50, output: 100 },
          memorySource: 'L1',
        },
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await sendMessage('Hello')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3333/api/chat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'Hello',
            conversationId: 'test-conversation-id',
            userId: 'test-user-id',
          }),
        }
      )

      expect(result).toEqual(mockResponse)
    })

    it('uses config values from config module', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'test' }),
      })

      await sendMessage('test')

      // Verify the fetch was called with the expected URL from config
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3333/api/chat',
        expect.anything()
      )
    })

    it('throws error on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({
          error: 'Bad Request',
          message: 'message is required',
          statusCode: 400,
        }),
      })

      await expect(sendMessage('')).rejects.toThrow('API Error (400): message is required')
    })

    it('handles JSON parse errors in error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Invalid JSON')),
      })

      await expect(sendMessage('test')).rejects.toThrow('API Error (500): Internal Server Error')
    })

    it('returns full ChatResponse structure', async () => {
      const fullResponse = {
        response: 'Response text',
        conversationId: 'conv-123',
        messageId: 'msg-456',
        crisisLevel: 5,
        emergencyTriggered: false,
        metrics: {
          totalDuration: 200,
          memoryDuration: 20,
          agentDuration: 150,
          tokensUsed: { input: 100, output: 200 },
          memorySource: 'L2',
        },
        safetyViolations: [],
        diagnostics: { timing: {} },
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fullResponse),
      })

      const result = await sendMessage('test')

      expect(result.diagnostics).toBeDefined()
      expect(result.safetyViolations).toEqual([])
    })
  })

  describe('checkHealth', () => {
    it('calls health endpoint', async () => {
      const mockHealth = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: 12345,
        version: '0.1.0',
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      })

      const result = await checkHealth()

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3333/health')
      expect(result).toEqual(mockHealth)
    })

    it('throws error on failed health check', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
      })

      await expect(checkHealth()).rejects.toThrow('Health check failed: Service Unavailable')
    })
  })

  describe('getMetrics', () => {
    it('calls metrics endpoint', async () => {
      const metricsText = '# HELP recoverysky_uptime_seconds Uptime in seconds\n# TYPE recoverysky_uptime_seconds gauge\nrecoverysky_uptime_seconds 12345'

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(metricsText),
      })

      const result = await getMetrics()

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3333/health/metrics')
      expect(result).toBe(metricsText)
    })

    it('throws error on failed metrics request', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      })

      await expect(getMetrics()).rejects.toThrow('Metrics request failed: Not Found')
    })
  })
})
