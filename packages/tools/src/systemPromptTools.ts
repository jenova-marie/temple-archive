/**
 * System Prompt Tools for the RecoverySky Agent
 *
 * Provides system-level tools:
 * - refreshSystemPrompt: Refresh base identity from database
 * - clearConversation: Clear all memory for the current conversation
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@pippa/observability'

/**
 * Callback type for refreshing the base identity
 * Returns the new content if successful, null if not found
 */
type RefreshBaseIdentityFn = () => Promise<{ content: string; id: string; name: string } | null>

/**
 * Callback type for clearing conversation memory
 * Returns true if successful
 */
type ClearConversationFn = (conversationId: string) => Promise<boolean>

/**
 * Function to get the current conversation ID from trace context
 */
type GetConversationIdFn = () => string | null

/**
 * Provider for the refresh function
 * Must be set before tool is used
 */
let refreshBaseIdentityFn: RefreshBaseIdentityFn | null = null

/**
 * Provider for clearing conversation memory
 */
let clearConversationFn: ClearConversationFn | null = null

/**
 * Provider for getting current conversation ID
 */
let getConversationIdFn: GetConversationIdFn | null = null

/**
 * Set the refresh function for the system prompt tool
 * Called once during container initialization
 */
export function setSystemPromptRefreshFn(fn: RefreshBaseIdentityFn): void {
  refreshBaseIdentityFn = fn
}

/**
 * Set the clear conversation function
 * Called once during container initialization
 */
export function setClearConversationFn(fn: ClearConversationFn): void {
  clearConversationFn = fn
}

/**
 * Set the get conversation ID function
 * Called at the start of each request
 */
export function setGetConversationIdFn(fn: GetConversationIdFn): void {
  getConversationIdFn = fn
}

/**
 * Clear the refresh function (for testing)
 */
export function clearSystemPromptRefreshFn(): void {
  refreshBaseIdentityFn = null
}

/**
 * Clear all system tool functions (for testing)
 */
export function clearSystemToolFunctions(): void {
  refreshBaseIdentityFn = null
  clearConversationFn = null
  getConversationIdFn = null
}

/**
 * Tool: refreshSystemPrompt
 *
 * Allows the agent to refresh its base identity from the database.
 * Use this when the user tells you to update or refresh your system prompt.
 */
export const refreshSystemPrompt = tool({
  description: 'Refresh your system prompt/base identity from the database. Use this when asked to update your personality or instructions. Note: The updated prompt will take effect on the NEXT message, not the current one.',
  inputSchema: z.object({
    reason: z.string().optional().describe('Optional reason for refreshing the prompt'),
  }),
  execute: async ({ reason }) => {
    return withSpan('tool.refreshSystemPrompt', async () => {
      const logger = getLogger().child({ tool: 'refreshSystemPrompt', reason })

      if (!refreshBaseIdentityFn) {
        logger.warn('System prompt refresh not configured')
        return {
          success: false,
          message: 'System prompt refresh is not configured. Please contact an administrator.',
        }
      }

      try {
        logger.info('Refreshing system prompt from database')
        const result = await refreshBaseIdentityFn()

        if (result) {
          logger.info({ promptId: result.id, promptName: result.name }, 'System prompt refreshed successfully')
          return {
            success: true,
            message: `System prompt refreshed successfully. The updated "${result.name}" prompt will take effect on your next message.`,
            promptId: result.id,
            promptName: result.name,
          }
        } else {
          logger.warn('No active base-identity prompt found in database')
          return {
            success: false,
            message: 'No active base-identity prompt found in the database. Using default prompt.',
          }
        }
      } catch (error) {
        logger.error({ error }, 'Failed to refresh system prompt')
        return {
          success: false,
          message: 'Failed to refresh system prompt due to a database error. Please try again later.',
        }
      }
    })
  },
})

/**
 * Tool: clearConversation
 *
 * Clears all memory for the current conversation across all tiers.
 * Use this when the user wants to start fresh or forget previous context.
 */
export const clearConversation = tool({
  description: 'Clear all memory for the current conversation. Use this when the user asks to start fresh, forget everything, or clear the conversation history. This will remove cached messages and context from all memory tiers.',
  inputSchema: z.object({
    reason: z.string().optional().describe('Optional reason for clearing the conversation'),
    confirmClear: z.boolean().default(true).describe('Confirm you want to clear the conversation'),
  }),
  execute: async ({ reason, confirmClear }) => {
    return withSpan('tool.clearConversation', async () => {
      const logger = getLogger().child({ tool: 'clearConversation', reason })

      if (!confirmClear) {
        return {
          success: false,
          message: 'Clear cancelled - confirmClear was false.',
        }
      }

      if (!clearConversationFn) {
        logger.warn('Clear conversation function not configured')
        return {
          success: false,
          message: 'Clear conversation is not configured. Please contact an administrator.',
        }
      }

      if (!getConversationIdFn) {
        logger.warn('Get conversation ID function not configured')
        return {
          success: false,
          message: 'Cannot determine current conversation. Please contact an administrator.',
        }
      }

      const conversationId = getConversationIdFn()
      if (!conversationId) {
        logger.warn('No conversation ID available')
        return {
          success: false,
          message: 'No active conversation found to clear.',
        }
      }

      try {
        logger.info({ conversationId, reason }, 'Clearing conversation memory')
        const success = await clearConversationFn(conversationId)

        if (success) {
          logger.info({ conversationId }, 'Conversation memory cleared successfully')
          return {
            success: true,
            conversationId,
            message: `Conversation cleared successfully. I've forgotten our previous messages and context. We're starting fresh!`,
          }
        } else {
          return {
            success: false,
            message: 'Failed to clear conversation memory. Please try again.',
          }
        }
      } catch (error) {
        logger.error({ error }, 'Failed to clear conversation')
        return {
          success: false,
          message: 'An error occurred while clearing the conversation. Please try again later.',
        }
      }
    })
  },
})

/**
 * All system tools
 */
export const systemPromptTools = {
  refreshSystemPrompt,
  clearConversation,
}
