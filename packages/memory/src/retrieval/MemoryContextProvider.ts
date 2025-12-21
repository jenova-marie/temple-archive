/**
 * Memory Context Provider
 *
 * Adapter that wraps MemoryRetrievalService to match the MemoryContextBuilder interface.
 * This allows swapping between legacy and L3 retrieval via configuration.
 */

import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import type { TraceContext } from '@recoverysky/types'
import type { MemoryRetrievalService, RetrievalOptions } from './MemoryRetrievalService.js'
import type { ContextStrategy } from '../deepmemory/DeepMemoryService.js'

/**
 * Interface for memory context providers.
 * Both MemoryContextBuilder and L3MemoryContextProvider implement this.
 */
export interface IMemoryContextProvider {
  buildContext(
    userMessage: string,
    userId: string,
    ctx: TraceContext
  ): Promise<string | null>
}

/**
 * Configuration for L3 Memory Context Provider
 */
export interface L3MemoryContextProviderConfig {
  /** Include entity observations (default: true) */
  includeObservations?: boolean
  /** Include Deep Memory conversation context (default: true) */
  includeConversationContext?: boolean
  /** Deep Memory context strategy (default: 'latest') */
  contextStrategy?: ContextStrategy
  /** Maximum entities to retrieve (default: 10) */
  limit?: number
  /** Maximum tokens for formatted output (default: 2000) */
  maxTokens?: number
  /** Minimum relevance score (default: 0.1) */
  minScore?: number
}

/**
 * Default configuration
 */
export const DEFAULT_L3_CONTEXT_CONFIG: Required<L3MemoryContextProviderConfig> = {
  includeObservations: true,
  includeConversationContext: true,
  contextStrategy: 'latest',
  limit: 10,
  maxTokens: 2000,
  minScore: 0.1,
}

/**
 * L3 Memory Context Provider
 *
 * Wraps MemoryRetrievalService to provide memory context for agent prompts.
 * Implements the same interface as MemoryContextBuilder for drop-in replacement.
 */
export class L3MemoryContextProvider implements IMemoryContextProvider {
  private readonly config: Required<L3MemoryContextProviderConfig>

  constructor(
    private readonly retrievalService: MemoryRetrievalService,
    config?: L3MemoryContextProviderConfig
  ) {
    this.config = { ...DEFAULT_L3_CONTEXT_CONFIG, ...config }
  }

  /**
   * Build memory context for injection into agent prompt.
   * Matches MemoryContextBuilder.buildContext() signature.
   */
  async buildContext(
    userMessage: string,
    userId: string,
    ctx: TraceContext
  ): Promise<string | null> {
    return withSpan('L3MemoryContextProvider.buildContext', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        userId,
        messageLength: userMessage.length,
        requestId: ctx.requestId,
      })

      logger.debug(
        {
          limit: this.config.limit,
          maxTokens: this.config.maxTokens,
          includeObservations: this.config.includeObservations,
          includeConversationContext: this.config.includeConversationContext,
          contextStrategy: this.config.contextStrategy,
        },
        'Building L3 memory context'
      )

      try {
        const options: RetrievalOptions = {
          includeObservations: this.config.includeObservations,
          includeConversationContext: this.config.includeConversationContext,
          contextStrategy: this.config.contextStrategy,
          limit: this.config.limit,
          maxTokens: this.config.maxTokens,
          minScore: this.config.minScore,
        }

        const result = await this.retrievalService.retrieve(
          userMessage,
          userId,
          options,
          ctx
        )

        const durationMs = Date.now() - startTime

        if (!result.ok) {
          logger.debug({ error: result.error, durationMs, messageLength: userMessage.length }, 'L3 retrieval failed - full error')
          logger.warn({ errorKind: result.error.kind, durationMs }, 'L3 retrieval failed')
          pipelineMetrics.errors.add(1, { kind: 'l3_context_build_error' })
          return null
        }

        if (result.value.entities.length === 0) {
          logger.debug({ durationMs }, 'No entities found for context')
          return null
        }

        logger.info(
          {
            entities: result.value.entities.length,
            totalMatched: result.value.totalMatched,
            tokens: result.value.tokenCount,
            durationMs,
          },
          'L3 memory context built'
        )

        // Record metrics
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_context_build' })

        return result.value.formattedContext || null
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.debug({ error, stack: error instanceof Error ? error.stack : undefined, durationMs }, 'L3 memory context build failed - full error')
        logger.error({ errorMessage: error instanceof Error ? error.message : String(error), durationMs }, 'L3 memory context build failed')
        pipelineMetrics.errors.add(1, { kind: 'l3_context_build_error' })
        return null
      }
    })
  }

  /**
   * Get current configuration.
   */
  getConfig(): Required<L3MemoryContextProviderConfig> {
    return { ...this.config }
  }
}

/**
 * Load L3 context provider configuration from environment.
 */
export function loadL3ContextConfig(): L3MemoryContextProviderConfig {
  return {
    includeObservations: process.env.L3_INCLUDE_OBSERVATIONS !== 'false',
    includeConversationContext: process.env.DEEP_MEMORY_ENABLED !== 'false',
    contextStrategy: (process.env.DEEP_MEMORY_STRATEGY as ContextStrategy) || 'latest',
    limit: parseInt(process.env.L3_RETRIEVAL_LIMIT || '10', 10),
    maxTokens: parseInt(process.env.L3_RETRIEVAL_MAX_TOKENS || '2000', 10),
    minScore: parseFloat(process.env.L3_RETRIEVAL_MIN_SCORE || '0.1'),
  }
}
