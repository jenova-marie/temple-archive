/**
 * Context Compaction Types
 *
 * Types and configuration for the context compaction system that summarizes
 * older messages to reduce context size while preserving semantic information.
 */

import type { Message, TraceContext } from '@siri/types'

/**
 * Configuration for context compaction
 */
export interface CompactionConfig {
  /** Message count threshold to trigger compaction */
  threshold: number
  /** Number of oldest messages to compact per batch */
  batchSize: number
  /** LLM model for summarization */
  model: string
  /** Max tokens for summary response */
  maxTokens: number
  /** Timeout for LLM call (ms) */
  timeoutMs: number
  /** Whether compaction is enabled */
  enabled: boolean
}

/**
 * Default compaction configuration
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 30,
  batchSize: 15,
  model: 'claude-3-haiku-20240307',
  maxTokens: 512,
  timeoutMs: 15000,
  enabled: true,
}

/**
 * Load compaction config from environment variables
 */
export function loadCompactionConfig(): CompactionConfig {
  return {
    enabled: process.env.COMPACTION_ENABLED !== 'false',
    threshold:
      parseInt(process.env.COMPACTION_THRESHOLD ?? '', 10) ||
      DEFAULT_COMPACTION_CONFIG.threshold,
    batchSize:
      parseInt(process.env.COMPACTION_BATCH_SIZE ?? '', 10) ||
      DEFAULT_COMPACTION_CONFIG.batchSize,
    model: process.env.COMPACTION_MODEL || DEFAULT_COMPACTION_CONFIG.model,
    maxTokens:
      parseInt(process.env.COMPACTION_MAX_TOKENS ?? '', 10) ||
      DEFAULT_COMPACTION_CONFIG.maxTokens,
    timeoutMs:
      parseInt(process.env.COMPACTION_TIMEOUT_MS ?? '', 10) ||
      DEFAULT_COMPACTION_CONFIG.timeoutMs,
  }
}

/**
 * Summary message metadata marker
 */
export interface SummaryMetadata {
  /** Message type marker */
  type: 'summary'
  /** IDs of original messages that were compacted */
  originalMessageIds: string[]
  /** When compaction occurred */
  compactedAt: number
  /** Number of original messages */
  originalCount: number
}

/**
 * Compaction error types
 */
export interface CompactionError {
  kind: 'LLMError' | 'RedisError' | 'ConfigError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * Interface for context compaction
 */
export interface IContextCompactor {
  /**
   * Check if compaction is needed and run if so (fire-and-forget)
   * @param conversationId - The conversation ID
   * @param messages - Already-loaded messages from memory retrieval
   * @param ctx - Trace context for logging/observability
   */
  maybeCompact(
    conversationId: string,
    messages: Message[],
    ctx: TraceContext
  ): void

  /**
   * Get compaction configuration
   */
  getConfig(): CompactionConfig
}
