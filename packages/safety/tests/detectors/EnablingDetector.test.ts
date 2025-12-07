import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { EnablingDetector } from "../../src/detectors/EnablingDetector.js";

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: "span-123",
  traceId: "trace-123",
});

// Mock Anthropic client
const mockCreate = vi.fn();
const mockClient = {
  messages: {
    create: mockCreate,
  },
} as unknown as Anthropic;

describe("EnablingDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("preFilter", () => {
    const detector = new EnablingDetector(null);

    describe("glorification patterns", () => {
      it("should detect deserve a drink", () => {
        const matches = detector.preFilter(
          "You deserve a drink after all that",
        );
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("glorification");
        expect(matches.some((m) => m.pattern === "deserve_drink")).toBe(true);
      });

      it("should detect celebrate with drinks", () => {
        const matches = detector.preFilter("Let's celebrate with a beer!");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("glorification");
      });

      it("should detect romanticizing past use", () => {
        const matches = detector.preFilter(
          "Remember the good times when we used to party",
        );
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("glorification");
      });
    });

    describe("minimization patterns", () => {
      it("should detect just one drink", () => {
        const matches = detector.preFilter("Just one drink won't hurt you");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("minimization");
      });

      it("should detect not that bad", () => {
        const matches = detector.preFilter("It's not that bad once in a while");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("minimization");
      });

      it("should detect moderation is okay", () => {
        const matches = detector.preFilter("In moderation is fine");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("minimization");
      });

      it("should detect little bit never hurt", () => {
        const matches = detector.preFilter("A little bit won't hurt");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("minimization");
      });
    });

    describe("normalization patterns", () => {
      it("should detect everyone does it", () => {
        const matches = detector.preFilter("Everyone drinks socially");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("normalization");
      });

      it("should detect normal to want", () => {
        const matches = detector.preFilter(
          "It's normal to want a drink sometimes",
        );
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("normalization");
      });

      it("should detect part of life", () => {
        const matches = detector.preFilter("Drinking is just part of life");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("normalization");
      });
    });

    describe("permission patterns", () => {
      it("should detect go ahead", () => {
        const matches = detector.preFilter("Go ahead and have a drink");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("permission");
      });

      it("should detect treat yourself", () => {
        const matches = detector.preFilter("Treat yourself to a drink");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("permission");
      });

      it("should detect you can have", () => {
        const matches = detector.preFilter("You can have just one");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("permission");
      });

      it("should detect why not", () => {
        const matches = detector.preFilter("Why not have a little?");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].type).toBe("permission");
      });
    });

    describe("dampeners", () => {
      it("should reduce confidence when discussing past beliefs", () => {
        const text =
          "I used to think one drink wouldn't hurt, but now I know better";
        const matches = detector.preFilter(text);
        if (matches.length > 0) {
          expect(matches[0].confidence).toBeLessThan(0.5);
        }
      });

      it("should reduce confidence with recovery first statement", () => {
        const text =
          "Some say moderation is fine, but your recovery comes first";
        const matches = detector.preFilter(text);
        if (matches.length > 0) {
          expect(matches[0].confidence).toBeLessThan(0.5);
        }
      });

      it("should reduce confidence when correcting misconception", () => {
        const text =
          "People sometimes think everyone does it, but that's not true";
        const matches = detector.preFilter(text);
        if (matches.length > 0) {
          expect(matches[0].confidence).toBeLessThan(0.5);
        }
      });
    });

    describe("no matches", () => {
      it("should not match supportive recovery language", () => {
        const matches = detector.preFilter(
          "I'm proud of your sobriety journey",
        );
        expect(matches).toHaveLength(0);
      });

      it("should not match cravings acknowledgment without permission", () => {
        const matches = detector.preFilter(
          "I understand you have cravings. Let us work through this together.",
        );
        expect(matches).toHaveLength(0);
      });

      it("should not match relapse discussion without enabling", () => {
        const matches = detector.preFilter(
          "Relapse can be part of recovery, but it is not inevitable",
        );
        expect(matches).toHaveLength(0);
      });
    });
  });

  describe("analyzeLLM", () => {
    it("should return null when client is not provided", async () => {
      const detector = new EnablingDetector(null);
      const result = await detector.analyzeLLM(
        "test text",
        createTraceContext(),
      );
      expect(result).toBeNull();
    });

    it("should parse LLM response correctly", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              isEnabling: true,
              confidence: 0.85,
              reasoning: "Suggests user deserves alcohol as reward",
              type: "glorification",
            }),
          },
        ],
      });

      const detector = new EnablingDetector(mockClient);
      const result = await detector.analyzeLLM(
        "You deserve a drink",
        createTraceContext(),
      );

      expect(result).not.toBeNull();
      expect(result!.isEnabling).toBe(true);
      expect(result!.confidence).toBe(0.85);
      expect(result!.type).toBe("glorification");
    });

    it("should handle non-enabling response", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              isEnabling: false,
              confidence: 0.9,
              reasoning: "Supportive recovery message",
              type: null,
            }),
          },
        ],
      });

      const detector = new EnablingDetector(mockClient);
      const result = await detector.analyzeLLM(
        "Keep up the great work!",
        createTraceContext(),
      );

      expect(result).not.toBeNull();
      expect(result!.isEnabling).toBe(false);
      expect(result!.type).toBeNull();
    });

    it("should handle LLM errors gracefully", async () => {
      mockCreate.mockRejectedValue(new Error("API error"));

      const detector = new EnablingDetector(mockClient);
      const result = await detector.analyzeLLM("test", createTraceContext());

      expect(result).toBeNull();
    });

    it("should handle invalid JSON response", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: "I cannot analyze this properly",
          },
        ],
      });

      const detector = new EnablingDetector(mockClient);
      const result = await detector.analyzeLLM("test", createTraceContext());

      expect(result).toBeNull();
    });
  });

  describe("detect", () => {
    it("should return no enabling for supportive text", async () => {
      const detector = new EnablingDetector(null);
      const result = await detector.detect(
        "You're doing amazing in your recovery!",
        createTraceContext(),
        false,
      );

      expect(result.isEnabling).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.type).toBeNull();
    });

    it("should detect enabling without LLM", async () => {
      const detector = new EnablingDetector(null);
      const result = await detector.detect(
        "You deserve a drink after that hard day",
        createTraceContext(),
        false,
      );

      expect(result.isEnabling).toBe(true);
      expect(result.type).toBe("glorification");
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it("should use LLM for confirmation when enabled", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              isEnabling: true,
              confidence: 0.92,
              reasoning: "Gives permission to drink",
              type: "permission",
            }),
          },
        ],
      });

      const detector = new EnablingDetector(mockClient);
      const result = await detector.detect(
        "Go ahead and have a drink",
        createTraceContext(),
        true,
      );

      expect(result.isEnabling).toBe(true);
      expect(result.confidence).toBe(0.92);
      expect(result.type).toBe("permission");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("should fall back to prefilter when LLM fails", async () => {
      mockCreate.mockRejectedValue(new Error("API error"));

      const detector = new EnablingDetector(mockClient);
      const result = await detector.detect(
        "Just one drink will not hurt",
        createTraceContext(),
        true,
      );

      expect(result.isEnabling).toBe(true);
      expect(result.type).toBe("minimization");
    });
  });

  describe("detectViolations", () => {
    it("should return SafetyViolation for enabling language", async () => {
      const detector = new EnablingDetector(null);
      const violations = await detector.detectViolations(
        "You deserve a drink!",
        createTraceContext(),
        false,
      );

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        type: "enabling_language",
        severity: expect.stringMatching(/medium|high/),
      });
      expect(violations[0].description).toContain("glorification");
    });

    it("should return empty for supportive text", async () => {
      const detector = new EnablingDetector(null);
      const violations = await detector.detectViolations(
        "Stay strong, you can do this!",
        createTraceContext(),
        false,
      );

      expect(violations).toHaveLength(0);
    });

    it("should return high severity for high confidence", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              isEnabling: true,
              confidence: 0.95,
              reasoning: "Explicit permission to drink",
              type: "permission",
            }),
          },
        ],
      });

      const detector = new EnablingDetector(mockClient);
      const violations = await detector.detectViolations(
        "Go ahead and have as many drinks as you want!",
        createTraceContext(),
        true,
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe("high");
    });
  });

  describe("recovery context", () => {
    const detector = new EnablingDetector(null);

    it("should not flag relapse prevention discussion", async () => {
      const result = await detector.detect(
        "Relapse is a risk, but with support you can stay on track",
        createTraceContext(),
        false,
      );
      expect(result.isEnabling).toBe(false);
    });

    it("should not flag cravings validation", async () => {
      const result = await detector.detect(
        "Cravings are challenging but they will pass",
        createTraceContext(),
        false,
      );
      expect(result.isEnabling).toBe(false);
    });

    it("should not flag trigger discussion", async () => {
      const result = await detector.detect(
        "What triggers do you face? Let us develop a plan to handle them",
        createTraceContext(),
        false,
      );
      expect(result.isEnabling).toBe(false);
    });

    it("should not flag sponsor recommendation", async () => {
      const result = await detector.detect(
        "Have you reached out to your sponsor today?",
        createTraceContext(),
        false,
      );
      expect(result.isEnabling).toBe(false);
    });

    it("should not flag meeting encouragement", async () => {
      const result = await detector.detect(
        "Going to a meeting might help you feel supported",
        createTraceContext(),
        false,
      );
      expect(result.isEnabling).toBe(false);
    });
  });
});
