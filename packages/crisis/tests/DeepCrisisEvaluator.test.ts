import { describe, it, expect, beforeEach, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { DeepCrisisEvaluator } from "../src/DeepCrisisEvaluator.js";

// Mock Anthropic client
const mockCreate = vi.fn();
const mockClient = {
  messages: {
    create: mockCreate,
  },
} as unknown as Anthropic;

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: "span-123",
  traceId: "trace-123",
});

describe("DeepCrisisEvaluator", () => {
  let evaluator: DeepCrisisEvaluator;

  beforeEach(() => {
    vi.clearAllMocks();
    evaluator = new DeepCrisisEvaluator(mockClient);
  });

  describe("evaluate", () => {
    it("should return empty result for trivial messages (< 20 chars)", async () => {
      const ctx = createTraceContext();
      const result = await evaluator.evaluate("Hello", [], ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(1);
        expect(result.value.patterns).toHaveLength(0);
        expect(result.value.action).toBe("none");
      }

      // Should not call API for short messages
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should detect crisis from LLM response", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: true,
              level: 8,
              patterns: [
                {
                  type: "suicidal_ideation",
                  confidence: 0.9,
                  reasoning:
                    "User expresses hopelessness and desire to end pain",
                },
              ],
              requiresEscalation: true,
            }),
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "I cannot go on anymore, the pain is too much to bear and I see no way out of this darkness",
        ["user: I feel so alone", "assistant: I am here for you"],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(8);
        expect(result.value.patterns).toHaveLength(1);
        expect(result.value.patterns[0].type).toBe("suicidal_ideation");
        expect(result.value.action).toBe("inject_resources");
        expect(result.value.triggerEmergency).toBe(false);
      }
    });

    it("should return emergency for level 9+", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: true,
              level: 10,
              patterns: [
                {
                  type: "suicidal_ideation",
                  confidence: 1.0,
                  reasoning: "Explicit statement of intent to end life tonight",
                },
              ],
              requiresEscalation: true,
            }),
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "I have made my decision and tonight I will end everything. Goodbye.",
        [],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(10);
        expect(result.value.triggerEmergency).toBe(true);
        expect(result.value.action).toBe("emergency_protocol");
      }
    });

    it("should handle no crisis detected", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: false,
              level: 2,
              patterns: [],
              requiresEscalation: false,
            }),
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "I am having a good day today and making progress in my recovery journey",
        [],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(2);
        expect(result.value.patterns).toHaveLength(0);
        expect(result.value.action).toBe("none");
        expect(result.value.triggerEmergency).toBe(false);
      }
    });

    it("should handle LLM response with extra text around JSON", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text:
              "Here is my analysis:\n" +
              JSON.stringify({
                crisisDetected: true,
                level: 6,
                patterns: [
                  {
                    type: "severe_distress",
                    confidence: 0.7,
                    reasoning: "Elevated stress",
                  },
                ],
                requiresEscalation: false,
              }) +
              "\n\nLet me know if you need more details.",
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "I am feeling overwhelmed and cannot cope with everything right now",
        [],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(6);
        expect(result.value.action).toBe("monitor");
      }
    });

    it("should handle invalid JSON response gracefully", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: "I cannot provide a proper JSON response",
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "This is a test message that is long enough to process",
        [],
        ctx,
      );

      // Should return empty result on parse failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(1);
        expect(result.value.patterns).toHaveLength(0);
      }
    });

    it("should handle API errors", async () => {
      mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "This is a test message that should trigger an API call",
        [],
        ctx,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("EvaluationError");
        expect(result.error.message).toContain("API rate limit exceeded");
      }
    });

    it("should handle timeout (AbortError)", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockCreate.mockRejectedValue(abortError);

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "This message should timeout during processing",
        [],
        ctx,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("TimeoutError");
      }
    });

    it("should validate unknown pattern types to severe_distress", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: true,
              level: 5,
              patterns: [
                {
                  type: "unknown_crisis_type",
                  confidence: 0.6,
                  reasoning: "Some distress indicator",
                },
              ],
              requiresEscalation: false,
            }),
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "I am experiencing some unknown type of distress",
        [],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.patterns[0].type).toBe("severe_distress");
      }
    });

    it("should clamp level to valid range (1-10)", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: true,
              level: 15, // Invalid - too high
              patterns: [],
              requiresEscalation: true,
            }),
          },
        ],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "Test message with invalid level response",
        [],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(10); // Clamped to max
      }
    });

    it("should include conversation history in prompt", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: false,
              level: 2,
              patterns: [],
              requiresEscalation: false,
            }),
          },
        ],
      });

      const ctx = createTraceContext();
      const history = [
        "user: I am struggling today",
        "assistant: I hear you. Can you tell me more?",
        "user: Everything feels hard",
      ];

      await evaluator.evaluate(
        "I do not know what to do anymore",
        history,
        ctx,
      );

      // Verify API was called with history
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain(
        "[1] user: I am struggling today",
      );
      expect(callArgs.messages[0].content).toContain(
        "[2] assistant: I hear you",
      );
      expect(callArgs.messages[0].content).toContain(
        "[3] user: Everything feels hard",
      );
    });

    it("should handle empty response content", async () => {
      mockCreate.mockResolvedValue({
        content: [],
      });

      const ctx = createTraceContext();
      const result = await evaluator.evaluate(
        "Test message with empty API response content",
        [],
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(1);
      }
    });
  });

  describe("configuration", () => {
    it("should use custom model when configured", async () => {
      const customEvaluator = new DeepCrisisEvaluator(mockClient, {
        model: "claude-3-opus-20240229",
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: false,
              level: 1,
              patterns: [],
              requiresEscalation: false,
            }),
          },
        ],
      });

      await customEvaluator.evaluate(
        "Test with custom model configuration",
        [],
        createTraceContext(),
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-opus-20240229",
        }),
        expect.anything(),
      );
    });

    it("should use custom maxTokens when configured", async () => {
      const customEvaluator = new DeepCrisisEvaluator(mockClient, {
        maxTokens: 256,
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              crisisDetected: false,
              level: 1,
              patterns: [],
              requiresEscalation: false,
            }),
          },
        ],
      });

      await customEvaluator.evaluate(
        "Test with custom tokens config",
        [],
        createTraceContext(),
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 256,
        }),
        expect.anything(),
      );
    });
  });
});
