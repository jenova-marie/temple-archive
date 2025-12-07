/**
 * Bootstrap Orchestrator - Coordinates the full memory bootstrap flow
 *
 * Responsibilities:
 * - Process each exchange (fire-and-forget after response)
 * - Extract memories via Haiku → L1 cache + L3 (Neo4j)
 * - During bootstrap window: search L4, merge L2 memories into L1
 * - Finalize conversation: L1 → L2, topic summary → L4
 */

import type { IMemoryStore, IVectorStore, IEmbeddingProvider, TraceContext } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'
import type {
  IBootstrapOrchestrator,
  IConversationMemoryCache,
  IMemoryExtractor,
  IMemoryCacheDeduplicator,
  ITopicGenerator,
  IMemoryCachePersistence,
  BootstrapConfig,
  Exchange,
} from './types.js'

export interface BootstrapOrchestratorDeps {
  cache: IConversationMemoryCache
  extractor: IMemoryExtractor
  deduplicator: IMemoryCacheDeduplicator
  topicGenerator: ITopicGenerator
  persistence: IMemoryCachePersistence
  memoryStore: IMemoryStore
  vectorStore: IVectorStore
  embeddingProvider: IEmbeddingProvider | null
}

/**
 * Main bootstrap orchestrator implementation
 */
export class BootstrapOrchestrator implements IBootstrapOrchestrator {
  // Track recent exchanges for topic generation
  private recentExchanges: Map<string, Exchange[]> = new Map()
  private readonly maxExchanges = 10

  constructor(
    private readonly deps: BootstrapOrchestratorDeps,
    private readonly config: BootstrapConfig
  ) {}

  /**
   * Process an exchange (called after each response, fire-and-forget)
   */
  async processExchange(
    exchange: Exchange,
    conversationId: string,
    userId: string,
    ctx: TraceContext
  ): Promise<void> {
    return withSpan('BootstrapOrchestrator.processExchange', async () => {
      const logger = getLogger().child({
        component: 'BootstrapOrchestrator',
        conversationId,
        userId,
        requestId: ctx.requestId,
      })

      try {
        // Track exchange for topic generation
        this.trackExchange(conversationId, exchange)

        // Increment exchange count
        const exchangeCount = await this.deps.cache.incrementExchangeCount(conversationId)
        logger.debug({ exchangeCount }, 'Processing exchange')

        // Get current cache (to avoid duplicates)
        const currentCache = await this.deps.cache.get(conversationId)

        // 1. Extract memories from this exchange
        const extractResult = await this.deps.extractor.extract(
          exchange,
          currentCache,
          userId,
          ctx
        )

        if (extractResult.ok && extractResult.value) {
          const { cacheEntries, memories } = extractResult.value

          // Add to L1 cache
          if (cacheEntries.length > 0) {
            await this.deps.cache.add(conversationId, cacheEntries, userId)
            logger.debug({ count: cacheEntries.length }, 'Added entries to L1 cache')
          }

          // Store to L3 (Neo4j)
          for (const memory of memories) {
            const storeResult = await this.deps.memoryStore.createMemory(
              {
                name: memory.name,
                memoryType: memory.memoryType,
                metadata: { ...memory.metadata, userId },
                observations: memory.observations.map(o => o.content),
              },
              ctx
            )
            if (!storeResult.ok) {
              logger.warn({ error: storeResult.error }, 'Failed to store memory in L3')
            }
          }

          // Check if we should deduplicate
          const metadata = await this.deps.cache.getMetadata(conversationId)
          const entryCount = metadata?.entryCount ?? 0
          if (entryCount > 0 && entryCount % this.config.dedupThreshold === 0) {
            await this.deduplicateCache(conversationId, ctx)
          }
        }

        // 2. Bootstrap window: search for related conversations
        if (exchangeCount >= this.config.bootstrapStart && exchangeCount <= this.config.bootstrapEnd) {
          await this.runBootstrap(conversationId, userId, ctx)
        }
      } catch (error) {
        logger.error({ error }, 'Error processing exchange')
        // Don't throw - this is fire-and-forget
      }
    })
  }

  /**
   * Finalize a conversation (on end or TTL)
   */
  async finalize(
    conversationId: string,
    userId: string,
    ctx: TraceContext
  ): Promise<void> {
    return withSpan('BootstrapOrchestrator.finalize', async () => {
      const logger = getLogger().child({
        component: 'BootstrapOrchestrator',
        conversationId,
        userId,
        requestId: ctx.requestId,
      })

      try {
        const currentCache = await this.deps.cache.get(conversationId)
        const exchanges = this.recentExchanges.get(conversationId) ?? []

        // 1. Generate topic summary
        const summaryResult = await this.deps.topicGenerator.generateSummary(
          exchanges,
          currentCache,
          ctx
        )

        const topicSummary = summaryResult.ok ? summaryResult.value : undefined

        // 2. Persist L1 → L2
        const persistResult = await this.deps.persistence.persist(conversationId, userId, topicSummary)
        if (!persistResult.ok) {
          logger.warn({ error: persistResult.error }, 'Failed to persist L1 to L2')
        }

        // 3. Store topic embedding in L4 (if we have summary and embedding provider)
        if (topicSummary && this.deps.embeddingProvider) {
          await this.storeTopicInL4(conversationId, userId, topicSummary, currentCache.length, exchanges.length, ctx)
        }

        // 4. Clean up
        await this.deps.cache.clear(conversationId)
        this.recentExchanges.delete(conversationId)

        logger.info('Conversation finalized')
      } catch (error) {
        logger.error({ error }, 'Error finalizing conversation')
      }
    })
  }

  /**
   * Get current L1 cache entries for a conversation (for LLM context)
   */
  async getMemoryCache(conversationId: string): Promise<string[]> {
    return this.deps.cache.get(conversationId)
  }

  /**
   * Clear memory cache for a conversation (for testing)
   */
  async clearMemoryCache(
    conversationId: string,
    levels: ('L1' | 'L2' | 'L4')[]
  ): Promise<void> {
    const logger = getLogger().child({ conversationId, levels, component: 'BootstrapOrchestrator' })

    if (levels.includes('L1')) {
      await this.deps.cache.clear(conversationId)
      logger.debug('Cleared L1 cache')
    }

    // L2 and L4 clearing would need to be implemented in persistence and vector store
    // For now, just log
    if (levels.includes('L2')) {
      logger.debug('L2 clearing not yet implemented')
    }

    if (levels.includes('L4')) {
      logger.debug('L4 clearing not yet implemented')
    }

    this.recentExchanges.delete(conversationId)
  }

  /**
   * Track exchange for topic generation
   */
  private trackExchange(conversationId: string, exchange: Exchange): void {
    const exchanges = this.recentExchanges.get(conversationId) ?? []
    exchanges.push(exchange)

    // Keep only recent exchanges
    if (exchanges.length > this.maxExchanges) {
      exchanges.shift()
    }

    this.recentExchanges.set(conversationId, exchanges)
  }

  /**
   * Deduplicate cache entries
   */
  private async deduplicateCache(conversationId: string, ctx: TraceContext): Promise<void> {
    const logger = getLogger().child({ conversationId, component: 'BootstrapOrchestrator' })

    const currentCache = await this.deps.cache.get(conversationId)
    const metadata = await this.deps.cache.getMetadata(conversationId)
    const userId = metadata?.userId ?? ''

    const dedupResult = await this.deps.deduplicator.deduplicate(currentCache, ctx)
    if (dedupResult.ok && dedupResult.value.length < currentCache.length) {
      await this.deps.cache.replace(conversationId, dedupResult.value, userId)
      logger.debug(
        { before: currentCache.length, after: dedupResult.value.length },
        'Deduplicated cache'
      )
    }
  }

  /**
   * Run bootstrap: search L4 for related conversations, merge L2 memories
   */
  private async runBootstrap(
    conversationId: string,
    userId: string,
    ctx: TraceContext
  ): Promise<void> {
    const logger = getLogger().child({ conversationId, component: 'BootstrapOrchestrator' })

    const currentCache = await this.deps.cache.get(conversationId)
    const exchanges = this.recentExchanges.get(conversationId) ?? []

    // Generate search phrases
    const phrasesResult = await this.deps.topicGenerator.generateSearchPhrases(
      exchanges,
      currentCache,
      ctx
    )

    if (!phrasesResult.ok || phrasesResult.value.length === 0) {
      logger.debug('No search phrases generated, skipping bootstrap')
      return
    }

    const searchPhrases = phrasesResult.value

    // Search L4 for related conversations (if we have embedding provider)
    if (!this.deps.embeddingProvider) {
      logger.debug('No embedding provider, skipping L4 search')
      return
    }

    // Embed search phrases and search L4
    const relatedConversationIds: string[] = []
    for (const phrase of searchPhrases.slice(0, 3)) {
      const embedResult = await this.deps.embeddingProvider.embed(phrase, ctx)
      if (!embedResult.ok) continue

      const searchResult = await this.deps.vectorStore.search(
        embedResult.value,
        {
          userId,
          limit: 5,
          daysBack: 90,
          scoreThreshold: 0.7,
        },
        ctx
      )

      if (searchResult.ok) {
        for (const match of searchResult.value) {
          if (match.metadata.conversationId && match.metadata.conversationId !== conversationId) {
            relatedConversationIds.push(match.metadata.conversationId)
          }
        }
      }
    }

    if (relatedConversationIds.length === 0) {
      logger.debug('No related conversations found')
      return
    }

    // Deduplicate conversation IDs
    const uniqueConversationIds = [...new Set(relatedConversationIds)]
    logger.debug({ count: uniqueConversationIds.length }, 'Found related conversations')

    // Load memories from L2
    const l2Result = await this.deps.persistence.loadMany(uniqueConversationIds)
    if (!l2Result.ok || l2Result.value.length === 0) {
      logger.debug('No L2 memories loaded')
      return
    }

    const l2Memories = l2Result.value
    logger.debug({ count: l2Memories.length }, 'Loaded L2 memories')

    // Merge with current L1
    const cacheLimit = this.config.cacheLimit === 'all' ? 100 :
                       this.config.cacheLimit === 'none' ? 0 :
                       this.config.cacheLimit

    const mergeResult = await this.deps.deduplicator.merge(
      currentCache,
      l2Memories,
      cacheLimit,
      ctx
    )

    if (mergeResult.ok && mergeResult.value.length > 0) {
      await this.deps.cache.replace(conversationId, mergeResult.value, userId)
      logger.info(
        { before: currentCache.length, l2: l2Memories.length, after: mergeResult.value.length },
        'Merged L2 memories into L1'
      )
    }
  }

  /**
   * Store topic embedding in L4
   */
  private async storeTopicInL4(
    conversationId: string,
    userId: string,
    topicSummary: string,
    memoryCount: number,
    exchangeCount: number,
    ctx: TraceContext
  ): Promise<void> {
    const logger = getLogger().child({ conversationId, component: 'BootstrapOrchestrator' })

    if (!this.deps.embeddingProvider) return

    const embedResult = await this.deps.embeddingProvider.embed(topicSummary, ctx)
    if (!embedResult.ok) {
      logger.warn({ error: embedResult.error }, 'Failed to embed topic summary')
      return
    }

    // Create a synthetic message to store in L4
    // This is a workaround since IVectorStore expects Message objects
    // We use topics to store metadata about the topic summary
    const syntheticMessage = {
      id: `topic_${conversationId}`,
      conversationId,
      userId,
      role: 'system' as const,
      content: topicSummary,
      timestamp: Date.now(),
      metadata: {
        topics: [`memory_count:${memoryCount}`, `exchange_count:${exchangeCount}`, 'topic_summary'],
      },
    }

    const indexResult = await this.deps.vectorStore.indexMessage(
      syntheticMessage,
      embedResult.value,
      ctx
    )

    if (!indexResult.ok) {
      logger.warn({ error: indexResult.error }, 'Failed to index topic in L4')
    } else {
      logger.debug('Stored topic summary in L4')
    }
  }
}

/**
 * Stub implementation for testing or when feature is disabled
 */
export class StubBootstrapOrchestrator implements IBootstrapOrchestrator {
  async processExchange(): Promise<void> {}
  async finalize(): Promise<void> {}
  async getMemoryCache(): Promise<string[]> { return [] }
  async clearMemoryCache(): Promise<void> {}
}
