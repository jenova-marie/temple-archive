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
  IMem0Store,
  Message,
  MessageTurn,
  AssembledContext,
  TraceContext,
  Result,
  SessionState,
  SessionEntities,
  Entity,
  UserProfile,
  Mem0SearchResult,
} from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'
import { deduplicateFactsWithScores } from './semanticDedup.js'

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
  /** Enable L5 Mem0 memory system (primary) */
  enableL5Memory: boolean
  /** Maximum memories to retrieve from L5 */
  l5MemoryLimit: number
  /** Similarity threshold for semantic deduplication of L5 memories (0-1). Default: 0.80 */
  l5DedupThreshold?: number
}

export interface MemoryRetrievalResult {
  context: AssembledContext
  latencyMs: number
  /** Number of cache hits during retrieval */
  cacheHits: number
  /** Number of cache misses during retrieval */
  cacheMisses: number
  /** Semantic search results from L4 (if queried) */
  semanticResults?: Array<{
    score: number
    content: string
    role?: string
    timestamp?: number
  }>
  /** L5 memory deduplication stats */
  l5Dedup?: {
    /** Duration of deduplication (ms) */
    durationMs: number
    /** Number of raw memories before dedup */
    rawCount: number
    /** Number of memories after dedup */
    dedupCount: number
  }
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
    config?: Partial<MemoryOrchestratorConfig>,
    private readonly l5?: IMem0Store
  ) {
    this.config = {
      l2MessageLimit: 50,
      semanticSearchDays: 90,
      semanticScoreThreshold: 0.7,
      l3EntityLimit: 20,
      // L3 (Neo4j) queries default off. Most deployments use L5 Mem0 as
      // primary memory; L3 must be explicitly opted in via container config.
      enableL3Queries: false,
      enableL5Memory: false,
      l5MemoryLimit: 10,
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
   * @param queryText - Optional query text for L5 Mem0 semantic search
   */
  async retrieveContext(
    conversationId: string,
    userId: string,
    queryEmbedding: number[] | null,
    ctx: TraceContext,
    preloadedProfile?: UserProfile | null,
    displayName?: string,
    queryText?: string
  ): Promise<Result<MemoryRetrievalResult, MemoryError>> {
    return withSpan('MemoryOrchestrator.retrieveContext', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        conversationId,
        userId,
        requestId: ctx.requestId,
        l5Enabled: this.config.enableL5Memory,
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

      // L5 Mem0 retrieval (primary memory system when enabled)
      let mem0Memories: Mem0SearchResult[] | undefined
      let l5DedupStats: { durationMs: number; rawCount: number; dedupCount: number } | undefined
      if (this.config.enableL5Memory && queryText) {
        const rawMemories = await this.queryL5Memories(userId, queryText, ctx)
        if (rawMemories && rawMemories.length > 0) {
          // Semantic deduplication to remove similar facts
          const dedupStartTime = Date.now()
          const dedupThreshold = this.config.l5DedupThreshold ?? 0.80
          const factsWithScores = rawMemories.map(m => ({
            text: m.memory,
            score: m.score ?? 0,
            original: m,
          }))

          const deduplicated = await deduplicateFactsWithScores(
            factsWithScores.map(f => ({ text: f.text, score: f.score })),
            { threshold: dedupThreshold }
          )

          // Map back to original Mem0SearchResult objects
          const dedupTexts = new Set(deduplicated.map(d => d.text))
          mem0Memories = rawMemories.filter(m => dedupTexts.has(m.memory))

          const dedupDurationMs = Date.now() - dedupStartTime
          l5DedupStats = {
            durationMs: dedupDurationMs,
            rawCount: rawMemories.length,
            dedupCount: mem0Memories.length,
          }

          cacheHits++
          logger.debug(
            { raw: rawMemories.length, deduplicated: mem0Memories.length, durationMs: dedupDurationMs },
            'L5 Mem0 memories retrieved and deduplicated'
          )
          pipelineMetrics.stageDuration.record(dedupDurationMs, { stage: 'l5_dedup' })
        }
      }

      // Get previous session summaries (only if L2 retrieval enabled)
      const l2RetrievalEnabled = process.env.ENABLE_L2_RETRIEVAL !== 'false'
      let previousSessions: import('@siri/types').SessionSummary[] = []

      if (l2RetrievalEnabled) {
        const summariesResult = await this.l2.getSessionSummaries(conversationId, 5, ctx)
        previousSessions = summariesResult.ok ? summariesResult.value : []
      }

      // STAGE 1: Try L2 (PostgreSQL) - authoritative message store
      // Skip if L2 retrieval disabled (client sends full history with Vercel AI SDK)
      if (l2RetrievalEnabled) {
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

          // Query L3 for related entities (non-blocking, skip if L5 is primary)
          const relatedEntities = this.config.enableL5Memory
            ? undefined
            : await this.queryL3Entities(userId, ctx)

          const context = this.assembleContext(
            l2Result.value,
            userProfile,
            sessionState,
            previousSessions,
            [],
            relatedEntities,
            displayName,
            mem0Memories
          )

          return ok({
            context,
            latencyMs: Date.now() - startTime,
            cacheHits,
            cacheMisses,
            l5Dedup: l5DedupStats,
          })
        }

        cacheMisses++
        pipelineMetrics.memoryCacheMisses.add(1, { tier: 'L2' })
        logger.debug('L2 miss, searching L3/L4')
      } else {
        logger.debug('L2 retrieval disabled (ENABLE_L2_RETRIEVAL=false)')
      }

      // STAGE 2: Semantic search in L4 (skip if L5 is primary)
      let semanticResults: MemoryRetrievalResult['semanticResults'] = undefined
      if (queryEmbedding && !this.config.enableL5Memory) {
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

          // Capture semantic results for diagnostics
          semanticResults = l4Result.value.map(match => ({
            score: match.score,
            content: match.content.slice(0, 200), // Truncate for display
            role: match.metadata.role,
            timestamp: match.metadata.timestamp,
          }))

          // Query L3 for related entities (non-blocking)
          const relatedEntities = await this.queryL3Entities(userId, ctx)

          const context = this.assembleContext(
            [],
            userProfile,
            sessionState,
            previousSessions,
            l4Result.value,
            relatedEntities,
            displayName,
            mem0Memories
          )

          return ok({
            context,
            latencyMs: Date.now() - startTime,
            cacheHits,
            cacheMisses,
            semanticResults,
            l5Dedup: l5DedupStats,
          })
        }
      }

      // No context found in L2/L4 - return context with L5 memories if available
      logger.debug('No context found in L2/L4, returning with L5 memories if available')

      // Still query L3 for related entities even without messages (skip if L5 is primary)
      const relatedEntities = this.config.enableL5Memory
        ? undefined
        : await this.queryL3Entities(userId, ctx)

      const context = this.assembleContext(
        [],
        userProfile,
        sessionState,
        previousSessions,
        [],
        relatedEntities,
        displayName,
        mem0Memories
      )

      return ok({
        context,
        latencyMs: Date.now() - startTime,
        cacheHits,
        cacheMisses,
        l5Dedup: l5DedupStats,
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
      // Note: Pass null for embedding - vectors are stored in Qdrant (L4) only
      const l2Result = await this.l2.storeMessage(message, null, ctx)
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
    userProfile: import('@siri/types').UserProfile | null,
    sessionState: SessionState,
    previousSessions: import('@siri/types').SessionSummary[],
    semanticMatches: import('@siri/types').SemanticMatch[],
    relatedEntities?: Entity[],
    displayName?: string,
    mem0Memories?: Mem0SearchResult[]
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
      mem0Memories,
    }

    // Log context size in KB
    const sizeBytes = Buffer.byteLength(JSON.stringify(context), 'utf8')
    const sizeKB = (sizeBytes / 1024).toFixed(2)
    getLogger().info({ sizeKB, messageCount: messages.length, mem0Count: mem0Memories?.length ?? 0 }, 'Context assembled')

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
   * Query L5 Mem0 for user's memories
   */
  private async queryL5Memories(
    userId: string,
    query: string,
    ctx: TraceContext
  ): Promise<Mem0SearchResult[] | undefined> {
    if (!this.config.enableL5Memory || !this.l5) {
      return undefined
    }

    const logger = getLogger().child({ userId, requestId: ctx.requestId })

    try {
      const result = await this.l5.searchMemory(query, {
        userId,
        limit: this.config.l5MemoryLimit,
      }, ctx)

      if (result.ok && result.value.length > 0) {
        pipelineMetrics.memoryCacheHits.add(1, { tier: 'L5' })
        logger.debug({ count: result.value.length }, 'L5 Mem0 memories found')
        return result.value
      }

      return undefined
    } catch (error) {
      logger.warn({ error }, 'L5 Mem0 query failed, continuing without memories')
      return undefined
    }
  }

  /**
   * Get conversation history from L2 (PostgreSQL).
   * Used when server fetches history instead of receiving it from client.
   */
  async getConversationHistory(
    conversationId: string,
    limit: number,
    ctx: TraceContext
  ): Promise<Result<Message[], MemoryError>> {
    return withSpan('MemoryOrchestrator.getConversationHistory', async () => {
      const logger = getLogger().child({
        conversationId,
        limit,
        requestId: ctx.requestId,
      })

      const result = await this.l2.getConversationHistory(conversationId, limit, ctx)

      if (!result.ok) {
        logger.error({ error: result.error }, 'Failed to fetch conversation history')
        return err({
          kind: 'RetrievalError',
          message: 'Failed to fetch conversation history from L2',
          context: { conversationId },
          cause: result.error,
        })
      }

      logger.debug({ count: result.value.length }, 'Fetched conversation history from L2')
      return ok(result.value)
    })
  }

  /**
   * Get the next turn sequence number for a conversation.
   * Uses Redis INCR for atomic counter operations.
   */
  async getNextTurnSequence(
    conversationId: string,
    ctx: TraceContext
  ): Promise<Result<number, MemoryError>> {
    return withSpan('MemoryOrchestrator.getNextTurnSequence', async () => {
      const key = `turn:seq:${conversationId}`
      const result = await this.l1.incrementCounter(key, ctx)

      if (!result.ok) {
        return err({
          kind: 'PersistError',
          message: 'Failed to get turn sequence',
          context: { conversationId },
          cause: result.error,
        })
      }

      return ok(result.value)
    })
  }

  /**
   * Store a message turn (links user/assistant pair) to L2.
   */
  async storeTurn(
    turn: MessageTurn,
    ctx: TraceContext
  ): Promise<Result<void, MemoryError>> {
    return withSpan('MemoryOrchestrator.storeTurn', async () => {
      const logger = getLogger().child({
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        requestId: ctx.requestId,
      })

      const result = await this.l2.storeTurn(turn, ctx)

      if (!result.ok) {
        logger.error({ error: result.error }, 'Failed to store turn')
        return err({
          kind: 'PersistError',
          message: 'Failed to store turn',
          context: { turnId: turn.turnId },
          cause: result.error,
        })
      }

      logger.debug({ sequenceNumber: turn.sequenceNumber }, 'Turn stored')
      return ok(undefined)
    })
  }

  /**
   * Store messages to L5 Mem0 for fact extraction
   * Call this in postflight after response is generated.
   *
   * @param turnId - Optional turn ID to link extracted memories to the turn
   */
  async storeToMem0(
    userMessage: Message,
    assistantMessage: Message,
    ctx: TraceContext,
    turnId?: string
  ): Promise<Result<void, MemoryError>> {
    if (!this.config.enableL5Memory || !this.l5) {
      return ok(undefined)
    }

    return withSpan('MemoryOrchestrator.storeToMem0', async () => {
      const logger = getLogger().child({
        userId: userMessage.userId,
        conversationId: userMessage.conversationId,
        turnId,
        requestId: ctx.requestId,
      })

      try {
        // Include turnId in metadata if provided, otherwise fall back to message IDs
        const metadata = turnId
          ? { turnId }
          : {
              userMessageId: userMessage.id,
              assistantMessageId: assistantMessage.id,
            }

        const result = await this.l5!.addMemory(
          [
            { role: 'user', content: userMessage.content },
            { role: 'assistant', content: assistantMessage.content },
          ],
          {
            userId: userMessage.userId,
            runId: userMessage.conversationId,
            metadata,
          },
          ctx
        )

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Failed to store to Mem0')
          return err({
            kind: 'PersistError',
            message: 'Failed to store to Mem0',
            context: { userId: userMessage.userId },
            cause: result.error,
          })
        }

        logger.debug(
          { memoryCount: result.value.memoryIds.length, resultCount: result.value.results.length, turnId },
          'Stored messages to Mem0'
        )
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Mem0 storage failed')
        return err({
          kind: 'PersistError',
          message: 'Mem0 storage failed',
          context: { userId: userMessage.userId },
          cause: error,
        })
      }
    })
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
