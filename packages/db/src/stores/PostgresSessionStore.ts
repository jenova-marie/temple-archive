/**
 * PostgresSessionStore
 *
 * L2 Session Store implementation using PostgreSQL + Drizzle ORM.
 * Implements the ISessionStore interface for persistent conversation storage.
 *
 * Supports optional Redis caching via UserCacheStore for user profiles.
 */

import type {
  ISessionStore,
  Message,
  MessageTurn,
  UserProfile,
  SessionSummary,
  StoreError,
  TraceContext,
} from "@siri/types";
import { ok, err, type Result } from "@siri/types";
import { getLogger, withSpan } from "@siri/observability";
import { eq, desc, asc, and, lte, gt, or } from "drizzle-orm";
import type { DatabaseClient } from "../client.js";
import {
  messages,
  messageTurns,
  userProfiles,
  sessionSummaries,
  conversations,
} from "../schema/index.js";
import type { UserCacheStore } from "./UserCacheStore.js";

/**
 * Generate a unique ID with a prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

export class PostgresSessionStore implements ISessionStore {
  constructor(
    private readonly db: DatabaseClient,
    private readonly userCache?: UserCacheStore,
  ) {}

  async getConversationHistory(
    conversationId: string,
    limit: number,
    ctx: TraceContext,
  ): Promise<Result<Message[], StoreError>> {
    return withSpan("PostgresSessionStore.getConversationHistory", async () => {
      const logger = getLogger().child({
        conversationId,
        requestId: ctx.requestId,
      });

      try {
        const rows = await this.db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.createdAt))
          .limit(limit);

        // Reverse to get chronological order
        const result = rows.reverse().map((row) => this.rowToMessage(row));

        logger.debug(
          { count: result.length },
          "Retrieved conversation history from L2",
        );
        return ok(result);
      } catch (error) {
        logger.error({ error }, "Failed to retrieve conversation history");
        return err({
          kind: "ConnectionError",
          message: "Failed to retrieve conversation history",
          context: { conversationId },
          cause: error,
        });
      }
    });
  }

  async storeMessage(
    message: Message,
    _embedding: number[] | null, // Kept for interface compatibility; embeddings stored in Qdrant L4
    ctx: TraceContext,
  ): Promise<Result<void, StoreError>> {
    return withSpan("PostgresSessionStore.storeMessage", async () => {
      const logger = getLogger().child({
        conversationId: message.conversationId,
        messageId: message.id,
        role: message.role,
        requestId: ctx.requestId,
      });

      try {
        // User is ensured to exist by ensureUser() called early in request lifecycle
        // Ensure conversation exists (upsert)
        await this.db
          .insert(conversations)
          .values({
            conversationId: message.conversationId,
            userId: message.userId,
          })
          .onConflictDoNothing();

        // Insert the message (embeddings stored in Qdrant L4, not here)
        await this.db.insert(messages).values({
          messageId: message.id,
          conversationId: message.conversationId,
          userId: message.userId,
          role: message.role,
          content: message.content,
          createdAt: new Date(message.timestamp),
          metadata: message.metadata ?? {},
        });

        logger.debug({ role: message.role }, "Message stored in L2");
        return ok(undefined);
      } catch (error) {
        logger.error({ error }, "Failed to store message");
        return err({
          kind: "ConnectionError",
          message: "Failed to store message",
          context: { messageId: message.id },
          cause: error,
        });
      }
    });
  }

  // Note: semanticSearch removed - vector search now handled by Qdrant (L4)

  async getUserProfile(
    userId: string,
    ctx: TraceContext,
  ): Promise<Result<UserProfile | null, StoreError>> {
    return withSpan("PostgresSessionStore.getUserProfile", async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId });

      // Check cache first (UserCacheStore logs cache hit/miss)
      if (this.userCache) {
        const cached = await this.userCache.getUserProfile(userId);
        if (cached.ok && cached.value) {
          return ok(cached.value);
        }
      }

      try {
        const rows = await this.db
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
          .limit(1);

        if (rows.length === 0) {
          // User exists (ensured by getOrCreateUser earlier) but profile doesn't - create default
          logger.debug(
            { cacheHit: false },
            "User profile not found, creating default",
          );
          const now = new Date();

          await this.db
            .insert(userProfiles)
            .values({
              userId,
              triggers: [],
              copingStrategies: [],
              preferences: {},
              milestones: [],
              createdAt: now,
              lastUpdated: now,
            })
            .onConflictDoNothing();

          const defaultProfile: UserProfile = {
            userId,
            triggers: [],
            copingStrategies: [],
            preferences: {},
            milestones: [],
            lastUpdated: now.getTime(),
          };

          // Cache the new profile
          if (this.userCache) {
            await this.userCache.setUserProfile(defaultProfile);
          }

          logger.debug({ cacheHit: false }, "User profile created in L2");
          return ok(defaultProfile);
        }

        const row = rows[0];
        const profile: UserProfile = {
          userId: row.userId,
          pronouns: row.pronouns ?? undefined,
          localeCode: row.localeCode ?? undefined,
          recoveryPhase: row.recoveryPhase ?? undefined,
          recoveryDate: row.recoveryDate ?? undefined,
          triggers: row.triggers ?? [],
          copingStrategies: row.copingStrategies ?? [],
          preferences: (row.preferences as UserProfile["preferences"]) ?? {},
          milestones: (row.milestones as UserProfile["milestones"]) ?? [],
          lastUpdated: row.lastUpdated.getTime(),
        };

        // Cache the profile
        if (this.userCache) {
          await this.userCache.setUserProfile(profile);
        }

        logger.debug({ cacheHit: false }, "User profile lookup in L2");
        return ok(profile);
      } catch (error) {
        logger.error({ error }, "Failed to get user profile");
        return err({
          kind: "ConnectionError",
          message: "Failed to get user profile",
          context: { userId },
          cause: error,
        });
      }
    });
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<UserProfile>,
    ctx: TraceContext,
  ): Promise<Result<void, StoreError>> {
    return withSpan("PostgresSessionStore.updateUserProfile", async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId });

      try {
        // Build the values object for upsert
        const values: Record<string, unknown> = {
          userId,
          lastUpdated: new Date(),
        };

        if (updates.pronouns !== undefined) values.pronouns = updates.pronouns;
        if (updates.localeCode !== undefined)
          values.localeCode = updates.localeCode;
        if (updates.recoveryPhase !== undefined)
          values.recoveryPhase = updates.recoveryPhase;
        if (updates.recoveryDate !== undefined)
          values.recoveryDate = updates.recoveryDate;
        if (updates.triggers !== undefined) values.triggers = updates.triggers;
        if (updates.copingStrategies !== undefined)
          values.copingStrategies = updates.copingStrategies;
        if (updates.preferences !== undefined)
          values.preferences = updates.preferences;
        if (updates.milestones !== undefined)
          values.milestones = updates.milestones;

        // Build the set object for update (exclude userId)
        const setValues = { ...values };
        delete setValues.userId;

        await this.db
          .insert(userProfiles)
          .values(values as typeof userProfiles.$inferInsert)
          .onConflictDoUpdate({
            target: userProfiles.userId,
            set: setValues as Partial<typeof userProfiles.$inferInsert>,
          });

        // Invalidate cache - next read will fetch fresh data
        if (this.userCache) {
          await this.userCache.invalidateUserProfile(userId);
        }

        logger.debug("User profile updated in L2");
        return ok(undefined);
      } catch (error) {
        logger.error({ error }, "Failed to update user profile");
        return err({
          kind: "ConnectionError",
          message: "Failed to update user profile",
          context: { userId },
          cause: error,
        });
      }
    });
  }

  async getSessionSummaries(
    conversationId: string,
    limit: number,
    ctx: TraceContext,
  ): Promise<Result<SessionSummary[], StoreError>> {
    return withSpan("PostgresSessionStore.getSessionSummaries", async () => {
      const logger = getLogger().child({
        conversationId,
        requestId: ctx.requestId,
      });

      try {
        const rows = await this.db
          .select()
          .from(sessionSummaries)
          .where(eq(sessionSummaries.conversationId, conversationId))
          .orderBy(desc(sessionSummaries.createdAt))
          .limit(limit);

        // Reverse to get chronological order
        const results = rows.reverse().map((row) => ({
          summaryId: row.summaryId,
          conversationId: row.conversationId,
          timeRange: {
            start: row.timeWindowStart.getTime(),
            end: row.timeWindowEnd.getTime(),
          },
          summaryText: row.summaryText,
          keyTopics: row.keyTopics ?? [],
          entitiesMentioned: Object.keys(
            (row.entitiesMentioned as Record<string, unknown>) ?? {},
          ),
          createdAt: row.createdAt.getTime(),
        }));

        logger.debug(
          { count: results.length },
          "Retrieved session summaries from L2",
        );
        return ok(results);
      } catch (error) {
        logger.error({ error }, "Failed to get session summaries");
        return err({
          kind: "ConnectionError",
          message: "Failed to get session summaries",
          context: { conversationId },
          cause: error,
        });
      }
    });
  }

  async storeSummary(
    summary: Omit<SessionSummary, "summaryId" | "createdAt">,
    ctx: TraceContext,
  ): Promise<Result<string, StoreError>> {
    return withSpan("PostgresSessionStore.storeSummary", async () => {
      const logger = getLogger().child({
        conversationId: summary.conversationId,
        requestId: ctx.requestId,
      });

      try {
        const summaryId = generateId("sum");
        await this.db.insert(sessionSummaries).values({
          summaryId,
          conversationId: summary.conversationId,
          timeWindowStart: new Date(summary.timeRange.start),
          timeWindowEnd: new Date(summary.timeRange.end),
          summaryText: summary.summaryText,
          keyTopics: summary.keyTopics,
          entitiesMentioned: summary.entitiesMentioned.reduce(
            (acc, e) => ({ ...acc, [e]: true }),
            {},
          ),
        });

        logger.debug({ summaryId }, "Session summary stored in L2");
        return ok(summaryId);
      } catch (error) {
        logger.error({ error }, "Failed to store session summary");
        return err({
          kind: "ConnectionError",
          message: "Failed to store session summary",
          context: { conversationId: summary.conversationId },
          cause: error,
        });
      }
    });
  }

  /**
   * Get messages around a specific message ID for Deep Memory context retrieval.
   * Returns messages around the target message with asymmetric windows.
   * Context before the extraction point is typically more valuable than after.
   *
   * @param conversationId - The conversation to search in
   * @param messageId - The target message ID
   * @param windowBefore - Number of messages before target (default: 5)
   * @param windowAfter - Number of messages after target (default: half of before)
   */
  async getMessagesAroundId(
    conversationId: string,
    messageId: string,
    windowBefore: number = 5,
    ctx: TraceContext,
    windowAfter?: number,
  ): Promise<Result<Message[], StoreError>> {
    // Default after window to half of before (rounded down)
    const actualWindowAfter = windowAfter ?? Math.floor(windowBefore * 0.5);

    return withSpan("PostgresSessionStore.getMessagesAroundId", async () => {
      const logger = getLogger().child({
        conversationId,
        messageId,
        windowBefore,
        windowAfter: actualWindowAfter,
        requestId: ctx.requestId,
      });

      try {
        // 1. Get target message to find its timestamp
        const targetRows = await this.db
          .select()
          .from(messages)
          .where(eq(messages.messageId, messageId))
          .limit(1);

        if (targetRows.length === 0) {
          logger.debug("Target message not found");
          return ok([]);
        }

        const targetTimestamp = targetRows[0].createdAt;

        // 2. Get N messages before (including target)
        const beforeRows = await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              lte(messages.createdAt, targetTimestamp),
            ),
          )
          .orderBy(desc(messages.createdAt))
          .limit(windowBefore + 1); // +1 to include target

        // 3. Get fewer messages after (context before extraction is more valuable)
        const afterRows = await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              gt(messages.createdAt, targetTimestamp),
            ),
          )
          .orderBy(asc(messages.createdAt))
          .limit(actualWindowAfter);

        // Combine: before (reversed to chronological) + after
        const allMessages = [
          ...beforeRows.reverse().map((row) => this.rowToMessage(row)),
          ...afterRows.map((row) => this.rowToMessage(row)),
        ];

        logger.debug(
          {
            count: allMessages.length,
            before: beforeRows.length,
            after: afterRows.length,
          },
          "Retrieved messages around target for Deep Memory",
        );
        return ok(allMessages);
      } catch (error) {
        logger.error({ error }, "Failed to get messages around ID");
        return err({
          kind: "ConnectionError",
          message: "Failed to get messages around ID",
          context: { conversationId, messageId },
          cause: error,
        });
      }
    });
  }

  /**
   * Store a message turn (links user/assistant message pair)
   */
  async storeTurn(
    turn: MessageTurn,
    ctx: TraceContext,
  ): Promise<Result<void, StoreError>> {
    return withSpan("PostgresSessionStore.storeTurn", async () => {
      const logger = getLogger().child({
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        requestId: ctx.requestId,
      });

      try {
        await this.db.insert(messageTurns).values({
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          userMessageId: turn.userMessageId,
          assistantMessageId: turn.assistantMessageId,
          sequenceNumber: turn.sequenceNumber,
          createdAt: new Date(turn.createdAt),
        });

        logger.debug(
          { sequenceNumber: turn.sequenceNumber },
          "Turn stored in L2",
        );
        return ok(undefined);
      } catch (error) {
        logger.error({ error }, "Failed to store turn");
        return err({
          kind: "ConnectionError",
          message: "Failed to store turn",
          context: { turnId: turn.turnId },
          cause: error,
        });
      }
    });
  }

  /**
   * Get a turn by ID
   */
  async getTurn(
    turnId: string,
    ctx: TraceContext,
  ): Promise<Result<MessageTurn | null, StoreError>> {
    return withSpan("PostgresSessionStore.getTurn", async () => {
      const logger = getLogger().child({ turnId, requestId: ctx.requestId });

      try {
        const rows = await this.db
          .select()
          .from(messageTurns)
          .where(eq(messageTurns.turnId, turnId))
          .limit(1);

        if (rows.length === 0) {
          return ok(null);
        }

        const row = rows[0];
        logger.debug("Turn retrieved from L2");
        return ok({
          turnId: row.turnId,
          conversationId: row.conversationId,
          userMessageId: row.userMessageId,
          assistantMessageId: row.assistantMessageId,
          sequenceNumber: row.sequenceNumber,
          createdAt: row.createdAt.getTime(),
        });
      } catch (error) {
        logger.error({ error }, "Failed to get turn");
        return err({
          kind: "ConnectionError",
          message: "Failed to get turn",
          context: { turnId },
          cause: error,
        });
      }
    });
  }

  /**
   * Get turn containing a specific message (user or assistant)
   */
  async getTurnByMessageId(
    messageId: string,
    ctx: TraceContext,
  ): Promise<Result<MessageTurn | null, StoreError>> {
    return withSpan("PostgresSessionStore.getTurnByMessageId", async () => {
      const logger = getLogger().child({ messageId, requestId: ctx.requestId });

      try {
        const rows = await this.db
          .select()
          .from(messageTurns)
          .where(
            or(
              eq(messageTurns.userMessageId, messageId),
              eq(messageTurns.assistantMessageId, messageId),
            ),
          )
          .limit(1);

        if (rows.length === 0) {
          return ok(null);
        }

        const row = rows[0];
        logger.debug("Turn found by message ID");
        return ok({
          turnId: row.turnId,
          conversationId: row.conversationId,
          userMessageId: row.userMessageId,
          assistantMessageId: row.assistantMessageId,
          sequenceNumber: row.sequenceNumber,
          createdAt: row.createdAt.getTime(),
        });
      } catch (error) {
        logger.error({ error }, "Failed to get turn by message ID");
        return err({
          kind: "ConnectionError",
          message: "Failed to get turn by message ID",
          context: { messageId },
          cause: error,
        });
      }
    });
  }

  /**
   * Convert a database row to a Message domain object
   */
  private rowToMessage(row: {
    messageId: string;
    conversationId: string;
    userId: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: Date;
    metadata: unknown;
  }): Message {
    return {
      id: row.messageId,
      conversationId: row.conversationId,
      userId: row.userId,
      role: row.role,
      content: row.content,
      timestamp: row.createdAt.getTime(),
      metadata: row.metadata as Message["metadata"],
    };
  }
}
