import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pipeline, type PipelineDependencies } from "../src/Pipeline.js";
import { ok, err } from "@recoverysky/types";
import type {
  TraceContext,
  PipelineInput,
  ICrisisDetector,
  ICrisisHandler,
  IAgentProvider,
  ISafetyValidator,
  IEvaluator,
  CrisisCheckResult,
  AgentResponse,
  SafetyValidationResult,
  EvaluationResult,
  AssembledContext,
} from "@recoverysky/types";
import { MemoryOrchestrator } from "@recoverysky/memory";

// Mock observability - include all logger methods at root level for direct calls
vi.mock("@recoverysky/observability", () => {
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

// Mock buildSystemPrompt
vi.mock("@recoverysky/agent", () => ({
  buildSystemPrompt: () => "System prompt for testing",
}));

// Mock recoveryTools
vi.mock("@recoverysky/tools", () => ({
  recoveryTools: {},
  meetingTools: {},
  literatureTools: {},
  getMemoryTools: vi.fn().mockReturnValue({}),
  setMemoryToolTraceContext: vi.fn(),
  clearMemoryToolTraceContext: vi.fn(),
  setGetConversationIdFn: vi.fn(),
  refreshSystemPrompt: {
    description: 'Mock refresh system prompt',
    inputSchema: {},
    execute: vi.fn().mockResolvedValue({ success: true }),
  },
  clearConversation: {
    description: 'Mock clear conversation',
    inputSchema: {},
    execute: vi.fn().mockResolvedValue({ success: true }),
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

function createPipelineInput(
  overrides: Partial<PipelineInput> = {},
): PipelineInput {
  return {
    message: "Hello, I need some support today",
    conversationId: "conv-1",
    userId: "user-1",
    ...overrides,
  };
}

function createCrisisResult(
  overrides: Partial<CrisisCheckResult> = {},
): CrisisCheckResult {
  return {
    level: 1,
    patterns: [],
    triggerEmergency: false,
    action: "none",
    processingTimeMs: 5,
    ...overrides,
  };
}

function createAgentResponse(
  overrides: Partial<AgentResponse> = {},
): AgentResponse {
  return {
    content:
      "I hear you. Recovery can be challenging, but you are doing great.",
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-sonnet-4-20250514",
    toolCalls: [],
    stopReason: "end_turn",
    ...overrides,
  };
}

function createMockContext(): AssembledContext {
  return {
    messages: [],
    userProfile: null,
    sessionEntities: {
      people: [],
      places: [],
      events: [],
      emotions: [],
      medications: [],
    },
    sessionState: {
      startTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      crisisLevel: 1,
    },
    previousSessions: [],
  };
}

function createMockDependencies(
  overrides: Partial<{
    crisisDetector: Partial<ICrisisDetector>;
    crisisHandler: Partial<ICrisisHandler>;
    agent: Partial<IAgentProvider>;
    safety: Partial<ISafetyValidator>;
    evaluator: Partial<IEvaluator>;
  }> = {},
): PipelineDependencies {
  const crisisDetector: ICrisisDetector = {
    detect: vi.fn().mockResolvedValue(ok(createCrisisResult())),
    ...overrides.crisisDetector,
  };

  const crisisHandler: ICrisisHandler = {
    handle: vi
      .fn()
      .mockResolvedValue(ok({ prependMessage: null, resources: [] })),
    ...overrides.crisisHandler,
  };

  const mockMemory = {
    retrieveContext: vi.fn().mockResolvedValue(
      ok({
        context: createMockContext(),
        source: "L1_REDIS" as const,
        latencyMs: 10,
        cacheHits: 1,
        cacheMisses: 0,
      }),
    ),
    storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateSessionState: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const agent: IAgentProvider = {
    generate: vi.fn().mockResolvedValue(ok(createAgentResponse())),
    stream: vi.fn(),
    ...overrides.agent,
  };

  const safety: ISafetyValidator = {
    validate: vi.fn().mockResolvedValue(
      ok({
        passed: true,
        violations: [],
        processingTimeMs: 5,
      }),
    ),
    ...overrides.safety,
  };

  const evaluator: IEvaluator = {
    evaluate: vi.fn().mockResolvedValue(
      ok({
        qualityScore: 0.8,
        relevanceScore: 0.9,
        empathyScore: 0.85,
        recoveryScore: 0.9,
        overallScore: 0.86,
        feedback: "Good response",
      }),
    ),
    ...overrides.evaluator,
  };

  return {
    crisisDetector,
    crisisHandler,
    memory: mockMemory as unknown as MemoryOrchestrator,
    agent,
    safety,
    evaluator,
  };
}

describe("Pipeline", () => {
  let pipeline: Pipeline;
  let deps: PipelineDependencies;
  let ctx: TraceContext;

  beforeEach(() => {
    deps = createMockDependencies();
    pipeline = new Pipeline(deps);
    ctx = createTraceContext();
  });

  describe("constructor", () => {
    it("creates pipeline with default config", () => {
      expect(pipeline.config).toBeDefined();
      expect(pipeline.config.timeoutMs).toBe(30000);
    });

    it("accepts custom config", () => {
      const customPipeline = new Pipeline(deps, { timeoutMs: 60000 });
      expect(customPipeline.config.timeoutMs).toBe(60000);
    });
  });

  describe("process", () => {
    describe("normal flow", () => {
      it("returns successful response for normal message", async () => {
        const input = createPipelineInput();

        const result = await pipeline.process(input, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.response).toBeDefined();
          expect(result.value.crisisLevel).toBe(1);
          expect(result.value.emergencyTriggered).toBe(false);
        }
      });

      it("includes user and assistant messages in result", async () => {
        const input = createPipelineInput({ message: "Test message" });

        const result = await pipeline.process(input, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.messages.user.content).toBe("Test message");
          expect(result.value.messages.user.role).toBe("user");
          expect(result.value.messages.assistant.role).toBe("assistant");
        }
      });

      it("includes metrics in result", async () => {
        const input = createPipelineInput();

        const result = await pipeline.process(input, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.metrics.totalDuration).toBeGreaterThanOrEqual(0);
          expect(result.value.metrics.tokensUsed).toBeDefined();
          expect(result.value.metrics.memorySource).toBe("L1_REDIS");
        }
      });

      it("includes diagnostics in result", async () => {
        const input = createPipelineInput();

        const result = await pipeline.process(input, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.diagnostics).toBeDefined();
          expect(result.value.diagnostics?.timing).toBeDefined();
          expect(result.value.diagnostics?.crisis).toBeDefined();
          expect(result.value.diagnostics?.memory).toBeDefined();
          expect(result.value.diagnostics?.agent).toBeDefined();
        }
      });
    });

    describe("crisis handling", () => {
      it("triggers emergency for level 9+ crisis", async () => {
        const emergencyCrisis = createCrisisResult({
          level: 9,
          triggerEmergency: true,
          action: "emergency_protocol",
        });

        deps = createMockDependencies({
          crisisDetector: {
            detect: vi.fn().mockResolvedValue(ok(emergencyCrisis)),
          },
          crisisHandler: {
            handle: vi.fn().mockResolvedValue(
              ok({
                prependMessage:
                  "I am concerned about your safety. Please call 988.",
                resources: [{ name: "988 Lifeline", contactValue: "988" }],
              }),
            ),
          },
        });
        pipeline = new Pipeline(deps);

        const input = createPipelineInput({ message: "I want to end it all" });
        const result = await pipeline.process(input, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.emergencyTriggered).toBe(true);
          expect(result.value.crisisLevel).toBe(9);
          expect(result.value.response).toContain("988");
        }
      });

      it("returns crisis error when detector fails", async () => {
        deps = createMockDependencies({
          crisisDetector: {
            detect: vi
              .fn()
              .mockResolvedValue(
                err({
                  kind: "DetectionError",
                  message: "Detector failed",
                  context: {},
                }),
              ),
          },
        });
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("CrisisError");
        }
      });
    });

    describe("memory retrieval", () => {
      it("continues with empty context when memory fails", async () => {
        const mockMemory = {
          retrieveContext: vi
            .fn()
            .mockResolvedValue(
              err({
                kind: "RetrievalError",
                message: "Memory failed",
                context: {},
              }),
            ),
          storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
          updateSessionState: vi.fn().mockResolvedValue(ok(undefined)),
        };

        deps.memory = mockMemory as unknown as MemoryOrchestrator;
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(true);
      });

      it("includes cache stats in metrics", async () => {
        const mockMemory = {
          retrieveContext: vi.fn().mockResolvedValue(
            ok({
              context: createMockContext(),
              source: "L2_POSTGRESQL" as const,
              latencyMs: 25,
              cacheHits: 0,
              cacheMisses: 1,
            }),
          ),
          storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
          updateSessionState: vi.fn().mockResolvedValue(ok(undefined)),
        };

        deps.memory = mockMemory as unknown as MemoryOrchestrator;
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.metrics.memorySource).toBe("L2_POSTGRESQL");
        }
      });
    });

    describe("agent processing", () => {
      it("returns agent error when agent fails", async () => {
        deps = createMockDependencies({
          agent: {
            generate: vi
              .fn()
              .mockResolvedValue(
                err({
                  kind: "GenerationError",
                  message: "Agent failed",
                  context: {},
                }),
              ),
          },
        });
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("AgentError");
        }
      });

      it("includes token usage in metrics", async () => {
        deps = createMockDependencies({
          agent: {
            generate: vi.fn().mockResolvedValue(
              ok(
                createAgentResponse({
                  usage: { inputTokens: 200, outputTokens: 100 },
                }),
              ),
            ),
          },
        });
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.metrics.tokensUsed.input).toBe(200);
          expect(result.value.metrics.tokensUsed.output).toBe(100);
        }
      });
    });

    describe("safety validation", () => {
      it("includes safety violations in result", async () => {
        deps = createMockDependencies({
          safety: {
            validate: vi.fn().mockResolvedValue(
              ok({
                passed: false,
                violations: [
                  {
                    type: "medical_advice",
                    severity: "high",
                    description: "Contains medical advice",
                  },
                ],
                sanitizedOutput: "Please consult a healthcare provider.",
                processingTimeMs: 10,
              }),
            ),
          },
        });
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.safetyViolations).toHaveLength(1);
          expect(result.value.response).toBe(
            "Please consult a healthcare provider.",
          );
        }
      });

      it("uses original response when safety passes", async () => {
        const originalResponse = "Original response content";
        deps = createMockDependencies({
          agent: {
            generate: vi.fn().mockResolvedValue(
              ok(
                createAgentResponse({
                  content: originalResponse,
                }),
              ),
            ),
          },
          safety: {
            validate: vi.fn().mockResolvedValue(
              ok({
                passed: true,
                violations: [],
                processingTimeMs: 5,
              }),
            ),
          },
        });
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.response).toBe(originalResponse);
        }
      });
    });

    describe("persistence", () => {
      it("persists user and assistant messages", async () => {
        const mockMemory = {
          retrieveContext: vi.fn().mockResolvedValue(
            ok({
              context: createMockContext(),
              source: "L1_REDIS" as const,
              latencyMs: 10,
              cacheHits: 1,
              cacheMisses: 0,
            }),
          ),
          storeMessage: vi.fn().mockResolvedValue(ok(undefined)),
          updateSessionState: vi.fn().mockResolvedValue(ok(undefined)),
        };

        deps.memory = mockMemory as unknown as MemoryOrchestrator;
        pipeline = new Pipeline(deps);

        await pipeline.process(createPipelineInput(), ctx);

        expect(mockMemory.storeMessage).toHaveBeenCalledTimes(2);
        expect(mockMemory.updateSessionState).toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("catches unexpected errors and returns UnexpectedError", async () => {
        deps = createMockDependencies({
          crisisDetector: {
            detect: vi.fn().mockRejectedValue(new Error("Unexpected failure")),
          },
        });
        pipeline = new Pipeline(deps);

        const result = await pipeline.process(createPipelineInput(), ctx);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("UnexpectedError");
        }
      });
    });
  });
});
