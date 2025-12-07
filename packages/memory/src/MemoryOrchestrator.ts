/**
 * Memory Orchestrator - Coordinates multi-tier memory retrieval
 *
 * This is the main entry point for memory operations. It implements
 * the tiered caching strategy described in the architecture:
 *
 * L1 (Redis) → L2 (PostgreSQL) → L3 (Neo4j) + L4 (Qdrant)
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
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'

export interface MemoryOrchestratorConfig {
  /** Maximum messages to retrieve from L1 */
  l1MessageLimit: number
  /** Maximum messages to retrieve from L2 */
  l2MessageLimit: number
  /** Days back to search in semantic search */
  semanticSearchDays: number
  /** Minimum similarity score for semantic matches */
  semanticScoreThreshold: number
}

export interface MemoryRetrievalResult {
  context: AssembledContext
  source: 'L1_REDIS' | 'L2_POSTGRESQL' | 'L3_NEO4J_L4_QDRANT' | 'COMBINED'
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
    // L3 (Neo4j) - reserved for future knowledge graph integration
    private readonly l3: IKnowledgeStore,
    private readonly l4: IVectorStore,
    config?: Partial<MemoryOrchestratorConfig>
  ) {
    // L3 will be used in future for knowledge graph queries
    void this.l3

    this.config = {
      l1MessageLimit: 20,
      l2MessageLimit: 50,
      semanticSearchDays: 90,
      semanticScoreThreshold: 0.7,
      ...config,
    }
  }

  /**
   * Retrieve assembled context for a conversation
   */
  async retrieveContext(
    conversationId: string,
    userId: string,
    queryEmbedding: number[] | null,
    ctx: TraceContext
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

      // STAGE 1: Try L1 cache (Redis)
      const l1Result = await this.l1.getRecentMessages(
        conversationId,
        this.config.l1MessageLimit,
        ctx
      )

      if (!l1Result.ok) {
        logger.warn({ error: l1Result.error }, 'L1 retrieval failed, continuing to L2')
        pipelineMetrics.errors.add(1, { error_kind: l1Result.error.kind })
      }

      if (l1Result.ok && l1Result.value.length > 0) {
        cacheHits++
        pipelineMetrics.memoryCacheHits.add(1, { tier: 'L1' })
        logger.debug({ count: l1Result.value.length }, 'L1 cache hit')

        // Get session state
        const stateResult = await this.l1.get(conversationId, ctx)
        const sessionState = stateResult.ok && stateResult.value
          ? stateResult.value
          : this.createDefaultSessionState()

        // Get user profile from L2 (may be cached)
        const profileResult = await this.l2.getUserProfile(userId, ctx)
        const userProfile = profileResult.ok ? profileResult.value : null

        const context = this.assembleContext(
          l1Result.value,
          userProfile,
          sessionState,
          [],
          []
        )

        return ok({
          context,
          source: 'L1_REDIS' as const,
          latencyMs: Date.now() - startTime,
          cacheHits,
          cacheMisses,
        })
      }

      cacheMisses++
      pipelineMetrics.memoryCacheMisses.add(1, { tier: 'L1' })
      logger.debug('L1 cache miss, trying L2')

      // STAGE 2: Try L2 (PostgreSQL)
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

      // Get user profile
      const profileResult = await this.l2.getUserProfile(userId, ctx)
      const userProfile = profileResult.ok ? profileResult.value : null

      // Get previous session summaries
      const summariesResult = await this.l2.getSessionSummaries(conversationId, 5, ctx)
      const previousSessions = summariesResult.ok ? summariesResult.value : []

      if (l2Result.value.length > 0) {
        cacheHits++
        pipelineMetrics.memoryCacheHits.add(1, { tier: 'L2' })
        logger.debug({ count: l2Result.value.length }, 'L2 hit')

        // Warm L1 cache with recent messages
        await this.warmL1Cache(conversationId, l2Result.value.slice(-20), ctx)

        const context = this.assembleContext(
          l2Result.value,
          userProfile,
          this.createDefaultSessionState(),
          previousSessions,
          []
        )

        return ok({
          context,
          source: 'L2_POSTGRESQL' as const,
          latencyMs: Date.now() - startTime,
          cacheHits,
          cacheMisses,
        })
      }

      cacheMisses++
      pipelineMetrics.memoryCacheMisses.add(1, { tier: 'L2' })
      logger.debug('L2 miss, searching L3/L4')

      // STAGE 3: Semantic search in L4 (and optionally L3)
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

          const context = this.assembleContext(
            [],
            userProfile,
            this.createDefaultSessionState(),
            previousSessions,
            l4Result.value
          )

          return ok({
            context,
            source: 'L3_NEO4J_L4_QDRANT' as const,
            latencyMs: Date.now() - startTime,
            cacheHits,
            cacheMisses,
          })
        }
      }

      // No context found - return empty context
      logger.debug('No context found in any tier')

      const context = this.assembleContext(
        [],
        userProfile,
        this.createDefaultSessionState(),
        previousSessions,
        []
      )

      return ok({
        context,
        source: 'COMBINED' as const,
        latencyMs: Date.now() - startTime,
        cacheHits,
        cacheMisses,
      })
    })
  }

  /**
   * Store a message across all tiers
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
        requestId: ctx.requestId,
      })

      // L1: Immediate write to Redis (synchronous for fast access)
      const l1Result = await this.l1.storeMessage(message, ctx)
      if (!l1Result.ok) {
        logger.warn({ error: l1Result.error }, 'L1 write failed')
        // Continue - L1 is cache, not authoritative
      }

      // L2: Persist to PostgreSQL
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

      logger.debug('Message stored across tiers')
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
    userProfile: import('@recoverysky/types').UserProfile | null,
    sessionState: SessionState,
    previousSessions: import('@recoverysky/types').SessionSummary[],
    semanticMatches: import('@recoverysky/types').SemanticMatch[]
  ): AssembledContext {
    return {
      messages,
      userProfile,
      sessionEntities: this.extractSessionEntities(messages),
      sessionState,
      previousSessions,
      semanticMatches,
    }
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

  private async warmL1Cache(
    conversationId: string,
    messages: Message[],
    ctx: TraceContext
  ): Promise<void> {
    const logger = getLogger().child({ conversationId, requestId: ctx.requestId })

    for (const message of messages) {
      await this.l1.storeMessage(message, ctx)
    }

    logger.debug({ count: messages.length }, 'L1 cache warmed')
  }
}
