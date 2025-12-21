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
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.searchEntities("test", createTraceContext("user-123"));

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "user-123" });
    });

    it("should sanitize userId for database name", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

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
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.searchEntities("test", createTraceContext("12345"));

      // Neo4j database names must start with a letter, so numeric IDs get 'u' prefix
      expect(mockDriver.session).toHaveBeenCalledWith({ database: "u12345" });
    });

    it("should fall back to default database when userId is missing", async () => {
      const store = new Neo4jKnowledgeStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true, defaultDatabase: "fallback" },
      );
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.searchEntities("test", createTraceContext()); // no userId

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "fallback" });
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
});
