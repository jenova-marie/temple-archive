import { describe, it, expect, vi, beforeEach } from "vitest"
import { SessionFactory } from "../../src/neo4j/SessionFactory.js"
import type { Driver, Session } from "neo4j-driver"

// Mock observability
vi.mock("@pippa/observability", () => ({
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

describe("SessionFactory", () => {
  let mockDriver: Driver
  let mockSession: Session

  beforeEach(() => {
    vi.clearAllMocks()

    mockSession = {
      run: vi.fn().mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Session

    mockDriver = {
      session: vi.fn().mockReturnValue(mockSession),
    } as unknown as Driver
  })

  describe("constructor", () => {
    it("should use default database when not specified", () => {
      const factory = new SessionFactory(mockDriver)
      expect(factory.getDefaultDatabase()).toBe("neo4j")
    })

    it("should use specified default database", () => {
      const factory = new SessionFactory(mockDriver, "custom-db")
      expect(factory.getDefaultDatabase()).toBe("custom-db")
    })
  })

  describe("createSession", () => {
    it("should create session with default database", () => {
      const factory = new SessionFactory(mockDriver, "my-database")
      factory.createSession()

      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "my-database",
      })
    })

    it("should create session with specified database", () => {
      const factory = new SessionFactory(mockDriver, "default-db")
      factory.createSession("other-db")

      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "other-db",
      })
    })

    it("should return the session from driver", () => {
      const factory = new SessionFactory(mockDriver)
      const session = factory.createSession()

      expect(session).toBe(mockSession)
    })
  })

  describe("createSystemSession", () => {
    it("should create session targeting system database", () => {
      const factory = new SessionFactory(mockDriver, "user-db")
      factory.createSystemSession()

      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "system",
      })
    })
  })

  describe("withSession", () => {
    it("should execute operation and close session", async () => {
      const factory = new SessionFactory(mockDriver)
      const operation = vi.fn().mockResolvedValue("result")

      const result = await factory.withSession(operation)

      expect(operation).toHaveBeenCalledWith(mockSession)
      expect(mockSession.close).toHaveBeenCalled()
      expect(result).toBe("result")
    })

    it("should close session even on error", async () => {
      const factory = new SessionFactory(mockDriver)
      const error = new Error("Operation failed")
      const operation = vi.fn().mockRejectedValue(error)

      await expect(factory.withSession(operation)).rejects.toThrow(
        "Operation failed"
      )
      expect(mockSession.close).toHaveBeenCalled()
    })

    it("should use specified database", async () => {
      const factory = new SessionFactory(mockDriver, "default")
      const operation = vi.fn().mockResolvedValue("ok")

      await factory.withSession(operation, "specific-db")

      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "specific-db",
      })
    })
  })

  describe("withSystemSession", () => {
    it("should execute operation on system database", async () => {
      const factory = new SessionFactory(mockDriver)
      const operation = vi.fn().mockResolvedValue("system-result")

      const result = await factory.withSystemSession(operation)

      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "system",
      })
      expect(operation).toHaveBeenCalledWith(mockSession)
      expect(result).toBe("system-result")
    })

    it("should close session even on error", async () => {
      const factory = new SessionFactory(mockDriver)
      const error = new Error("System operation failed")
      const operation = vi.fn().mockRejectedValue(error)

      await expect(factory.withSystemSession(operation)).rejects.toThrow(
        "System operation failed"
      )
      expect(mockSession.close).toHaveBeenCalled()
    })
  })
})
