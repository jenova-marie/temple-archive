/**
 * Redis-backed L1 Context Store
 *
 * Provides fast session caching with automatic TTL expiry.
 * Uses Redis sorted sets for message ordering and hashes for session state.
 */

import type { Redis } from 'ioredis'
import type {
  IContextStore,
  SessionState,
  Message,
  StoreError,
  TraceContext,
  Result,
} from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan } from '@siri/observability'
import { RedisKeys, RedisTTL, RedisDefaults } from '../redis/keys.js'

export interface RedisContextStoreConfig {
  /** TTL for session data in seconds (default: 4 hours) */
  ttlSeconds?: number
  /** Maximum messages to keep per session (default: 100) */
  maxMessages?: number
}

/**
 * Map Redis error codes to StoreError kinds
 */
function mapRedisError(error: unknown): StoreError {
  const err = error as Error & { code?: string }
  const message = err?.message ?? 'Unknown Redis error'
  const code = err?.code

  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || message.includes('ECONNRESET')) {
    return {
      kind: 'ConnectionError',
      message: `Redis connection failed: ${message}`,
      context: { code },
      cause: error,
    }
  }

  if (code === 'ETIMEDOUT' || message.includes('timeout')) {
    return {
      kind: 'TimeoutError',
      message: `Redis operation timed out: ${message}`,
      context: { code },
      cause: error,
    }
  }

  return {
    kind: 'UnexpectedError',
    message: `Redis error: ${message}`,
    context: { code },
    cause: error,
  }
}

/**
 * Serialize SessionState to Redis hash fields
 */
function serializeSessionState(state: SessionState): Record<string, string> {
  return {
    startTime: String(state.startTime),
    lastActivity: String(state.lastActivity),
    messageCount: String(state.messageCount),
    crisisLevel: String(state.crisisLevel),
    currentTopic: state.currentTopic ?? '',
    emotionalTrend: state.emotionalTrend ?? '',
    conversationGoal: state.conversationGoal ?? '',
  }
}

/**
 * Deserialize Redis hash fields to SessionState
 */
function deserializeSessionState(data: Record<string, string>): SessionState {
  return {
    startTime: parseInt(data.startTime, 10) || Date.now(),
    lastActivity: parseInt(data.lastActivity, 10) || Date.now(),
    messageCount: parseInt(data.messageCount, 10) || 0,
    crisisLevel: parseInt(data.crisisLevel, 10) || 1,
    currentTopic: data.currentTopic || undefined,
    emotionalTrend: (data.emotionalTrend as SessionState['emotionalTrend']) || undefined,
    conversationGoal: data.conversationGoal || undefined,
  }
}

export class RedisContextStore implements IContextStore {
  private readonly ttlSeconds: number
  private readonly maxMessages: number

  constructor(
    private readonly redis: Redis,
    config: RedisContextStoreConfig = {}
  ) {
    this.ttlSeconds = config.ttlSeconds ?? RedisTTL.SESSION
    this.maxMessages = config.maxMessages ?? RedisDefaults.MAX_MESSAGES_PER_SESSION
  }

  async get(sessionId: string, ctx: TraceContext): Promise<Result<SessionState | null, StoreError>> {
    return withSpan('RedisContextStore.get', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      try {
        const key = RedisKeys.sessionState(sessionId)
        const data = await this.redis.hgetall(key)

        if (!data || Object.keys(data).length === 0) {
          logger.debug('Session not found in Redis L1 cache')
          return ok(null)
        }

        const state = deserializeSessionState(data)
        logger.debug({ messageCount: state.messageCount }, 'Session found in Redis L1 cache')
        return ok(state)
      } catch (error) {
        logger.error({ error }, 'Failed to get session from Redis')
        return err(mapRedisError(error))
      }
    })
  }

  async set(sessionId: string, state: SessionState, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('RedisContextStore.set', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      try {
        const key = RedisKeys.sessionState(sessionId)
        const fields = serializeSessionState(state)

        // Use pipeline for atomic operation
        const pipeline = this.redis.pipeline()
        pipeline.hset(key, fields)
        pipeline.expire(key, this.ttlSeconds)
        await pipeline.exec()

        logger.debug('Session state updated in Redis L1 cache')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to set session in Redis')
        return err(mapRedisError(error))
      }
    })
  }

  async delete(sessionId: string, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('RedisContextStore.delete', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      try {
        const stateKey = RedisKeys.sessionState(sessionId)
        const messagesKey = RedisKeys.sessionMessages(sessionId)

        await this.redis.del(stateKey, messagesKey)

        logger.debug('Session deleted from Redis L1 cache')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to delete session from Redis')
        return err(mapRedisError(error))
      }
    })
  }

  async getRecentMessages(
    sessionId: string,
    limit: number,
    ctx: TraceContext
  ): Promise<Result<Message[], StoreError>> {
    return withSpan('RedisContextStore.getRecentMessages', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      try {
        const key = RedisKeys.sessionMessages(sessionId)

        // Get most recent messages (highest scores = newest)
        // ZREVRANGE returns in descending order, so we get newest first
        const rawMessages = await this.redis.zrevrange(key, 0, limit - 1)

        if (!rawMessages || rawMessages.length === 0) {
          logger.debug('No messages found in Redis L1 cache')
          return ok([])
        }

        // Parse messages and reverse to get chronological order
        const messages: Message[] = []
        for (const raw of rawMessages) {
          try {
            messages.push(JSON.parse(raw) as Message)
          } catch (parseError) {
            logger.warn({ raw }, 'Failed to parse message from Redis')
          }
        }

        // Reverse to get chronological order (oldest first)
        messages.reverse()

        logger.debug({ count: messages.length }, 'Retrieved messages from Redis L1 cache')
        return ok(messages)
      } catch (error) {
        logger.error({ error }, 'Failed to get messages from Redis')
        return err(mapRedisError(error))
      }
    })
  }

  async storeMessage(message: Message, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('RedisContextStore.storeMessage', async () => {
      const logger = getLogger().child({
        sessionId: message.conversationId,
        messageId: message.id,
        role: message.role,
        requestId: ctx.requestId,
      })

      try {
        const stateKey = RedisKeys.sessionState(message.conversationId)
        const messagesKey = RedisKeys.sessionMessages(message.conversationId)

        const serializedMessage = JSON.stringify(message)

        // Use pipeline for atomic operations
        const pipeline = this.redis.pipeline()

        // Add message to sorted set with timestamp as score
        pipeline.zadd(messagesKey, message.timestamp, serializedMessage)

        // Trim to max messages (remove oldest)
        pipeline.zremrangebyrank(messagesKey, 0, -(this.maxMessages + 1))

        // Refresh TTL on messages
        pipeline.expire(messagesKey, this.ttlSeconds)

        // Update session state
        pipeline.hincrby(stateKey, 'messageCount', 1)
        pipeline.hset(stateKey, 'lastActivity', String(message.timestamp))
        pipeline.expire(stateKey, this.ttlSeconds)

        // Initialize session state if it doesn't exist
        pipeline.hsetnx(stateKey, 'startTime', String(message.timestamp))
        pipeline.hsetnx(stateKey, 'crisisLevel', '1')

        await pipeline.exec()

        logger.debug({ role: message.role }, 'Message stored in Redis L1 cache')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to store message in Redis')
        return err(mapRedisError(error))
      }
    })
  }

  /**
   * Get number of messages in a session (for monitoring)
   */
  async getMessageCount(sessionId: string): Promise<number> {
    try {
      const key = RedisKeys.sessionMessages(sessionId)
      return await this.redis.zcard(key)
    } catch {
      return 0
    }
  }

  /**
   * Check if session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    try {
      const key = RedisKeys.sessionState(sessionId)
      return (await this.redis.exists(key)) === 1
    } catch {
      return false
    }
  }

  /**
   * Store post-process stats for phase-shifted diagnostics
   * These stats are retrieved on the NEXT request to show what happened in the previous exchange
   */
  async storePostProcessStats<T>(
    sessionId: string,
    stats: T,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('RedisContextStore.storePostProcessStats', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      try {
        const key = RedisKeys.postProcessStats(sessionId)
        const serialized = JSON.stringify(stats)

        const pipeline = this.redis.pipeline()
        pipeline.set(key, serialized)
        pipeline.expire(key, this.ttlSeconds)
        await pipeline.exec()

        logger.debug('Post-process stats stored in Redis L1 cache')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to store post-process stats in Redis')
        return err(mapRedisError(error))
      }
    })
  }

  /**
   * Retrieve post-process stats from previous exchange
   * Returns null if no stats exist (first message in conversation)
   */
  async getPostProcessStats<T>(
    sessionId: string,
    ctx: TraceContext
  ): Promise<Result<T | null, StoreError>> {
    return withSpan('RedisContextStore.getPostProcessStats', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      try {
        const key = RedisKeys.postProcessStats(sessionId)
        const data = await this.redis.get(key)

        if (!data) {
          logger.debug('No post-process stats found (first exchange or expired)')
          return ok(null)
        }

        const stats = JSON.parse(data) as T
        logger.debug('Retrieved post-process stats from Redis L1 cache')
        return ok(stats)
      } catch (error) {
        logger.error({ error }, 'Failed to get post-process stats from Redis')
        return err(mapRedisError(error))
      }
    })
  }

  /**
   * Atomically increment a counter and return the new value
   * Used for sequence numbers (e.g., exchange sequence in a conversation)
   */
  async incrementCounter(key: string, ctx: TraceContext): Promise<Result<number, StoreError>> {
    return withSpan('RedisContextStore.incrementCounter', async () => {
      const logger = getLogger().child({ key, requestId: ctx.requestId })

      try {
        const newValue = await this.redis.incr(key)
        logger.debug({ newValue }, 'Counter incremented')
        return ok(newValue)
      } catch (error) {
        logger.error({ error }, 'Failed to increment counter')
        return err(mapRedisError(error))
      }
    })
  }
}
