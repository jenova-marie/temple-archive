/**
 * Memory Orchestrator - Coordinates multi-tier memory operations
 *
 * This is the main entry point for memory operations. Architecture:
 *
 * L1 (Redis)     - Session metadata only (state, post-process stats)
 * L2 (PostgreSQL) - Authoritative message store, user profiles
 * L3 (Neo4j)     - Knowledge graph entities
 * L4 (Qdrant)    - Semantic vector search
 *
 * Note: L1 does NOT cache messages since Vercel AI SDK clients send
 * full conversation history with each request.
 */

import type {
  IContextStore,
  ISessionStore,
  IKnowledgeStore,
  IVectorStore,
  Message,
  AssembledContext,
  TraceContext,
  Result,
  SessionState,
  SessionEntities,
  Entity,
  UserProfile,
} from '@pippa/types'
import { ok, err } from '@pippa/types'
import { getLogger, withSpan, pipelineMetrics } from '@pippa/observability'

export interface MemoryOrchestratorConfig {
  /** Maximum messages to retrieve from L2 */
  l2MessageLimit: number
  /** Days back to search in semantic search */
  semanticSearchDays: number
  /** Minimum similarity score for semantic matches */
  semanticScoreThreshold: number
  /** Maximum related entities to retrieve from L3 */
  l3EntityLimit: number
  /** Enable L3 knowledge graph queries */
  enableL3Queries: boolean
}

export interface MemoryRetrievalResult {
  context: AssembledContext
  latencyMs: number
  /** Number of cache hits during retrieval */
  cacheHits: number
  /** Number of cache misses during retrieval */
  cacheMisses: number
}

export interface MemoryError {
  kind: 'RetrievalError' | 'PersistError' | 'ConfigError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

export class MemoryOrchestrator {
  private readonly config: MemoryOrchestratorConfig

  constructor(
    private readonly l1: IContextStore,
    private readonly l2: ISessionStore,
    private readonly l3: IKnowledgeStore,
    private readonly l4: IVectorStore,
    config?: Partial<MemoryOrchestratorConfig>
  ) {
    this.config = {
      l2MessageLimit: 50,
      semanticSearchDays: 90,
      semanticScoreThreshold: 0.7,
      l3EntityLimit: 20,
      enableL3Queries: true,
      ...config,
    }
  }

  /**
   * Retrieve assembled context for a conversation
   *
   * Note: L1 is not used for message retrieval since Vercel AI SDK clients
   * send full message history with each request. L1 is only used for session
   * metadata (state, post-process stats). Messages are retrieved from L2.
   *
   * @param preloadedProfile - Optional pre-loaded user profile to avoid redundant fetch
   * @param displayName - Optional user's display name for personalization
   */
  async retrieveContext(
    conversationId: string,
    userId: string,
    queryEmbedding: number[] | null,
    ctx: TraceContext,
    preloadedProfile?: UserProfile | null,
    displayName?: string
  ): Promise<Result<MemoryRetrievalResult, MemoryError>> {
    return withSpan('MemoryOrchestrator.retrieveContext', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        conversationId,
        userId,
        requestId: ctx.requestId,
      })

      // Track cache stats locally to return in result
      let cacheHits = 0
      let cacheMisses = 0

      // Get session state from L1 (for crisis level tracking, etc.)
      const stateResult = await this.l1.get(conversationId, ctx)
      const sessionState = stateResult.ok && stateResult.value
        ? stateResult.value
        : this.createDefaultSessionState()

      // Use pre-loaded profile if available, otherwise fetch from L2
      let userProfile: UserProfile | null = preloadedProfile ?? null
      if (preloadedProfile === undefined) {
        const profileResult = await this.l2.getUserProfile(userId, ctx)
        userProfile = profileResult.ok ? profileResult.value : null
      }

      // Get previous session summaries
      const summariesResult = await this.l2.getSessionSummaries(conversationId, 5, ctx)
      const previousSessions = summariesResult.ok ? summariesResult.value : []

      // STAGE 1: Try L2 (PostgreSQL) - authoritative message store
      const l2Result = await this.l2.getConversationHistory(
        conversationId,
        this.config.l2MessageLimit,
        ctx
      )

      if (!l2Result.ok) {
        logger.error({ error: l2Result.error }, 'L2 retrieval failed')
        return err({
          kind: 'RetrievalError',
          message: 'Failed to retrieve from L2',
          context: { conversationId },
          cause: l2Result.error,
        })
      }

      if (l2Result.value.length > 0) {
        cacheHits++
        pipelineMetrics.memoryCacheHits.add(1, { tier: 'L2' })
        logger.debug({ count: l2Result.value.length }, 'L2 hit')

        // Query L3 for related entities (non-blocking)
        const relatedEntities = await this.queryL3Entities(userId, ctx)

        const context = this.assembleContext(
          l2Result.value,
          userProfile,
          sessionState,
          previousSessions,
          [],
          relatedEntities,
          displayName
        )

        return ok({
          context,
          latencyMs: Date.now() - startTime,
          cacheHits,
          cacheMisses,
        })
      }

      cacheMisses++
      pipelineMetrics.memoryCacheMisses.add(1, { tier: 'L2' })
      logger.debug('L2 miss, searching L3/L4')

      // STAGE 2: Semantic search in L4 (and optionally L3)
      if (queryEmbedding) {
        const l4Result = await this.l4.search(
          queryEmbedding,
          {
            userId,
            limit: 10,
            daysBack: this.config.semanticSearchDays,
            scoreThreshold: this.config.semanticScoreThreshold,
          },
          ctx
        )

        if (l4Result.ok && l4Result.value.length > 0) {
          cacheHits++
          pipelineMetrics.memoryCacheHits.add(1, { tier: 'L4' })
          logger.debug({ count: l4Result.value.length }, 'L4 semantic matches found')

          // Query L3 for related entities (non-blocking)
          const relatedEntities = await this.queryL3Entities(userId, ctx)

          const context = this.assembleContext(
            [],
            userProfile,
            sessionState,
            previousSessions,
            l4Result.value,
            relatedEntities,
            displayName
          )

          return ok({
            context,
            latencyMs: Date.now() - startTime,
            cacheHits,
            cacheMisses,
          })
        }
      }

      // No context found - return empty context
      logger.debug('No context found in any tier')

      // Still query L3 for related entities even without messages
      const relatedEntities = await this.queryL3Entities(userId, ctx)

      const context = this.assembleContext(
        [],
        userProfile,
        sessionState,
        previousSessions,
        [],
        relatedEntities,
        displayName
      )

      return ok({
        context,
        latencyMs: Date.now() - startTime,
        cacheHits,
        cacheMisses,
      })
    })
  }

  /**
   * Store a message to L2 (and optionally L4 for semantic search)
   *
   * Note: L1 message caching is disabled since Vercel AI SDK clients send
   * full message history with each request. L1 is only used for session
   * metadata (state, post-process stats).
   */
  async storeMessage(
    message: Message,
    embedding: number[] | null,
    ctx: TraceContext
  ): Promise<Result<void, MemoryError>> {
    return withSpan('MemoryOrchestrator.storeMessage', async () => {
      const logger = getLogger().child({
        messageId: message.id,
        conversationId: message.conversationId,
        role: message.role,
        requestId: ctx.requestId,
      })

      // L2: Persist to PostgreSQL (authoritative store)
      const l2Result = await this.l2.storeMessage(message, embedding, ctx)
      if (!l2Result.ok) {
        logger.error({ error: l2Result.error }, 'L2 write failed')
        return err({
          kind: 'PersistError',
          message: 'Failed to persist message to L2',
          context: { messageId: message.id },
          cause: l2Result.error,
        })
      }

      // L4: Index in vector store (if embedding provided)
      if (embedding) {
        const l4Result = await this.l4.indexMessage(message, embedding, ctx)
        if (!l4Result.ok) {
          logger.warn({ error: l4Result.error }, 'L4 indexing failed')
          // Continue - L4 is for search, can be re-indexed later
        }
      }

      logger.debug({ role: message.role }, 'Message stored in L2')
      return ok(undefined)
    })
  }

  /**
   * Update session state in L1
   */
  async updateSessionState(
    conversationId: string,
    state: Partial<SessionState>,
    ctx: TraceContext
  ): Promise<Result<void, MemoryError>> {
    return withSpan('MemoryOrchestrator.updateSessionState', async () => {
      const existingResult = await this.l1.get(conversationId, ctx)

      const currentState = existingResult.ok && existingResult.value
        ? existingResult.value
        : this.createDefaultSessionState()

      const updatedState: SessionState = {
        ...currentState,
        ...state,
        lastActivity: Date.now(),
      }

      const result = await this.l1.set(conversationId, updatedState, ctx)

      if (!result.ok) {
        return err({
          kind: 'PersistError',
          message: 'Failed to update session state',
          context: { conversationId },
          cause: result.error,
        })
      }

      return ok(undefined)
    })
  }

  private assembleContext(
    messages: Message[],
    userProfile: import('@pippa/types').UserProfile | null,
    sessionState: SessionState,
    previousSessions: import('@pippa/types').SessionSummary[],
    semanticMatches: import('@pippa/types').SemanticMatch[],
    relatedEntities?: Entity[],
    displayName?: string
  ): AssembledContext {
    const context: AssembledContext = {
      messages,
      userProfile,
      displayName,
      sessionEntities: this.extractSessionEntities(messages),
      sessionState,
      previousSessions,
      semanticMatches,
      relatedEntities,
    }

    // Log context size in KB
    const sizeBytes = Buffer.byteLength(JSON.stringify(context), 'utf8')
    const sizeKB = (sizeBytes / 1024).toFixed(2)
    getLogger().info({ sizeKB, messageCount: messages.length }, 'Context assembled')

    return context
  }

  private extractSessionEntities(messages: Message[]): SessionEntities {
    // Simple extraction - in production, use NER
    const entities: SessionEntities = {
      people: [],
      places: [],
      events: [],
      emotions: [],
      medications: [],
    }

    for (const msg of messages) {
      if (msg.metadata?.entities) {
        // Extract from metadata if available
        for (const entity of msg.metadata.entities) {
          if (!entities.people.includes(entity)) {
            entities.people.push(entity)
          }
        }
      }
    }

    return entities
  }

  private createDefaultSessionState(): SessionState {
    return {
      startTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      crisisLevel: 1,
    }
  }

  /**
   * Query L3 knowledge graph for user's related entities
   */
  private async queryL3Entities(
    userId: string,
    ctx: TraceContext
  ): Promise<Entity[] | undefined> {
    if (!this.config.enableL3Queries) {
      return undefined
    }

    const logger = getLogger().child({ userId, requestId: ctx.requestId })

    try {
      // Search for recent entities related to this user
      const result = await this.l3.searchEntities(userId, ctx)

      if (result.ok && result.value.length > 0) {
        pipelineMetrics.memoryCacheHits.add(1, { tier: 'L3' })
        logger.debug({ count: result.value.length }, 'L3 entities found')
        return result.value.slice(0, this.config.l3EntityLimit)
      }

      return undefined
    } catch (error) {
      logger.warn({ error }, 'L3 query failed, continuing without entities')
      return undefined
    }
  }

  /**
   * Store post-process stats in L1 for phase-shifted diagnostics
   * These are retrieved on the next request to show what happened in the previous exchange
   */
  async storePostProcessStats<T>(
    conversationId: string,
    stats: T,
    ctx: TraceContext
  ): Promise<Result<void, MemoryError>> {
    return withSpan('MemoryOrchestrator.storePostProcessStats', async () => {
      const logger = getLogger().child({ conversationId, requestId: ctx.requestId })

      // Check if L1 store supports post-process stats
      const l1WithStats = this.l1 as typeof this.l1 & {
        storePostProcessStats?: <S>(id: string, s: S, c: TraceContext) => Promise<Result<void, unknown>>
      }

      if (!l1WithStats.storePostProcessStats) {
        logger.debug('L1 store does not support post-process stats')
        return ok(undefined)
      }

      const result = await l1WithStats.storePostProcessStats(conversationId, stats, ctx)
      if (!result.ok) {
        return err({
          kind: 'PersistError',
          message: 'Failed to store post-process stats',
          context: { conversationId },
          cause: result.error,
        })
      }

      return ok(undefined)
    })
  }

  /**
   * Retrieve post-process stats from previous exchange
   * Returns null if no stats exist (first message or L1 doesn't support it)
   */
  async getPostProcessStats<T>(
    conversationId: string,
    ctx: TraceContext
  ): Promise<Result<T | null, MemoryError>> {
    return withSpan('MemoryOrchestrator.getPostProcessStats', async () => {
      const logger = getLogger().child({ conversationId, requestId: ctx.requestId })

      // Check if L1 store supports post-process stats
      const l1WithStats = this.l1 as typeof this.l1 & {
        getPostProcessStats?: <S>(id: string, c: TraceContext) => Promise<Result<S | null, unknown>>
      }

      if (!l1WithStats.getPostProcessStats) {
        logger.debug('L1 store does not support post-process stats')
        return ok(null)
      }

      const result = await l1WithStats.getPostProcessStats<T>(conversationId, ctx)
      if (!result.ok) {
        logger.warn({ error: result.error }, 'Failed to get post-process stats')
        return ok(null) // Non-fatal - return null instead of error
      }

      return ok(result.value)
    })
  }
}
