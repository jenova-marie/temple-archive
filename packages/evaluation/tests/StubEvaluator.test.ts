import { describe, it, expect, vi, beforeEach } from "vitest";
import { StubEvaluator } from "../src/StubEvaluator.js";
import type { TraceContext, AssembledContext } from "@pippa/types";

// Mock observability
vi.mock("@pippa/observability", () => ({
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

describe("StubEvaluator", () => {
  let evaluator: StubEvaluator;
  let ctx: TraceContext;
  let mockContext: AssembledContext;

  beforeEach(() => {
    evaluator = new StubEvaluator();
    ctx = createTraceContext();
    mockContext = createMockContext();
  });

  describe("evaluate", () => {
    describe("overall score calculation", () => {
      it("returns evaluation result with all scores", async () => {
        const userMessage = "I am struggling with cravings today";
        const response =
          "I hear you. That must be really difficult. Recovery takes courage and I am here to support you.";

        const result = await evaluator.evaluate(
          userMessage,
          response,
          mockContext,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.qualityScore).toBeGreaterThanOrEqual(0);
          expect(result.value.qualityScore).toBeLessThanOrEqual(1);
          expect(result.value.relevanceScore).toBeGreaterThanOrEqual(0);
          expect(result.value.relevanceScore).toBeLessThanOrEqual(1);
          expect(result.value.empathyScore).toBeGreaterThanOrEqual(0);
          expect(result.value.empathyScore).toBeLessThanOrEqual(1);
          expect(result.value.recoveryScore).toBeGreaterThanOrEqual(0);
          expect(result.value.recoveryScore).toBeLessThanOrEqual(1);
          expect(result.value.overallScore).toBeGreaterThanOrEqual(0);
          expect(result.value.overallScore).toBeLessThanOrEqual(1);
        }
      });

      it("calculates overall score as weighted average", async () => {
        evaluator.setMockScores({
          qualityScore: 0.8,
          relevanceScore: 0.6,
          empathyScore: 0.9,
          recoveryScore: 0.7,
        });

        const result = await evaluator.evaluate(
          "test",
          "test response",
          mockContext,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Overall = 0.8*0.2 + 0.6*0.3 + 0.9*0.3 + 0.7*0.2
          // = 0.16 + 0.18 + 0.27 + 0.14 = 0.75
          expect(result.value.overallScore).toBeCloseTo(0.75, 2);
        }
      });
    });

    describe("quality score", () => {
      it("gives higher score for well-formatted responses", async () => {
        const userMessage = "Hello";
        const goodResponse =
          "Hello! I am here to support you on your recovery journey. How are you feeling today?";
        const shortResponse = "Hi";

        const goodResult = await evaluator.evaluate(
          userMessage,
          goodResponse,
          mockContext,
          ctx,
        );
        const shortResult = await evaluator.evaluate(
          userMessage,
          shortResponse,
          mockContext,
          ctx,
        );

        expect(goodResult.ok).toBe(true);
        expect(shortResult.ok).toBe(true);
        if (goodResult.ok && shortResult.ok) {
          expect(goodResult.value.qualityScore).toBeGreaterThan(
            shortResult.value.qualityScore,
          );
        }
      });

      it("rewards proper punctuation", async () => {
        const withPunctuation =
          "I understand how you feel. Recovery is a journey.";
        const withoutPunctuation =
          "I understand how you feel recovery is a journey";

        const withResult = await evaluator.evaluate(
          "test",
          withPunctuation,
          mockContext,
          ctx,
        );
        const withoutResult = await evaluator.evaluate(
          "test",
          withoutPunctuation,
          mockContext,
          ctx,
        );

        expect(withResult.ok).toBe(true);
        expect(withoutResult.ok).toBe(true);
        if (withResult.ok && withoutResult.ok) {
          expect(withResult.value.qualityScore).toBeGreaterThanOrEqual(
            withoutResult.value.qualityScore,
          );
        }
      });
    });

    describe("relevance score", () => {
      it("gives higher score when response relates to user message", async () => {
        const userMessage = "I am having cravings for alcohol";
        const relevantResponse =
          "I hear you about the cravings. When cravings for alcohol arise, it can help to use coping strategies.";
        const irrelevantResponse =
          "The weather is nice today. Would you like to go for a walk?";

        const relevantResult = await evaluator.evaluate(
          userMessage,
          relevantResponse,
          mockContext,
          ctx,
        );
        const irrelevantResult = await evaluator.evaluate(
          userMessage,
          irrelevantResponse,
          mockContext,
          ctx,
        );

        expect(relevantResult.ok).toBe(true);
        expect(irrelevantResult.ok).toBe(true);
        if (relevantResult.ok && irrelevantResult.ok) {
          expect(relevantResult.value.relevanceScore).toBeGreaterThan(
            irrelevantResult.value.relevanceScore,
          );
        }
      });
    });

    describe("empathy score", () => {
      it("rewards empathetic phrases", async () => {
        const empatheticResponse =
          "I understand how difficult this must be for you. I hear you and you are not alone in this.";
        const flatResponse = "Recovery takes time. Here are some resources.";

        const empatheticResult = await evaluator.evaluate(
          "test",
          empatheticResponse,
          mockContext,
          ctx,
        );
        const flatResult = await evaluator.evaluate(
          "test",
          flatResponse,
          mockContext,
          ctx,
        );

        expect(empatheticResult.ok).toBe(true);
        expect(flatResult.ok).toBe(true);
        if (empatheticResult.ok && flatResult.ok) {
          expect(empatheticResult.value.empathyScore).toBeGreaterThan(
            flatResult.value.empathyScore,
          );
        }
      });

      it('detects "I hear you" phrase', async () => {
        const response = "I hear you and I am here to support you.";

        const result = await evaluator.evaluate(
          "test",
          response,
          mockContext,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.empathyScore).toBeGreaterThan(0.5);
        }
      });

      it('detects "Thank you for sharing" phrase', async () => {
        const response =
          "Thank you for sharing this with me. It takes courage.";

        const result = await evaluator.evaluate(
          "test",
          response,
          mockContext,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.empathyScore).toBeGreaterThan(0.5);
        }
      });
    });

    describe("recovery score", () => {
      it("rewards recovery-positive language", async () => {
        const positiveResponse =
          "Your progress in recovery is inspiring. Let us find a support meeting and connect with your sponsor.";
        const neutralResponse = "I see. How do you feel about that?";

        const positiveResult = await evaluator.evaluate(
          "test",
          positiveResponse,
          mockContext,
          ctx,
        );
        const neutralResult = await evaluator.evaluate(
          "test",
          neutralResponse,
          mockContext,
          ctx,
        );

        expect(positiveResult.ok).toBe(true);
        expect(neutralResult.ok).toBe(true);
        if (positiveResult.ok && neutralResult.ok) {
          expect(positiveResult.value.recoveryScore).toBeGreaterThan(
            neutralResult.value.recoveryScore,
          );
        }
      });

      it("penalizes enabling language", async () => {
        const harmfulResponse =
          "Just one drink probably would not hurt. You deserve to relax.";
        const safeResponse =
          "I understand you are struggling. Let us talk about coping strategies.";

        const harmfulResult = await evaluator.evaluate(
          "test",
          harmfulResponse,
          mockContext,
          ctx,
        );
        const safeResult = await evaluator.evaluate(
          "test",
          safeResponse,
          mockContext,
          ctx,
        );

        expect(harmfulResult.ok).toBe(true);
        expect(safeResult.ok).toBe(true);
        if (harmfulResult.ok && safeResult.ok) {
          expect(harmfulResult.value.recoveryScore).toBeLessThan(
            safeResult.value.recoveryScore,
          );
        }
      });

      it("score is capped between 0 and 1", async () => {
        // Response with many positive indicators
        const superPositive =
          "Great progress in recovery! Let us find support meetings and coping strategies. Your strength and help from your sponsor is amazing.";

        const result = await evaluator.evaluate(
          "test",
          superPositive,
          mockContext,
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.recoveryScore).toBeLessThanOrEqual(1);
          expect(result.value.recoveryScore).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });

  describe("mock scores", () => {
    it("uses mock scores when set", async () => {
      evaluator.setMockScores({
        qualityScore: 0.95,
        empathyScore: 0.85,
      });

      const result = await evaluator.evaluate(
        "test",
        "short",
        mockContext,
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qualityScore).toBe(0.95);
        expect(result.value.empathyScore).toBe(0.85);
      }
    });

    it("clears mock scores", async () => {
      evaluator.setMockScores({ qualityScore: 1.0 });
      evaluator.clearMockScores();

      const result = await evaluator.evaluate("test", "Hi", mockContext, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qualityScore).toBeLessThan(1.0);
      }
    });

    it("only overrides specified scores", async () => {
      evaluator.setMockScores({ qualityScore: 0.99 });

      const result = await evaluator.evaluate(
        "test",
        "response",
        mockContext,
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qualityScore).toBe(0.99);
        // Other scores should be calculated normally
        expect(result.value.relevanceScore).not.toBe(0.99);
      }
    });
  });
});
