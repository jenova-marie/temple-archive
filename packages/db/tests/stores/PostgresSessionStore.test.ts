import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgresSessionStore } from "../../src/stores/PostgresSessionStore.js";
import type { Message, TraceContext, UserProfile } from "@recoverysky/types";

// Mock observability
vi.mock("@recoverysky/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}));

function createTraceContext(): TraceContext {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    requestId: "test-request-id",
    startTime: Date.now(),
  };
}

function createMockDb() {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return mockChain;
}

describe("PostgresSessionStore", () => {
  let store: PostgresSessionStore;
  let mockDb: ReturnType<typeof createMockDb>;
  let ctx: TraceContext;

  beforeEach(() => {
    mockDb = createMockDb();
    store = new PostgresSessionStore(mockDb as any);
    ctx = createTraceContext();
  });

  describe("getConversationHistory", () => {
    it("returns empty array when no messages exist", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await store.getConversationHistory("conv-1", 20, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it("returns messages in chronological order", async () => {
      const now = Date.now();
      mockDb.limit.mockResolvedValue([
        {
          messageId: "msg-2",
          conversationId: "conv-1",
          userId: "user-1",
          role: "assistant",
          content: "Response",
          createdAt: new Date(now),
          metadata: {},
          embedding: null,
        },
        {
          messageId: "msg-1",
          conversationId: "conv-1",
          userId: "user-1",
          role: "user",
          content: "Hello",
          createdAt: new Date(now - 1000),
          metadata: {},
          embedding: null,
        },
      ]);

      const result = await store.getConversationHistory("conv-1", 20, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        // Should be reversed to chronological order
        expect(result.value[0].id).toBe("msg-1");
        expect(result.value[1].id).toBe("msg-2");
      }
    });

    it("converts database rows to Message objects", async () => {
      const now = new Date();
      mockDb.limit.mockResolvedValue([
        {
          messageId: "msg-1",
          conversationId: "conv-1",
          userId: "user-1",
          role: "user",
          content: "Test message",
          createdAt: now,
          metadata: { key: "value" },
          embedding: null,
        },
      ]);

      const result = await store.getConversationHistory("conv-1", 20, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const msg = result.value[0];
        expect(msg.id).toBe("msg-1");
        expect(msg.conversationId).toBe("conv-1");
        expect(msg.userId).toBe("user-1");
        expect(msg.role).toBe("user");
        expect(msg.content).toBe("Test message");
        expect(msg.timestamp).toBe(now.getTime());
        expect(msg.metadata).toEqual({ key: "value" });
      }
    });

    it("returns error on database failure", async () => {
      mockDb.limit.mockRejectedValue(new Error("DB connection failed"));

      const result = await store.getConversationHistory("conv-1", 20, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
        expect(result.error.message).toContain("conversation history");
      }
    });
  });

  describe("storeMessage", () => {
    const message: Message = {
      id: "msg-1",
      conversationId: "conv-1",
      userId: "user-1",
      role: "user",
      content: "Test message",
      timestamp: Date.now(),
    };

    it("stores message successfully", async () => {
      const result = await store.storeMessage(message, null, ctx);

      expect(result.ok).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("stores message with embedding", async () => {
      const embedding = [0.1, 0.2, 0.3];

      const result = await store.storeMessage(message, embedding, ctx);

      expect(result.ok).toBe(true);
    });

    it("returns error on database failure", async () => {
      mockDb.onConflictDoNothing.mockRejectedValue(new Error("Insert failed"));

      const result = await store.storeMessage(message, null, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });

  describe("getUserProfile", () => {
    it("creates default profile when profile does not exist", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await store.getUserProfile("user-1", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Default profile is auto-created for existing users
        expect(result.value).toEqual(expect.objectContaining({
          userId: "user-1",
          triggers: [],
          copingStrategies: [],
          preferences: {},
          milestones: [],
        }));
        expect(result.value?.lastUpdated).toBeDefined();
      }
      // Verify insert was called to create the default profile
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("returns user profile when exists", async () => {
      mockDb.limit.mockResolvedValue([
        {
          userId: "user-1",
          recoveryPhase: "early",
          sobrietyDate: "2024-01-01",
          triggers: ["stress", "social"],
          copingStrategies: ["exercise", "meditation"],
          preferences: { preferredName: "Test" },
          milestones: [{ type: "30days", date: "2024-02-01" }],
          lastUpdated: new Date(),
        },
      ]);

      const result = await store.getUserProfile("user-1", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.userId).toBe("user-1");
        expect(result.value?.recoveryPhase).toBe("early");
        expect(result.value?.triggers).toContain("stress");
      }
    });

    it("returns error on database failure", async () => {
      mockDb.limit.mockRejectedValue(new Error("Query failed"));

      const result = await store.getUserProfile("user-1", ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });

  describe("updateUserProfile", () => {
    it("updates user profile successfully", async () => {
      const updates: Partial<UserProfile> = {
        recoveryPhase: "maintenance",
        triggers: ["stress"],
      };

      const result = await store.updateUserProfile("user-1", updates, ctx);

      expect(result.ok).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("returns error on database failure", async () => {
      mockDb.onConflictDoUpdate.mockRejectedValue(new Error("Update failed"));

      const result = await store.updateUserProfile("user-1", {}, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });

  describe("getSessionSummaries", () => {
    it("returns empty array when no summaries exist", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await store.getSessionSummaries("conv-1", 5, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it("returns summaries in chronological order", async () => {
      const now = new Date();
      mockDb.limit.mockResolvedValue([
        {
          summaryId: "sum-2",
          conversationId: "conv-1",
          timeWindowStart: new Date(now.getTime() - 3600000),
          timeWindowEnd: now,
          summaryText: "Later summary",
          keyTopics: ["topic2"],
          entitiesMentioned: { entity2: true },
          createdAt: now,
        },
        {
          summaryId: "sum-1",
          conversationId: "conv-1",
          timeWindowStart: new Date(now.getTime() - 7200000),
          timeWindowEnd: new Date(now.getTime() - 3600000),
          summaryText: "Earlier summary",
          keyTopics: ["topic1"],
          entitiesMentioned: { entity1: true },
          createdAt: new Date(now.getTime() - 3600000),
        },
      ]);

      const result = await store.getSessionSummaries("conv-1", 5, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        // Should be reversed to chronological order
        expect(result.value[0].summaryId).toBe("sum-1");
        expect(result.value[1].summaryId).toBe("sum-2");
      }
    });

    it("returns error on database failure", async () => {
      mockDb.limit.mockRejectedValue(new Error("Query failed"));

      const result = await store.getSessionSummaries("conv-1", 5, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });

  describe("storeSummary", () => {
    it("stores summary and returns ID", async () => {
      const summary = {
        conversationId: "conv-1",
        timeRange: { start: Date.now() - 3600000, end: Date.now() },
        summaryText: "Test summary",
        keyTopics: ["recovery"],
        entitiesMentioned: ["person1"],
      };

      const result = await store.storeSummary(summary, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatch(/^sum_/);
      }
    });

    it("returns error on database failure", async () => {
      mockDb.values.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      const summary = {
        conversationId: "conv-1",
        timeRange: { start: Date.now() - 3600000, end: Date.now() },
        summaryText: "Test summary",
        keyTopics: [],
        entitiesMentioned: [],
      };

      const result = await store.storeSummary(summary, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });

  describe("semanticSearch", () => {
    it("returns empty array when no matches found", async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await store.semanticSearch("conv-1", [0.1, 0.2], {}, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it("returns matches with similarity scores", async () => {
      const now = new Date();
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            message_id: "msg-1",
            conversation_id: "conv-1",
            user_id: "user-1",
            role: "user",
            content: "Similar message",
            created_at: now,
            metadata: {},
            similarity: 0.95,
          },
        ],
      });

      const result = await store.semanticSearch("conv-1", [0.1, 0.2], {}, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].similarity).toBe(0.95);
        expect(result.value[0].content).toBe("Similar message");
      }
    });

    it("returns error on database failure", async () => {
      mockDb.execute.mockRejectedValue(new Error("Query failed"));

      const result = await store.semanticSearch("conv-1", [0.1, 0.2], {}, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ConnectionError");
      }
    });
  });
});
