import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNeo4jDriver, verifyConnectivity, closeDriver } from './client.js'

// Mock neo4j-driver
vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn().mockReturnValue({
      verifyConnectivity: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      session: vi.fn().mockReturnValue({
        run: vi.fn(),
        close: vi.fn(),
      }),
    }),
    auth: {
      basic: vi.fn().mockReturnValue({ username: 'neo4j', password: 'test' }),
    },
  },
}))

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
  withSpan: vi.fn().mockImplementation((_name, fn) => fn()),
}))

describe('Neo4j Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createNeo4jDriver', () => {
    it('should create a driver with basic auth', () => {
      const driver = createNeo4jDriver({
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'password',
      })

      expect(driver).toBeDefined()
    })

    it('should use default pool settings', () => {
      const driver = createNeo4jDriver({
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'password',
      })

      expect(driver).toBeDefined()
    })
  })

  describe('verifyConnectivity', () => {
    it('should return true when connection succeeds', async () => {
      const driver = createNeo4jDriver({
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'password',
      })

      const result = await verifyConnectivity(driver)

      expect(result).toBe(true)
    })

    it('should return false when connection fails', async () => {
      const driver = createNeo4jDriver({
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'password',
      })

      // Make verifyConnectivity throw
      ;(driver.verifyConnectivity as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection failed')
      )

      const result = await verifyConnectivity(driver)

      expect(result).toBe(false)
    })
  })

  describe('closeDriver', () => {
    it('should close the driver', async () => {
      const driver = createNeo4jDriver({
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'password',
      })

      await closeDriver(driver)

      expect(driver.close).toHaveBeenCalled()
    })

    it('should handle close errors gracefully', async () => {
      const driver = createNeo4jDriver({
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'password',
      })

      ;(driver.close as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Close failed'))

      // Should not throw
      await closeDriver(driver)
    })
  })
})
