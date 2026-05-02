import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  getMinimalSystemPrompt,
} from "../src/systemPrompt.js";
import type {
  AssembledContext,
  CrisisCheckResult,
  UserProfile,
  SessionState,
  SessionEntities,
} from "@siri/types";

function createMinimalContext(): AssembledContext {
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

function createUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "user-1",
    recoveryPhase: "maintenance",
    recoveryDate: "2024-01-01",
    triggers: ["stress", "social events"],
    copingStrategies: ["meditation", "exercise"],
    supportNetwork: [],
    preferences: { tone: "encouraging" },
    milestones: [],
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  describe("base identity", () => {
    it("includes default fallback persona when no baseIdentity provided", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt(context);

      // The fallback BASE_IDENTITY is a placeholder that gets overridden in production
      // via the baseIdentity option (loaded from database)
      expect(prompt).toContain("You are Dizzy");
    });

    it("uses provided baseIdentity when available", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt({
        context,
        baseIdentity:
          "You are Sky, a compassionate AI companion for addiction recovery support.",
      });

      expect(prompt).toContain("You are Sky");
      expect(prompt).toContain("compassionate");
      expect(prompt).toContain("addiction recovery");
    });

    it("includes recovery guidelines in all cases", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt(context);

      // Recovery guidelines are always included regardless of base identity
      expect(prompt).toContain("triggers");
      expect(prompt).toContain("coping strategies");
    });
  });

  describe("user context section", () => {
    it("includes recovery phase when available", () => {
      const context = createMinimalContext();
      context.userProfile = createUserProfile({ recoveryPhase: "early" });

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Recovery Phase");
      expect(prompt).toContain("early");
    });

    it("calculates recovery days correctly", () => {
      const context = createMinimalContext();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      context.userProfile = createUserProfile({
        recoveryDate: thirtyDaysAgo.toISOString().split("T")[0],
      });

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Recovery");
      expect(prompt).toMatch(/\d+ days/);
    });

    it("includes triggers", () => {
      const context = createMinimalContext();
      context.userProfile = createUserProfile({
        triggers: ["stress", "loneliness"],
      });

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Known Triggers");
      expect(prompt).toContain("stress");
      expect(prompt).toContain("loneliness");
    });

    it("includes coping strategies", () => {
      const context = createMinimalContext();
      context.userProfile = createUserProfile({
        copingStrategies: ["walking", "journaling"],
      });

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Coping Strategies");
      expect(prompt).toContain("walking");
      expect(prompt).toContain("journaling");
    });

    it("includes preferred communication style", () => {
      const context = createMinimalContext();
      context.userProfile = createUserProfile({
        preferences: { tone: "direct and practical" },
      });

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Communication Style");
      expect(prompt).toContain("direct and practical");
    });

    it("omits user context section when no profile", () => {
      const context = createMinimalContext();
      context.userProfile = null;

      const prompt = buildSystemPrompt(context);

      expect(prompt).not.toContain("## User Context");
    });
  });

  describe("session context section", () => {
    it("includes current topic when set", () => {
      const context = createMinimalContext();
      context.sessionState.currentTopic = "dealing with cravings";

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Current Topic");
      expect(prompt).toContain("dealing with cravings");
    });

    it("includes recent emotions", () => {
      const context = createMinimalContext();
      context.sessionEntities.emotions = ["anxious", "hopeful"];

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Recent Emotions");
      expect(prompt).toContain("anxious");
      expect(prompt).toContain("hopeful");
    });

    it("includes recent events", () => {
      const context = createMinimalContext();
      context.sessionEntities.events = ["job interview", "family dinner"];

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Recent Events");
      expect(prompt).toContain("job interview");
    });

    it("includes topics from previous sessions", () => {
      const context = createMinimalContext();
      context.previousSessions = [
        {
          conversationId: "conv-prev",
          date: new Date().toISOString(),
          summary: "Discussed triggers",
          keyTopics: ["triggers", "work stress"],
          emotionalTone: "anxious",
        },
      ];

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Previous Topics");
      expect(prompt).toContain("triggers");
    });
  });

  describe("crisis instructions", () => {
    it("does not include crisis section for low levels", () => {
      const context = createMinimalContext();
      const crisisCheck: CrisisCheckResult = {
        level: 2,
        patterns: [],
        triggerEmergency: false,
        action: "none",
        processingTimeMs: 5,
      };

      const prompt = buildSystemPrompt(context, crisisCheck);

      expect(prompt).not.toContain("CRISIS");
      expect(prompt).not.toContain("Elevated Concern");
    });

    it("includes elevated concern for level 4-6", () => {
      const context = createMinimalContext();
      const crisisCheck: CrisisCheckResult = {
        level: 5,
        patterns: [],
        triggerEmergency: false,
        action: "monitor",
        processingTimeMs: 5,
      };

      const prompt = buildSystemPrompt(context, crisisCheck);

      expect(prompt).toContain("Elevated Concern");
      expect(prompt).toContain("Level 5");
    });

    it("includes elevated crisis for level 7-8", () => {
      const context = createMinimalContext();
      const crisisCheck: CrisisCheckResult = {
        level: 7,
        patterns: [],
        triggerEmergency: false,
        action: "inject_resources",
        processingTimeMs: 5,
      };

      const prompt = buildSystemPrompt(context, crisisCheck);

      expect(prompt).toContain("ELEVATED CRISIS LEVEL");
      expect(prompt).toContain("Level 7");
      expect(prompt).toContain("Validate their feelings");
      expect(prompt).toContain("crisis resources");
    });

    it("includes critical crisis for level 9-10", () => {
      const context = createMinimalContext();
      const crisisCheck: CrisisCheckResult = {
        level: 9,
        patterns: [],
        triggerEmergency: true,
        action: "emergency_protocol",
        processingTimeMs: 5,
      };

      const prompt = buildSystemPrompt(context, crisisCheck);

      expect(prompt).toContain("CRITICAL CRISIS DETECTED");
      expect(prompt).toContain("Level 9");
      expect(prompt).toContain("immediate danger");
      expect(prompt).toContain("988");
    });
  });

  describe("recovery guidelines", () => {
    it("includes positive guidelines", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Celebrate milestones");
      expect(prompt).toContain("Validate");
      expect(prompt).toContain("support networks");
    });

    it("includes restrictions", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("Never suggest");
      expect(prompt).toContain("Don't minimize");
      expect(prompt).toContain("Avoid lecturing");
    });
  });

  describe("tool instructions", () => {
    it("includes available tools", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("findMeetings");
      expect(prompt).toContain("logMood");
      expect(prompt).toContain("getCrisisResources");
      expect(prompt).toContain("getResources");
    });
  });

  describe("safety boundaries", () => {
    it("includes safety restrictions", () => {
      const context = createMinimalContext();
      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain("must NEVER");
      expect(prompt).toContain("medical advice");
      expect(prompt).toContain("dosage");
      expect(prompt).toContain("self-harm");
    });
  });
});

describe("getMinimalSystemPrompt", () => {
  it("returns only base identity", () => {
    const prompt = getMinimalSystemPrompt();

    // Returns the fallback BASE_IDENTITY (placeholder for testing)
    expect(prompt).toContain("You are Dizzy");
    expect(prompt).not.toContain("## User Context");
    expect(prompt).not.toContain("## Current Session");
    expect(prompt).not.toContain("## Recovery-Specific Guidelines");
  });
});
