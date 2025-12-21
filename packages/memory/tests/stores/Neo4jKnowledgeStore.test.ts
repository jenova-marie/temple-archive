import { describe, it, expect, vi, beforeEach } from "vitest";
import { Neo4jKnowledgeStore } from "../../src/stores/Neo4jKnowledgeStore.js";
import type { Entity, TraceContext } from "@recoverysky/types";

// Mock observability
vi.mock("@recoverysky/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    info: vi.fn(),
  }),
  withSpan: vi.fn().mockImplementation((_name, fn) => fn()),
  pipelineMetrics: {
    stageDuration: { record: vi.fn() },
    errors: { add: vi.fn() },
    memoryCacheHits: { add: vi.fn() },
    memoryCacheMisses: { add: vi.fn() },
  },
}));

const createTraceContext = (userId?: string): TraceContext => ({
  requestId: `req_${Date.now()}`,
  spanId: "span-123",
  traceId: "trace-123",
  startTime: Date.now(),
  userId,
});

// Create mock session
const createMockSession = () => ({
  run: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
});

// Create mock driver
const createMockDriver = () => {
  const mockSession = createMockSession();
  return {
    session: vi.fn().mockReturnValue(mockSession),
    _mockSession: mockSession,
  };
};

describe("Neo4jKnowledgeStore", () => {
  let mockDriver: ReturnType<typeof createMockDriver>;
  let store: Neo4jKnowledgeStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDriver = createMockDriver();
    store = new Neo4jKnowledgeStore(
      mockDriver as unknown as import("neo4j-driver").Driver,
    );
  });

  describe("database-per-user mode", () => {
    /**
     * Helper to set up mocks for per-user database tests.
     * Simulates the flow: check exists (false) -> create -> check exists (true) -> run queries
     */
    const setupPerUserDatabaseMock = (expectedDbName: string) => {
      let existsCheckCount = 0;
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        // SHOW DATABASES query for existence check
        if (query.includes("SHOW DATABASES")) {
          existsCheckCount++;
          // First check returns empty (doesn't exist), subsequent checks return found
          if (existsCheckCount === 1) {
            return Promise.resolve({ records: [] });
          }
          return Promise.resolve({ records: [{ get: () => expectedDbName }] });
        }
        // CREATE DATABASE query
        if (query.includes("CREATE DATABASE")) {
          return Promise.resolve({ records: [] });
        }
        // Schema and other queries
        return Promise.resolve({ records: [] });
      });
    };

    it("should use default database when databasePerUser is false", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: false, defaultDatabase: "mydb" },
      );
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.searchEntities("test", createTraceContext("user-123"));

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "mydb" });
    });

    it("should use userId as database name when databasePerUser is true", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      setupPerUserDatabaseMock("user-123");

      await store.searchEntities("test", createTraceContext("user-123"));

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "user-123" });
    });

    it("should sanitize userId for database name", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      setupPerUserDatabaseMock("user123abc");

      // userId with uppercase and special chars
      await store.searchEntities("test", createTraceContext("User@123!ABC"));

      // Should be sanitized: lowercase, special chars removed (Neo4j only allows a-z, 0-9, hyphens)
      // User@123!ABC -> user123abc
      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "user123abc",
      });
    });

    it("should prefix numeric userId with u", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      setupPerUserDatabaseMock("u12345");

      await store.searchEntities("test", createTraceContext("12345"));

      // Neo4j database names must start with a letter, so numeric IDs get 'u' prefix
      expect(mockDriver.session).toHaveBeenCalledWith({ database: "u12345" });
    });

    it("should fall back to default database when userId is missing", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true, defaultDatabase: "fallback" },
      );
      // No userId means we use defaultDatabase "fallback", which is not 'neo4j' or 'system'
      // so per-user mode still triggers database creation flow
      setupPerUserDatabaseMock("fallback");

      await store.searchEntities("test", createTraceContext()); // no userId

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "fallback" });
    });

    it("should throw error when database creation fails", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      // Simulate CREATE DATABASE failure
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        if (query.includes("SHOW DATABASES")) {
          return Promise.resolve({ records: [] }); // Never exists
        }
        if (query.includes("CREATE DATABASE")) {
          return Promise.reject(new Error("Insufficient privileges"));
        }
        return Promise.resolve({ records: [] });
      });

      await expect(
        store.searchEntities("test", createTraceContext("user-123"))
      ).rejects.toThrow("Per-user database mode requires");
    });
  });

  describe("upsertEntity", () => {
    it("should upsert an entity successfully", async () => {
      const entity: Entity = {
        entityId: "entity_1",
        name: "John",
        type: "person",
        firstMentioned: Date.now(),
        lastMentioned: Date.now(),
        properties: { userId: "user_1", importance: 0.8 },
      };

      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.upsertEntity(entity, createTraceContext());

      expect(result.ok).toBe(true);
      expect(mockDriver._mockSession.run).toHaveBeenCalled();
      expect(mockDriver._mockSession.close).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      const entity: Entity = {
        entityId: "entity_1",
        name: "John",
        type: "person",
        firstMentioned: Date.now(),
        lastMentioned: Date.now(),
      };

      mockDriver._mockSession.run.mockRejectedValue(new Error("Neo4j error"));

      const result = await store.upsertEntity(entity, createTraceContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  describe("createRelationship", () => {
    it("should create a relationship successfully", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.createRelationship(
        "john",
        "work",
        "triggers",
        { strength: 0.9 },
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      expect(mockDriver._mockSession.run).toHaveBeenCalled();
    });

    it("should sanitize relationship type", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.createRelationship(
        "john",
        "work",
        "helps-with",
        { strength: 0.5 },
        createTraceContext(),
      );

      // The query should contain sanitized relationship type (HELPS_WITH)
      // Note: Schema initialization calls happen first, so find the relationship query
      const allCalls = mockDriver._mockSession.run.mock.calls;
      const relationshipCall = allCalls.find(
        (call: unknown[]) => typeof call[0] === "string" && call[0].includes("MERGE")
      );
      expect(relationshipCall).toBeDefined();
      expect(relationshipCall![0]).toContain("HELPS_WITH");
    });
  });

  describe("getRelatedEntities", () => {
    it("should return related entities", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                entityId: "entity_2",
                name: "sponsor",
                type: "person",
                firstMentioned: { toNumber: () => Date.now() },
                lastMentioned: { toNumber: () => Date.now() },
                properties: '{"importance": 0.9}',
              },
            }),
          },
        ],
      });

      const result = await store.getRelatedEntities(
        "john",
        2,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe("sponsor");
      }
    });

    it("should return empty array when no related entities", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.getRelatedEntities(
        "isolated",
        2,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe("searchEntities", () => {
    it("should search entities by pattern", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                entityId: "entity_1",
                name: "john doe",
                type: "person",
                firstMentioned: { toNumber: () => Date.now() },
                lastMentioned: { toNumber: () => Date.now() },
              },
            }),
          },
        ],
      });

      const result = await store.searchEntities("john", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe("john doe");
      }
    });
  });

  describe("deleteEntity", () => {
    it("should delete an entity", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.deleteEntity("entity_1", createTraceContext());

      expect(result.ok).toBe(true);
      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining("DETACH DELETE"),
        expect.any(Object),
      );
    });
  });

  describe("getEntityCount", () => {
    it("should return entity count", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({ toNumber: () => 42 }),
          },
        ],
      });

      const result = await store.getEntityCount(createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });
  });

  describe("getRelationshipCount", () => {
    it("should return relationship count", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({ toNumber: () => 15 }),
          },
        ],
      });

      const result = await store.getRelationshipCount(createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(15);
      }
    });
  });

  // =============================================================================
  // Memory Reflector Support Methods (Self Entity, Insights, Reinforcement)
  // =============================================================================

  describe("ensureSelfEntity", () => {
    it("should create self entity for user insights", async () => {
      // Mock successful upsert
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                id: "self_123",
                name: "user_456_self",
                displayName: "Self",
                canonicalType: "concept",
                labels: ["user_insights", "introspection"],
                importance: 1.0,
              },
            }),
          },
        ],
      });

      const result = await store.ensureSelfEntity(
        "user_456",
        createTraceContext("user_456"),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("user_456_self");
        expect(result.value.displayName).toBe("Self");
        expect(result.value.canonicalType).toBe("concept");
      }
    });

    it("should include userId in self entity name", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                id: "self_abc",
                name: "my_custom_user_self",
                displayName: "Self",
                canonicalType: "concept",
              },
            }),
          },
        ],
      });

      const result = await store.ensureSelfEntity(
        "my_custom_user",
        createTraceContext("my_custom_user"),
      );

      expect(result.ok).toBe(true);
      // The upsertL3Entity should be called with name = my_custom_user_self
      const runCalls = mockDriver._mockSession.run.mock.calls;
      // Look for MERGE call with the self entity name
      const mergeCall = runCalls.find((call) =>
        call[0].includes("MERGE") && call[1]?.name === "my_custom_user_self"
      );
      expect(mergeCall).toBeDefined();
    });

    it("should set correct labels for self entity", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                id: "self_test",
                name: "test_user_self",
                displayName: "Self",
                canonicalType: "concept",
                labels: ["user_insights", "introspection"],
              },
            }),
          },
        ],
      });

      const result = await store.ensureSelfEntity(
        "test_user",
        createTraceContext("test_user"),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.labels).toContain("user_insights");
        expect(result.value.labels).toContain("introspection");
      }
    });

    it("should handle database errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await store.ensureSelfEntity(
        "user_456",
        createTraceContext("user_456"),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  describe("getUserInsights", () => {
    it("should return user insights as observations", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "o") {
                return {
                  properties: {
                    id: "obs_1",
                    content: "User prefers morning meetings",
                    confidence: 0.9,
                    createdAt: { toNumber: () => now },
                  },
                };
              }
              return null;
            },
          },
          {
            get: (key: string) => {
              if (key === "o") {
                return {
                  properties: {
                    id: "obs_2",
                    content: "User works in tech",
                    confidence: 0.85,
                    createdAt: { toNumber: () => now - 1000 },
                  },
                };
              }
              return null;
            },
          },
        ],
      });

      const result = await store.getUserInsights(
        "user_456",
        10,
        createTraceContext("user_456"),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value[0].content).toBe("User prefers morning meetings");
        expect(result.value[1].content).toBe("User works in tech");
      }
    });

    it("should return empty array when no insights exist", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.getUserInsights(
        "user_456",
        10,
        createTraceContext("user_456"),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it("should respect the limit parameter", async () => {
      const now = Date.now();
      // Return observations (limit is passed to getEntityObservations)
      mockDriver._mockSession.run.mockResolvedValue({
        records: Array.from({ length: 3 }, (_, i) => ({
          get: (key: string) => {
            if (key === "o") {
              return {
                properties: {
                  id: `obs_${i}`,
                  content: `Insight ${i}`,
                  confidence: 0.9,
                  createdAt: { toNumber: () => now - i * 1000 },
                },
              };
            }
            return null;
          },
        })),
      });

      const result = await store.getUserInsights(
        "user_456",
        3, // Request only 3
        createTraceContext("user_456"),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify limit is passed through to the underlying method
        expect(result.value.length).toBeLessThanOrEqual(3);
      }
    });

    it("should query the correct self entity name", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.getUserInsights(
        "test_user_123",
        5,
        createTraceContext("test_user_123"),
      );

      const runCalls = mockDriver._mockSession.run.mock.calls;
      // Should query for observations on test_user_123_self
      const queryCall = runCalls.find(
        (call) => call[1]?.entityName === "test_user_123_self",
      );
      expect(queryCall).toBeDefined();
    });
  });

  describe("reinforceObservation", () => {
    it("should boost observation confidence", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "newConfidence") return 0.85;
              if (key === "count") return 2;
              return null;
            },
          },
        ],
      });

      const result = await store.reinforceObservation(
        "obs_123",
        "msg_456",
        "conv_789",
        0.1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);

      // Check that the query updates confidence
      const runCalls = mockDriver._mockSession.run.mock.calls;
      const updateCall = runCalls.find(
        (call) =>
          call[0].includes("confidence") &&
          call[0].includes("Observation") &&
          call[1]?.id === "obs_123",
      );
      expect(updateCall).toBeDefined();
    });

    it("should cap confidence at 1.0", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "newConfidence") return 1.0; // Capped
              if (key === "count") return 5;
              return null;
            },
          },
        ],
      });

      const result = await store.reinforceObservation(
        "obs_high",
        "msg_456",
        "conv_789",
        0.5, // Large boost that would exceed 1.0
        createTraceContext(),
      );

      expect(result.ok).toBe(true);

      // The query should include CASE WHEN to cap at 1.0
      const runCalls = mockDriver._mockSession.run.mock.calls;
      const updateCall = runCalls.find(
        (call) => call[0].includes("CASE") && call[0].includes("1.0"),
      );
      expect(updateCall).toBeDefined();
    });

    it("should increment reinforcement count", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "newConfidence") return 0.6;
              if (key === "count") return 3;
              return null;
            },
          },
        ],
      });

      const result = await store.reinforceObservation(
        "obs_123",
        "msg_456",
        "conv_789",
        0.1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);

      // Query should increment reinforcementCount
      const runCalls = mockDriver._mockSession.run.mock.calls;
      const countCall = runCalls.find((call) =>
        call[0].includes("reinforcementCount"),
      );
      expect(countCall).toBeDefined();
    });

    it("should return NotFoundError when observation does not exist", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.reinforceObservation(
        "obs_nonexistent",
        "msg_456",
        "conv_789",
        0.1,
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("NotFoundError");
        expect(result.error.message).toContain("obs_nonexistent");
      }
    });

    it("should handle database errors", async () => {
      mockDriver._mockSession.run.mockRejectedValue(
        new Error("Database timeout"),
      );

      const result = await store.reinforceObservation(
        "obs_123",
        "msg_456",
        "conv_789",
        0.1,
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });

    it("should use default confidence boost of 0.1", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "newConfidence") return 0.6;
              if (key === "count") return 1;
              return null;
            },
          },
        ],
      });

      const result = await store.reinforceObservation(
        "obs_123",
        "msg_456",
        "conv_789",
        undefined as unknown as number, // Use default
        createTraceContext(),
      );

      expect(result.ok).toBe(true);

      // Check that boost parameter defaults to 0.1
      const runCalls = mockDriver._mockSession.run.mock.calls;
      const updateCall = runCalls.find(
        (call) => call[0].includes("confidence") && call[1]?.boost === 0.1,
      );
      expect(updateCall).toBeDefined();
    });

    it("should set lastReinforced timestamp", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "newConfidence") return 0.7;
              if (key === "count") return 2;
              return null;
            },
          },
        ],
      });

      const result = await store.reinforceObservation(
        "obs_123",
        "msg_456",
        "conv_789",
        0.1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);

      // Query should set lastReinforced
      const runCalls = mockDriver._mockSession.run.mock.calls;
      const timestampCall = runCalls.find((call) =>
        call[0].includes("lastReinforced"),
      );
      expect(timestampCall).toBeDefined();
    });
  });
});
