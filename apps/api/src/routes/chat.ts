/**
 * Chat API Routes - Vercel AI SDK Format
 */

import { Router, type Request, type Response } from 'express'
import type { UIMessage } from 'ai'
import type { PipelineInput, TraceContext } from '@recoverysky/types'
import type { Pipeline } from '@recoverysky/pipeline'
import { getLogger } from '@recoverysky/observability'

/**
 * Vercel AI SDK request body format
 */
interface VercelAIChatRequest {
  /** Conversation/thread ID */
  id: string
  /** Array of UI messages */
  messages: UIMessage[]
  /** Action trigger type */
  trigger?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Extract text content from the last user message
 */
function extractLastUserMessage(messages: UIMessage[]): string | null {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      // Extract text from parts array
      if (msg.parts && Array.isArray(msg.parts)) {
        const textParts = msg.parts
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map(part => part.text)
        if (textParts.length > 0) {
          return textParts.join('\n')
        }
      }
      // Fallback to content if parts not available
      if (typeof msg.content === 'string') {
        return msg.content
      }
    }
  }
  return null
}

export function createChatRouter(pipeline: Pipeline): Router {
  const router = Router()

  /**
   * POST /api/chat
   *
   * Process a chat message through the pipeline.
   * Expects Vercel AI SDK format with id, messages[], and optional trigger.
   *
   * When auth is enabled (ZITADEL_ISSUER set), userId is extracted from JWT.
   * When auth is disabled, userId must be provided in metadata.
   */
  router.post('/', async (req: Request, res: Response) => {
    const logger = getLogger().child({ route: 'POST /api/chat' })

    try {
      const body = req.body as VercelAIChatRequest
      const { id: conversationId, messages, metadata } = body

      // Validate conversation ID
      if (!conversationId || typeof conversationId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'id is required and must be a string',
        })
        return
      }

      // Validate messages array
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'messages is required and must be a non-empty array',
        })
        return
      }

      // Extract the last user message text
      const message = extractLastUserMessage(messages)
      if (!message) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'No user message found in messages array',
        })
        return
      }

      // Get userId: prefer JWT user, fall back to metadata
      const userId = req.user?.id || (metadata?.userId as string)

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userId is required (from JWT or metadata.userId)',
        })
        return
      }

      // Create trace context
      const traceContext: TraceContext = {
        traceId: req.headers['x-trace-id'] as string || generateId(),
        spanId: generateId(),
        requestId: req.headers['x-request-id'] as string || generateId(),
        userId,
        sessionId: conversationId,
        startTime: Date.now(),
      }

      // Create pipeline input
      const input: PipelineInput = {
        message,
        conversationId,
        userId,
      }

      logger.info({ conversationId, userId, messageLength: message.length }, 'Processing chat message')

      // Process through pipeline
      const result = await pipeline.process(input, traceContext)

      if (!result.ok) {
        logger.error({ error: result.error }, 'Pipeline processing failed')

        res.status(500).json({
          error: 'Processing Error',
          message: result.error.message,
          kind: result.error.kind,
        })
        return
      }

      // Return response in Vercel AI SDK compatible format
      res.json({
        // Core response - Vercel AI SDK expects 'messages' array or single message
        id: result.value.messages.assistant.id,
        role: 'assistant',
        content: result.value.response,
        // Additional metadata
        conversationId,
        metrics: {
          totalDuration: result.value.metrics.totalDuration,
          memoryDuration: result.value.metrics.memoryDuration,
          agentDuration: result.value.metrics.agentDuration,
          tokensUsed: result.value.metrics.tokensUsed,
          memorySource: result.value.metrics.memorySource,
        },
        crisisLevel: result.value.crisisLevel,
        emergencyTriggered: result.value.emergencyTriggered,
        safetyViolations: result.value.safetyViolations,
        diagnostics: result.value.diagnostics,
      })
    } catch (error) {
      logger.error({ error }, 'Unexpected error in chat endpoint')

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      })
    }
  })

  return router
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
