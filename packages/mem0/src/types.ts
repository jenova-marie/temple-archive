/**
 * Mem0 Types and Interface
 *
 * Types for the Mem0 memory system (L5).
 * Designed to be portable - can later be moved to @siri/types.
 */

import type { Result, StoreError, TraceContext } from '@siri/types'

// ============================================================================
// Mem0 API Types (matching FastAPI wrapper)
// ============================================================================

/**
 * Message format for adding memories
 */
export interface Mem0Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Options for adding memories
 */
export interface AddMemoryOptions {
  /** User identifier (required) */
  userId: string
  /** Agent identifier (optional) */
  agentId?: string
  /** Run/session identifier (optional) */
  runId?: string
  /** Additional metadata to store */
  metadata?: Record<string, unknown>
  // Note: Mem0 API always infers - no 'infer' option needed
}

/**
 * Single result from adding a memory (raw API response item)
 */
export interface Mem0AddResult {
  /** Memory ID */
  id: string
  /** Memory content */
  memory: string
  /** Event type (ADD, UPDATE, DELETE) */
  event: 'ADD' | 'UPDATE' | 'DELETE'
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Raw response from POST /memories (direct from mem0 library)
 */
export interface Mem0AddRawResponse {
  /** Array of memory results */
  results: Mem0AddResult[]
  /** Optional relations (only if Neo4j configured) */
  relations?: unknown[]
}

/**
 * Normalized response from adding memories (our interface)
 */
export interface AddMemoryResponse {
  /** IDs of created/updated memories */
  memoryIds: string[]
  /** Results with full details */
  results: Mem0AddResult[]
}

/**
 * Options for searching memories
 */
export interface SearchMemoryOptions {
  /** User identifier (required) */
  userId: string
  /** Agent identifier (optional) */
  agentId?: string
  /** Run/session identifier (optional) */
  runId?: string
  /** Filter by metadata fields */
  filters?: Record<string, unknown>
  /** Maximum results to return */
  limit?: number
  /** Minimum similarity score threshold (0-1) */
  threshold?: number
}

/**
 * A memory from Mem0
 */
export interface Mem0Memory {
  /** Unique memory ID */
  id: string
  /** Memory content/text */
  memory: string
  /** Hash of the memory content */
  hash: string
  /** Associated user ID */
  userId: string
  /** Associated agent ID (if any) */
  agentId?: string
  /** Associated run ID (if any) */
  runId?: string
  /** Additional metadata */
  metadata: Record<string, unknown>
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
}

/**
 * Memory with similarity score from search
 */
export interface Mem0SearchResult extends Mem0Memory {
  /** Similarity score (0-1) */
  score: number
}

/**
 * Raw response from GET /memories (wrapped in results)
 */
export interface Mem0GetMemoriesRawResponse {
  results: Mem0Memory[]
}

/**
 * Raw response from GET /memories/search (wrapped in results)
 */
export interface Mem0SearchRawResponse {
  results: Mem0SearchResult[]
}

/**
 * Options for getting memories
 */
export interface GetMemoriesOptions {
  /** Agent identifier (optional) */
  agentId?: string
  /** Run/session identifier (optional) */
  runId?: string
}

// ============================================================================
// IMem0Store Interface
// ============================================================================

/**
 * L5 Mem0 Store interface
 *
 * Provides memory operations via Mem0 API.
 * All methods return Result types for consistent error handling.
 */
export interface IMem0Store {
  /**
   * Add memories from a conversation.
   * Mem0 will extract and deduplicate memories automatically.
   *
   * @param messages - Array of messages to extract memories from
   * @param options - User ID, agent ID, run ID, metadata, infer flag
   * @param ctx - Trace context
   */
  addMemory(
    messages: Mem0Message[],
    options: AddMemoryOptions,
    ctx: TraceContext
  ): Promise<Result<AddMemoryResponse, StoreError>>

  /**
   * Semantic search for relevant memories.
   *
   * @param query - Search query text
   * @param options - User ID, filters, limit, threshold
   * @param ctx - Trace context
   */
  searchMemory(
    query: string,
    options: SearchMemoryOptions,
    ctx: TraceContext
  ): Promise<Result<Mem0SearchResult[], StoreError>>

  /**
   * Update an existing memory.
   *
   * @param id - Memory ID to update
   * @param text - New memory text
   * @param metadata - Optional metadata to merge
   * @param ctx - Trace context
   */
  updateMemory(
    id: string,
    text: string,
    metadata: Record<string, unknown> | undefined,
    ctx: TraceContext
  ): Promise<Result<Mem0Memory, StoreError>>

  /**
   * Delete a memory by ID.
   *
   * @param id - Memory ID to delete
   * @param ctx - Trace context
   */
  deleteMemory(id: string, ctx: TraceContext): Promise<Result<void, StoreError>>

  /**
   * Get all memories for a user.
   *
   * @param userId - User identifier
   * @param options - Optional agent ID and run ID filters
   * @param ctx - Trace context
   */
  getMemories(
    userId: string,
    options: GetMemoriesOptions | undefined,
    ctx: TraceContext
  ): Promise<Result<Mem0Memory[], StoreError>>

  /**
   * Get a single memory by ID.
   *
   * @param id - Memory ID
   * @param ctx - Trace context
   */
  getMemory(id: string, ctx: TraceContext): Promise<Result<Mem0Memory | null, StoreError>>
}

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Configuration for Mem0 HTTP client
 */
export interface Mem0ClientConfig {
  /** Mem0 API base URL (default: MEM0_API_URL env or http://localhost:8000) */
  url?: string
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** API key for authentication (if required) */
  apiKey?: string
}
