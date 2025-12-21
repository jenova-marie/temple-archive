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

      logger.debug({ hasEmbedding: !!embedding }, "Message stored in L2");
      return ok(undefined);
    });
  }

  async semanticSearch(
    conversationId: string,
    queryEmbedding: number[],
    options: { limit?: number; daysBack?: number },
    ctx: TraceContext,
  ): Promise<Result<Array<Message & { similarity: number }>, StoreError>> {
    return withSpan("InMemorySessionStore.semanticSearch", async () => {
      const logger = getLogger().child({
        conversationId,
        requestId: ctx.requestId,
      });
      const { limit = 10, daysBack = 90 } = options;

      const convMessages = this.messages.get(conversationId) ?? [];
      const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

      // Filter messages with embeddings and within time range
      const candidates = convMessages.filter(
        (m) => m.embedding && m.timestamp > cutoff,
      );

      // Calculate cosine similarity
      const scored = candidates.map((msg) => {
        const similarity = this.cosineSimilarity(
          queryEmbedding,
          msg.embedding!,
        );
        return { ...msg, similarity };
      });

      // Sort by similarity and take top N
      scored.sort((a, b) => b.similarity - a.similarity);
      const results = scored.slice(0, limit);

      logger.debug(
        { count: results.length },
        "Semantic search completed in L2",
      );
      return ok(results);
    });
  }

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

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
