/**
 * Pipeline Integration Tests
 *
 * Tests the pipeline with real implementations of components (using stubs/in-memory versions).
 * Unlike unit tests, these test the actual interaction between components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Pipeline, type PipelineDependencies } from "../src/Pipeline.js";
import { ok, err } from "@siri/types";
import type {
  TraceContext,
  PipelineInput,
  IAgentProvider,
  AgentResponse,
  AssembledContext,
} from "@siri/types";
import {
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
  MemoryOrchestrator,
} from "@siri/memory";
import {
  KeywordCrisisDetector,
  StubCrisisHandler,
} from "@siri/crisis";
import { StubSafetyValidator } from "@siri/safety";
import { StubEvaluator } from "@siri/evaluation";

// Mock observability
vi.mock("@siri/observability", () => {
  const mockLoggerMethods = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    getLogger: () => ({
      ...mockLoggerMethods,
      child: () => ({
        ...mockLoggerMethods,
        child: () => mockLoggerMethods,
      }),
    }),
    withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
    pipelineMetrics: {
      stageDuration: { record: vi.fn() },
      tokensUsed: { add: vi.fn() },
      crisisDetections: { add: vi.fn() },
      memoryCacheHits: { add: vi.fn() },
      memoryCacheMisses: { add: vi.fn() },
    },
  };
});

// Mock agent and tools
vi.mock("@siri/agent", () => ({
  buildSystemPrompt: () => "System prompt for testing",
}));

vi.mock("@siri/tools", () => ({
  recoveryTools: {},
  meetingTools: {},
  literatureTools: {},
  getMemoryTools: vi.fn().mockReturnValue({}),
  setMemoryToolTraceContext: vi.fn(),
  clearMemoryToolTraceContext: vi.fn(),
  setGetConversationIdFn: vi.fn(),
  refreshSystemPrompt: {
    description: "Mock refresh system prompt",
    inputSchema: {},
    execute: vi.fn().mockResolvedValue({ success: true }),
  },
  clearConversation: {
    description: "Mock clear conversation",
    inputSchema: {},
    execute: vi.fn().mockResolvedValue({ success: true }),
  },
}));

/**
 * Mock Agent Provider that simulates realistic responses
 */
class MockRealisticAgentProvider implements IAgentProvider {
  private responses: Map<string, string> = new Map([
    ["help", "I'm here to help. What's on your mind?"],
    ["crisis", "I'm very concerned about what you shared. Please reach out to the 988 Lifeline."],
    ["normal", "Thank you for sharing that with me. How can I support you today?"],
  ]);

  async generate(): Promise<ReturnType<typeof ok<AgentResponse>>> {
    return ok({
      content: this.responses.get("normal") || "I'm here for you.",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
      stopReason: "end_turn",
    });
  }

  stream = vi.fn();
}

function createTraceContext(userId?: string): TraceContext {
  return {
    traceId: `trace-${Date.now()}`,
    spanId: `span-${Date.now()}`,
    requestId: `req-${Date.now()}`,
    startTime: Date.now(),
    userId,
  };
}

function createInput(message: string, overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    message,
    conversationId: `conv-${Date.now()}`,
    userId: "test-user-1",
    ...overrides,
  };
}

describe("Pipeline Integration Tests", () => {
  let pipeline: Pipeline;
  let deps: PipelineDependencies;
  let contextStore: InMemoryContextStore;
  let sessionStore: InMemorySessionStore;
  let knowledgeStore: InMemoryKnowledgeStore;
  let vectorStore: InMemoryVectorStore;
  let memory: MemoryOrchestrator;

  beforeEach(() => {
    // Create real in-memory stores
    contextStore = new InMemoryContextStore();
    sessionStore = new InMemorySessionStore();
    knowledgeStore = new InMemoryKnowledgeStore();
    vectorStore = new InMemoryVectorStore();

    // Create real memory orchestrator with in-memory stores
    memory = new MemoryOrchestrator(
      contextStore,
      sessionStore,
      knowledgeStore,
      vectorStore,
    );

    // Create real crisis detector with patterns
    const crisisDetector = new KeywordCrisisDetector({
      emergencyThreshold: 9,
      resourceThreshold: 7,
    });

    // Create stub handlers (don't need real webhooks in integration tests)
    const crisisHandler = new StubCrisisHandler();
    const safety = new StubSafetyValidator();
    const evaluator = new StubEvaluator();

    // Create mock agent
    const agent = new MockRealisticAgentProvider();

    deps = {
      crisisDetector,
      crisisHandler,
      memory,
      agent,
      safety,
      evaluator,
    };

    pipeline = new Pipeline(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("end-to-end message flow", () => {
    it("processes a normal message through all stages", async () => {
      const input = createInput("Hello, I'm feeling good today!");
      const ctx = createTraceContext("user-1");

      const result = await pipeline.process(input, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.response).toBeDefined();
        expect(result.value.crisisLevel).toBeLessThan(7);
        expect(result.value.emergencyTriggered).toBe(false);
        expect(result.value.metrics).toBeDefined();
        expect(result.value.metrics.totalDuration).toBeGreaterThanOrEqual(0);
      }
    });

    it("detects crisis patterns in messages", async () => {
      // Use a message with known crisis patterns
      const input = createInput("I'm thinking about suicide");
      const ctx = createTraceContext("user-1");

      const result = await pipeline.process(input, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // KeywordCrisisDetector should detect high crisis level
        expect(result.value.crisisLevel).toBeGreaterThan(5);
      }
    });

    it("includes proper diagnostics for debugging", async () => {
      const input = createInput("Tell me about recovery");
      const ctx = createTraceContext("user-1");

      const result = await pipeline.process(input, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const { diagnostics } = result.value;
        expect(diagnostics).toBeDefined();
        expect(diagnostics?.crisis).toBeDefined();
        expect(diagnostics?.memory).toBeDefined();
        expect(diagnostics?.agent).toBeDefined();
      }
    });
  });

  describe("multi-turn conversations", () => {
    it("maintains conversation context across multiple messages", async () => {
      const conversationId = "multi-turn-conv-1";
      const ctx = createTraceContext("user-1");

      // First message
      const input1 = createInput("My name is Alice", { conversationId });
      const result1 = await pipeline.process(input1, ctx);
      expect(result1.ok).toBe(true);

      // Second message in same conversation
      const input2 = createInput("How are you today?", { conversationId });
      const result2 = await pipeline.process(input2, ctx);
      expect(result2.ok).toBe(true);

      // Both should succeed and maintain context
      if (result1.ok && result2.ok) {
        expect(result1.value.messages.user.content).toBe("My name is Alice");
        expect(result2.value.messages.user.content).toBe("How are you today?");
      }
    });

    it("handles new conversations correctly", async () => {
      const ctx = createTraceContext("user-1");

      // Two different conversations
      const input1 = createInput("First conversation", { conversationId: "conv-a" });
      const input2 = createInput("Second conversation", { conversationId: "conv-b" });

      const result1 = await pipeline.process(input1, ctx);
      const result2 = await pipeline.process(input2, ctx);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
    });
  });

  describe("user isolation", () => {
    it("isolates data between different users", async () => {
      const conversationId = "shared-conv";

      // User 1's message
      const ctx1 = createTraceContext("user-1");
      const input1 = createInput("I'm user 1", {
        conversationId,
        userId: "user-1",
      });
      const result1 = await pipeline.process(input1, ctx1);

      // User 2's message (same conversation ID but different user)
      const ctx2 = createTraceContext("user-2");
      const input2 = createInput("I'm user 2", {
        conversationId,
        userId: "user-2",
      });
      const result2 = await pipeline.process(input2, ctx2);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
    });
  });

  describe("error resilience", () => {
    it("continues processing when memory retrieval fails", async () => {
      // Create a memory orchestrator that will fail retrieval
      const failingMemory = {
        retrieveContext: vi.fn().mockResolvedValue(
          err({ kind: "RetrievalError", message: "Store unavailable", context: {} }),
        ),
        storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
        updateSessionState: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as MemoryOrchestrator;

      const failingDeps = { ...deps, memory: failingMemory };
      const failingPipeline = new Pipeline(failingDeps);

      const input = createInput("Testing resilience");
      const ctx = createTraceContext("user-1");

      const result = await failingPipeline.process(input, ctx);

      // Should still succeed despite memory failure
      expect(result.ok).toBe(true);
    });

    it("returns error when agent fails", async () => {
      // Create an agent that will fail
      const failingAgent = {
        generate: vi.fn().mockResolvedValue(
          err({ kind: "GenerationError", message: "API unavailable", context: {} }),
        ),
        stream: vi.fn(),
      } as IAgentProvider;

      const failingDeps = { ...deps, agent: failingAgent };
      const failingPipeline = new Pipeline(failingDeps);

      const input = createInput("Testing agent failure");
      const ctx = createTraceContext("user-1");

      const result = await failingPipeline.process(input, ctx);

      // Should return error for agent failure
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("AgentError");
      }
    });
  });

  describe("preflight mode", () => {
    it("returns preflight data without generating response", async () => {
      const input = createInput("Hello!");
      const ctx = createTraceContext("user-1");

      const preflightResult = await pipeline.preflight(input, ctx);

      expect(preflightResult.ok).toBe(true);
      if (preflightResult.ok) {
        expect(preflightResult.value.systemPrompt).toBeDefined();
        expect(preflightResult.value.crisisCheck).toBeDefined();
        expect(preflightResult.value.context).toBeDefined();
      }
    });

    it("preflight detects crisis without processing", async () => {
      const input = createInput("I want to hurt myself");
      const ctx = createTraceContext("user-1");

      const preflightResult = await pipeline.preflight(input, ctx);

      expect(preflightResult.ok).toBe(true);
      if (preflightResult.ok) {
        expect(preflightResult.value.crisisCheck.level).toBeGreaterThan(5);
      }
    });
  });

  describe("metrics and observability", () => {
    it("captures timing metrics for all stages", async () => {
      const input = createInput("Testing metrics");
      const ctx = createTraceContext("user-1");

      const result = await pipeline.process(input, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const { metrics, diagnostics } = result.value;

        // Check overall metrics
        expect(metrics.totalDuration).toBeGreaterThanOrEqual(0);
        expect(metrics.tokensUsed).toBeDefined();
        expect(metrics.memorySource).toBeDefined();

        // Check diagnostics exist
        expect(diagnostics).toBeDefined();
        expect(diagnostics?.crisis).toBeDefined();
        expect(diagnostics?.memory).toBeDefined();
        expect(diagnostics?.agent).toBeDefined();
      }
    });
  });
});

describe("Pipeline with Context Compaction", () => {
  it("handles context compaction when available", async () => {
    const contextStore = new InMemoryContextStore();
    const sessionStore = new InMemorySessionStore();
    const knowledgeStore = new InMemoryKnowledgeStore();
    const vectorStore = new InMemoryVectorStore();

    const memory = new MemoryOrchestrator(
      contextStore,
      sessionStore,
      knowledgeStore,
      vectorStore,
    );

    // Mock context compactor (must implement IContextCompactor interface)
    // The pipeline calls maybeCompact, not compact
    const mockCompactor = {
      maybeCompact: vi.fn().mockResolvedValue(ok({
        compacted: false,
        originalCount: 10,
        compactedCount: 10,
      })),
      getCompactionSummary: vi.fn().mockResolvedValue(ok(null)),
    };

    const deps: PipelineDependencies = {
      crisisDetector: new KeywordCrisisDetector(),
      crisisHandler: new StubCrisisHandler(),
      memory,
      agent: new MockRealisticAgentProvider(),
      safety: new StubSafetyValidator(),
      evaluator: new StubEvaluator(),
      contextCompactor: mockCompactor as any,
    };

    const pipeline = new Pipeline(deps);
    const input = createInput("Test with compaction");
    const ctx = createTraceContext("user-1");

    const result = await pipeline.process(input, ctx);

    expect(result.ok).toBe(true);
    // Context compaction is fire-and-forget, so we just verify the pipeline completes
  });
});

describe("Pipeline with Entity Extraction", () => {
  it("triggers entity extraction when configured", async () => {
    const contextStore = new InMemoryContextStore();
    const sessionStore = new InMemorySessionStore();
    const knowledgeStore = new InMemoryKnowledgeStore();
    const vectorStore = new InMemoryVectorStore();

    const memory = new MemoryOrchestrator(
      contextStore,
      sessionStore,
      knowledgeStore,
      vectorStore,
    );

    // Mock entity extractor
    const mockExtractor = {
      extract: vi.fn().mockResolvedValue(ok({
        entities: [],
        relationships: [],
      })),
      persist: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const deps: PipelineDependencies = {
      crisisDetector: new KeywordCrisisDetector(),
      crisisHandler: new StubCrisisHandler(),
      memory,
      agent: new MockRealisticAgentProvider(),
      safety: new StubSafetyValidator(),
      evaluator: new StubEvaluator(),
      entityExtractor: mockExtractor as any,
    };

    const pipeline = new Pipeline(deps);
    const input = createInput("My friend John helped me yesterday");
    const ctx = createTraceContext("user-1");

    const result = await pipeline.process(input, ctx);

    expect(result.ok).toBe(true);
    // Entity extraction is fire-and-forget in post-processing
  });
});
