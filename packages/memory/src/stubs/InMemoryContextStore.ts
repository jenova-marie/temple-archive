/**
 * In-memory stub implementation of L1 Context Store (Redis)
 */

import type {
  IContextStore,
  SessionState,
  Message,
  StoreError,
  TraceContext,
  Result,
} from '@pippa/types'
import { ok } from '@pippa/types'
import { getLogger, withSpan } from '@pippa/observability'

interface SessionData {
  state: SessionState
  messages: Message[]
  expiresAt: number
  postProcessStats?: unknown
}

export class InMemoryContextStore implements IContextStore {
  private sessions: Map<string, SessionData> = new Map()
  private readonly ttlMs: number

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 4 * 60 * 60 * 1000 // 4 hours default
  }

  async get(sessionId: string, ctx: TraceContext): Promise<Result<SessionState | null, StoreError>> {
    return withSpan('InMemoryContextStore.get', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      const session = this.sessions.get(sessionId)

      if (!session) {
        logger.debug('Session not found in L1 cache')
        return ok(null)
      }

      // Check if expired
      if (Date.now() > session.expiresAt) {
        logger.debug('Session expired, removing from cache')
        this.sessions.delete(sessionId)
        return ok(null)
      }

      logger.debug({ messageCount: session.messages.length }, 'Session found in L1 cache')
      return ok(session.state)
    })
  }

  async set(sessionId: string, state: SessionState, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryContextStore.set', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      const existing = this.sessions.get(sessionId)

      this.sessions.set(sessionId, {
        state,
        messages: existing?.messages ?? [],
        expiresAt: Date.now() + this.ttlMs,
      })

      logger.debug('Session state updated in L1 cache')
      return ok(undefined)
    })
  }

  async delete(sessionId: string, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryContextStore.delete', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      this.sessions.delete(sessionId)

      logger.debug('Session deleted from L1 cache')
      return ok(undefined)
    })
  }

  async getRecentMessages(
    sessionId: string,
    limit: number,
    ctx: TraceContext
  ): Promise<Result<Message[], StoreError>> {
    return withSpan('InMemoryContextStore.getRecentMessages', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      const session = this.sessions.get(sessionId)

      if (!session || Date.now() > session.expiresAt) {
        logger.debug('No messages found in L1 cache')
        return ok([])
      }

      const messages = session.messages.slice(-limit)
      logger.debug({ count: messages.length }, 'Retrieved messages from L1 cache')
      return ok(messages)
    })
  }

  async storeMessage(message: Message, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryContextStore.storeMessage', async () => {
      const logger = getLogger().child({
        sessionId: message.conversationId,
        messageId: message.id,
        requestId: ctx.requestId,
      })

      let session = this.sessions.get(message.conversationId)

      if (!session) {
        // Create new session
        session = {
          state: {
            startTime: message.timestamp,
            lastActivity: message.timestamp,
            messageCount: 0,
            crisisLevel: 1,
          },
          messages: [],
          expiresAt: Date.now() + this.ttlMs,
        }
        this.sessions.set(message.conversationId, session)
      }

      session.messages.push(message)
      session.state.lastActivity = message.timestamp
      session.state.messageCount = session.messages.length
      session.expiresAt = Date.now() + this.ttlMs

      logger.debug('Message stored in L1 cache')
      return ok(undefined)
    })
  }

  /**
   * Store post-process stats for phase-shifted diagnostics
   */
  async storePostProcessStats<T>(
    sessionId: string,
    stats: T,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryContextStore.storePostProcessStats', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      let session = this.sessions.get(sessionId)
      if (!session) {
        session = {
          state: {
            startTime: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
            crisisLevel: 1,
          },
          messages: [],
          expiresAt: Date.now() + this.ttlMs,
        }
        this.sessions.set(sessionId, session)
      }

      session.postProcessStats = stats
      session.expiresAt = Date.now() + this.ttlMs

      logger.debug('Post-process stats stored in L1 cache')
      return ok(undefined)
    })
  }

  /**
   * Retrieve post-process stats from previous exchange
   */
  async getPostProcessStats<T>(
    sessionId: string,
    ctx: TraceContext
  ): Promise<Result<T | null, StoreError>> {
    return withSpan('InMemoryContextStore.getPostProcessStats', async () => {
      const logger = getLogger().child({ sessionId, requestId: ctx.requestId })

      const session = this.sessions.get(sessionId)

      if (!session || Date.now() > session.expiresAt || !session.postProcessStats) {
        logger.debug('No post-process stats found')
        return ok(null)
      }

      logger.debug('Retrieved post-process stats from L1 cache')
      return ok(session.postProcessStats as T)
    })
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear()
  }

  /**
   * Get number of active sessions (for monitoring)
   */
  size(): number {
    return this.sessions.size
  }
}
