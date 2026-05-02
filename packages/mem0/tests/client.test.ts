/**
 * Unit tests for Mem0 HTTP Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Mem0HttpClient,
  Mem0ApiError,
  createMem0Client,
  getMem0Client,
  closeMem0Client,
} from '../src/client.js'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock the observability module
vi.mock('@siri/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('Mem0ApiError', () => {
  it('should create error with status, body, and path', () => {
    const error = new Mem0ApiError(404, 'Not found', '/memories/123')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('Mem0ApiError')
    expect(error.status).toBe(404)
    expect(error.body).toBe('Not found')
    expect(error.path).toBe('/memories/123')
    expect(error.message).toBe('Mem0 API error (404): Not found')
  })
})

describe('Mem0HttpClient', () => {
  let client: Mem0HttpClient

  beforeEach(() => {
    mockFetch.mockReset()
    client = new Mem0HttpClient({ url: 'http://localhost:8000', timeout: 30000 })
  })

  describe('GET requests', () => {
    it('should make GET request with query params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await client.request('GET', '/memories', {
        params: { user_id: 'user-123', agent_id: 'agent-1' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memories?user_id=user-123&agent_id=agent-1',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should filter out undefined params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await client.request('GET', '/memories', {
        params: { user_id: 'user-123', agent_id: undefined },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memories?user_id=user-123',
        expect.any(Object)
      )
    })

    it('should parse JSON response', async () => {
      const responseData = { results: [{ id: '1', memory: 'test' }] }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseData),
      })

      const result = await client.request('GET', '/memories')

      expect(result).toEqual(responseData)
    })
  })

  describe('POST requests', () => {
    it('should make POST request with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        user_id: 'user-123',
      }

      await client.request('POST', '/memories', { body })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memories',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
    })
  })

  describe('PUT requests', () => {
    it('should make PUT request with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: '123', memory: 'updated' }),
      })

      await client.request('PUT', '/memories/123', {
        body: { data: 'updated content' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memories/123',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ data: 'updated content' }),
        })
      )
    })
  })

  describe('DELETE requests', () => {
    it('should make DELETE request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await client.request('DELETE', '/memories/123')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memories/123',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should make DELETE request with query params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await client.request('DELETE', '/memories', {
        params: { user_id: 'user-123' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memories?user_id=user-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('Error handling', () => {
    it('should throw Mem0ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('{"detail": "Not found"}'),
      })

      await expect(client.request('GET', '/memories/nonexistent')).rejects.toThrow(Mem0ApiError)
    })

    it('should include status and body in error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('{"detail": "Validation error"}'),
      })

      try {
        await client.request('POST', '/memories', { body: {} })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Mem0ApiError)
        if (error instanceof Mem0ApiError) {
          expect(error.status).toBe(422)
          expect(error.body).toContain('Validation error')
          expect(error.path).toBe('/memories')
        }
      }
    })

    it('should propagate network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(client.request('GET', '/health')).rejects.toThrow('Network error')
    })

    it('should propagate connection refused errors', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(client.request('GET', '/health')).rejects.toThrow('ECONNREFUSED')
    })
  })

  describe('API Key', () => {
    it('should include Authorization header when apiKey provided', async () => {
      const clientWithKey = new Mem0HttpClient({
        url: 'http://localhost:8000',
        timeout: 30000,
        apiKey: 'secret-key',
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await clientWithKey.request('GET', '/health')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-key',
          },
        })
      )
    })
  })
})

describe('Client Factory', () => {
  beforeEach(() => {
    closeMem0Client()
  })

  afterEach(() => {
    closeMem0Client()
  })

  it('should create client with default config', () => {
    const client = createMem0Client()

    expect(client).toBeInstanceOf(Mem0HttpClient)
  })

  it('should create client with custom URL', () => {
    const client = createMem0Client({ url: 'http://custom:9000' })

    expect(client).toBeInstanceOf(Mem0HttpClient)
  })

  it('should return singleton from getMem0Client', () => {
    const client1 = createMem0Client()
    const client2 = getMem0Client()

    expect(client2).toBe(client1)
  })

  it('should auto-create client if getMem0Client called before create', () => {
    const client = getMem0Client()
    expect(client).toBeInstanceOf(Mem0HttpClient)
  })

  it('should allow re-creation after close', () => {
    const client1 = createMem0Client()
    closeMem0Client()
    const client2 = createMem0Client()

    expect(client2).not.toBe(client1)
  })
})
