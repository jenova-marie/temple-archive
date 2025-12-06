/**
 * Mock agent provider for testing
 */

import type {
  IAgentProvider,
  AgentInput,
  AgentResponse,
  AgentError,
  StreamChunk,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

export interface MockAgentProviderConfig {
  /** Simulated delay in ms */
  delayMs?: number
  /** Default response to return */
  defaultResponse?: string
}

export class MockAgentProvider implements IAgentProvider {
  private config: MockAgentProviderConfig
  private mockResponses: Map<string, string> = new Map()

  constructor(config: MockAgentProviderConfig = {}) {
    this.config = {
      delayMs: 100,
      defaultResponse: 'I hear you, and I\'m here to support you. How are you feeling right now?',
      ...config,
    }
  }

  async generate(
    input: AgentInput,
    ctx: TraceContext
  ): Promise<Result<AgentResponse, AgentError>> {
    return withSpan('MockAgentProvider.generate', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Simulate processing delay
      if (this.config.delayMs) {
        await this.delay(this.config.delayMs)
      }

      // Check for specific mock responses
      let content = this.config.defaultResponse!

      for (const [trigger, response] of this.mockResponses) {
        if (input.userMessage.toLowerCase().includes(trigger.toLowerCase())) {
          content = response
          break
        }
      }

      // Generate context-aware response for common scenarios
      content = this.generateContextualResponse(input, content)

      logger.debug({ contentLength: content.length }, 'Mock response generated')

      return ok({
        content,
        toolCalls: [],
        usage: {
          inputTokens: Math.ceil(input.userMessage.length / 4),
          outputTokens: Math.ceil(content.length / 4),
        },
        model: 'mock-model',
        stopReason: 'end_turn',
      })
    })
  }

  async *stream(
    input: AgentInput,
    ctx: TraceContext
  ): AsyncGenerator<StreamChunk, AgentResponse, unknown> {
    const logger = getLogger().child({ requestId: ctx.requestId })

    // Get the full response
    const result = await this.generate(input, ctx)

    if (!result.ok) {
      yield {
        type: 'error',
        error: result.error.message,
      }
      throw new Error(result.error.message)
    }

    const response = result.value
    const words = response.content.split(' ')

    // Stream word by word
    for (const word of words) {
      yield {
        type: 'text',
        content: word + ' ',
      }

      // Small delay between words
      await this.delay(10)
    }

    yield { type: 'done' }

    logger.debug('Mock stream completed')

    return response
  }

  /**
   * Set a mock response for a specific trigger phrase
   */
  setMockResponse(trigger: string, response: string): void {
    this.mockResponses.set(trigger, response)
  }

  /**
   * Clear all mock responses
   */
  clearMockResponses(): void {
    this.mockResponses.clear()
  }

  private generateContextualResponse(input: AgentInput, defaultResponse: string): string {
    const message = input.userMessage.toLowerCase()

    // Crisis scenarios
    if (message.includes('want to die') || message.includes('suicide')) {
      return `I'm so sorry you're feeling this way. Your life matters, and I'm here for you right now. Please reach out to the 988 Suicide & Crisis Lifeline by calling or texting 988. They have trained counselors available 24/7. You don't have to face this alone.`
    }

    if (message.includes('relapse') || message.includes('using again')) {
      return `Thank you for being honest with me. Relapse can be part of the journey, but it doesn't erase your progress. What matters is what you do next. Can you tell me more about what happened? And have you been able to reach out to your sponsor or support network?`
    }

    // Greeting
    if (message.includes('hello') || message.includes('hi') || message.includes('hey')) {
      return `Hi there! I'm Sky, and I'm here to support you on your recovery journey. How are you doing today?`
    }

    // Mood check
    if (message.includes('feeling') || message.includes('mood')) {
      return `Thank you for sharing that with me. It takes courage to express how you're feeling. Would you like to talk more about what's on your mind, or would you prefer I help you with some coping strategies?`
    }

    // Meeting request
    if (message.includes('meeting') || message.includes('aa') || message.includes('na')) {
      return `Finding meetings is a great step! Let me help you find some nearby. What type of meeting are you looking for - AA, NA, or would you like to see both? And would you prefer in-person or online?`
    }

    return defaultResponse
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
