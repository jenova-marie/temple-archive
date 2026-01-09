/**
 * In-memory stub implementation of L2 Session Store (PostgreSQL)
 */

import type {
  ISessionStore,
  Message,
  UserProfile,
  SessionSummary,
  StoreError,
  TraceContext,
  Result,
} from "@pippa/types";
import { ok } from "@pippa/types";
import { getLogger, withSpan } from "@pippa/observability";

interface StoredMessage extends Message {
  embedding?: number[];
}

export class InMemorySessionStore implements ISessionStore {
  private messages: Map<string, StoredMessage[]> = new Map();
  private profiles: Map<string, UserProfile> = new Map();
  private summaries: Map<string, SessionSummary[]> = new Map();

  async getConversationHistory(
    conversationId: string,
    limit: number,
    ctx: TraceContext,
  ): Promise<Result<Message[], StoreError>> {
    return withSpan("InMemorySessionStore.getConversationHistory", async () => {
      const logger = getLogger().child({
        conversationId,
        requestId: ctx.requestId,
      });

      const convMessages = this.messages.get(conversationId) ?? [];
      const result = convMessages.slice(-limit);

      logger.debug(
        { count: result.length },
        "Retrieved conversation history from L2",
      );
      return ok(result);
    });
  }

  async storeMessage(
    message: Message,
    embedding: number[] | null,
    ctx: TraceContext,
  ): Promise<Result<void, StoreError>> {
    return withSpan("InMemorySessionStore.storeMessage", async () => {
      const logger = getLogger().child({
        conversationId: message.conversationId,
        messageId: message.id,
        requestId: ctx.requestId,
      });

      const convMessages = this.messages.get(message.conversationId) ?? [];

      const storedMessage: StoredMessage = {
        ...message,
        embedding: embedding ?? undefined,
      };

      convMessages.push(storedMessage);
      this.messages.set(message.conversationId, convMessages);

      logger.debug("Message stored in L2");
      return ok(undefined);
    });
  }

  // Note: semanticSearch removed - vector search now handled by Qdrant (L4)

  async getUserProfile(
    userId: string,
    ctx: TraceContext,
  ): Promise<Result<UserProfile | null, StoreError>> {
    return withSpan("InMemorySessionStore.getUserProfile", async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId });

      const profile = this.profiles.get(userId) ?? null;

      logger.debug({ found: !!profile }, "User profile lookup in L2");
      return ok(profile);
    });
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<UserProfile>,
    ctx: TraceContext,
  ): Promise<Result<void, StoreError>> {
    return withSpan("InMemorySessionStore.updateUserProfile", async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId });

      const existing = this.profiles.get(userId);

      const profile: UserProfile = {
        userId,
        triggers: [],
        copingStrategies: [],
        preferences: {},
        milestones: [],
        lastUpdated: Date.now(),
        ...existing,
        ...updates,
      };

      this.profiles.set(userId, profile);

      logger.debug("User profile updated in L2");
      return ok(undefined);
    });
  }

  async getSessionSummaries(
    conversationId: string,
    limit: number,
    ctx: TraceContext,
  ): Promise<Result<SessionSummary[], StoreError>> {
    return withSpan("InMemorySessionStore.getSessionSummaries", async () => {
      const logger = getLogger().child({
        conversationId,
        requestId: ctx.requestId,
      });

      const convSummaries = this.summaries.get(conversationId) ?? [];
      const result = convSummaries.slice(-limit);

      logger.debug(
        { count: result.length },
        "Retrieved session summaries from L2",
      );
      return ok(result);
    });
  }

  async storeSummary(
    summary: Omit<SessionSummary, "summaryId" | "createdAt">,
    ctx: TraceContext,
  ): Promise<Result<string, StoreError>> {
    return withSpan("InMemorySessionStore.storeSummary", async () => {
      const logger = getLogger().child({
        conversationId: summary.conversationId,
        requestId: ctx.requestId,
      });

      const summaryId = `summary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const fullSummary: SessionSummary = {
        ...summary,
        summaryId,
        createdAt: Date.now(),
      };

      const convSummaries = this.summaries.get(summary.conversationId) ?? [];
      convSummaries.push(fullSummary);
      this.summaries.set(summary.conversationId, convSummaries);

      logger.debug({ summaryId }, "Session summary stored in L2");
      return ok(summaryId);
    });
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.messages.clear();
    this.profiles.clear();
    this.summaries.clear();
  }
}
