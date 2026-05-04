/**
 * Mem0 Tools for the Siri Agent
 *
 * These tools allow the agent to interact with the Mem0 memory system:
 * - searchMemories: Semantic search for relevant facts
 * - listMemories: List all stored memories
 * - rememberThis: Save a new fact/observation
 * - forgetThis: Delete a specific memory
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@siri/observability'
import type { IMem0Store, TraceContext } from '@siri/types'

// ============================================================================
// Dependency Injection
// ============================================================================

let mem0StoreInstance: IMem0Store | null = null
let currentTraceContext: TraceContext | null = null

/**
 * Set the Mem0 store instance for memory tools
 * Called once during container initialization
 */
export function setMem0ToolStore(store: IMem0Store): void {
  mem0StoreInstance = store
}

/**
 * Set the current trace context for memory tools
 * Must be called at the start of each request/pipeline run
 */
export function setMem0ToolTraceContext(ctx: TraceContext): void {
  currentTraceContext = ctx
}

/**
 * Clear the current trace context
 * Should be called after each request completes
 */
export function clearMem0ToolTraceContext(): void {
  currentTraceContext = null
}

function getMem0Store(): IMem0Store {
  if (!mem0StoreInstance) {
    throw new Error('Mem0 tools not initialized - call setMem0ToolStore first')
  }
  return mem0StoreInstance
}

function getTraceContext(): TraceContext {
  if (!currentTraceContext) {
    throw new Error('TraceContext not set - call setMem0ToolTraceContext before using Mem0 tools')
  }
  return currentTraceContext
}

function getUserId(): string {
  const ctx = getTraceContext()
  return ctx.userId ?? 'unknown'
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Semantic search for relevant memories
 */
export const searchMemories = tool({
  description: `Search your memory for information about this user. Use when you need to recall:
- Facts they've shared about themselves
- Preferences and interests
- Important people, places, or events
- Past conversations and context`,
  inputSchema: z.object({
    query: z.string().describe('What to search for'),
    limit: z.number().min(1).max(20).optional().describe('Max results to return (default 5)'),
  }),
  execute: async ({ query, limit }) => {
    return withSpan('tool.searchMemories', async () => {
      const logger = getLogger().child({ tool: 'searchMemories' })
      const resolvedLimit = limit ?? 5
      logger.info({ query, limit: resolvedLimit }, 'Searching memories')

      try {
        const store = getMem0Store()
        const ctx = getTraceContext()
        const userId = getUserId()

        const result = await store.searchMemory(query, { userId, limit: resolvedLimit }, ctx)

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Memory search failed')
          return {
            success: false,
            memories: [],
            message: 'Unable to search memories right now.',
          }
        }

        const memories = result.value.map((m) => ({
          id: m.id,
          memory: m.memory,
          score: m.score,
          createdAt: m.createdAt,
        }))

        logger.info({ count: memories.length }, 'Memories found')

        return {
          success: true,
          memories,
          count: memories.length,
          message:
            memories.length > 0
              ? `Found ${memories.length} relevant memories.`
              : `No memories found for "${query}".`,
        }
      } catch (error) {
        logger.error({ error }, 'Memory search failed')
        return {
          success: false,
          memories: [],
          message: 'Memory search encountered an error.',
        }
      }
    })
  },
})

/**
 * List all stored memories for the user
 */
export const listMemories = tool({
  description: `List all memories stored about this user. Use when:
- You want to see everything you remember
- The user asks "what do you know about me?"
- You need a complete picture, not just search results`,
  inputSchema: z.object({
    limit: z.number().min(1).max(50).optional().describe('Max memories to return (default 20)'),
  }),
  execute: async ({ limit }) => {
    return withSpan('tool.listMemories', async () => {
      const logger = getLogger().child({ tool: 'listMemories' })
      const resolvedLimit = limit ?? 20
      logger.info({ limit: resolvedLimit }, 'Listing memories')

      try {
        const store = getMem0Store()
        const ctx = getTraceContext()
        const userId = getUserId()

        const result = await store.getMemories(userId, undefined, ctx)

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Failed to list memories')
          return {
            success: false,
            memories: [],
            message: 'Unable to list memories right now.',
          }
        }

        // Apply limit
        const memories = result.value.slice(0, resolvedLimit).map((m) => ({
          id: m.id,
          memory: m.memory,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        }))

        logger.info({ count: memories.length, total: result.value.length }, 'Memories listed')

        return {
          success: true,
          memories,
          count: memories.length,
          total: result.value.length,
          message:
            memories.length > 0
              ? `You have ${result.value.length} memories stored${memories.length < result.value.length ? ` (showing first ${memories.length})` : ''}.`
              : 'No memories stored yet.',
        }
      } catch (error) {
        logger.error({ error }, 'List memories failed')
        return {
          success: false,
          memories: [],
          message: 'Failed to list memories.',
        }
      }
    })
  },
})

/**
 * Explicitly save a fact or observation
 */
export const rememberThis = tool({
  description: `Save something important to remember about this user. Use when:
- They share a significant fact about themselves
- You learn something you should remember for future conversations
- They explicitly ask you to remember something`,
  inputSchema: z.object({
    fact: z.string().describe('The fact to remember (be concise and specific)'),
  }),
  execute: async ({ fact }) => {
    return withSpan('tool.rememberThis', async () => {
      const logger = getLogger().child({ tool: 'rememberThis' })
      logger.info({ factLength: fact.length }, 'Saving memory')

      try {
        const store = getMem0Store()
        const ctx = getTraceContext()
        const userId = getUserId()

        // Add as a user message - Mem0 will extract and deduplicate
        const result = await store.addMemory(
          [{ role: 'user', content: fact }],
          { userId },
          ctx
        )

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Failed to save memory')
          return {
            success: false,
            message: 'Unable to save memory right now.',
          }
        }

        logger.info({ memoryCount: result.value.memoryIds.length }, 'Memory saved')

        return {
          success: true,
          memoryIds: result.value.memoryIds,
          message:
            result.value.memoryIds.length > 0
              ? `Remembered: "${fact.slice(0, 50)}${fact.length > 50 ? '...' : ''}"`
              : 'Noted (may have been deduplicated with existing memories).',
        }
      } catch (error) {
        logger.error({ error }, 'Save memory failed')
        return {
          success: false,
          message: 'Failed to save memory.',
        }
      }
    })
  },
})

/**
 * Delete a specific memory
 */
export const forgetThis = tool({
  description: `Forget/delete a specific memory. Use when:
- The user explicitly asks you to forget something
- Information is outdated or incorrect
- The user wants to remove something personal

Note: You'll need the memory ID from searchMemories or listMemories first.`,
  inputSchema: z.object({
    memoryId: z.string().describe('The ID of the memory to delete'),
    reason: z.string().describe('Why this memory should be forgotten'),
  }),
  execute: async ({ memoryId, reason }) => {
    return withSpan('tool.forgetThis', async () => {
      const logger = getLogger().child({ tool: 'forgetThis' })
      logger.info({ memoryId, reason }, 'Deleting memory')

      try {
        const store = getMem0Store()
        const ctx = getTraceContext()

        const result = await store.deleteMemory(memoryId, ctx)

        if (!result.ok) {
          logger.warn({ error: result.error, memoryId }, 'Failed to delete memory')
          return {
            success: false,
            message: result.error.kind === 'NotFoundError'
              ? `Memory not found: ${memoryId}`
              : 'Unable to delete memory right now.',
          }
        }

        logger.info({ memoryId, reason }, 'Memory deleted')

        return {
          success: true,
          memoryId,
          message: `Forgotten: memory ${memoryId}`,
        }
      } catch (error) {
        logger.error({ error, memoryId }, 'Delete memory failed')
        return {
          success: false,
          message: 'Failed to delete memory.',
        }
      }
    })
  },
})

// ============================================================================
// Tool Collections
// ============================================================================

export const mem0Tools = {
  searchMemories,
  listMemories,
  rememberThis,
  forgetThis,
}

/**
 * Get Mem0 tools if the store is configured
 */
export function getMem0Tools(): Record<string, unknown> {
  if (!mem0StoreInstance) {
    return {}
  }
  return mem0Tools
}
