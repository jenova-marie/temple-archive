import { describe, it, expect, beforeEach } from "vitest";
import { StubCrisisHandler } from "../../src/stubs/StubCrisisHandler.js";
import type { TraceContext, CrisisCheckResult } from "@siri/types";

function createTraceContext(): TraceContext {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    requestId: "test-request-id",
    startTime: Date.now(),
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
    processingTimeMs: 1,
    ...overrides,
  };
}

describe("StubCrisisHandler", () => {
  let handler: StubCrisisHandler;
  let ctx: TraceContext;

  beforeEach(() => {
    handler = new StubCrisisHandler();
    ctx = createTraceContext();
  });

  describe("handle", () => {
    describe("low crisis levels (1-3)", () => {
      it("returns minimal response for level 1", async () => {
        const crisisResult = createCrisisResult({ level: 1 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.teamAlerted).toBe(false);
          expect(result.value.actionsTaken).toEqual([]);
          expect(result.value.prependMessage).toBeUndefined();
          expect(result.value.resources).toBeUndefined();
        }
      });

      it("returns minimal response for level 3", async () => {
        const crisisResult = createCrisisResult({ level: 3 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.teamAlerted).toBe(false);
          expect(result.value.actionsTaken).toEqual([]);
        }
      });
    });

    describe("moderate crisis levels (4-6)", () => {
      it("flags for review at level 4", async () => {
        const crisisResult = createCrisisResult({ level: 4 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.teamAlerted).toBe(false);
          expect(result.value.actionsTaken).toContain("flagged_for_review");
          expect(result.value.prependMessage).toBeUndefined();
        }
      });

      it("flags for review at level 6", async () => {
        const crisisResult = createCrisisResult({ level: 6 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.actionsTaken).toContain("flagged_for_review");
        }
      });
    });

    describe("high crisis levels (7-8)", () => {
      it("injects resources at level 7", async () => {
        const crisisResult = createCrisisResult({ level: 7 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.teamAlerted).toBe(false);
          expect(result.value.actionsTaken).toContain("resources_injected");
          expect(result.value.prependMessage).toBeDefined();
          expect(result.value.prependMessage).toContain("struggling");
          expect(result.value.resources).toBeDefined();
          expect(result.value.resources!.length).toBeGreaterThan(0);
        }
      });

      it("injects resources at level 8", async () => {
        const crisisResult = createCrisisResult({ level: 8 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.actionsTaken).toContain("resources_injected");
          expect(result.value.resources).toBeDefined();
        }
      });

      it("includes national and recovery resources", async () => {
        const crisisResult = createCrisisResult({ level: 7 });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Should have both national (988, crisis text line) and recovery resources
          expect(
            result.value.resources!.some((r) => r.contactValue === "988"),
          ).toBe(true);
        }
      });
    });

    describe("emergency crisis levels (9-10)", () => {
      it("alerts team at level 9", async () => {
        const crisisResult = createCrisisResult({
          level: 9,
          triggerEmergency: true,
        });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.teamAlerted).toBe(true);
          expect(result.value.actionsTaken).toContain("emergency_team_alerted");
          expect(result.value.prependMessage).toBeDefined();
          expect(result.value.prependMessage).toContain("🆘");
          expect(result.value.resources).toBeDefined();
        }
      });

      it("alerts team at level 10", async () => {
        const crisisResult = createCrisisResult({
          level: 10,
          triggerEmergency: true,
        });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.teamAlerted).toBe(true);
          expect(result.value.actionsTaken).toContain("emergency_team_alerted");
        }
      });

      it("includes national resources only for emergency", async () => {
        const crisisResult = createCrisisResult({
          level: 9,
          triggerEmergency: true,
        });

        const result = await handler.handle(
          crisisResult,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Emergency should prioritize national resources
          expect(
            result.value.resources!.some((r) => r.contactValue === "988"),
          ).toBe(true);
        }
      });
    });

    describe("triggerEmergency flag", () => {
      it("sets teamAlerted based on triggerEmergency", async () => {
        const crisisWithEmergency = createCrisisResult({
          level: 9,
          triggerEmergency: true,
        });
        const crisisWithoutEmergency = createCrisisResult({
          level: 9,
          triggerEmergency: false,
        });

        const resultWith = await handler.handle(
          crisisWithEmergency,
          "user-1",
          "conv-1",
          ctx,
        );
        const resultWithout = await handler.handle(
          crisisWithoutEmergency,
          "user-1",
          "conv-1",
          ctx,
        );

        expect(resultWith.ok && resultWith.value.teamAlerted).toBe(true);
        expect(resultWithout.ok && resultWithout.value.teamAlerted).toBe(false);
      });
    });
  });

  describe("getHandledCrises", () => {
    it("returns empty array initially", () => {
      expect(handler.getHandledCrises()).toEqual([]);
    });

    it("records handled crises", async () => {
      const crisisResult = createCrisisResult({ level: 5 });

      await handler.handle(crisisResult, "user-1", "conv-1", ctx);

      const handled = handler.getHandledCrises();
      expect(handled).toHaveLength(1);
      expect(handled[0].result).toEqual(crisisResult);
      expect(handled[0].userId).toBe("user-1");
      expect(handled[0].conversationId).toBe("conv-1");
      expect(handled[0].timestamp).toBeDefined();
    });

    it("records multiple crises", async () => {
      await handler.handle(
        createCrisisResult({ level: 3 }),
        "user-1",
        "conv-1",
        ctx,
      );
      await handler.handle(
        createCrisisResult({ level: 7 }),
        "user-2",
        "conv-2",
        ctx,
      );
      await handler.handle(
        createCrisisResult({ level: 9 }),
        "user-1",
        "conv-3",
        ctx,
      );

      const handled = handler.getHandledCrises();
      expect(handled).toHaveLength(3);
    });

    it("returns a copy of the array", async () => {
      await handler.handle(createCrisisResult(), "user-1", "conv-1", ctx);

      const handled1 = handler.getHandledCrises();
      const handled2 = handler.getHandledCrises();

      expect(handled1).not.toBe(handled2);
      expect(handled1).toEqual(handled2);
    });
  });

  describe("clear", () => {
    it("clears all handled crises", async () => {
      await handler.handle(
        createCrisisResult({ level: 5 }),
        "user-1",
        "conv-1",
        ctx,
      );
      await handler.handle(
        createCrisisResult({ level: 8 }),
        "user-2",
        "conv-2",
        ctx,
      );

      expect(handler.getHandledCrises()).toHaveLength(2);

      handler.clear();

      expect(handler.getHandledCrises()).toEqual([]);
    });
  });
});
