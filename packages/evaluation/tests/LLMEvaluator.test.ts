import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { LLMEvaluator, type EvaluationMode } from "../src/LLMEvaluator.js";
import { StubEvaluator } from "../src/StubEvaluator.js";
import type { AssembledContext } from "@siri/types";

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: "span-123",
  traceId: "trace-123",
});

const createMockContext = (
  overrides?: Partial<AssembledContext>,
): AssembledContext => ({
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
  ...overrides,
});

// Mock Anthropic client
const mockCreate = vi.fn();
const mockClient = {
  messages: {
    create: mockCreate,
  },
} as unknown as Anthropic;

describe("LLMEvaluator", () => {
  let stubEvaluator: StubEvaluator;

  beforeEach(() => {
    vi.clearAllMocks();
    stubEvaluator = new StubEvaluator();
  });

  describe("constructor", () => {
    it("should create evaluator with default config", () => {
      const evaluator = new LLMEvaluator(mockClient, stubEvaluator);
      expect(evaluator).toBeDefined();
      expect(evaluator.getConfig().mode).toBe("on_demand");
    });

    it("should accept custom config", () => {
      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
        minCrisisLevelToTrigger: 5,
      });
      expect(evaluator.getConfig().mode).toBe("all");
      expect(evaluator.getConfig().minCrisisLevelToTrigger).toBe(5);
    });
  });

  describe("evaluate - mode: on_demand", () => {
    it("should use stub result when conditions not met", async () => {
      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "on_demand",
        minCrisisLevelToTrigger: 4,
        minStubScoreToSkip: 0.5, // Low threshold so stub passes
      });

      const result = await evaluator.evaluate(
        "How are you?",
        "I am doing well, thank you for asking!",
        createMockContext({
          sessionState: {
            startTime: Date.now(),
            lastActivity: Date.now(),
            messageCount: 1,
            crisisLevel: 1,
          },
        }),
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled(); // LLM not called
    });

    it("should run LLM when crisis level is high", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.9,
              relevanceScore: 0.85,
              empathyScore: 0.95,
              recoveryScore: 0.9,
              feedback: null,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "on_demand",
        minCrisisLevelToTrigger: 4,
      });

      const result = await evaluator.evaluate(
        "I am struggling",
        "I hear you and I am here to support you.",
        createMockContext({
          sessionState: {
            startTime: Date.now(),
            lastActivity: Date.now(),
            messageCount: 5,
            crisisLevel: 5,
          },
        }),
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      expect(mockCreate).toHaveBeenCalled(); // LLM was called due to crisis
    });

    it("should run LLM when stub score is low", async () => {
      // Make stub return low score
      stubEvaluator.setMockScores({
        qualityScore: 0.3,
        relevanceScore: 0.3,
        empathyScore: 0.3,
        recoveryScore: 0.3,
        overallScore: 0.3,
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.8,
              relevanceScore: 0.8,
              empathyScore: 0.8,
              recoveryScore: 0.8,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "on_demand",
        minStubScoreToSkip: 0.7,
      });

      await evaluator.evaluate(
        "Hello",
        "Hi there!",
        createMockContext(),
        createTraceContext(),
      );

      expect(mockCreate).toHaveBeenCalled(); // LLM called due to low stub score
    });
  });

  describe("evaluate - mode: all", () => {
    it("should always run LLM evaluation", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.9,
              relevanceScore: 0.9,
              empathyScore: 0.9,
              recoveryScore: 0.9,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });

      await evaluator.evaluate(
        "Hello",
        "Hi!",
        createMockContext(),
        createTraceContext(),
      );

      expect(mockCreate).toHaveBeenCalled();
    });
  });

  describe("evaluate - mode: sample", () => {
    it("should run LLM for approximately N% of requests", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.9,
              relevanceScore: 0.9,
              empathyScore: 0.9,
              recoveryScore: 0.9,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "sample:50" as EvaluationMode,
      });

      // Run many times to test sampling
      let llmCalls = 0;
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        vi.clearAllMocks();
        await evaluator.evaluate(
          "Hello",
          "Hi!",
          createMockContext(),
          createTraceContext(),
        );
        if (mockCreate.mock.calls.length > 0) {
          llmCalls++;
        }
      }

      // Should be roughly 50% (with some variance)
      expect(llmCalls).toBeGreaterThan(20); // At least 20%
      expect(llmCalls).toBeLessThan(80); // At most 80%
    });
  });

  describe("evaluate - LLM response parsing", () => {
    it("should parse valid LLM response", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.85,
              relevanceScore: 0.9,
              empathyScore: 0.95,
              recoveryScore: 0.8,
              feedback: "Good response overall",
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });
      const result = await evaluator.evaluate(
        "I need help",
        "I am here for you.",
        createMockContext(),
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qualityScore).toBe(0.85);
        expect(result.value.relevanceScore).toBe(0.9);
        expect(result.value.empathyScore).toBe(0.95);
        expect(result.value.recoveryScore).toBe(0.8);
        expect(result.value.feedback).toBe("Good response overall");
        // Check overall score calculation
        const expected = 0.85 * 0.2 + 0.9 * 0.3 + 0.95 * 0.3 + 0.8 * 0.2;
        expect(result.value.overallScore).toBeCloseTo(expected, 5);
      }
    });

    it("should clamp scores to 0-1 range", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 1.5, // Over 1
              relevanceScore: -0.5, // Under 0
              empathyScore: 0.8,
              recoveryScore: 0.9,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });
      const result = await evaluator.evaluate(
        "Test",
        "Test response",
        createMockContext(),
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qualityScore).toBe(1);
        expect(result.value.relevanceScore).toBe(0);
      }
    });

    it("should handle LLM response with extra text", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text:
              "Here is my evaluation:\n" +
              JSON.stringify({
                qualityScore: 0.9,
                relevanceScore: 0.9,
                empathyScore: 0.9,
                recoveryScore: 0.9,
              }) +
              "\n\nLet me know if you need more details.",
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });
      const result = await evaluator.evaluate(
        "Test",
        "Test response",
        createMockContext(),
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qualityScore).toBe(0.9);
      }
    });
  });

  describe("evaluate - error handling", () => {
    it("should fall back to stub on LLM error", async () => {
      mockCreate.mockRejectedValue(new Error("API error"));

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });
      const result = await evaluator.evaluate(
        "Hello",
        "Hi there! How can I help you today?",
        createMockContext(),
        createTraceContext(),
      );

      // Should still return a result from stub
      expect(result.ok).toBe(true);
    });

    it("should fall back to stub on invalid JSON", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: "This is not valid JSON",
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });
      const result = await evaluator.evaluate(
        "Hello",
        "Hi!",
        createMockContext(),
        createTraceContext(),
      );

      expect(result.ok).toBe(true); // Falls back to stub
    });

    it("should handle timeout gracefully", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockCreate.mockRejectedValue(abortError);

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
        timeoutMs: 100,
      });

      const result = await evaluator.evaluate(
        "Hello",
        "Hi!",
        createMockContext(),
        createTraceContext(),
      );

      expect(result.ok).toBe(true); // Falls back to stub
    });
  });

  describe("getEvaluationCount", () => {
    it("should track number of LLM evaluations", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.9,
              relevanceScore: 0.9,
              empathyScore: 0.9,
              recoveryScore: 0.9,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });

      expect(evaluator.getEvaluationCount()).toBe(0);

      await evaluator.evaluate(
        "Test",
        "Response",
        createMockContext(),
        createTraceContext(),
      );
      expect(evaluator.getEvaluationCount()).toBe(1);

      await evaluator.evaluate(
        "Test2",
        "Response2",
        createMockContext(),
        createTraceContext(),
      );
      expect(evaluator.getEvaluationCount()).toBe(2);
    });

    it("should not count when LLM is skipped", async () => {
      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "on_demand",
        minStubScoreToSkip: 0.3, // Low threshold, stub will pass
      });

      await evaluator.evaluate(
        "Hello",
        "Hi there, how can I help?",
        createMockContext(),
        createTraceContext(),
      );

      expect(evaluator.getEvaluationCount()).toBe(0); // LLM not called
    });
  });

  describe("recovery context evaluation", () => {
    it("should properly evaluate empathetic responses", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              qualityScore: 0.9,
              relevanceScore: 0.95,
              empathyScore: 0.98,
              recoveryScore: 0.92,
              feedback: null,
            }),
          },
        ],
      });

      const evaluator = new LLMEvaluator(mockClient, stubEvaluator, {
        mode: "all",
      });
      const result = await evaluator.evaluate(
        "I am really struggling today and feel like giving up",
        "I hear you, and I want you to know that what you are feeling is valid. Recovery is hard, and having difficult days does not mean you have failed. You are still here, and that takes incredible strength. Would you like to talk about what is making today particularly challenging?",
        createMockContext({
          sessionState: {
            startTime: Date.now(),
            lastActivity: Date.now(),
            messageCount: 10,
            crisisLevel: 4,
          },
        }),
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.empathyScore).toBeGreaterThan(0.9);
        expect(result.value.recoveryScore).toBeGreaterThan(0.9);
      }
    });
  });
});
