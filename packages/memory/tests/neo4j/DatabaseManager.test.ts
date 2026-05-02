import { describe, it, expect, vi, beforeEach } from "vitest"
import { DatabaseManager } from "../../src/neo4j/DatabaseManager.js"
import { SessionFactory } from "../../src/neo4j/SessionFactory.js"
import type { Session } from "neo4j-driver"

// Mock observability
vi.mock("@siri/observability", () => ({
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

describe("DatabaseManager", () => {
  let mockSessionFactory: SessionFactory
  let mockSession: Session

  beforeEach(() => {
    vi.clearAllMocks()

    mockSession = {
      run: vi.fn().mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Session

    mockSessionFactory = {
      createSession: vi.fn().mockReturnValue(mockSession),
      createSystemSession: vi.fn().mockReturnValue(mockSession),
      withSession: vi.fn().mockImplementation(async (op) => {
        const session = mockSession
        try {
          return await op(session)
        } finally {
          await session.close()
        }
      }),
      withSystemSession: vi.fn().mockImplementation(async (op) => {
        const session = mockSession
        try {
          return await op(session)
        } finally {
          await session.close()
        }
      }),
      getDefaultDatabase: vi.fn().mockReturnValue("neo4j"),
    } as unknown as SessionFactory
  })

  describe("constructor", () => {
    it("should use default database", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.getCurrentDatabase()).toBe("neo4j")
    })

    it("should use specified default database", () => {
      const manager = new DatabaseManager(mockSessionFactory, "custom")
      expect(manager.getCurrentDatabase()).toBe("custom")
    })
  })

  describe("normalizeDatabaseName", () => {
    it("should convert to lowercase", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("MyDatabase")).toBe("mydatabase")
    })

    it("should replace spaces with hyphens", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("my database")).toBe("my-database")
    })

    it("should remove invalid characters", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("user@email.com")).toBe(
        "useremailcom"
      )
    })

    it("should remove leading hyphens", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("---test")).toBe("test")
    })

    it("should remove trailing hyphens", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("test---")).toBe("test")
    })

    it("should prefix numeric names with u", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("12345")).toBe("u12345")
    })

    it("should collapse multiple hyphens", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("a---b")).toBe("a-b")
    })

    it("should truncate to 63 characters", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      const longName = "a".repeat(100)
      const result = manager.normalizeDatabaseName(longName)
      expect(result.length).toBeLessThanOrEqual(63)
    })

    it("should handle empty input", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("")).toBe("default")
    })

    it("should handle only invalid characters", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("@#$%")).toBe("default")
    })

    it("should handle complex email-like names", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.normalizeDatabaseName("User.Name+tag@Example.COM")).toBe(
        "usernametagexamplecom"
      )
    })
  })

  describe("isValidDatabaseName", () => {
    it("should accept valid simple names", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("neo4j")).toBe(true)
      expect(manager.isValidDatabaseName("my-database")).toBe(true)
      expect(manager.isValidDatabaseName("db1")).toBe(true)
    })

    it("should accept single character names", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("a")).toBe(true)
      expect(manager.isValidDatabaseName("1")).toBe(true)
    })

    it("should reject names starting with hyphen", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("-test")).toBe(false)
    })

    it("should reject names ending with hyphen", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("test-")).toBe(false)
    })

    it("should reject empty names", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("")).toBe(false)
    })

    it("should reject names with uppercase", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("MyDatabase")).toBe(false)
    })

    it("should reject names with invalid characters", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("my_database")).toBe(false)
      expect(manager.isValidDatabaseName("my.database")).toBe(false)
    })

    it("should reject names over 63 characters", () => {
      const manager = new DatabaseManager(mockSessionFactory)
      expect(manager.isValidDatabaseName("a".repeat(64))).toBe(false)
    })
  })

  describe("databaseExists", () => {
    it("should return true when database exists", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [{ get: () => "mydb" }],
      })

      const exists = await manager.databaseExists("mydb")
      expect(exists).toBe(true)
    })

    it("should return false when database does not exist", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [],
      })

      const exists = await manager.databaseExists("nonexistent")
      expect(exists).toBe(false)
    })

    it("should return true on error (graceful fallback)", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Permission denied")
      )

      const exists = await manager.databaseExists("mydb")
      expect(exists).toBe(true)
    })

    it("should use system session", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      await manager.databaseExists("test")

      expect(mockSessionFactory.withSystemSession).toHaveBeenCalled()
    })
  })

  describe("createDatabase", () => {
    it("should run CREATE DATABASE command", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      await manager.createDatabase("newdb")

      expect(mockSession.run).toHaveBeenCalledWith(
        "CREATE DATABASE $name IF NOT EXISTS",
        { name: "newdb" }
      )
    })

    it("should use system session", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      await manager.createDatabase("newdb")

      expect(mockSessionFactory.withSystemSession).toHaveBeenCalled()
    })

    it("should not throw on permission error (graceful)", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Insufficient privileges")
      )

      // Should not throw
      await expect(manager.createDatabase("newdb")).resolves.not.toThrow()
    })
  })

  describe("switchDatabase", () => {
    it("should return early if already in target database", async () => {
      const manager = new DatabaseManager(mockSessionFactory, "current")

      const result = await manager.switchDatabase("current")

      expect(result).toEqual({
        previousDatabase: "current",
        currentDatabase: "current",
        created: false,
      })
      expect(mockSessionFactory.withSystemSession).not.toHaveBeenCalled()
    })

    it("should check existence and create if needed", async () => {
      const manager = new DatabaseManager(mockSessionFactory, "old")

      // Database does not exist
      ;(mockSession.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ records: [] }) // databaseExists returns false
        .mockResolvedValueOnce({}) // createDatabase succeeds

      const result = await manager.switchDatabase("newdb")

      expect(result).toEqual({
        previousDatabase: "old",
        currentDatabase: "newdb",
        created: true,
      })
      expect(manager.getCurrentDatabase()).toBe("newdb")
    })

    it("should not create if database exists", async () => {
      const manager = new DatabaseManager(mockSessionFactory, "old")

      // Database exists
      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [{ get: () => "existing" }],
      })

      const result = await manager.switchDatabase("existing")

      expect(result).toEqual({
        previousDatabase: "old",
        currentDatabase: "existing",
        created: false,
      })
    })

    it("should normalize database name", async () => {
      const manager = new DatabaseManager(mockSessionFactory, "old")

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [{ get: () => "user123" }],
      })

      const result = await manager.switchDatabase("User@123")

      expect(result.currentDatabase).toBe("user123")
    })

    it("should throw on invalid normalized name", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      // This creates a name that ends with hyphen after normalization
      // which is invalid - let's use a case that produces invalid output
      // Actually normalizeDatabaseName handles most cases, so let's mock isValidDatabaseName
      const originalIsValid = manager.isValidDatabaseName.bind(manager)
      manager.isValidDatabaseName = vi.fn().mockReturnValue(false)

      await expect(manager.switchDatabase("test")).rejects.toThrow(
        "Invalid database name"
      )

      manager.isValidDatabaseName = originalIsValid
    })
  })

  describe("ensureDatabase", () => {
    it("should create database if not exists", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ records: [] }) // databaseExists returns false
        .mockResolvedValueOnce({}) // createDatabase succeeds

      const result = await manager.ensureDatabase("newdb")

      expect(result).toBe("newdb")
    })

    it("should not create database if exists", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [{}],
      })

      const result = await manager.ensureDatabase("existing")

      expect(result).toBe("existing")
      // Only one call (databaseExists), not two (no createDatabase)
      expect(mockSession.run).toHaveBeenCalledTimes(1)
    })

    it("should not change current database", async () => {
      const manager = new DatabaseManager(mockSessionFactory, "current")

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [{}],
      })

      await manager.ensureDatabase("other")

      expect(manager.getCurrentDatabase()).toBe("current")
    })

    it("should return normalized name", async () => {
      const manager = new DatabaseManager(mockSessionFactory)

      ;(mockSession.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        records: [{}],
      })

      const result = await manager.ensureDatabase("User@Email.com")

      expect(result).toBe("useremailcom")
    })
  })
})
