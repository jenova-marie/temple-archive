/**
 * QdrantVectorStore Unit Tests
 *
 * Uses mocked Qdrant client for fast, isolated testing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { QdrantVectorStore } from "../../src/stores/QdrantVectorStore.js";
import type { Message, TraceContext } from "@pippa/types";
import {
  messageIdToPointId,
  DENSE_VECTOR_NAME,
  SPARSE_VECTOR_NAME,
} from "../../src/qdrant/schema.js";

// Mock observability to avoid side effects
vi.mock("@pippa/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: <T>(_name: string, fn: () => T) => fn(),
  pipelineMetrics: {
    memoryCacheHits: { add: vi.fn() },
    errors: { add: vi.fn() },
  },
}));

// Create mock Qdrant client
function createMockClient() {
  return {
    getCollections: vi
      .fn()
      .mockResolvedValue({ collections: [{ name: "messages" }] }),
    createCollection: vi.fn().mockResolvedValue({}),
    createPayloadIndex: vi.fn().mockResolvedValue({}),
    getCollection: vi.fn().mockResolvedValue({ points_count: 100 }),
    upsert: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    delete: vi.fn().mockResolvedValue({}),
  };
}

// Helper to create a test trace context
function createTestContext(): TraceContext {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    requestId: "test-request-id",
    startTime: Date.now(),
  };
}

// Helper to create a test message
function createTestMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-test-1",
    conversationId: "conv-1",
    userId: "user-1",
    role: "user",
    content: "Test message content",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("QdrantVectorStore", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let store: QdrantVectorStore;
  let ctx: TraceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    // Default to simple mode for backward-compatible tests
    // Explicitly set collectionName to 'messages' for consistent test behavior
    store = new QdrantVectorStore(mockClient as any, {
      searchMode: "simple",
      collectionName: "messages",
    });
    ctx = createTestContext();
  });

  describe("indexMessage", () => {
    it("creates point with correct payload (simple mode)", async () => {
      const simpleStore = new QdrantVectorStore(mockClient as any, {
        searchMode: "simple",
        collectionName: "messages",
      });
      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);

      const result = await simpleStore.indexMessage(message, embedding, ctx);

      expect(result.ok).toBe(true);
      expect(mockClient.upsert).toHaveBeenCalledWith("messages", {
        wait: true,
        points: [
          {
            id: messageIdToPointId(message.id),
            vector: embedding,
            payload: {
              userId: message.userId,
              conversationId: message.conversationId,
              messageId: message.id,
              role: message.role,
              content: message.content,
              timestamp: message.timestamp,
              crisisLevel: undefined,
              entities: undefined,
              topics: undefined,
            },
          },
        ],
      });
    });

    it("creates point with named vectors (hybrid mode)", async () => {
      const hybridStore = new QdrantVectorStore(mockClient as any, {
        searchMode: "hybrid",
        collectionName: "messages",
      });
      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);

      const result = await hybridStore.indexMessage(message, embedding, ctx);

      expect(result.ok).toBe(true);
      const upsertCall = mockClient.upsert.mock.calls[0];
      const point = upsertCall[1].points[0];

      // Should have named vectors
      expect(point.vector).toHaveProperty(DENSE_VECTOR_NAME);
      expect(point.vector).toHaveProperty(SPARSE_VECTOR_NAME);
      expect(point.vector[DENSE_VECTOR_NAME]).toEqual(embedding);
      // Sparse vector should have indices and values
      expect(point.vector[SPARSE_VECTOR_NAME]).toHaveProperty("indices");
      expect(point.vector[SPARSE_VECTOR_NAME]).toHaveProperty("values");
    });

    it("includes optional metadata in payload", async () => {
      const message = createTestMessage({
        metadata: {
          crisisLevel: 3,
          entities: ["person-a"],
          topics: ["recovery"],
        },
      });
      const embedding = Array(1536).fill(0.1);

      const result = await store.indexMessage(message, embedding, ctx);

      expect(result.ok).toBe(true);
      const upsertCall = mockClient.upsert.mock.calls[0];
      const payload = upsertCall[1].points[0].payload;
      expect(payload.crisisLevel).toBe(3);
      expect(payload.entities).toEqual(["person-a"]);
      expect(payload.topics).toEqual(["recovery"]);
    });

    it("handles Qdrant errors gracefully", async () => {
      const error = new Error("fetch failed: Connection refused") as Error & {
        code: string;
      };
      error.code = "ECONNREFUSED";
      mockClient.upsert.mockRejectedValue(error);

      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);

      const result = await store.indexMessage(message, embedding, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });

  describe("batchIndex", () => {
    it("processes messages in batches", async () => {
      const messages = Array(150)
        .fill(null)
        .map((_, i) => createTestMessage({ id: `msg-${i}` }));
      const embeddings = Array(150)
        .fill(null)
        .map(() => Array(1536).fill(0.1));

      const result = await store.batchIndex(messages, embeddings, ctx);

      expect(result.ok).toBe(true);
      // Should be called twice: once for first 100, once for remaining 50
      expect(mockClient.upsert).toHaveBeenCalledTimes(2);
    });

    it("handles empty array", async () => {
      const result = await store.batchIndex([], [], ctx);

      expect(result.ok).toBe(true);
      expect(mockClient.upsert).not.toHaveBeenCalled();
    });

    it("returns error if arrays have different lengths", async () => {
      const messages = [createTestMessage()];
      const embeddings: number[][] = [];

      const result = await store.batchIndex(messages, embeddings, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ValidationError");
      }
    });
  });

  describe("search", () => {
    it("builds correct filter for userId", async () => {
      const queryEmbedding = Array(1536).fill(0.1);

      await store.search(queryEmbedding, { userId: "user-1" }, ctx);

      const searchCall = mockClient.search.mock.calls[0];
      const filter = searchCall[1].filter;
      expect(filter.must).toContainEqual({
        key: "userId",
        match: { value: "user-1" },
      });
    });

    it("builds correct filter for daysBack", async () => {
      const queryEmbedding = Array(1536).fill(0.1);
      const daysBack = 30;

      await store.search(queryEmbedding, { daysBack }, ctx);

      const searchCall = mockClient.search.mock.calls[0];
      const filter = searchCall[1].filter;
      const timestampFilter = filter.must.find(
        (c: any) => c.key === "timestamp",
      );
      expect(timestampFilter).toBeDefined();
      expect(timestampFilter.range.gte).toBeDefined();
      // Should be approximately 30 days ago
      const expectedCutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
      expect(timestampFilter.range.gte).toBeGreaterThan(expectedCutoff - 1000);
      expect(timestampFilter.range.gte).toBeLessThan(expectedCutoff + 1000);
    });

    it("builds correct filter for excludeCrisisLevels", async () => {
      const queryEmbedding = Array(1536).fill(0.1);

      await store.search(queryEmbedding, { excludeCrisisLevels: [9, 10] }, ctx);

      const searchCall = mockClient.search.mock.calls[0];
      const filter = searchCall[1].filter;
      expect(filter.must_not).toContainEqual({
        key: "crisisLevel",
        match: { value: 9 },
      });
      expect(filter.must_not).toContainEqual({
        key: "crisisLevel",
        match: { value: 10 },
      });
    });

    it("respects limit and scoreThreshold", async () => {
      const queryEmbedding = Array(1536).fill(0.1);

      await store.search(
        queryEmbedding,
        { limit: 5, scoreThreshold: 0.8 },
        ctx,
      );

      const searchCall = mockClient.search.mock.calls[0];
      expect(searchCall[1].limit).toBe(5);
      expect(searchCall[1].score_threshold).toBe(0.8);
    });

    it("maps results to SemanticMatch format", async () => {
      const mockResults = [
        {
          id: "point-1",
          score: 0.95,
          payload: {
            messageId: "msg-1",
            content: "Test content",
            conversationId: "conv-1",
            timestamp: 1234567890,
            role: "user",
          },
        },
      ];
      mockClient.search.mockResolvedValue(mockResults);

      const queryEmbedding = Array(1536).fill(0.1);
      const result = await store.search(queryEmbedding, {}, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({
          id: "msg-1",
          score: 0.95,
          content: "Test content",
          metadata: {
            conversationId: "conv-1",
            timestamp: 1234567890,
            role: "user",
          },
        });
      }
    });

    it("handles search errors gracefully", async () => {
      mockClient.search.mockRejectedValue(new Error("timeout"));

      const queryEmbedding = Array(1536).fill(0.1);
      const result = await store.search(queryEmbedding, {}, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("TimeoutError");
      }
    });
  });

  describe("prune", () => {
    it("deletes old points and returns count", async () => {
      // Simulate finding 2 points to delete
      mockClient.scroll.mockResolvedValue({
        points: [{ id: "point-1" }, { id: "point-2" }],
        next_page_offset: null,
      });

      const result = await store.prune(30, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2);
      }
      expect(mockClient.delete).toHaveBeenCalledWith("messages", {
        wait: true,
        points: ["point-1", "point-2"],
      });
    });

    it("handles no points to delete", async () => {
      mockClient.scroll.mockResolvedValue({
        points: [],
        next_page_offset: null,
      });

      const result = await store.prune(30, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });

  describe("collection management", () => {
    it("creates simple collection if it does not exist (simple mode)", async () => {
      mockClient.getCollections.mockResolvedValue({ collections: [] });
      const simpleStore = new QdrantVectorStore(mockClient as any, {
        searchMode: "simple",
        collectionName: "messages",
      });

      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);

      await simpleStore.indexMessage(message, embedding, ctx);

      expect(mockClient.createCollection).toHaveBeenCalledWith("messages", {
        vectors: {
          size: 1536,
          distance: "Cosine",
          on_disk: true,
        },
        optimizers_config: {
          default_segment_number: 2,
          indexing_threshold: 20000,
        },
      });
      expect(mockClient.createPayloadIndex).toHaveBeenCalledTimes(3);
    });

    it("creates hybrid collection if it does not exist (hybrid mode)", async () => {
      mockClient.getCollections.mockResolvedValue({ collections: [] });
      const hybridStore = new QdrantVectorStore(mockClient as any, {
        searchMode: "hybrid",
        collectionName: "messages",
      });

      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);

      await hybridStore.indexMessage(message, embedding, ctx);

      expect(mockClient.createCollection).toHaveBeenCalledWith(
        "messages",
        expect.objectContaining({
          vectors: {
            [DENSE_VECTOR_NAME]: expect.objectContaining({
              size: 1536,
              distance: "Cosine",
              on_disk: true,
            }),
          },
          sparse_vectors: {
            [SPARSE_VECTOR_NAME]: expect.objectContaining({
              index: { on_disk: true },
            }),
          },
        }),
      );
      expect(mockClient.createPayloadIndex).toHaveBeenCalledTimes(3);
    });

    it("does not create collection if it already exists", async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [{ name: "messages" }],
      });

      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);

      await store.indexMessage(message, embedding, ctx);

      expect(mockClient.createCollection).not.toHaveBeenCalled();
    });

    it("only checks collection existence once", async () => {
      const message1 = createTestMessage({ id: "msg-1" });
      const message2 = createTestMessage({ id: "msg-2" });
      const embedding = Array(1536).fill(0.1);

      await store.indexMessage(message1, embedding, ctx);
      await store.indexMessage(message2, embedding, ctx);

      // getCollections should only be called once
      expect(mockClient.getCollections).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("maps connection errors correctly", async () => {
      const error = new Error("fetch failed");
      mockClient.upsert.mockRejectedValue(error);

      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);
      const result = await store.indexMessage(message, embedding, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });

    it("maps 400 errors to ValidationError", async () => {
      const error = new Error("Bad request") as Error & { status: number };
      error.status = 400;
      mockClient.upsert.mockRejectedValue(error);

      const message = createTestMessage();
      const embedding = Array(1536).fill(0.1);
      const result = await store.indexMessage(message, embedding, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ValidationError");
      }
    });

    it("maps 404 errors to NotFoundError", async () => {
      const error = new Error("Not found") as Error & { status: number };
      error.status = 404;
      mockClient.search.mockRejectedValue(error);

      const result = await store.search(Array(1536).fill(0.1), {}, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("NotFoundError");
      }
    });
  });

  describe("helper methods", () => {
    it("getPointCount returns correct count", async () => {
      mockClient.getCollection.mockResolvedValue({ points_count: 42 });

      const count = await store.getPointCount();
      expect(count).toBe(42);
    });

    it("collectionExists returns true when collection exists", async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [{ name: "messages" }],
      });

      const exists = await store.collectionExists();
      expect(exists).toBe(true);
    });

    it("collectionExists returns false when collection does not exist", async () => {
      mockClient.getCollections.mockResolvedValue({ collections: [] });

      // Create fresh store to reset cached state
      const freshStore = new QdrantVectorStore(mockClient as any, {
        collectionName: "messages",
      });
      const exists = await freshStore.collectionExists();
      expect(exists).toBe(false);
    });
  });
});

describe("messageIdToPointId", () => {
  it("generates valid UUID format", () => {
    const pointId = messageIdToPointId("test-message-id");
    // UUID format: 8-4-4-4-12
    expect(pointId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("is deterministic", () => {
    const id1 = messageIdToPointId("same-id");
    const id2 = messageIdToPointId("same-id");
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different inputs", () => {
    const id1 = messageIdToPointId("id-1");
    const id2 = messageIdToPointId("id-2");
    expect(id1).not.toBe(id2);
  });
});
