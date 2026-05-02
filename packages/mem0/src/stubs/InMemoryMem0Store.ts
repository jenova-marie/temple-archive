/**
 * In-Memory Mem0 Store Stub
 *
 * For testing and development without a real Mem0 service.
 */

import type { Result, StoreError, TraceContext } from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan } from '@siri/observability'
import { nanoid } from 'nanoid'
import type {
  IMem0Store,
  Mem0Message,
  AddMemoryOptions,
  AddMemoryResponse,
  Mem0AddResult,
  SearchMemoryOptions,
  Mem0SearchResult,
  Mem0Memory,
  GetMemoriesOptions,
} from '../types.js'

/**
 * Simple hash function for memory content
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16)
}

/**
 * Simple word-based similarity for testing
 */
function calculateSimilarity(query: string, text: string): number {
  const queryWords = new Set(query.toLowerCase().split(/\s+/))
  const textWords = text.toLowerCase().split(/\s+/)

  let matches = 0
  for (const word of textWords) {
    if (queryWords.has(word)) {
      matches++
    }
  }

  return queryWords.size > 0 ? matches / queryWords.size : 0
}

/**
 * In-memory implementation of IMem0Store for testing
 */
export class InMemoryMem0Store implements IMem0Store {
  private memories: Map<string, Mem0Memory> = new Map()

  async addMemory(
    messages: Mem0Message[],
    options: AddMemoryOptions,
    ctx: TraceContext
  ): Promise<Result<AddMemoryResponse, StoreError>> {
    return withSpan('InMemoryMem0Store.addMemory', async () => {
      const logger = getLogger().child({
        userId: options.userId,
        messageCount: messages.length,
        requestId: ctx.requestId,
      })

      const memoryIds: string[] = []
      const results: Mem0AddResult[] = []

      // Extract memories from user messages (simplified)
      for (const message of messages) {
        if (message.role === 'user' && message.content.length > 0) {
          const id = nanoid()
          const now = new Date().toISOString()

          const memory: Mem0Memory = {
            id,
            memory: message.content,
            hash: simpleHash(message.content),
            userId: options.userId,
            agentId: options.agentId,
            runId: options.runId,
            metadata: options.metadata ?? {},
            createdAt: now,
            updatedAt: now,
          }

          this.memories.set(id, memory)
          memoryIds.push(id)
          results.push({
            id,
            memory: message.content,
            event: 'ADD',
            metadata: options.metadata,
          })
        }
      }

      logger.debug({ memoryCount: memoryIds.length }, 'Memories added (in-memory)')
      return ok({ memoryIds, results })
    })
  }

  async searchMemory(
    query: string,
    options: SearchMemoryOptions,
    ctx: TraceContext
  ): Promise<Result<Mem0SearchResult[], StoreError>> {
    return withSpan('InMemoryMem0Store.searchMemory', async () => {
      const logger = getLogger().child({
        userId: options.userId,
        queryLength: query.length,
        requestId: ctx.requestId,
      })

      const results: Mem0SearchResult[] = []
      const threshold = options.threshold ?? 0.3
      const limit = options.limit ?? 10

      for (const memory of this.memories.values()) {
        // Filter by user
        if (memory.userId !== options.userId) continue
        if (options.agentId && memory.agentId !== options.agentId) continue
        if (options.runId && memory.runId !== options.runId) continue

        const score = calculateSimilarity(query, memory.memory)
        if (score >= threshold) {
          results.push({ ...memory, score })
        }
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score)

      logger.debug({ resultCount: Math.min(results.length, limit) }, 'Search completed (in-memory)')
      return ok(results.slice(0, limit))
    })
  }

  async updateMemory(
    id: string,
    text: string,
    metadata: Record<string, unknown> | undefined,
    ctx: TraceContext
  ): Promise<Result<Mem0Memory, StoreError>> {
    return withSpan('InMemoryMem0Store.updateMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      const existing = this.memories.get(id)
      if (!existing) {
        return err({
          kind: 'NotFoundError',
          message: `Memory not found: ${id}`,
          context: { memoryId: id },
        })
      }

      const updated: Mem0Memory = {
        ...existing,
        memory: text,
        hash: simpleHash(text),
        metadata: { ...existing.metadata, ...metadata },
        updatedAt: new Date().toISOString(),
      }

      this.memories.set(id, updated)
      logger.debug({ memoryId: id }, 'Memory updated (in-memory)')
      return ok(updated)
    })
  }

  async deleteMemory(id: string, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryMem0Store.deleteMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      if (!this.memories.has(id)) {
        return err({
          kind: 'NotFoundError',
          message: `Memory not found: ${id}`,
          context: { memoryId: id },
        })
      }

      this.memories.delete(id)
      logger.debug({ memoryId: id }, 'Memory deleted (in-memory)')
      return ok(undefined)
    })
  }

  async getMemories(
    userId: string,
    options: GetMemoriesOptions | undefined,
    ctx: TraceContext
  ): Promise<Result<Mem0Memory[], StoreError>> {
    return withSpan('InMemoryMem0Store.getMemories', async () => {
      const logger = getLogger().child({
        userId,
        requestId: ctx.requestId,
      })

      const results: Mem0Memory[] = []
      for (const memory of this.memories.values()) {
        if (memory.userId !== userId) continue
        if (options?.agentId && memory.agentId !== options.agentId) continue
        if (options?.runId && memory.runId !== options.runId) continue
        results.push(memory)
      }

      logger.debug({ memoryCount: results.length }, 'Retrieved memories (in-memory)')
      return ok(results)
    })
  }

  async getMemory(id: string, ctx: TraceContext): Promise<Result<Mem0Memory | null, StoreError>> {
    return withSpan('InMemoryMem0Store.getMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      const memory = this.memories.get(id) ?? null
      logger.debug({ memoryId: id, found: !!memory }, 'Retrieved memory (in-memory)')
      return ok(memory)
    })
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.memories.clear()
  }

  /**
   * Get memory count (for monitoring)
   */
  size(): number {
    return this.memories.size
  }
}
