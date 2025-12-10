/**
 * Chat API Routes - Vercel AI SDK UI Message Stream Format
 *
 * Uses pipeUIMessageStreamToResponse() for assistant-ui compatibility
 */

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { PipelineInput, TraceContext } from '@recoverysky/types'
import type { Pipeline } from '@recoverysky/pipeline'
import { getLogger } from '@recoverysky/observability'

/**
 * Chat request body schema - matches existing recoverysky-api format
 * Note: 'id' is optional (unlike our previous implementation)
 */
const chatBodySchema = z.object({
  messages: z.array(z.object({
    id: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
    content: z.string().optional(),
  }).passthrough()).min(1),
}).passthrough()

/**
 * Extract text content from the last user message
 */
function extractLastUserMessage(messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      // Extract text from parts array (v5 format)
      if (msg.parts && Array.isArray(msg.parts)) {
        const textParts = msg.parts
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
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
   * POST /api/v1/chat
   *
   * Streaming chat endpoint compatible with assistant-ui.
   * Uses Vercel AI SDK's pipeUIMessageStreamToResponse() for native streaming.
   *
   * Request Body:
   *   - messages: Array of { role, parts/content }
   *
   * Response:
   *   - UI Message Stream (native assistant-ui format)
   */
  router.post('/', async (req: Request, res: Response) => {
    const logger = getLogger().child({ route: 'POST /api/v1/chat' })
    const startTime = Date.now()

    try {
      // Auth middleware ensures req.user is present
      const userId = req.user!.id
      const requestId = req.headers['x-request-id'] as string || generateId()

      // Validate request body
      const parseResult = chatBodySchema.safeParse(req.body)
      if (!parseResult.success) {
        logger.debug({ validationErrors: parseResult.error.issues }, 'Request validation failed')
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid request body',
          details: parseResult.error.issues,
        })
        return
      }

      const { messages: rawMessages } = parseResult.data

      // Validate messages array
      if (!rawMessages || rawMessages.length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'messages is required and must be a non-empty array',
        })
        return
      }

      // Extract the last user message for pipeline processing
      const lastUserMessage = extractLastUserMessage(rawMessages)
      if (!lastUserMessage) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'No user message found in messages array',
        })
        return
      }

      // Convert to model messages format for Vercel AI SDK
      const messages = convertToModelMessages(rawMessages as UIMessage[])

      // Use request ID as conversation ID (or could use a separate field)
      const conversationId = requestId

      // Create trace context
      const traceContext: TraceContext = {
        traceId: req.headers['x-trace-id'] as string || generateId(),
        spanId: generateId(),
        requestId,
        userId,
        sessionId: conversationId,
        startTime,
      }

      // Create pipeline input
      const input: PipelineInput = {
        message: lastUserMessage,
        conversationId,
        userId,
      }

      logger.info(
        { conversationId, userId, messageLength: lastUserMessage.length, messageCount: messages.length },
        'Processing chat message'
      )

      // STAGE 1: Pre-flight checks (crisis, memory, system prompt)
      const preflightResult = await pipeline.preflight(input, traceContext)
      if (!preflightResult.ok) {
        logger.error({ error: preflightResult.error }, 'Preflight checks failed')
        res.status(500).json({
          error: 'Processing Error',
          message: preflightResult.error.message,
          kind: preflightResult.error.kind,
        })
        return
      }

      const { systemPrompt, crisisCheck } = preflightResult.value

      // Handle emergency crisis - need to respond immediately
      if (crisisCheck.triggerEmergency) {
        logger.warn({ crisisLevel: crisisCheck.level }, 'Emergency crisis detected')

        // Get emergency response from crisis handler
        const emergencyResult = await pipeline.getDeps().crisisHandler.handle(
          crisisCheck,
          userId,
          conversationId,
          traceContext
        )

        if (emergencyResult.ok && emergencyResult.value.prependMessage) {
          // Stream emergency response using Vercel AI SDK
          const emergencyStream = streamText({
            model: anthropic('claude-sonnet-4-20250514'),
            system: 'You are Sky, a compassionate recovery companion. Respond with care and provide crisis resources.',
            messages: [{ role: 'user', content: lastUserMessage }],
            maxOutputTokens: 500,
          })

          emergencyStream.pipeUIMessageStreamToResponse(res)

          // Post-process the emergency response
          emergencyStream.text.then(async (text) => {
            await pipeline.postProcess(input, text, preflightResult.value, traceContext)
          }).catch(err => {
            logger.error({ err }, 'Emergency post-process failed')
          })

          return
        }
      }

      // STAGE 2: Stream response using Vercel AI SDK
      // Get tools from pipeline
      const deps = pipeline.getDeps()
      const tools = deps.memoryToolAccess !== 'off'
        ? {} // TODO: Convert pipeline tools to Vercel AI SDK format if needed
        : {}

      const result = streamText({
        model: anthropic('claude-sonnet-4-20250514'),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(5),
        maxOutputTokens: 4096,
        onStepFinish: ({ toolCalls, finishReason }) => {
          logger.debug(
            { toolCalls: toolCalls?.map((t: { toolName?: string }) => t.toolName), finishReason },
            'Agent step finished'
          )
        },
      })

      // Use native UI Message Stream - this is what assistant-ui expects
      result.pipeUIMessageStreamToResponse(res)

      // STAGE 3: Post-process after stream completes (async, don't await)
      result.text.then(async (responseText) => {
        const duration = Date.now() - startTime
        logger.info({ requestId, duration }, 'Stream completed, starting post-process')

        await pipeline.postProcess(input, responseText, preflightResult.value, traceContext)

        logger.info({ requestId, totalDuration: Date.now() - startTime }, 'Request fully completed')
      }).catch(err => {
        logger.error({ err }, 'Post-process failed')
      })

    } catch (error) {
      logger.error({ error }, 'Unexpected error in chat endpoint')

      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
        })
      }
    }
  })

  /**
   * GET /api/v1/chat/health
   *
   * Health check for chat service
   */
  router.get('/health', async (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    })
  })

  return router
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
