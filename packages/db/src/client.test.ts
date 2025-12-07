import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pg Pool - must be hoisted
vi.mock('pg', () => {
  const mockEnd = vi.fn()
  return {
    default: {
      Pool: vi.fn().mockImplementation((config) => ({
        _config: config,
        end: mockEnd,
      })),
    },
    mockEnd,
  }
})

// Mock drizzle
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({ _drizzle: true }),
}))

// Mock schema
vi.mock('./schema/index.js', () => ({
  users: {},
  conversations: {},
  messages: {},
}))

// Import after mocks
import {
  createDatabaseClient,
  getDatabaseClient,
  closeDatabaseClient,
} from './client.js'
import pg from 'pg'

describe('db/client', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset singleton
    await closeDatabaseClient().catch(() => {})
  })

  afterEach(async () => {
    await closeDatabaseClient().catch(() => {})
  })

  describe('createDatabaseClient', () => {
    it('creates client with connection string', async () => {
      // Reset first
      await closeDatabaseClient().catch(() => {})

      const client = createDatabaseClient({
        connectionString: 'postgresql://user:pass@localhost:5432/db',
      })

      expect(client).toBeDefined()
    })

    it('creates client with individual config options', async () => {
      await closeDatabaseClient().catch(() => {})

      const client = createDatabaseClient({
        host: 'localhost',
        port: 5432,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb',
      })

      expect(client).toBeDefined()
    })

    it('uses default max connections of 10', async () => {
      await closeDatabaseClient().catch(() => {})

      createDatabaseClient({
        connectionString: 'postgresql://localhost/db',
      })

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          max: 10,
        })
      )
    })

    it('uses custom max connections', async () => {
      await closeDatabaseClient().catch(() => {})

      createDatabaseClient({
        connectionString: 'postgresql://localhost/db',
        max: 20,
      })

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          max: 20,
        })
      )
    })

    it('supports SSL configuration', async () => {
      await closeDatabaseClient().catch(() => {})

      createDatabaseClient({
        connectionString: 'postgresql://localhost/db',
        ssl: { rejectUnauthorized: false },
      })

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
        })
      )
    })

    it('returns same instance on subsequent calls', async () => {
      await closeDatabaseClient().catch(() => {})

      const client1 = createDatabaseClient({
        connectionString: 'postgresql://localhost/db',
      })
      const client2 = createDatabaseClient({
        connectionString: 'postgresql://other/db',
      })

      expect(client1).toBe(client2)
    })
  })

  describe('getDatabaseClient', () => {
    it('throws error if not initialized', async () => {
      await closeDatabaseClient().catch(() => {})

      expect(() => getDatabaseClient()).toThrow(
        'Database client not initialized'
      )
    })

    it('returns client after initialization', async () => {
      await closeDatabaseClient().catch(() => {})

      createDatabaseClient({
        connectionString: 'postgresql://localhost/db',
      })

      const client = getDatabaseClient()

      expect(client).toBeDefined()
    })
  })

  describe('closeDatabaseClient', () => {
    it('can be called when no client exists', async () => {
      // Force reset
      await closeDatabaseClient().catch(() => {})
      await closeDatabaseClient()

      // Should not throw
      expect(true).toBe(true)
    })
  })
})
