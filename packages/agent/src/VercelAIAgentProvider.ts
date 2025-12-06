/**
 * Real agent provider using Vercel AI SDK with Anthropic Claude
 *
 * Implements IAgentProvider interface for production use with Claude
 * via the Vercel AI SDK (@ai-sdk/anthropic).
 */

import { anthropic } from '@ai-sdk/anthropic'
import { generateText, type CoreTool } from 'ai'
import type {
  IAgentProvider,
  AgentInput,
  AgentResponse,
  AgentError,
  ToolDefinition,
} from '@recoverysky/types'
import type { StreamChunk, ToolCall } from '@recoverysky/types'
import type { TraceContext } from '@recoverysky/types'
import { ok, err, type Result } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'

/**
 * Configuration for VercelAIAgentProvider
 */
export interface VercelAIAgentProviderConfig {
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string
  /** Maximum tokens for response (default: 4096) */
  maxTokens?: number
  /** Maximum steps for agentic loop (default: 5) */
  maxSteps?: number
  /** Temperature for generation (default: 0.7) */
  temperature?: number
}

const DEFAULT_CONFIG: Required<VercelAIAgentProviderConfig> = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  maxSteps: 5,
  temperature: 0.7,
}

/**
 * Agent provider implementation using Vercel AI SDK with Anthropic
 */
export class VercelAIAgentProvider implements IAgentProvider {
  private readonly config: Required<VercelAIAgentProviderConfig>

  constructor(config: VercelAIAgentProviderConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Generate a response using Claude via Vercel AI SDK
   */
  async generate(
    input: AgentInput,
    ctx: TraceContext
  ): Promise<Result<AgentResponse, AgentError>> {
    return withSpan('VercelAIAgentProvider.generate', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        model: this.config.model,
        conversationId: ctx.sessionId,
      })

      logger.info(
        {
          messageLength: input.userMessage.length,
          hasTools: !!input.tools?.length,
          toolCount: input.tools?.length ?? 0,
          contextMessageCount: input.context.messages.length,
        },
        'Starting agent generation'
      )

      try {
        // Build messages array from conversation history
        const messages = this.buildMessages(input)

        // Convert our tool definitions to Vercel AI SDK format
        const tools = this.convertTools(input.tools)

        const startTime = Date.now()

        const result = await generateText({
          model: anthropic(this.config.model),
          system: input.systemPrompt,
          messages,
          tools,
          maxSteps: this.config.maxSteps,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        })

        const duration = Date.now() - startTime

        logger.info(
          {
            duration,
            finishReason: result.finishReason,
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
            toolCallCount: result.toolCalls?.length ?? 0,
            stepCount: result.steps?.length ?? 1,
          },
          'Agent generation completed'
        )

        // Record metrics
        pipelineMetrics.tokensUsed.add(result.usage.promptTokens, { direction: 'input' })
        pipelineMetrics.tokensUsed.add(result.usage.completionTokens, { direction: 'output' })

        // Convert tool calls to our format
        const toolCalls = this.convertToolCalls(result.toolCalls ?? [])

        // Map finish reason to our stop reason type
        const stopReason = this.mapFinishReason(result.finishReason)

        return ok({
          content: result.text,
          toolCalls,
          usage: {
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
          },
          model: this.config.model,
          stopReason,
        })
      } catch (error) {
        logger.error({ error }, 'Agent generation failed')

        const agentError = this.mapError(error)
        pipelineMetrics.errors.add(1, { kind: agentError.kind })

        return err(agentError)
      }
    })
  }

  /**
   * Stream a response using the LLM
   *
   * Phase 1: Falls back to generate() and simulates streaming
   * Real streaming will be implemented in Phase 1.5
   */
  async *stream(
    input: AgentInput,
    ctx: TraceContext
  ): AsyncGenerator<StreamChunk, AgentResponse, unknown> {
    const logger = getLogger().child({ requestId: ctx.requestId })
    logger.debug('stream() called - falling back to generate() for Phase 1')

    const result = await this.generate(input, ctx)

    if (!result.ok) {
      yield {
        type: 'error',
        error: result.error.message,
      }
      throw new Error(result.error.message)
    }

    const response = result.value

    // Emit tool calls if any
    for (const toolCall of response.toolCalls) {
      yield {
        type: 'tool_call',
        toolCall: {
          toolId: toolCall.toolId,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      }
      yield {
        type: 'tool_result',
        toolCall: {
          toolId: toolCall.toolId,
          name: toolCall.name,
          result: toolCall.result,
        },
      }
    }

    // Stream the text content word by word (simulated for Phase 1)
    const words = response.content.split(' ')
    for (const word of words) {
      yield {
        type: 'text',
        content: word + ' ',
      }
    }

    yield { type: 'done' }

    return response
  }

  /**
   * Build messages array from AgentInput
   * Includes conversation history from context
   */
  private buildMessages(
    input: AgentInput
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

    // Add conversation history from context
    for (const msg of input.context.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        })
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: input.userMessage,
    })

    return messages
  }

  /**
   * Convert our ToolDefinition[] to Vercel AI SDK tool format
   */
  private convertTools(
    tools?: ToolDefinition[]
  ): Record<string, CoreTool> | undefined {
    if (!tools || tools.length === 0) {
      return undefined
    }

    const converted: Record<string, CoreTool> = {}

    for (const tool of tools) {
      converted[tool.name] = {
        description: tool.description,
        parameters: tool.parameters as CoreTool['parameters'],
        execute: tool.execute as CoreTool['execute'],
      }
    }

    return converted
  }

  /**
   * Convert Vercel AI SDK tool calls to our ToolCall format
   */
  private convertToolCalls(
    sdkToolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>
  ): ToolCall[] {
    return sdkToolCalls.map(tc => ({
      toolId: tc.toolCallId,
      name: tc.toolName,
      arguments: tc.args as Record<string, unknown>,
      // Result would be populated during agentic loop execution
      result: undefined,
    }))
  }

  /**
   * Map Vercel AI SDK finish reason to our stop reason
   */
  private mapFinishReason(
    finishReason: string
  ): AgentResponse['stopReason'] {
    switch (finishReason) {
      case 'stop':
      case 'end_turn':
        return 'end_turn'
      case 'length':
      case 'max_tokens':
        return 'max_tokens'
      case 'tool-calls':
      case 'tool_use':
        return 'tool_use'
      case 'stop_sequence':
        return 'stop_sequence'
      default:
        return 'end_turn'
    }
  }

  /**
   * Map SDK errors to our AgentError type
   */
  private mapError(error: unknown): AgentError {
    const errorObj = error as Error & { status?: number; code?: string }

    // Rate limit errors
    if (
      errorObj.status === 429 ||
      errorObj.message?.includes('rate limit') ||
      errorObj.code === 'rate_limit_exceeded'
    ) {
      return {
        kind: 'RateLimitError',
        message: 'Rate limit exceeded. Please try again in a moment.',
        context: {
          originalError: errorObj.message,
          status: errorObj.status,
        },
        cause: error,
      }
    }

    // Context length errors
    if (
      errorObj.message?.includes('context length') ||
      errorObj.message?.includes('maximum context') ||
      errorObj.message?.includes('too many tokens') ||
      errorObj.message?.includes('token limit')
    ) {
      return {
        kind: 'ContextLengthError',
        message: 'The conversation is too long. Please start a new conversation.',
        context: {
          originalError: errorObj.message,
        },
        cause: error,
      }
    }

    // Timeout errors
    if (
      errorObj.message?.includes('timeout') ||
      errorObj.code === 'ETIMEDOUT' ||
      errorObj.code === 'ECONNABORTED'
    ) {
      return {
        kind: 'TimeoutError',
        message: 'Request timed out. Please try again.',
        context: {
          originalError: errorObj.message,
        },
        cause: error,
      }
    }

    // Tool errors
    if (
      errorObj.message?.includes('tool') ||
      errorObj.message?.includes('function call')
    ) {
      return {
        kind: 'ToolError',
        message: 'Tool execution failed.',
        context: {
          originalError: errorObj.message,
        },
        cause: error,
      }
    }

    // Default to provider error
    return {
      kind: 'ProviderError',
      message: errorObj.message || 'An unexpected error occurred.',
      context: {
        originalError: errorObj.message,
        status: errorObj.status,
        code: errorObj.code,
      },
      cause: error,
    }
  }
}
