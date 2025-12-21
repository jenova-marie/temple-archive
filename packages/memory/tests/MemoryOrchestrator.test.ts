import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MemoryOrchestrator,
  type MemoryOrchestratorConfig,
} from "../src/MemoryOrchestrator.js";
import type {
  IContextStore,
  ISessionStore,
  IKnowledgeStore,
  IVectorStore,
  TraceContext,
  Message,
  SessionState,
  UserProfile,
  SessionSummary,
  SemanticMatch,
  Result,
  StoreError,
} from "@recoverysky/types";
import { ok, err } from "@recoverysky/types";

// Mock observability - include all logger methods at root level for direct calls
const mockLoggerMethods = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@recoverysky/observability", () => ({
  getLogger: () => ({
    ...mockLoggerMethods,
    child: () => mockLoggerMethods,
  }),
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
  pipelineMetrics: {
    memoryCacheHits: { add: vi.fn() },
    memoryCacheMisses: { add: vi.fn() },
    errors: { add: vi.fn() },
  },
}));

function createTraceContext(): TraceContext {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    requestId: "test-request-id",
    startTime: Date.now(),
  };
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}`,
    conversationId: "conv-1",
    role: "user",
    content: "Test message",
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockL1Store(
  overrides: Partial<IContextStore> = {},
): IContextStore {
  return {
    get: vi.fn().mockResolvedValue(ok(null)),
    set: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    getRecentMessages: vi.fn().mockResolvedValue(ok([])),
    storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

function createMockL2Store(
  overrides: Partial<ISessionStore> = {},
): ISessionStore {
  return {
    getConversationHistory: vi.fn().mockResolvedValue(ok([])),
    getUserProfile: vi.fn().mockResolvedValue(ok(null)),
    getSessionSummaries: vi.fn().mockResolvedValue(ok([])),
    storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
    saveUserProfile: vi.fn().mockResolvedValue(ok(undefined)),
    saveSessionSummary: vi.fn().mockResolvedValue(ok(undefined)),
    getConversationMessages: vi.fn().mockResolvedValue(ok([])),
    createConversation: vi.fn().mockResolvedValue(ok("conv-id")),
    getOrCreateUser: vi
      .fn()
      .mockResolvedValue(
        ok({ id: "user-id", externalId: "ext-1", createdAt: new Date() }),
      ),
    ...overrides,
  };
}

function createMockL3Store(
  overrides: Partial<IKnowledgeStore> = {},
): IKnowledgeStore {
  return {
    storeEntity: vi.fn().mockResolvedValue(ok(undefined)),
    storeRelationship: vi.fn().mockResolvedValue(ok(undefined)),
    queryRelated: vi.fn().mockResolvedValue(ok([])),
    getEntity: vi.fn().mockResolvedValue(ok(null)),
    ...overrides,
  };
}

function createMockL4Store(
  overrides: Partial<IVectorStore> = {},
): IVectorStore {
  return {
    indexMessage: vi.fn().mockResolvedValue(ok(undefined)),
    batchIndex: vi.fn().mockResolvedValue(ok(undefined)),
    search: vi.fn().mockResolvedValue(ok([])),
    prune: vi.fn().mockResolvedValue(ok(0)),
    ...overrides,
  };
}

describe("MemoryOrchestrator", () => {
  let l1: IContextStore;
  let l2: ISessionStore;
  let l3: IKnowledgeStore;
  let l4: IVectorStore;
  let orchestrator: MemoryOrchestrator;
  let ctx: TraceContext;

  beforeEach(() => {
    l1 = createMockL1Store();
    l2 = createMockL2Store();
    l3 = createMockL3Store();
    l4 = createMockL4Store();
    orchestrator = new MemoryOrchestrator(l1, l2, l3, l4);
    ctx = createTraceContext();
  });

  describe("constructor", () => {
    it("uses default config values", () => {
      const orch = new MemoryOrchestrator(l1, l2, l3, l4);
      expect(orch).toBeInstanceOf(MemoryOrchestrator);
    });

    it("accepts custom config", () => {
      const config: Partial<MemoryOrchestratorConfig> = {
        l1MessageLimit: 10,
        l2MessageLimit: 30,
        semanticSearchDays: 60,
        semanticScoreThreshold: 0.8,
      };
      const orch = new MemoryOrchestrator(l1, l2, l3, l4, config);
      expect(orch).toBeInstanceOf(MemoryOrchestrator);
    });
  });

  describe("retrieveContext", () => {
    describe("L1 cache hit", () => {
      it("returns from L1 when messages are cached", async () => {
        const messages = [createMessage(), createMessage()];
        l1.getRecentMessages = vi.fn().mockResolvedValue(ok(messages));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toBe("L1_REDIS");
          expect(result.value.context.messages).toHaveLength(2);
          expect(result.value.cacheHits).toBe(1);
          expect(result.value.cacheMisses).toBe(0);
        }
      });

      it("fetches session state on L1 hit", async () => {
        const messages = [createMessage()];
        const sessionState: SessionState = {
          startTime: Date.now(),
          lastActivity: Date.now(),
          messageCount: 5,
          crisisLevel: 2,
        };

        l1.getRecentMessages = vi.fn().mockResolvedValue(ok(messages));
        l1.get = vi.fn().mockResolvedValue(ok(sessionState));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.context.sessionState.messageCount).toBe(5);
          expect(result.value.context.sessionState.crisisLevel).toBe(2);
        }
      });

      it("fetches user profile from L2 on L1 hit", async () => {
        const messages = [createMessage()];
        const userProfile: UserProfile = {
          userId: "user-1",
          recoveryStartDate: new Date().toISOString(),
          substancesOfConcern: ["alcohol"],
          supportNetwork: [],
          preferences: { preferredName: "Test" },
        };

        l1.getRecentMessages = vi.fn().mockResolvedValue(ok(messages));
        l2.getUserProfile = vi.fn().mockResolvedValue(ok(userProfile));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.context.userProfile?.userId).toBe("user-1");
        }
      });
    });

    describe("L1 cache miss, L2 hit", () => {
      it("returns from L2 when L1 is empty", async () => {
        const messages = [createMessage(), createMessage(), createMessage()];
        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok(messages));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toBe("L2_POSTGRESQL");
          expect(result.value.context.messages).toHaveLength(3);
          expect(result.value.cacheHits).toBe(1);
          expect(result.value.cacheMisses).toBe(1);
        }
      });

      it("warms L1 cache with L2 results", async () => {
        const messages = [createMessage(), createMessage()];
        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok(messages));

        await orchestrator.retrieveContext("conv-1", "user-1", null, ctx);

        expect(l1.storeMessage).toHaveBeenCalledTimes(2);
      });

      it("fetches session summaries from L2", async () => {
        const messages = [createMessage()];
        const summaries: SessionSummary[] = [
          {
            conversationId: "conv-prev",
            date: new Date().toISOString(),
            summary: "Previous session summary",
            keyTopics: ["recovery"],
            emotionalTone: "hopeful",
          },
        ];

        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok(messages));
        l2.getSessionSummaries = vi.fn().mockResolvedValue(ok(summaries));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.context.previousSessions).toHaveLength(1);
        }
      });
    });

    describe("L2 failure", () => {
      it("returns error when L2 fails", async () => {
        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi
          .fn()
          .mockResolvedValue(
            err({
              kind: "ConnectionError" as const,
              message: "DB error",
              context: {},
            }),
          );

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("RetrievalError");
        }
      });
    });

    describe("L4 semantic search", () => {
      it("falls back to L4 when L1 and L2 are empty", async () => {
        const semanticMatches: SemanticMatch[] = [
          {
            messageId: "msg-old",
            conversationId: "conv-old",
            content: "Similar past message",
            score: 0.85,
            timestamp: Date.now() - 86400000,
          },
        ];

        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok([]));
        l4.search = vi.fn().mockResolvedValue(ok(semanticMatches));

        const embedding = [0.1, 0.2, 0.3];
        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          embedding,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toBe("L3_NEO4J_L4_QDRANT");
          expect(result.value.context.semanticMatches).toHaveLength(1);
        }
      });

      it("skips L4 when no embedding provided", async () => {
        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok([]));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toBe("COMBINED");
        }
        expect(l4.search).not.toHaveBeenCalled();
      });
    });

    describe("empty context", () => {
      it("returns COMBINED source when all tiers are empty", async () => {
        l1.getRecentMessages = vi.fn().mockResolvedValue(ok([]));
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok([]));
        l4.search = vi.fn().mockResolvedValue(ok([]));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          [0.1],
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toBe("COMBINED");
          expect(result.value.context.messages).toHaveLength(0);
        }
      });
    });

    describe("L1 failure handling", () => {
      it("continues to L2 when L1 fails", async () => {
        const messages = [createMessage()];
        l1.getRecentMessages = vi
          .fn()
          .mockResolvedValue(
            err({
              kind: "ConnectionError" as const,
              message: "Redis down",
              context: {},
            }),
          );
        l2.getConversationHistory = vi.fn().mockResolvedValue(ok(messages));

        const result = await orchestrator.retrieveContext(
          "conv-1",
          "user-1",
          null,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toBe("L2_POSTGRESQL");
        }
      });
    });
  });

  describe("storeMessage", () => {
    it("stores message in L1 and L2", async () => {
      const message = createMessage();

      const result = await orchestrator.storeMessage(message, null, ctx);

      expect(result.ok).toBe(true);
      expect(l1.storeMessage).toHaveBeenCalledWith(message, ctx);
      expect(l2.storeMessage).toHaveBeenCalledWith(message, null, ctx);
    });

    it("stores message in L4 when embedding provided", async () => {
      const message = createMessage();
      const embedding = [0.1, 0.2, 0.3];

      const result = await orchestrator.storeMessage(message, embedding, ctx);

      expect(result.ok).toBe(true);
      expect(l4.indexMessage).toHaveBeenCalledWith(message, embedding, ctx);
    });

    it("skips L4 when no embedding", async () => {
      const message = createMessage();

      await orchestrator.storeMessage(message, null, ctx);

      expect(l4.indexMessage).not.toHaveBeenCalled();
    });

    it("continues when L1 fails", async () => {
      const message = createMessage();
      l1.storeMessage = vi
        .fn()
        .mockResolvedValue(
          err({
            kind: "ConnectionError" as const,
            message: "Redis error",
            context: {},
          }),
        );

      const result = await orchestrator.storeMessage(message, null, ctx);

      expect(result.ok).toBe(true);
      expect(l2.storeMessage).toHaveBeenCalled();
    });

    it("returns error when L2 fails", async () => {
      const message = createMessage();
      l2.storeMessage = vi
        .fn()
        .mockResolvedValue(
          err({
            kind: "ConnectionError" as const,
            message: "DB error",
            context: {},
          }),
        );

      const result = await orchestrator.storeMessage(message, null, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("PersistError");
      }
    });

    it("continues when L4 fails", async () => {
      const message = createMessage();
      const embedding = [0.1, 0.2, 0.3];
      l4.indexMessage = vi
        .fn()
        .mockResolvedValue(
          err({
            kind: "ConnectionError" as const,
            message: "Qdrant error",
            context: {},
          }),
        );

      const result = await orchestrator.storeMessage(message, embedding, ctx);

      expect(result.ok).toBe(true);
    });
  });

  describe("updateSessionState", () => {
    it("updates existing session state", async () => {
      const existingState: SessionState = {
        startTime: Date.now() - 10000,
        lastActivity: Date.now() - 5000,
        messageCount: 5,
        crisisLevel: 1,
      };
      l1.get = vi.fn().mockResolvedValue(ok(existingState));

      const result = await orchestrator.updateSessionState(
        "conv-1",
        { crisisLevel: 3 },
        ctx,
      );

      expect(result.ok).toBe(true);
      expect(l1.set).toHaveBeenCalledWith(
        "conv-1",
        expect.objectContaining({ crisisLevel: 3, messageCount: 5 }),
        ctx,
      );
    });

    it("creates default state if none exists", async () => {
      l1.get = vi.fn().mockResolvedValue(ok(null));

      const result = await orchestrator.updateSessionState(
        "conv-1",
        { crisisLevel: 2 },
        ctx,
      );

      expect(result.ok).toBe(true);
      expect(l1.set).toHaveBeenCalledWith(
        "conv-1",
        expect.objectContaining({ crisisLevel: 2, messageCount: 0 }),
        ctx,
      );
    });

    it("returns error when L1 set fails", async () => {
      l1.get = vi.fn().mockResolvedValue(ok(null));
      l1.set = vi
        .fn()
        .mockResolvedValue(
          err({
            kind: "ConnectionError" as const,
            message: "Redis error",
            context: {},
          }),
        );

      const result = await orchestrator.updateSessionState(
        "conv-1",
        { crisisLevel: 2 },
        ctx,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("PersistError");
      }
    });
  });
});
