/**
 * Bootstrap Memory System - Types & Interfaces
 *
 * Defines the configuration and interfaces for the conversation memory
 * bootstrap system that primes conversations with relevant past memories.
 */

import type { Memory, TraceContext, Result, StoreError } from '@pippa/types'

// =============================================================================
// Configuration
// =============================================================================

export interface BootstrapConfig {
  /** Feature flag - disabled by default */
  enabled: boolean
  /** Exchange count to start bootstrap window */
  bootstrapStart: number
  /** Exchange count to end bootstrap window */
  bootstrapEnd: number
  /** Max entries in L1 cache (number | 'all' | 'none') */
  cacheLimit: number | 'all' | 'none'
  /** L1 cache TTL in hours */
  cacheTTLHours: number
  /** Deduplicate after this many new entries */
  dedupThreshold: number
  /** Model for memory extraction */
  extractionModel: 'haiku' | 'sonnet'
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfig = {
  enabled: false,
  bootstrapStart: 3,
  bootstrapEnd: 8,
  cacheLimit: 50,
  cacheTTLHours: 4,
  dedupThreshold: 10,
  extractionModel: 'haiku',
}

/**
 * Load bootstrap config from environment variables
 */
export function loadBootstrapConfig(): BootstrapConfig {
  const limitEnv = process.env.MEMORY_CACHE_LIMIT
  let cacheLimit: number | 'all' | 'none' = DEFAULT_BOOTSTRAP_CONFIG.cacheLimit

  if (limitEnv === 'all' || limitEnv === 'none') {
    cacheLimit = limitEnv
  } else if (limitEnv) {
    const parsed = parseInt(limitEnv, 10)
    if (!isNaN(parsed)) {
      cacheLimit = parsed
    }
  }

  return {
    enabled: process.env.MEMORY_BOOTSTRAP_ENABLED === 'true',
    bootstrapStart: parseInt(process.env.MEMORY_BOOTSTRAP_START ?? '', 10) || DEFAULT_BOOTSTRAP_CONFIG.bootstrapStart,
    bootstrapEnd: parseInt(process.env.MEMORY_BOOTSTRAP_END ?? '', 10) || DEFAULT_BOOTSTRAP_CONFIG.bootstrapEnd,
    cacheLimit,
    cacheTTLHours: parseInt(process.env.MEMORY_CACHE_TTL_HOURS ?? '', 10) || DEFAULT_BOOTSTRAP_CONFIG.cacheTTLHours,
    dedupThreshold: parseInt(process.env.MEMORY_CACHE_DEDUP_THRESHOLD ?? '', 10) || DEFAULT_BOOTSTRAP_CONFIG.dedupThreshold,
    extractionModel: (process.env.MEMORY_EXTRACTION_MODEL as 'haiku' | 'sonnet') || DEFAULT_BOOTSTRAP_CONFIG.extractionModel,
  }
}

// =============================================================================
// Data Types
// =============================================================================

/** Metadata about a conversation's memory cache */
export interface CacheMetadata {
  conversationId: string
  userId: string
  entryCount: number
  exchangeCount: number
  lastUpdated: number
}

/** Result of memory extraction from an exchange */
export interface ExtractionResult {
  /** Pre-formatted strings for L1 cache (ready for LLM) */
  cacheEntries: string[]
  /** Structured Memory objects for L3 storage */
  memories: Memory[]
}

/** A user/assistant exchange */
export interface Exchange {
  userMessage: string
  assistantResponse: string
}

// =============================================================================
// Interfaces
// =============================================================================

/**
 * L1 Conversation Memory Cache (Redis)
 * Stores pre-formatted strings ready for LLM consumption
 */
export interface IConversationMemoryCache {
  /** Get all formatted memory strings for a conversation */
  get(conversationId: string): Promise<string[]>

  /** Add new entries to the cache */
  add(conversationId: string, entries: string[], userId: string): Promise<void>

  /** Replace entire cache (after dedup/merge) */
  replace(conversationId: string, entries: string[], userId: string): Promise<void>

  /** Clear cache for a conversation */
  clear(conversationId: string): Promise<void>

  /** Get cache metadata */
  getMetadata(conversationId: string): Promise<CacheMetadata | null>

  /** Increment exchange count */
  incrementExchangeCount(conversationId: string): Promise<number>
}

/**
 * L1 → L2 Memory Cache Persistence
 */
export interface IMemoryCachePersistence {
  /** Persist L1 cache to L2 (PostgreSQL) */
  persist(conversationId: string, userId: string, topicSummary?: string): Promise<Result<void, StoreError>>

  /** Load memories from L2 for a conversation */
  load(conversationId: string): Promise<Result<string[], StoreError>>

  /** Load memories from L2 for multiple conversations */
  loadMany(conversationIds: string[]): Promise<Result<string[], StoreError>>
}

/**
 * Memory Extractor - Uses Haiku to extract memories from exchanges
 */
export interface IMemoryExtractor {
  /**
   * Extract memories from an exchange.
   * Receives current cache so Haiku doesn't duplicate.
   */
  extract(
    exchange: Exchange,
    currentCache: string[],
    userId: string,
    ctx: TraceContext
  ): Promise<Result<ExtractionResult | null, StoreError>>
}

/**
 * Memory Cache Deduplicator - Uses Haiku to consolidate/merge entries
 */
export interface IMemoryCacheDeduplicator {
  /** Consolidate and deduplicate cache entries */
  deduplicate(entries: string[], ctx: TraceContext): Promise<Result<string[], StoreError>>

  /** Merge current L1 cache with L2 memories from related conversations */
  merge(currentL1: string[], l2Memories: string[], cacheLimit: number, ctx: TraceContext): Promise<Result<string[], StoreError>>
}

/**
 * Topic Generator - Uses Haiku to generate topic phrases and summaries
 */
export interface ITopicGenerator {
  /** Generate search phrases from recent exchanges */
  generateSearchPhrases(exchanges: Exchange[], currentCache: string[], ctx: TraceContext): Promise<Result<string[], StoreError>>

  /** Generate topic summary for conversation (for L4 storage) */
  generateSummary(exchanges: Exchange[], memories: string[], ctx: TraceContext): Promise<Result<string, StoreError>>
}

/**
 * Bootstrap Orchestrator - Coordinates the full bootstrap flow
 */
export interface IBootstrapOrchestrator {
  /**
   * Process an exchange (called after each response, fire-and-forget)
   * - Extracts memories via Haiku
   * - Adds to L1 cache
   * - Stores to L3 (Neo4j)
   * - During bootstrap window: searches L4, merges L2 memories
   */
  processExchange(
    exchange: Exchange,
    conversationId: string,
    userId: string,
    ctx: TraceContext
  ): Promise<void>

  /**
   * Finalize a conversation (on end or TTL)
   * - Persists L1 → L2
   * - Generates topic summary
   * - Stores topic embedding in L4
   */
  finalize(conversationId: string, userId: string, ctx: TraceContext): Promise<void>

  /** Get current L1 cache entries for a conversation (for LLM context) */
  getMemoryCache(conversationId: string): Promise<string[]>

  /** Clear memory cache for a conversation (for testing) */
  clearMemoryCache(conversationId: string, levels: ('L1' | 'L2' | 'L4')[]): Promise<void>
}
