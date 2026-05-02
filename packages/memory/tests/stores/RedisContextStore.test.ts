/**
 * RedisContextStore Unit Tests
 *
 * Uses ioredis-mock for fast, isolated testing without Docker.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
// @ts-expect-error - ioredis-mock doesn't have types
import RedisMock from "ioredis-mock";
import { RedisContextStore } from "../../src/stores/RedisContextStore.js";
import type { SessionState, Message, TraceContext } from "@siri/types";
import { RedisKeys } from "../../src/redis/keys.js";

// Mock observability to avoid side effects
vi.mock("@siri/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: <T>(_name: string, fn: () => T) => fn(),
}));

// Helper to create a test trace context
function createTestContext(): TraceContext {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    requestId: "test-request-id",
    startTime: Date.now(),
  };
}

describe("RedisContextStore", () => {
  let redis: InstanceType<typeof RedisMock>;
  let store: RedisContextStore;
  let ctx: TraceContext;

  beforeEach(async () => {
    // Create fresh Redis mock for each test
    redis = new RedisMock();
    await redis.flushall(); // Clear any leftover data
    store = new RedisContextStore(redis as any, {
      ttlSeconds: 3600,
      maxMessages: 100,
    });
    ctx = createTestContext();
  });

  describe("get()", () => {
    it("returns null for missing session", async () => {
      const result = await store.get("non-existent-session", ctx);

      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toBeNull();
    });

    it("returns SessionState for existing session", async () => {
      // Pre-populate Redis
      const key = RedisKeys.sessionState("session-1");
      await redis.hset(key, {
        startTime: "1000",
        lastActivity: "2000",
        messageCount: "5",
        crisisLevel: "2",
        currentTopic: "recovery",
        emotionalTrend: "improving",
        conversationGoal: "support",
      });

      const result = await store.get("session-1", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          startTime: 1000,
          lastActivity: 2000,
          messageCount: 5,
          crisisLevel: 2,
          currentTopic: "recovery",
          emotionalTrend: "improving",
          conversationGoal: "support",
        });
      }
    });
  });

  describe("set()", () => {
    it("stores state and sets TTL", async () => {
      const state: SessionState = {
        startTime: 1000,
        lastActivity: 2000,
        messageCount: 3,
        crisisLevel: 1,
        currentTopic: "coping",
      };

      const result = await store.set("session-1", state, ctx);

      expect(result.ok).toBe(true);

      // Verify data was stored
      const key = RedisKeys.sessionState("session-1");
      const stored = await redis.hgetall(key);
      expect(stored.startTime).toBe("1000");
      expect(stored.lastActivity).toBe("2000");
      expect(stored.messageCount).toBe("3");
      expect(stored.crisisLevel).toBe("1");
      expect(stored.currentTopic).toBe("coping");

      // Verify TTL was set (ioredis-mock supports TTL)
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe("delete()", () => {
    it("removes both state and messages keys", async () => {
      const stateKey = RedisKeys.sessionState("session-1");
      const messagesKey = RedisKeys.sessionMessages("session-1");

      // Pre-populate
      await redis.hset(stateKey, { startTime: "1000" });
      await redis.zadd(messagesKey, 1000, "message-1");

      const result = await store.delete("session-1", ctx);

      expect(result.ok).toBe(true);

      // Verify both keys deleted
      expect(await redis.exists(stateKey)).toBe(0);
      expect(await redis.exists(messagesKey)).toBe(0);
    });
  });

  describe("getRecentMessages()", () => {
    it("returns empty array when no messages", async () => {
      const result = await store.getRecentMessages("session-1", 10, ctx);

      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toEqual([]);
    });

    it("returns messages in chronological order", async () => {
      const key = RedisKeys.sessionMessages("session-1");

      // Add messages with timestamps as scores
      const msg1: Message = {
        id: "msg-1",
        conversationId: "session-1",
        userId: "user-1",
        role: "user",
        content: "First message",
        timestamp: 1000,
      };
      const msg2: Message = {
        id: "msg-2",
        conversationId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "Second message",
        timestamp: 2000,
      };
      const msg3: Message = {
        id: "msg-3",
        conversationId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Third message",
        timestamp: 3000,
      };

      await redis.zadd(key, 1000, JSON.stringify(msg1));
      await redis.zadd(key, 2000, JSON.stringify(msg2));
      await redis.zadd(key, 3000, JSON.stringify(msg3));

      const result = await store.getRecentMessages("session-1", 10, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(3);
        // Should be in chronological order (oldest first)
        expect(result.value[0].id).toBe("msg-1");
        expect(result.value[1].id).toBe("msg-2");
        expect(result.value[2].id).toBe("msg-3");
      }
    });

    it("respects limit parameter", async () => {
      const key = RedisKeys.sessionMessages("session-1");

      // Add 5 messages
      for (let i = 1; i <= 5; i++) {
        const msg: Message = {
          id: `msg-${i}`,
          conversationId: "session-1",
          userId: "user-1",
          role: "user",
          content: `Message ${i}`,
          timestamp: i * 1000,
        };
        await redis.zadd(key, i * 1000, JSON.stringify(msg));
      }

      // Request only 3 most recent
      const result = await store.getRecentMessages("session-1", 3, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(3);
        // Should be the 3 most recent in chronological order
        expect(result.value[0].id).toBe("msg-3");
        expect(result.value[1].id).toBe("msg-4");
        expect(result.value[2].id).toBe("msg-5");
      }
    });
  });

  describe("storeMessage()", () => {
    it("adds message to sorted set with correct score", async () => {
      const message: Message = {
        id: "msg-1",
        conversationId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Test message",
        timestamp: 1234567890,
      };

      const result = await store.storeMessage(message, ctx);

      expect(result.ok).toBe(true);

      // Verify message stored with timestamp as score
      const key = RedisKeys.sessionMessages("session-1");
      const members = await redis.zrangebyscore(
        key,
        "-inf",
        "+inf",
        "WITHSCORES",
      );
      expect(members.length).toBe(2); // [value, score]
      expect(members[1]).toBe("1234567890");

      const storedMsg = JSON.parse(members[0] as string);
      expect(storedMsg.id).toBe("msg-1");
    });

    it("updates session state", async () => {
      const message: Message = {
        id: "msg-1",
        conversationId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Test message",
        timestamp: 1234567890,
      };

      await store.storeMessage(message, ctx);

      // Verify session state updated
      const stateKey = RedisKeys.sessionState("session-1");
      const state = await redis.hgetall(stateKey);
      expect(state.lastActivity).toBe("1234567890");
      expect(parseInt(state.messageCount, 10)).toBeGreaterThan(0);
    });

    it("refreshes TTL on activity", async () => {
      const message: Message = {
        id: "msg-1",
        conversationId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Test message",
        timestamp: Date.now(),
      };

      await store.storeMessage(message, ctx);

      // Verify TTL set
      const stateKey = RedisKeys.sessionState("session-1");
      const messagesKey = RedisKeys.sessionMessages("session-1");

      const stateTTL = await redis.ttl(stateKey);
      const messagesTTL = await redis.ttl(messagesKey);

      expect(stateTTL).toBeGreaterThan(0);
      expect(messagesTTL).toBeGreaterThan(0);
    });
  });

  describe("helper methods", () => {
    it("getMessageCount returns correct count", async () => {
      const key = RedisKeys.sessionMessages("session-1");
      await redis.zadd(key, 1000, "msg-1");
      await redis.zadd(key, 2000, "msg-2");
      await redis.zadd(key, 3000, "msg-3");

      const count = await store.getMessageCount("session-1");
      expect(count).toBe(3);
    });

    it("exists returns true for existing session", async () => {
      const key = RedisKeys.sessionState("session-1");
      await redis.hset(key, { startTime: "1000" });

      const exists = await store.exists("session-1");
      expect(exists).toBe(true);
    });

    it("exists returns false for non-existent session", async () => {
      const exists = await store.exists("non-existent");
      expect(exists).toBe(false);
    });

    it("getMessageCount returns 0 when no messages", async () => {
      const count = await store.getMessageCount("empty-session");
      expect(count).toBe(0);
    });
  });

  describe("deserialization edge cases", () => {
    it("handles missing optional fields in session state", async () => {
      const key = RedisKeys.sessionState("session-1");
      // Only store required fields
      await redis.hset(key, {
        startTime: "1000",
        lastActivity: "2000",
        messageCount: "5",
        crisisLevel: "2",
      });

      const result = await store.get("session-1", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          startTime: 1000,
          lastActivity: 2000,
          messageCount: 5,
          crisisLevel: 2,
          currentTopic: undefined,
          emotionalTrend: undefined,
          conversationGoal: undefined,
        });
      }
    });

    it("handles empty string optional fields", async () => {
      const key = RedisKeys.sessionState("session-1");
      await redis.hset(key, {
        startTime: "1000",
        lastActivity: "2000",
        messageCount: "5",
        crisisLevel: "2",
        currentTopic: "",
        emotionalTrend: "",
        conversationGoal: "",
      });

      const result = await store.get("session-1", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.currentTopic).toBeUndefined();
        expect(result.value?.emotionalTrend).toBeUndefined();
        expect(result.value?.conversationGoal).toBeUndefined();
      }
    });

    it("handles invalid numeric fields with defaults", async () => {
      const key = RedisKeys.sessionState("session-1");
      await redis.hset(key, {
        startTime: "invalid",
        lastActivity: "not-a-number",
        messageCount: "abc",
        crisisLevel: "",
      });

      const result = await store.get("session-1", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should fall back to defaults
        expect(result.value?.startTime).toBeDefined();
        expect(result.value?.lastActivity).toBeDefined();
        expect(result.value?.messageCount).toBe(0);
        expect(result.value?.crisisLevel).toBe(1);
      }
    });

    it("skips malformed messages in getRecentMessages", async () => {
      const key = RedisKeys.sessionMessages("session-1");

      // Add one valid message and one invalid
      const validMsg: Message = {
        id: "msg-1",
        conversationId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Valid message",
        timestamp: 1000,
      };
      await redis.zadd(key, 1000, JSON.stringify(validMsg));
      await redis.zadd(key, 2000, "not-valid-json{{{");

      const result = await store.getRecentMessages("session-1", 10, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should only return the valid message
        expect(result.value.length).toBe(1);
        expect(result.value[0].id).toBe("msg-1");
      }
    });
  });

  describe("default config", () => {
    it("uses default TTL when not specified", () => {
      const storeWithDefaults = new RedisContextStore(redis as any);
      expect(storeWithDefaults).toBeDefined();
    });

    it("uses default maxMessages when not specified", () => {
      const storeWithDefaults = new RedisContextStore(redis as any);
      expect(storeWithDefaults).toBeDefined();
    });
  });

  describe("message trimming", () => {
    it("trims old messages when max is exceeded", async () => {
      // Create store with max 3 messages
      const smallStore = new RedisContextStore(redis as any, {
        ttlSeconds: 3600,
        maxMessages: 3,
      });

      // Store 5 messages
      for (let i = 1; i <= 5; i++) {
        const message: Message = {
          id: `msg-${i}`,
          conversationId: "session-1",
          userId: "user-1",
          role: "user",
          content: `Message ${i}`,
          timestamp: i * 1000,
        };
        await smallStore.storeMessage(message, ctx);
      }

      // Should only have most recent 3 messages
      const key = RedisKeys.sessionMessages("session-1");
      const count = await redis.zcard(key);
      expect(count).toBe(3);

      // Verify it's the newest messages
      const messages = await redis.zrange(key, 0, -1);
      const parsed = messages.map((m: string) => JSON.parse(m));
      expect(parsed.map((m: Message) => m.id)).toEqual([
        "msg-3",
        "msg-4",
        "msg-5",
      ]);
    });
  });
});
