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
  UserProfile,
  SessionSummary,
  StoreError,
  TraceContext,
} from '@recoverysky/types'
import { ok, err, type Result } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'
import { eq, desc, asc, and, lte, gt, sql } from 'drizzle-orm'
import type { DatabaseClient } from '../client.js'
import {
  messages,
  userProfiles,
  sessionSummaries,
  conversations,
} from '../schema/index.js'
import type { UserCacheStore } from './UserCacheStore.js'

/**
 * Generate a unique ID with a prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}_${random}`
}

export class PostgresSessionStore implements ISessionStore {
  constructor(
    private readonly db: DatabaseClient,
    private readonly userCache?: UserCacheStore
  ) {}

  async getConversationHistory(
    conversationId: string,
    limit: number,
    ctx: TraceContext
  ): Promise<Result<Message[], StoreError>> {
    return withSpan('PostgresSessionStore.getConversationHistory', async () => {
      const logger = getLogger().child({ conversationId, requestId: ctx.requestId })

      try {
        const rows = await this.db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.createdAt))
          .limit(limit)

        // Reverse to get chronological order
        const result = rows.reverse().map((row) => this.rowToMessage(row))

        logger.debug({ count: result.length }, 'Retrieved conversation history from L2')
        return ok(result)
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve conversation history')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to retrieve conversation history',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }

  async storeMessage(
    message: Message,
    embedding: number[] | null,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('PostgresSessionStore.storeMessage', async () => {
      const logger = getLogger().child({
        conversationId: message.conversationId,
        messageId: message.id,
        role: message.role,
        requestId: ctx.requestId,
      })

      try {
        // User is ensured to exist by ensureUser() called early in request lifecycle
        // Ensure conversation exists (upsert)
        await this.db
          .insert(conversations)
          .values({
            conversationId: message.conversationId,
            userId: message.userId,
          })
          .onConflictDoNothing()

        // Insert the message
        await this.db.insert(messages).values({
          messageId: message.id,
          conversationId: message.conversationId,
          userId: message.userId,
          role: message.role,
          content: message.content,
          embedding: embedding,
          createdAt: new Date(message.timestamp),
          metadata: message.metadata ?? {},
        })

        logger.debug({ role: message.role, hasEmbedding: !!embedding }, 'Message stored in L2')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to store message')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to store message',
          context: { messageId: message.id },
          cause: error,
        })
      }
    })
  }

  async semanticSearch(
    conversationId: string,
    queryEmbedding: number[],
    options: { limit?: number; daysBack?: number },
    ctx: TraceContext
  ): Promise<Result<Array<Message & { similarity: number }>, StoreError>> {
    return withSpan('PostgresSessionStore.semanticSearch', async () => {
      const logger = getLogger().child({ conversationId, requestId: ctx.requestId })
      const { limit = 10, daysBack = 90 } = options

      try {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - daysBack)

        // Format embedding for pgvector
        const embeddingStr = `[${queryEmbedding.join(',')}]`

        // Use pgvector cosine distance: 1 - (embedding <=> query) for similarity score
        const rows = await this.db.execute(sql`
          SELECT
            message_id,
            conversation_id,
            user_id,
            role,
            content,
            created_at,
            metadata,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity
          FROM messages
          WHERE conversation_id = ${conversationId}
            AND embedding IS NOT NULL
            AND created_at >= ${cutoffDate}
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT ${limit}
        `)

        const results = (rows.rows as any[]).map((row) => ({
          ...this.rowToMessage({
            messageId: row.message_id,
            conversationId: row.conversation_id,
            userId: row.user_id,
            role: row.role,
            content: row.content,
            createdAt: row.created_at,
            metadata: row.metadata,
            embedding: null,
          }),
          similarity: Number(row.similarity),
        }))

        logger.debug({ count: results.length }, 'Semantic search completed in L2')
        return ok(results)
      } catch (error) {
        logger.error({ error }, 'Semantic search failed')
        return err({
          kind: 'ConnectionError',
          message: 'Semantic search failed',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }

  async getUserProfile(
    userId: string,
    ctx: TraceContext
  ): Promise<Result<UserProfile | null, StoreError>> {
    return withSpan('PostgresSessionStore.getUserProfile', async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId })

      // Check cache first (UserCacheStore logs cache hit/miss)
      if (this.userCache) {
        const cached = await this.userCache.getUserProfile(userId)
        if (cached.ok && cached.value) {
          return ok(cached.value)
        }
      }

      try {
        const rows = await this.db
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
          .limit(1)

        if (rows.length === 0) {
          // User exists (ensured by getOrCreateUser earlier) but profile doesn't - create default
          logger.debug({ cacheHit: false }, 'User profile not found, creating default')
          const now = new Date()

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
            .onConflictDoNothing()

          const defaultProfile: UserProfile = {
            userId,
            triggers: [],
            copingStrategies: [],
            preferences: {},
            milestones: [],
            lastUpdated: now.getTime(),
          }

          // Cache the new profile
          if (this.userCache) {
            await this.userCache.setUserProfile(defaultProfile)
          }

          logger.debug({ cacheHit: false }, 'User profile created in L2')
          return ok(defaultProfile)
        }

        const row = rows[0]
        const profile: UserProfile = {
          userId: row.userId,
          recoveryPhase: row.recoveryPhase ?? undefined,
          sobrietyDate: row.sobrietyDate ?? undefined,
          triggers: row.triggers ?? [],
          copingStrategies: row.copingStrategies ?? [],
          preferences: (row.preferences as UserProfile['preferences']) ?? {},
          milestones: (row.milestones as UserProfile['milestones']) ?? [],
          lastUpdated: row.lastUpdated.getTime(),
        }

        // Cache the profile
        if (this.userCache) {
          await this.userCache.setUserProfile(profile)
        }

        logger.debug({ cacheHit: false }, 'User profile lookup in L2')
        return ok(profile)
      } catch (error) {
        logger.error({ error }, 'Failed to get user profile')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to get user profile',
          context: { userId },
          cause: error,
        })
      }
    })
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<UserProfile>,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('PostgresSessionStore.updateUserProfile', async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId })

      try {
        // Build the values object for upsert
        const values: Record<string, unknown> = {
          userId,
          lastUpdated: new Date(),
        }

        if (updates.recoveryPhase !== undefined) values.recoveryPhase = updates.recoveryPhase
        if (updates.sobrietyDate !== undefined) values.sobrietyDate = updates.sobrietyDate
        if (updates.triggers !== undefined) values.triggers = updates.triggers
        if (updates.copingStrategies !== undefined)
          values.copingStrategies = updates.copingStrategies
        if (updates.preferences !== undefined) values.preferences = updates.preferences
        if (updates.milestones !== undefined) values.milestones = updates.milestones

        // Build the set object for update (exclude userId)
        const setValues = { ...values }
        delete setValues.userId

        await this.db
          .insert(userProfiles)
          .values(values as typeof userProfiles.$inferInsert)
          .onConflictDoUpdate({
            target: userProfiles.userId,
            set: setValues as Partial<typeof userProfiles.$inferInsert>,
          })

        // Invalidate cache - next read will fetch fresh data
        if (this.userCache) {
          await this.userCache.invalidateUserProfile(userId)
        }

        logger.debug('User profile updated in L2')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to update user profile')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to update user profile',
          context: { userId },
          cause: error,
        })
      }
    })
  }

  async getSessionSummaries(
    conversationId: string,
    limit: number,
    ctx: TraceContext
  ): Promise<Result<SessionSummary[], StoreError>> {
    return withSpan('PostgresSessionStore.getSessionSummaries', async () => {
      const logger = getLogger().child({ conversationId, requestId: ctx.requestId })

      try {
        const rows = await this.db
          .select()
          .from(sessionSummaries)
          .where(eq(sessionSummaries.conversationId, conversationId))
          .orderBy(desc(sessionSummaries.createdAt))
          .limit(limit)

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
          entitiesMentioned: Object.keys((row.entitiesMentioned as Record<string, unknown>) ?? {}),
          createdAt: row.createdAt.getTime(),
        }))

        logger.debug({ count: results.length }, 'Retrieved session summaries from L2')
        return ok(results)
      } catch (error) {
        logger.error({ error }, 'Failed to get session summaries')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to get session summaries',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }

  async storeSummary(
    summary: Omit<SessionSummary, 'summaryId' | 'createdAt'>,
    ctx: TraceContext
  ): Promise<Result<string, StoreError>> {
    return withSpan('PostgresSessionStore.storeSummary', async () => {
      const logger = getLogger().child({
        conversationId: summary.conversationId,
        requestId: ctx.requestId,
      })

      try {
        const summaryId = generateId('sum')
        await this.db.insert(sessionSummaries).values({
          summaryId,
          conversationId: summary.conversationId,
          timeWindowStart: new Date(summary.timeRange.start),
          timeWindowEnd: new Date(summary.timeRange.end),
          summaryText: summary.summaryText,
          keyTopics: summary.keyTopics,
          entitiesMentioned: summary.entitiesMentioned.reduce(
            (acc, e) => ({ ...acc, [e]: true }),
            {}
          ),
        })

        logger.debug({ summaryId }, 'Session summary stored in L2')
        return ok(summaryId)
      } catch (error) {
        logger.error({ error }, 'Failed to store session summary')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to store session summary',
          context: { conversationId: summary.conversationId },
          cause: error,
        })
      }
    })
  }

  /**
   * Get messages around a specific message ID for Deep Memory context retrieval.
   * Returns ±N messages around the target message.
   *
   * @param conversationId - The conversation to search in
   * @param messageId - The target message ID
   * @param window - Number of messages before and after (default: 5)
   */
  async getMessagesAroundId(
    conversationId: string,
    messageId: string,
    window: number = 5,
    ctx: TraceContext
  ): Promise<Result<Message[], StoreError>> {
    return withSpan('PostgresSessionStore.getMessagesAroundId', async () => {
      const logger = getLogger().child({
        conversationId,
        messageId,
        window,
        requestId: ctx.requestId,
      })

      try {
        // 1. Get target message to find its timestamp
        const targetRows = await this.db
          .select()
          .from(messages)
          .where(eq(messages.messageId, messageId))
          .limit(1)

        if (targetRows.length === 0) {
          logger.debug('Target message not found')
          return ok([])
        }

        const targetTimestamp = targetRows[0].createdAt

        // 2. Get N messages before (including target)
        const beforeRows = await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              lte(messages.createdAt, targetTimestamp)
            )
          )
          .orderBy(desc(messages.createdAt))
          .limit(window + 1) // +1 to include target

        // 3. Get N messages after
        const afterRows = await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              gt(messages.createdAt, targetTimestamp)
            )
          )
          .orderBy(asc(messages.createdAt))
          .limit(window)

        // Combine: before (reversed to chronological) + after
        const allMessages = [
          ...beforeRows.reverse().map((row) => this.rowToMessage(row)),
          ...afterRows.map((row) => this.rowToMessage(row)),
        ]

        logger.debug(
          { count: allMessages.length, before: beforeRows.length, after: afterRows.length },
          'Retrieved messages around target for Deep Memory'
        )
        return ok(allMessages)
      } catch (error) {
        logger.error({ error }, 'Failed to get messages around ID')
        return err({
          kind: 'ConnectionError',
          message: 'Failed to get messages around ID',
          context: { conversationId, messageId },
          cause: error,
        })
      }
    })
  }

  /**
   * Convert a database row to a Message domain object
   */
  private rowToMessage(row: {
    messageId: string
    conversationId: string
    userId: string
    role: 'user' | 'assistant' | 'system'
    content: string
    createdAt: Date
    metadata: unknown
    embedding: number[] | null
  }): Message {
    return {
      id: row.messageId,
      conversationId: row.conversationId,
      userId: row.userId,
      role: row.role,
      content: row.content,
      timestamp: row.createdAt.getTime(),
      metadata: row.metadata as Message['metadata'],
    }
  }
}
