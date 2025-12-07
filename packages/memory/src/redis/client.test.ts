import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createRedisClient,
  getRedisClient,
  closeRedisClient,
  checkRedisHealth,
} from './client.js'

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

// Store event handlers for testing
const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}

// Mock Redis client
const mockPing = vi.fn()
const mockQuit = vi.fn()
vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation((url, options) => {
    const instance = {
      _url: url,
      _options: options,
      ping: mockPing,
      quit: mockQuit,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!eventHandlers[event]) {
          eventHandlers[event] = []
        }
        eventHandlers[event].push(handler)
        return instance
      }),
    }
    return instance
  }),
}))

describe('redis/client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear event handlers
    Object.keys(eventHandlers).forEach(key => delete eventHandlers[key])
    // Clear env vars
    delete process.env.REDIS_URL
    delete process.env.REDIS_PASSWORD
    delete process.env.REDIS_USERNAME
    delete process.env.REDIS_DB
    delete process.env.REDIS_TLS
  })

  afterEach(async () => {
    // Reset the singleton
    mockQuit.mockResolvedValue('OK')
    await closeRedisClient()
  })

  describe('createRedisClient', () => {
    it('creates client with default URL', () => {
      const client = createRedisClient()

      expect(client).toBeDefined()
      expect((client as { _url: string })._url).toBe('redis://localhost:6379')
    })

    it('creates client with custom URL', () => {
      const client = createRedisClient({ url: 'redis://custom-host:6380' })

      expect((client as { _url: string })._url).toBe('redis://custom-host:6380')
    })

    it('uses REDIS_URL environment variable', () => {
      process.env.REDIS_URL = 'redis://env-host:6379'

      const client = createRedisClient()

      expect((client as { _url: string })._url).toBe('redis://env-host:6379')
    })

    it('config URL takes precedence over env var', () => {
      process.env.REDIS_URL = 'redis://env-host:6379'

      const client = createRedisClient({ url: 'redis://config-host:6379' })

      expect((client as { _url: string })._url).toBe('redis://config-host:6379')
    })

    it('creates client with password', () => {
      const client = createRedisClient({ password: 'secret123' })

      expect((client as { _options: { password: string } })._options.password).toBe('secret123')
    })

    it('uses REDIS_PASSWORD environment variable', () => {
      process.env.REDIS_PASSWORD = 'env-secret'

      const client = createRedisClient()

      expect((client as { _options: { password: string } })._options.password).toBe('env-secret')
    })

    it('creates client with username', () => {
      const client = createRedisClient({ username: 'myuser' })

      expect((client as { _options: { username: string } })._options.username).toBe('myuser')
    })

    it('uses REDIS_USERNAME environment variable', () => {
      process.env.REDIS_USERNAME = 'env-user'

      const client = createRedisClient()

      expect((client as { _options: { username: string } })._options.username).toBe('env-user')
    })

    it('creates client with database number', () => {
      const client = createRedisClient({ db: 5 })

      expect((client as { _options: { db: number } })._options.db).toBe(5)
    })

    it('uses REDIS_DB environment variable', () => {
      process.env.REDIS_DB = '3'

      const client = createRedisClient()

      expect((client as { _options: { db: number } })._options.db).toBe(3)
    })

    it('creates client with TLS enabled', () => {
      const client = createRedisClient({ tls: true })

      expect((client as { _options: { tls: object } })._options.tls).toEqual({})
    })

    it('uses REDIS_TLS environment variable', () => {
      process.env.REDIS_TLS = 'true'

      const client = createRedisClient()

      expect((client as { _options: { tls: object } })._options.tls).toEqual({})
    })

    it('uses default command timeout of 5000ms', () => {
      const client = createRedisClient()

      expect((client as { _options: { commandTimeout: number } })._options.commandTimeout).toBe(5000)
    })

    it('uses custom command timeout', () => {
      const client = createRedisClient({ commandTimeout: 10000 })

      expect((client as { _options: { commandTimeout: number } })._options.commandTimeout).toBe(10000)
    })

    it('uses default maxRetriesPerRequest of 3', () => {
      const client = createRedisClient()

      expect((client as { _options: { maxRetriesPerRequest: number } })._options.maxRetriesPerRequest).toBe(3)
    })

    it('registers event handlers', () => {
      createRedisClient()

      expect(eventHandlers['connect']).toBeDefined()
      expect(eventHandlers['ready']).toBeDefined()
      expect(eventHandlers['error']).toBeDefined()
      expect(eventHandlers['close']).toBeDefined()
      expect(eventHandlers['reconnecting']).toBeDefined()
    })
  })

  describe('getRedisClient', () => {
    it('creates client on first call', () => {
      const client = getRedisClient()

      expect(client).toBeDefined()
    })

    it('returns same instance on subsequent calls', () => {
      const client1 = getRedisClient()
      const client2 = getRedisClient()

      expect(client1).toBe(client2)
    })

    it('accepts config on first call', () => {
      const client = getRedisClient({ url: 'redis://custom:6379' })

      expect((client as { _url: string })._url).toBe('redis://custom:6379')
    })
  })

  describe('closeRedisClient', () => {
    it('calls quit on the client', async () => {
      mockQuit.mockResolvedValue('OK')

      getRedisClient()
      await closeRedisClient()

      expect(mockQuit).toHaveBeenCalled()
    })

    it('clears the singleton client', async () => {
      mockQuit.mockResolvedValue('OK')

      const client1 = getRedisClient()
      await closeRedisClient()
      const client2 = getRedisClient()

      expect(client1).not.toBe(client2)
    })

    it('can be called when no client exists', async () => {
      await closeRedisClient()

      // Should not throw
      expect(mockQuit).not.toHaveBeenCalled()
    })
  })

  describe('checkRedisHealth', () => {
    it('returns true when Redis responds with PONG', async () => {
      mockPing.mockResolvedValue('PONG')

      const client = createRedisClient()
      const healthy = await checkRedisHealth(client)

      expect(healthy).toBe(true)
      expect(mockPing).toHaveBeenCalled()
    })

    it('returns false when Redis returns unexpected response', async () => {
      mockPing.mockResolvedValue('WRONG')

      const client = createRedisClient()
      const healthy = await checkRedisHealth(client)

      expect(healthy).toBe(false)
    })

    it('returns false when ping fails', async () => {
      mockPing.mockRejectedValue(new Error('Connection refused'))

      const client = createRedisClient()
      const healthy = await checkRedisHealth(client)

      expect(healthy).toBe(false)
    })

    it('returns false on timeout', async () => {
      mockPing.mockRejectedValue(new Error('Command timeout'))

      const client = createRedisClient()
      const healthy = await checkRedisHealth(client)

      expect(healthy).toBe(false)
    })
  })
})
