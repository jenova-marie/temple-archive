import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeywordCrisisDetector } from "../src/KeywordCrisisDetector.js";
import type { TraceContext } from "@recoverysky/types";

// Mock observability to avoid side effects
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
  pipelineMetrics: {
    crisisDetections: {
      add: vi.fn(),
    },
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

describe("KeywordCrisisDetector", () => {
  let detector: KeywordCrisisDetector;
  let ctx: TraceContext;

  beforeEach(() => {
    detector = new KeywordCrisisDetector();
    ctx = createTraceContext();
  });

  describe("constructor", () => {
    it("uses default config values", () => {
      const d = new KeywordCrisisDetector();
      expect(d).toBeInstanceOf(KeywordCrisisDetector);
    });

    it("accepts custom config", () => {
      const d = new KeywordCrisisDetector({
        emergencyThreshold: 8,
        resourceThreshold: 5,
      });
      expect(d).toBeInstanceOf(KeywordCrisisDetector);
    });
  });

  describe("detect", () => {
    describe("no crisis", () => {
      it("returns level 1 for normal messages", async () => {
        const result = await detector.detect("Hello, how are you today?", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBe(1);
          expect(result.value.patterns).toHaveLength(0);
          expect(result.value.action).toBe("none");
          expect(result.value.triggerEmergency).toBe(false);
        }
      });

      it("returns level 1 for recovery-positive messages", async () => {
        const result = await detector.detect(
          "I am 30 days sober and feeling great!",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBe(1);
          expect(result.value.action).toBe("none");
        }
      });
    });

    describe("suicidal ideation detection", () => {
      it("detects explicit suicidal statements", async () => {
        const result = await detector.detect("I want to kill myself", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(9);
          expect(result.value.triggerEmergency).toBe(true);
          expect(result.value.action).toBe("emergency_protocol");
          expect(
            result.value.patterns.some((p) => p.type === "suicidal_ideation"),
          ).toBe(true);
        }
      });

      it('detects "end it all" phrase', async () => {
        const result = await detector.detect("I just want to end it all", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(9);
          expect(result.value.triggerEmergency).toBe(true);
        }
      });

      it('detects "no point in living" phrase', async () => {
        const result = await detector.detect(
          "There is no point in living anymore",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(9);
          expect(
            result.value.patterns.some((p) => p.type === "suicidal_ideation"),
          ).toBe(true);
        }
      });

      it("boosts level with urgency keywords", async () => {
        const result = await detector.detect(
          "I decided to end it all tonight, goodbye everyone",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBe(10);
        }
      });
    });

    describe("self harm detection", () => {
      it("detects self harm intent", async () => {
        const result = await detector.detect("I want to cut myself", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(8);
          expect(
            result.value.patterns.some((p) => p.type === "self_harm"),
          ).toBe(true);
        }
      });

      it("detects self-harm keyword", async () => {
        const result = await detector.detect(
          "I have been thinking about self-harm again",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(8);
        }
      });
    });

    describe("overdose risk detection", () => {
      it("detects overdose intent", async () => {
        const result = await detector.detect(
          "I took too many pills intentionally",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(9);
          expect(
            result.value.patterns.some((p) => p.type === "overdose_risk"),
          ).toBe(true);
        }
      });

      it("detects overdose keyword", async () => {
        const result = await detector.detect("I might overdose tonight", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(9);
          expect(result.value.triggerEmergency).toBe(true);
        }
      });
    });

    describe("violence risk detection", () => {
      it("detects violence intent toward others", async () => {
        const result = await detector.detect("I want to hurt someone", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(8);
          expect(
            result.value.patterns.some((p) => p.type === "violence_risk"),
          ).toBe(true);
        }
      });

      it("detects violent urges", async () => {
        const result = await detector.detect(
          "I have violent thoughts about my neighbor",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(8);
        }
      });
    });

    describe("relapse detection", () => {
      it("detects active relapse", async () => {
        const result = await detector.detect("I relapsed again today", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(8);
          expect(
            result.value.patterns.some((p) => p.type === "active_relapse"),
          ).toBe(true);
        }
      });

      it("detects imminent relapse", async () => {
        const result = await detector.detect("I am about to use again", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(7);
          expect(result.value.action).toBe("inject_resources");
        }
      });

      it("detects dealer contact", async () => {
        const result = await detector.detect(
          "I contacted my dealer today",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(7);
          expect(
            result.value.patterns.some((p) => p.type === "imminent_relapse"),
          ).toBe(true);
        }
      });
    });

    describe("severe distress detection", () => {
      it("detects inability to cope", async () => {
        const result = await detector.detect("I can't take it anymore", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(6);
          expect(
            result.value.patterns.some((p) => p.type === "severe_distress"),
          ).toBe(true);
        }
      });

      it("detects panic attack mention", async () => {
        const result = await detector.detect(
          "I am having a panic attack right now",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(4);
        }
      });
    });

    describe("hopelessness detection", () => {
      it("detects lost hope", async () => {
        const result = await detector.detect(
          "I have no hope left anymore",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(5);
          expect(
            result.value.patterns.some((p) => p.type === "hopelessness"),
          ).toBe(true);
        }
      });

      it("detects giving up", async () => {
        const result = await detector.detect(
          "I have given up on everything",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(5);
        }
      });
    });

    describe("isolation detection", () => {
      it("detects complete isolation", async () => {
        const result = await detector.detect(
          "I am completely alone, no one cares about me",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(4);
          expect(
            result.value.patterns.some((p) => p.type === "isolation"),
          ).toBe(true);
        }
      });
    });

    describe("action determination", () => {
      it("returns monitor action for level 4-6", async () => {
        const result = await detector.detect(
          "I feel completely alone and isolated",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.level).toBeGreaterThanOrEqual(4);
          expect(result.value.level).toBeLessThan(7);
          expect(result.value.action).toBe("monitor");
        }
      });

      it("returns inject_resources for level 7-8", async () => {
        const result = await detector.detect(
          "I am about to use drugs again",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe("inject_resources");
        }
      });

      it("returns emergency_protocol for level 9-10", async () => {
        const result = await detector.detect("I want to kill myself now", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe("emergency_protocol");
        }
      });
    });

    describe("performance", () => {
      it("completes detection in under 10ms", async () => {
        const result = await detector.detect(
          "This is a test message with some crisis keywords like suicide and relapse",
          ctx,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.processingTimeMs).toBeLessThan(10);
        }
      });
    });

    describe("pattern matching details", () => {
      it("includes matched text in pattern", async () => {
        const result = await detector.detect("I want to kill myself", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const pattern = result.value.patterns.find(
            (p) => p.type === "suicidal_ideation",
          );
          expect(pattern).toBeDefined();
          expect(pattern?.matchedText).toBeDefined();
        }
      });

      it("includes position in pattern", async () => {
        const result = await detector.detect("I feel suicidal today", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const pattern = result.value.patterns.find(
            (p) => p.type === "suicidal_ideation",
          );
          expect(pattern?.position).toBeDefined();
          expect(pattern?.position?.start).toBeGreaterThanOrEqual(0);
        }
      });

      it("calculates confidence based on boost keywords", async () => {
        const result = await detector.detect("I want to die tonight", ctx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const pattern = result.value.patterns[0];
          expect(pattern.confidence).toBeGreaterThan(0.6);
        }
      });
    });
  });
});
