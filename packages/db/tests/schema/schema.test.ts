import { describe, it, expect } from "vitest";
import { users, type User, type NewUser } from "../../src/schema/users.js";
import {
  conversations,
  type Conversation,
  type NewConversation,
} from "../../src/schema/conversations.js";
import {
  messages,
  type DbMessage,
  type NewDbMessage,
} from "../../src/schema/messages.js";
import {
  sessionSummaries,
  type DbSessionSummary,
  type NewDbSessionSummary,
} from "../../src/schema/sessionSummaries.js";
import {
  userProfiles,
  type DbUserProfile,
  type NewDbUserProfile,
} from "../../src/schema/userProfiles.js";
import {
  crisisEvents,
  type DbCrisisEvent,
  type NewDbCrisisEvent,
} from "../../src/schema/crisisEvents.js";

describe("database schemas", () => {
  describe("users schema", () => {
    it("exports users table", () => {
      expect(users).toBeDefined();
    });

    it("has correct primary key", () => {
      // Drizzle table columns are accessible via $inferSelect type
      const tableColumns = Object.keys(users);
      expect(tableColumns).toContain("userId");
    });

    it("has email field", () => {
      const tableColumns = Object.keys(users);
      expect(tableColumns).toContain("email");
    });

    it("has displayName field", () => {
      const tableColumns = Object.keys(users);
      expect(tableColumns).toContain("displayName");
    });

    it("has timestamp fields", () => {
      const tableColumns = Object.keys(users);
      expect(tableColumns).toContain("createdAt");
      expect(tableColumns).toContain("updatedAt");
    });

    it("has metadata field", () => {
      const tableColumns = Object.keys(users);
      expect(tableColumns).toContain("metadata");
    });

    it("exports User type", () => {
      // Type check - this validates the types exist and compile
      const _user: User = {
        userId: "user-1",
        email: "test@example.com",
        displayName: "Test User",
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      };
      expect(_user.userId).toBe("user-1");
    });

    it("exports NewUser type with optional fields", () => {
      const _newUser: NewUser = {
        userId: "user-1",
      };
      expect(_newUser.userId).toBe("user-1");
    });
  });

  describe("conversations schema", () => {
    it("exports conversations table", () => {
      expect(conversations).toBeDefined();
    });

    it("has correct primary key", () => {
      const tableColumns = Object.keys(conversations);
      expect(tableColumns).toContain("conversationId");
    });

    it("has userId for foreign key", () => {
      const tableColumns = Object.keys(conversations);
      expect(tableColumns).toContain("userId");
    });

    it("has status field", () => {
      const tableColumns = Object.keys(conversations);
      expect(tableColumns).toContain("status");
    });

    it("has summary field", () => {
      const tableColumns = Object.keys(conversations);
      expect(tableColumns).toContain("summary");
    });

    it("exports Conversation type", () => {
      const _conv: Conversation = {
        conversationId: "conv-1",
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
        summary: null,
        metadata: {},
      };
      expect(_conv.conversationId).toBe("conv-1");
    });

    it("exports NewConversation type", () => {
      const _newConv: NewConversation = {
        conversationId: "conv-1",
        userId: "user-1",
      };
      expect(_newConv.conversationId).toBe("conv-1");
    });
  });

  describe("messages schema", () => {
    it("exports messages table", () => {
      expect(messages).toBeDefined();
    });

    it("has correct primary key", () => {
      const tableColumns = Object.keys(messages);
      expect(tableColumns).toContain("messageId");
    });

    it("has conversationId for foreign key", () => {
      const tableColumns = Object.keys(messages);
      expect(tableColumns).toContain("conversationId");
    });

    it("has userId for foreign key", () => {
      const tableColumns = Object.keys(messages);
      expect(tableColumns).toContain("userId");
    });

    it("has role field", () => {
      const tableColumns = Object.keys(messages);
      expect(tableColumns).toContain("role");
    });

    it("has content field", () => {
      const tableColumns = Object.keys(messages);
      expect(tableColumns).toContain("content");
    });

    // Note: embedding field removed - vectors stored in Qdrant (L4)

    it("exports DbMessage type", () => {
      const _msg: DbMessage = {
        messageId: "msg-1",
        conversationId: "conv-1",
        userId: "user-1",
        role: "user",
        content: "Hello",
        createdAt: new Date(),
        metadata: {},
      };
      expect(_msg.role).toBe("user");
    });

    it("exports NewDbMessage type", () => {
      const _newMsg: NewDbMessage = {
        messageId: "msg-1",
        conversationId: "conv-1",
        userId: "user-1",
        role: "assistant",
        content: "Hi there!",
      };
      expect(_newMsg.role).toBe("assistant");
    });
  });

  describe("sessionSummaries schema", () => {
    it("exports sessionSummaries table", () => {
      expect(sessionSummaries).toBeDefined();
    });

    it("has correct primary key", () => {
      const tableColumns = Object.keys(sessionSummaries);
      expect(tableColumns).toContain("summaryId");
    });

    it("has conversationId for foreign key", () => {
      const tableColumns = Object.keys(sessionSummaries);
      expect(tableColumns).toContain("conversationId");
    });

    it("has time window fields", () => {
      const tableColumns = Object.keys(sessionSummaries);
      expect(tableColumns).toContain("timeWindowStart");
      expect(tableColumns).toContain("timeWindowEnd");
    });

    it("has summaryText field", () => {
      const tableColumns = Object.keys(sessionSummaries);
      expect(tableColumns).toContain("summaryText");
    });

    it("has summaryEmbedding field for vector search", () => {
      const tableColumns = Object.keys(sessionSummaries);
      expect(tableColumns).toContain("summaryEmbedding");
    });

    it("has keyTopics array field", () => {
      const tableColumns = Object.keys(sessionSummaries);
      expect(tableColumns).toContain("keyTopics");
    });

    it("exports DbSessionSummary type", () => {
      const _summary: DbSessionSummary = {
        summaryId: "sum-1",
        conversationId: "conv-1",
        timeWindowStart: new Date(),
        timeWindowEnd: new Date(),
        summaryText: "User discussed coping strategies",
        summaryEmbedding: null,
        keyTopics: ["coping", "progress"],
        entitiesMentioned: {},
        createdAt: new Date(),
      };
      expect(_summary.summaryText).toBe("User discussed coping strategies");
    });

    it("exports NewDbSessionSummary type", () => {
      const _newSummary: NewDbSessionSummary = {
        summaryId: "sum-1",
        conversationId: "conv-1",
        timeWindowStart: new Date(),
        timeWindowEnd: new Date(),
        summaryText: "Summary text",
      };
      expect(_newSummary.summaryId).toBe("sum-1");
    });
  });

  describe("userProfiles schema", () => {
    it("exports userProfiles table", () => {
      expect(userProfiles).toBeDefined();
    });

    it("has correct primary key (userId)", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("userId");
    });

    it("has recoveryPhase field", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("recoveryPhase");
    });

    it("has sobrietyDate field", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("sobrietyDate");
    });

    it("has triggers array field", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("triggers");
    });

    it("has copingStrategies array field", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("copingStrategies");
    });

    it("has preferences field", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("preferences");
    });

    it("has milestones field", () => {
      const tableColumns = Object.keys(userProfiles);
      expect(tableColumns).toContain("milestones");
    });

    it("exports DbUserProfile type", () => {
      const _profile: DbUserProfile = {
        userId: "user-1",
        recoveryPhase: "early-recovery",
        sobrietyDate: "2024-01-01",
        triggers: ["stress", "boredom"],
        copingStrategies: ["exercise", "meditation"],
        preferences: { notifications: true },
        milestones: [{ type: "30-days", date: "2024-02-01" }],
        createdAt: new Date(),
        lastUpdated: new Date(),
      };
      expect(_profile.recoveryPhase).toBe("early-recovery");
    });

    it("exports NewDbUserProfile type", () => {
      const _newProfile: NewDbUserProfile = {
        userId: "user-1",
      };
      expect(_newProfile.userId).toBe("user-1");
    });
  });

  describe("crisisEvents schema", () => {
    it("exports crisisEvents table", () => {
      expect(crisisEvents).toBeDefined();
    });

    it("has correct primary key", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("eventId");
    });

    it("has conversationId for foreign key (nullable)", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("conversationId");
    });

    it("has userId for foreign key", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("userId");
    });

    it("has crisisLevel field", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("crisisLevel");
    });

    it("has patterns field", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("patterns");
    });

    it("has actionTaken field", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("actionTaken");
    });

    it("has handledAt timestamp", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("handledAt");
    });

    it("has notes field", () => {
      const tableColumns = Object.keys(crisisEvents);
      expect(tableColumns).toContain("notes");
    });

    it("exports DbCrisisEvent type", () => {
      const _event: DbCrisisEvent = {
        eventId: "evt-1",
        conversationId: "conv-1",
        userId: "user-1",
        crisisLevel: 8,
        patterns: [{ type: "suicidal_ideation", confidence: 0.9 }],
        actionTaken: "resources_provided",
        handledAt: new Date(),
        notes: "User was connected to crisis line",
      };
      expect(_event.crisisLevel).toBe(8);
    });

    it("exports NewDbCrisisEvent type", () => {
      const _newEvent: NewDbCrisisEvent = {
        eventId: "evt-1",
        userId: "user-1",
        crisisLevel: 7,
        patterns: [],
        actionTaken: "continue",
      };
      expect(_newEvent.eventId).toBe("evt-1");
    });
  });
});

describe("schema index exports", () => {
  it("exports all tables from schema/index", async () => {
    const schemaIndex = await import("../../src/schema/index.js");

    expect(schemaIndex.users).toBeDefined();
    expect(schemaIndex.conversations).toBeDefined();
    expect(schemaIndex.messages).toBeDefined();
    expect(schemaIndex.sessionSummaries).toBeDefined();
    expect(schemaIndex.userProfiles).toBeDefined();
    expect(schemaIndex.crisisEvents).toBeDefined();
  });
});
