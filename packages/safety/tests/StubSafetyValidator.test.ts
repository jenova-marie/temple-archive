import { describe, it, expect, vi, beforeEach } from "vitest";
import { StubSafetyValidator } from "../src/StubSafetyValidator.js";
import type {
  TraceContext,
  AssembledContext,
  SafetyViolation,
} from "@siri/types";

// Mock observability
vi.mock("@siri/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
  pipelineMetrics: {
    safetyViolations: { add: vi.fn() },
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

describe("StubSafetyValidator", () => {
  let validator: StubSafetyValidator;
  let ctx: TraceContext;
  let mockContext: AssembledContext;

  beforeEach(() => {
    validator = new StubSafetyValidator();
    ctx = createTraceContext();
    mockContext = createMockContext();
  });

  describe("validate", () => {
    describe("passing validation", () => {
      it("returns passed=true for safe content", async () => {
        const output =
          "I hear you. Recovery is a journey, and I am here to support you.";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(true);
          expect(result.value.violations).toHaveLength(0);
        }
      });

      it("includes processing time", async () => {
        const output = "Thank you for sharing.";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.processingTimeMs).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe("PII detection", () => {
      it("detects SSN pattern", async () => {
        const output = "Your SSN is 123-45-6789";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(false);
          expect(result.value.violations).toHaveLength(1);
          expect(result.value.violations[0].type).toBe("pii");
          expect(result.value.violations[0].severity).toBe("critical");
        }
      });

      it("does not flag partial SSN patterns", async () => {
        const output = "The code is 123-45";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(true);
          expect(
            result.value.violations.filter((v) => v.type === "pii"),
          ).toHaveLength(0);
        }
      });
    });

    describe("medical advice detection", () => {
      it("detects dosage recommendations in mg", async () => {
        const output = "You should take 500 mg of acetaminophen";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(false);
          expect(
            result.value.violations.some((v) => v.type === "medical_advice"),
          ).toBe(true);
        }
      });

      it("detects dosage recommendations with pills", async () => {
        const output = "Take 2 pills before bed";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(false);
          expect(
            result.value.violations.some((v) => v.type === "medical_advice"),
          ).toBe(true);
        }
      });

      it("detects dosage recommendations with tablets", async () => {
        const output = "Take 3 tablets daily";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(false);
        }
      });

      it("does not flag general medication mentions", async () => {
        const output = "Please consult your doctor about your medication";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(true);
        }
      });
    });

    describe("multiple violations", () => {
      it("detects multiple violations in same output", async () => {
        const output = "Your SSN 123-45-6789 shows you should take 50 mg daily";

        const result = await validator.validate(output, mockContext, ctx);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.passed).toBe(false);
          expect(result.value.violations.length).toBeGreaterThanOrEqual(2);
          expect(result.value.violations.some((v) => v.type === "pii")).toBe(
            true,
          );
          expect(
            result.value.violations.some((v) => v.type === "medical_advice"),
          ).toBe(true);
        }
      });
    });
  });

  describe("mock violations", () => {
    it("includes mock violations in result", async () => {
      const mockViolation: SafetyViolation = {
        type: "harmful_content",
        severity: "high",
        description: "Mock harmful content violation",
      };
      validator.addMockViolation(mockViolation);

      const result = await validator.validate("Safe content", mockContext, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.passed).toBe(false);
        expect(result.value.violations).toContainEqual(mockViolation);
      }
    });

    it("combines mock and detected violations", async () => {
      const mockViolation: SafetyViolation = {
        type: "harmful_content",
        severity: "medium",
        description: "Mock violation",
      };
      validator.addMockViolation(mockViolation);

      const result = await validator.validate(
        "SSN: 123-45-6789",
        mockContext,
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.violations.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("clears mock violations", async () => {
      validator.addMockViolation({
        type: "test",
        severity: "low",
        description: "Test",
      });
      validator.clearMockViolations();

      const result = await validator.validate("Safe content", mockContext, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.passed).toBe(true);
        expect(result.value.violations).toHaveLength(0);
      }
    });

    it("accumulates multiple mock violations", async () => {
      validator.addMockViolation({
        type: "type1",
        severity: "low",
        description: "First",
      });
      validator.addMockViolation({
        type: "type2",
        severity: "medium",
        description: "Second",
      });

      const result = await validator.validate("Safe content", mockContext, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.violations).toHaveLength(2);
      }
    });
  });
});
