import { describe, it, expect, vi, beforeEach } from "vitest";
import { Neo4jMemoryStore } from "../../src/stores/Neo4jMemoryStore.js";
import type { TraceContext, CreateMemoryInput, MemoryRelationType } from "@pippa/types";

// Mock observability
vi.mock("@pippa/observability", () => ({
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
  },
}));

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nanoid-id"),
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

describe("Neo4jMemoryStore", () => {
  let mockDriver: ReturnType<typeof createMockDriver>;
  let store: Neo4jMemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDriver = createMockDriver();
    store = new Neo4jMemoryStore(
      mockDriver as unknown as import("neo4j-driver").Driver,
    );
  });

  // ===========================================================================
  // Database Configuration Tests
  // ===========================================================================

  describe("database configuration", () => {
    it("should use default database when databasePerUser is false", async () => {
      const store = new Neo4jMemoryStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: false, defaultDatabase: "mydb" },
      );
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.getMemoryCount(createTraceContext("user-123"));

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "mydb" });
    });

    it("should use userId as database name when databasePerUser is true", async () => {
      const store = new Neo4jMemoryStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      // Mock database exists check
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        if (query.includes("SHOW DATABASES")) {
          return Promise.resolve({ records: [{ get: () => "user-123" }] });
        }
        return Promise.resolve({ records: [] });
      });

      await store.getMemoryCount(createTraceContext("user-123"));

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "user-123" });
    });

    it("should sanitize userId for database name", async () => {
      const store = new Neo4jMemoryStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        if (query.includes("SHOW DATABASES")) {
          return Promise.resolve({ records: [{ get: () => "user123abc" }] });
        }
        return Promise.resolve({ records: [] });
      });

      // userId with uppercase and special chars
      await store.getMemoryCount(createTraceContext("User@123!ABC"));

      // Should be sanitized: lowercase, special chars removed
      expect(mockDriver.session).toHaveBeenCalledWith({
        database: "user123abc",
      });
    });

    it("should prefix numeric userId with u", async () => {
      const store = new Neo4jMemoryStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true },
      );
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        if (query.includes("SHOW DATABASES")) {
          return Promise.resolve({ records: [{ get: () => "u12345" }] });
        }
        return Promise.resolve({ records: [] });
      });

      await store.getMemoryCount(createTraceContext("12345"));

      // Neo4j database names must start with a letter
      expect(mockDriver.session).toHaveBeenCalledWith({ database: "u12345" });
    });

    it("should fall back to default database when userId is missing", async () => {
      const store = new Neo4jMemoryStore(
        mockDriver as unknown as import("neo4j-driver").Driver,
        { databasePerUser: true, defaultDatabase: "fallback" },
      );
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.getMemoryCount(createTraceContext()); // no userId

      expect(mockDriver.session).toHaveBeenCalledWith({ database: "fallback" });
    });
  });

  // ===========================================================================
  // CRUD Operations - createMemory
  // ===========================================================================

  describe("createMemory", () => {
    it("should create a memory successfully", async () => {
      const input: CreateMemoryInput = {
        name: "John Smith",
        memoryType: "person",
        metadata: { role: "friend" },
      };

      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.createMemory(input, createTraceContext("user-1"));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("John Smith");
        expect(result.value.memoryType).toBe("person");
        expect(result.value.metadata).toEqual({ role: "friend" });
        expect(result.value.id).toBe("mock-nanoid-id");
      }
      expect(mockDriver._mockSession.close).toHaveBeenCalled();
    });

    it("should create memory with initial observations", async () => {
      const input: CreateMemoryInput = {
        name: "Coffee Shop",
        memoryType: "place",
        observations: ["Great espresso", "Cozy atmosphere"],
      };

      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.createMemory(input, createTraceContext("user-1"));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.observations).toHaveLength(2);
        expect(result.value.observations[0].content).toBe("Great espresso");
        expect(result.value.observations[1].content).toBe("Cozy atmosphere");
      }
      // Should call run multiple times (schema init + memory + observations)
      expect(mockDriver._mockSession.run.mock.calls.length).toBeGreaterThan(2);
    });

    it("should handle errors gracefully", async () => {
      const input: CreateMemoryInput = {
        name: "Test",
        memoryType: "person",
      };

      mockDriver._mockSession.run.mockRejectedValue(new Error("Neo4j error"));

      const result = await store.createMemory(input, createTraceContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
        expect(result.error.message).toBe("Failed to create memory");
      }
    });
  });

  // ===========================================================================
  // CRUD Operations - getMemory
  // ===========================================================================

  describe("getMemory", () => {
    it("should return a memory by ID", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "m") {
                return {
                  properties: {
                    id: "mem-1",
                    name: "Test Memory",
                    memoryType: "concept",
                    metadata: "{}",
                    createdAt: now,
                    modifiedAt: now,
                    lastAccessed: now,
                  },
                };
              }
              if (key === "observations") {
                return [];
              }
              return null;
            },
          },
        ],
      });

      const result = await store.getMemory("mem-1", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.id).toBe("mem-1");
        expect(result.value.name).toBe("Test Memory");
        expect(result.value.memoryType).toBe("concept");
      }
    });

    it("should return null when memory not found", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.getMemory("nonexistent", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("should include observations when present", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "m") {
                return {
                  properties: {
                    id: "mem-1",
                    name: "Test",
                    memoryType: "person",
                    metadata: "{}",
                    createdAt: now,
                    modifiedAt: now,
                    lastAccessed: now,
                  },
                };
              }
              if (key === "observations") {
                return [
                  {
                    properties: {
                      id: "obs-1",
                      content: "Likes coffee",
                      createdAt: now,
                    },
                  },
                  {
                    properties: {
                      id: "obs-2",
                      content: "Works in tech",
                      createdAt: now,
                    },
                  },
                ];
              }
              return null;
            },
          },
        ],
      });

      const result = await store.getMemory("mem-1", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.observations).toHaveLength(2);
        expect(result.value.observations[0].content).toBe("Likes coffee");
        expect(result.value.observations[1].content).toBe("Works in tech");
      }
    });

    it("should handle errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(new Error("Connection lost"));

      const result = await store.getMemory("mem-1", createTraceContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  // ===========================================================================
  // CRUD Operations - updateMemory
  // ===========================================================================

  describe("updateMemory", () => {
    it("should update memory name", async () => {
      const now = Date.now();
      // Mock all queries to return the updated memory
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        // Schema queries
        if (query.includes("CREATE INDEX")) {
          return Promise.resolve({ records: [] });
        }
        // Get memory queries (for lastAccessed and final fetch)
        if (query.includes("MATCH (m:Memory {id:") && query.includes("RETURN m")) {
          return Promise.resolve({
            records: [
              {
                get: (key: string) => {
                  if (key === "m") {
                    return {
                      properties: {
                        id: "mem-1",
                        name: "Updated Name",
                        memoryType: "person",
                        metadata: "{}",
                        createdAt: now,
                        modifiedAt: now,
                        lastAccessed: now,
                      },
                    };
                  }
                  if (key === "observations") {
                    return [];
                  }
                  return null;
                },
              },
            ],
          });
        }
        // Update and other queries
        return Promise.resolve({ records: [] });
      });

      const result = await store.updateMemory(
        "mem-1",
        { name: "Updated Name" },
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Updated Name");
      }
    });

    it("should merge metadata on update", async () => {
      const now = Date.now();
      // Mock all queries
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        // Schema queries
        if (query.includes("CREATE INDEX")) {
          return Promise.resolve({ records: [] });
        }
        // Metadata fetch
        if (query.includes("RETURN m.metadata")) {
          return Promise.resolve({
            records: [{ get: () => '{"existing": "value"}' }],
          });
        }
        // Get memory queries
        if (query.includes("MATCH (m:Memory {id:") && query.includes("RETURN m")) {
          return Promise.resolve({
            records: [
              {
                get: (key: string) => {
                  if (key === "m") {
                    return {
                      properties: {
                        id: "mem-1",
                        name: "Test",
                        memoryType: "person",
                        metadata: '{"existing":"value","new":"data"}',
                        createdAt: now,
                        modifiedAt: now,
                        lastAccessed: now,
                      },
                    };
                  }
                  if (key === "observations") {
                    return [];
                  }
                  return null;
                },
              },
            ],
          });
        }
        return Promise.resolve({ records: [] });
      });

      const result = await store.updateMemory(
        "mem-1",
        { metadata: { new: "data" } },
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.metadata).toEqual({
          existing: "value",
          new: "data",
        });
      }
    });

    it("should return NotFoundError when memory does not exist after update", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.updateMemory(
        "nonexistent",
        { name: "New Name" },
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("NotFoundError");
      }
    });
  });

  // ===========================================================================
  // CRUD Operations - deleteMemory
  // ===========================================================================

  describe("deleteMemory", () => {
    it("should delete memory and its observations", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.deleteMemory("mem-1", createTraceContext());

      expect(result.ok).toBe(true);
      // Should use DETACH DELETE to remove relationships too
      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining("DETACH DELETE"),
        expect.any(Object),
      );
    });

    it("should handle errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(new Error("Delete failed"));

      const result = await store.deleteMemory("mem-1", createTraceContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  // ===========================================================================
  // Observation Operations
  // ===========================================================================

  describe("addObservation", () => {
    it("should add observation to a memory", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.addObservation(
        "mem-1",
        "New observation content",
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe("New observation content");
        expect(result.value.id).toBe("mock-nanoid-id");
      }
    });

    it("should handle errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(new Error("Failed"));

      const result = await store.addObservation(
        "mem-1",
        "Test",
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  describe("getObservations", () => {
    it("should return observations for a memory", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({
              properties: {
                id: "obs-1",
                content: "First observation",
                createdAt: now,
              },
            }),
          },
          {
            get: () => ({
              properties: {
                id: "obs-2",
                content: "Second observation",
                createdAt: now + 1000,
              },
            }),
          },
        ],
      });

      const result = await store.getObservations("mem-1", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].content).toBe("First observation");
        expect(result.value[1].content).toBe("Second observation");
      }
    });

    it("should return empty array when no observations", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.getObservations("mem-1", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  // ===========================================================================
  // Relation Operations
  // ===========================================================================

  describe("createRelation", () => {
    it("should create a relation between memories", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.createRelation(
        "mem-1",
        "mem-2",
        "knows" as MemoryRelationType,
        0.8,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining("MERGE"),
        expect.objectContaining({
          from: "mem-1",
          to: "mem-2",
          type: "knows",
          strength: 0.8,
        }),
      );
    });

    it("should clamp strength between 0.1 and 1.0", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      // Test clamping high value
      await store.createRelation(
        "mem-1",
        "mem-2",
        "knows" as MemoryRelationType,
        1.5,
        createTraceContext(),
      );

      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          strength: 1.0,
        }),
      );
    });

    it("should handle errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(new Error("Failed"));

      const result = await store.createRelation(
        "mem-1",
        "mem-2",
        "knows" as MemoryRelationType,
        0.5,
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  describe("getRelations", () => {
    it("should return outbound relations", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              switch (key) {
                case "from":
                  return "mem-1";
                case "to":
                  return "mem-2";
                case "type":
                  return "knows";
                case "strength":
                  return 0.8;
                case "source":
                  return "agent";
                case "createdAt":
                  return now;
                default:
                  return null;
              }
            },
          },
        ],
      });

      const result = await store.getRelations(
        "mem-1",
        "outbound",
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].from).toBe("mem-1");
        expect(result.value[0].to).toBe("mem-2");
        expect(result.value[0].type).toBe("knows");
      }
    });

    it("should return inbound relations", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              switch (key) {
                case "from":
                  return "mem-2";
                case "to":
                  return "mem-1";
                case "type":
                  return "references";
                case "strength":
                  return 0.6;
                case "source":
                  return "agent";
                case "createdAt":
                  return Date.now();
                default:
                  return null;
              }
            },
          },
        ],
      });

      const result = await store.getRelations(
        "mem-1",
        "inbound",
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].from).toBe("mem-2");
        expect(result.value[0].to).toBe("mem-1");
      }
    });

    it("should return both directions when asked", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              switch (key) {
                case "from":
                  return "mem-1";
                case "to":
                  return "mem-2";
                case "type":
                  return "knows";
                case "strength":
                  return 0.7;
                case "source":
                  return "agent";
                case "createdAt":
                  return Date.now();
                default:
                  return null;
              }
            },
          },
        ],
      });

      const result = await store.getRelations(
        "mem-1",
        "both",
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
    });
  });

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  describe("searchMemories", () => {
    it("should search memories by text query", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "m") {
                return {
                  properties: {
                    id: "mem-1",
                    name: "John Smith",
                    memoryType: "person",
                    metadata: "{}",
                    createdAt: now,
                    modifiedAt: now,
                    lastAccessed: now,
                  },
                };
              }
              if (key === "observations") {
                return [];
              }
              return null;
            },
          },
        ],
      });

      const result = await store.searchMemories(
        "john",
        { limit: 10 },
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe("John Smith");
      }
    });

    it("should filter by memoryTypes", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      await store.searchMemories(
        "test",
        { memoryTypes: ["person", "place"], limit: 50 },
        createTraceContext(),
      );

      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining("memoryType IN"),
        expect.objectContaining({
          memoryTypes: ["person", "place"],
        }),
      );
    });

    it("should filter by temporal bounds", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const now = Date.now();
      await store.searchMemories(
        "test",
        { createdAfter: now - 86400000, createdBefore: now, limit: 50 },
        createTraceContext(),
      );

      expect(mockDriver._mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining("createdAt >="),
        expect.objectContaining({
          createdAfter: now - 86400000,
          createdBefore: now,
        }),
      );
    });

    it("should handle errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(new Error("Search failed"));

      const result = await store.searchMemories(
        "test",
        { limit: 10 },
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });

  describe("findByName", () => {
    it("should find memories by name pattern", async () => {
      const now = Date.now();
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key: string) => {
              if (key === "m") {
                return {
                  properties: {
                    id: "mem-1",
                    name: "John Smith",
                    memoryType: "person",
                    metadata: "{}",
                    createdAt: now,
                    modifiedAt: now,
                    lastAccessed: now,
                  },
                };
              }
              if (key === "observations") {
                return [];
              }
              return null;
            },
          },
        ],
      });

      const result = await store.findByName("John", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe("John Smith");
      }
    });

    it("should return empty array when no matches", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.findByName("Nonexistent", createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe("getRelatedMemories", () => {
    it("should return memory with related memories", async () => {
      const now = Date.now();
      // Mock all queries dynamically
      mockDriver._mockSession.run.mockImplementation((query: string) => {
        // Schema queries
        if (query.includes("CREATE INDEX")) {
          return Promise.resolve({ records: [] });
        }
        // lastAccessed update
        if (query.includes("SET m.lastAccessed")) {
          return Promise.resolve({ records: [] });
        }
        // getMemory query (with observations)
        if (query.includes("OPTIONAL MATCH (m)-[:HAS_OBSERVATION]")) {
          return Promise.resolve({
            records: [
              {
                get: (key: string) => {
                  if (key === "m") {
                    return {
                      properties: {
                        id: "mem-1",
                        name: "Main Memory",
                        memoryType: "person",
                        metadata: "{}",
                        createdAt: now,
                        modifiedAt: now,
                        lastAccessed: now,
                      },
                    };
                  }
                  if (key === "observations") {
                    return [];
                  }
                  return null;
                },
              },
            ],
          });
        }
        // descendants query
        if (query.includes("RELATES_TO*1..") && query.includes("->(related")) {
          return Promise.resolve({
            records: [
              {
                get: (key: string) => {
                  if (key === "related") {
                    return {
                      properties: {
                        id: "mem-2",
                        name: "Related Memory",
                        memoryType: "concept",
                        metadata: "{}",
                        createdAt: now,
                        modifiedAt: now,
                        lastAccessed: now,
                      },
                    };
                  }
                  if (key === "observations") {
                    return [];
                  }
                  if (key === "distance") {
                    return 1;
                  }
                  if (key === "relType") {
                    return "knows";
                  }
                  if (key === "relStrength") {
                    return 0.8;
                  }
                  if (key === "from") {
                    return "mem-1";
                  }
                  if (key === "to") {
                    return "mem-2";
                  }
                  return null;
                },
              },
            ],
          });
        }
        // ancestors query
        if (query.includes("RELATES_TO*1..") && query.includes("->(start)")) {
          return Promise.resolve({ records: [] });
        }
        return Promise.resolve({ records: [] });
      });

      const result = await store.getRelatedMemories(
        "mem-1",
        2,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Main Memory");
        expect(result.value.related?.descendants).toHaveLength(1);
        expect(result.value.related?.descendants[0].name).toBe("Related Memory");
      }
    });

    it("should return NotFoundError when memory does not exist", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.getRelatedMemories(
        "nonexistent",
        2,
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("NotFoundError");
      }
    });
  });

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  describe("getMemoryCount", () => {
    it("should return memory count", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({ toNumber: () => 42 }),
          },
        ],
      });

      const result = await store.getMemoryCount(createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should return 0 when no records", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.getMemoryCount(createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe("getRelationCount", () => {
    it("should return relation count", async () => {
      mockDriver._mockSession.run.mockResolvedValue({
        records: [
          {
            get: () => ({ toNumber: () => 15 }),
          },
        ],
      });

      const result = await store.getRelationCount(createTraceContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(15);
      }
    });
  });

  describe("initializeSchema", () => {
    it("should create indexes successfully", async () => {
      mockDriver._mockSession.run.mockResolvedValue({ records: [] });

      const result = await store.initializeSchema(createTraceContext());

      expect(result.ok).toBe(true);
      // Should create multiple indexes
      expect(mockDriver._mockSession.run.mock.calls.length).toBeGreaterThan(0);
    });

    it("should handle errors gracefully", async () => {
      mockDriver._mockSession.run.mockRejectedValue(new Error("Schema error"));

      const result = await store.initializeSchema(createTraceContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("UnexpectedError");
      }
    });
  });
});
