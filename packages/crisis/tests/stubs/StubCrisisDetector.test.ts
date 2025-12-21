import { describe, it, expect, beforeEach } from "vitest";
import { StubCrisisDetector } from "../../src/stubs/StubCrisisDetector.js";
import type { TraceContext, CrisisCheckResult } from "@pippa/types";

function createTraceContext(): TraceContext {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    requestId: "test-request-id",
    startTime: Date.now(),
  };
}

describe("StubCrisisDetector", () => {
  let detector: StubCrisisDetector;
  let ctx: TraceContext;

  beforeEach(() => {
    detector = new StubCrisisDetector();
    ctx = createTraceContext();
  });

  describe("detect", () => {
    it("returns default safe result", async () => {
      const result = await detector.detect("Hello, how are you?", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(1);
        expect(result.value.patterns).toEqual([]);
        expect(result.value.triggerEmergency).toBe(false);
        expect(result.value.action).toBe("none");
        expect(result.value.processingTimeMs).toBe(1);
      }
    });

    it("ignores message content (stub behavior)", async () => {
      // Even crisis messages return safe result without mock override
      const result = await detector.detect("I want to end my life", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(1);
        expect(result.value.action).toBe("none");
      }
    });
  });

  describe("setMockResult", () => {
    it("sets custom crisis level", async () => {
      detector.setMockResult({ level: 8 });

      const result = await detector.detect("Any message", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(8);
      }
    });

    it("sets emergency trigger", async () => {
      detector.setMockResult({
        level: 10,
        triggerEmergency: true,
        action: "emergency_protocol",
      });

      const result = await detector.detect("Any message", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triggerEmergency).toBe(true);
        expect(result.value.action).toBe("emergency_protocol");
      }
    });

    it("sets custom patterns", async () => {
      const patterns = [
        {
          type: "suicidal_ideation" as const,
          confidence: 0.9,
          matchedPhrase: "test phrase",
        },
      ];
      detector.setMockResult({ patterns });

      const result = await detector.detect("Any message", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.patterns).toEqual(patterns);
      }
    });

    it("merges with existing mock result", async () => {
      detector.setMockResult({ level: 5 });
      detector.setMockResult({ action: "monitor" });

      const result = await detector.detect("Any message", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(5);
        expect(result.value.action).toBe("monitor");
      }
    });
  });

  describe("reset", () => {
    it("resets to default safe result", async () => {
      detector.setMockResult({
        level: 10,
        triggerEmergency: true,
        action: "emergency_protocol",
        patterns: [
          {
            type: "suicidal_ideation",
            confidence: 0.95,
            matchedPhrase: "test",
          },
        ],
      });

      detector.reset();

      const result = await detector.detect("Any message", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.level).toBe(1);
        expect(result.value.patterns).toEqual([]);
        expect(result.value.triggerEmergency).toBe(false);
        expect(result.value.action).toBe("none");
      }
    });
  });

  describe("all action types", () => {
    it("supports none action", async () => {
      detector.setMockResult({ action: "none" });
      const result = await detector.detect("test", ctx);
      expect(result.ok && result.value.action).toBe("none");
    });

    it("supports monitor action", async () => {
      detector.setMockResult({ action: "monitor" });
      const result = await detector.detect("test", ctx);
      expect(result.ok && result.value.action).toBe("monitor");
    });

    it("supports inject_resources action", async () => {
      detector.setMockResult({ action: "inject_resources" });
      const result = await detector.detect("test", ctx);
      expect(result.ok && result.value.action).toBe("inject_resources");
    });

    it("supports emergency_protocol action", async () => {
      detector.setMockResult({ action: "emergency_protocol" });
      const result = await detector.detect("test", ctx);
      expect(result.ok && result.value.action).toBe("emergency_protocol");
    });
  });
});
