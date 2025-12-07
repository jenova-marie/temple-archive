/**
 * Chat API Routes
 */

import { Router, type Request, type Response } from 'express'
import type { PipelineInput, TraceContext } from '@recoverysky/types'
import type { Pipeline } from '@recoverysky/pipeline'
import { getLogger } from '@recoverysky/observability'

export function createChatRouter(pipeline: Pipeline): Router {
  const router = Router()

  /**
   * POST /api/chat
   *
   * Process a chat message through the pipeline
   */
  router.post('/', async (req: Request, res: Response) => {
    const logger = getLogger().child({ route: 'POST /api/chat' })

    try {
      // Validate request body
      const { message, conversationId, userId } = req.body

      if (!message || typeof message !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'message is required and must be a string',
        })
        return
      }

      if (!conversationId || typeof conversationId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'conversationId is required and must be a string',
        })
        return
      }

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userId is required and must be a string',
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

      logger.info({ conversationId, userId }, 'Processing chat message')

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

      // Return response with full diagnostics
      res.json({
        response: result.value.response,
        conversationId,
        messageId: result.value.messages.assistant.id,
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
