/**
 * Topic Generator - Uses Haiku to generate search phrases and summaries
 *
 * Two operations:
 * - generateSearchPhrases: Create phrases to search L4 for related conversations
 * - generateSummary: Create topic summary for storing conversation in L4
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { TraceContext, Result, StoreError } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'
import type { ITopicGenerator, Exchange, BootstrapConfig } from './types.js'

/**
 * Search phrases prompt
 */
const SEARCH_PHRASES_PROMPT = `You are generating search phrases to find related past conversations for a recovery support agent.

RECENT EXCHANGES:
{exchanges}

CURRENT MEMORIES:
{memories}

Generate 3-5 short search phrases that would help find conversations about similar topics.
Focus on:
- Key people mentioned (sponsors, family, therapists)
- Recovery-related topics (triggers, coping strategies, milestones)
- Emotional themes
- Places or events

Return ONLY the phrases, one per line:
phrase 1
phrase 2
phrase 3
...`

/**
 * Topic summary prompt
 */
const SUMMARY_PROMPT = `Summarize this conversation for a recovery support agent's memory system.

EXCHANGES:
{exchanges}

MEMORIES FROM THIS CONVERSATION:
{memories}

Write a 1-2 sentence summary capturing the main topics and themes.
Focus on recovery-relevant content: triggers, coping strategies, support people, milestones, emotions.

Return ONLY the summary text, no quotes or formatting.`

/**
 * Haiku-based topic generator
 */
export class TopicGenerator implements ITopicGenerator {
  private readonly model: string

  constructor(
    private readonly client: Anthropic | null,
    config: BootstrapConfig
  ) {
    this.model = config.extractionModel === 'sonnet'
      ? 'claude-sonnet-4-20250514'
      : 'claude-3-haiku-20240307'
  }

  async generateSearchPhrases(
    exchanges: Exchange[],
    currentCache: string[],
    ctx: TraceContext
  ): Promise<Result<string[], StoreError>> {
    return withSpan('TopicGenerator.generateSearchPhrases', async () => {
      const logger = getLogger().child({
        component: 'TopicGenerator',
        requestId: ctx.requestId,
      })

      if (exchanges.length === 0) {
        return ok([])
      }

      if (!this.client) {
        // Without LLM, extract simple keywords from cache entries
        const phrases = this.extractKeywordsFromCache(currentCache)
        logger.debug({ phrases }, 'Generated fallback search phrases from cache')
        return ok(phrases)
      }

      try {
        const exchangesText = exchanges
          .map(e => `User: ${e.userMessage}\nAssistant: ${e.assistantResponse}`)
          .join('\n\n')

        const prompt = SEARCH_PHRASES_PROMPT
          .replace('{exchanges}', exchangesText)
          .replace('{memories}', currentCache.length > 0 ? currentCache.join('\n') : '(none)')

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            signal: AbortSignal.timeout(10000),
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          logger.warn('LLM response was not text')
          return ok([])
        }

        // Parse phrases - one per line
        const phrases = content.text
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && line.length < 100)
          .slice(0, 5)

        logger.info({ count: phrases.length }, 'Generated search phrases')
        return ok(phrases)
      } catch (error) {
        logger.error({ error }, 'Search phrase generation failed')
        return err({
          kind: 'UnexpectedError',
          message: 'Search phrase generation failed',
          context: {},
          cause: error,
        })
      }
    })
  }

  async generateSummary(
    exchanges: Exchange[],
    memories: string[],
    ctx: TraceContext
  ): Promise<Result<string, StoreError>> {
    return withSpan('TopicGenerator.generateSummary', async () => {
      const logger = getLogger().child({
        component: 'TopicGenerator',
        requestId: ctx.requestId,
      })

      if (exchanges.length === 0 && memories.length === 0) {
        return ok('')
      }

      if (!this.client) {
        // Without LLM, create simple summary from memories
        const summary = this.createFallbackSummary(memories)
        logger.debug('Generated fallback summary')
        return ok(summary)
      }

      try {
        const exchangesText = exchanges
          .slice(-5) // Last 5 exchanges
          .map(e => `User: ${e.userMessage}\nAssistant: ${e.assistantResponse}`)
          .join('\n\n')

        const prompt = SUMMARY_PROMPT
          .replace('{exchanges}', exchangesText || '(no exchanges)')
          .replace('{memories}', memories.length > 0 ? memories.join('\n') : '(none)')

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            signal: AbortSignal.timeout(10000),
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          logger.warn('LLM response was not text')
          return ok('')
        }

        const summary = content.text.trim()
        logger.info({ length: summary.length }, 'Generated conversation summary')
        return ok(summary)
      } catch (error) {
        logger.error({ error }, 'Summary generation failed')
        return err({
          kind: 'UnexpectedError',
          message: 'Summary generation failed',
          context: {},
          cause: error,
        })
      }
    })
  }

  /**
   * Extract keywords from cache entries as fallback search phrases
   */
  private extractKeywordsFromCache(cache: string[]): string[] {
    const phrases: string[] = []

    for (const entry of cache) {
      // Parse "- Name:type -> description"
      const match = entry.match(/^-\s*([^:]+):(\w+)\s*->/)
      if (match) {
        const name = match[1].trim()
        const type = match[2].trim()

        // Create search phrase from name and type
        if (name.length > 2) {
          phrases.push(name)
        }
        if (type === 'trigger' || type === 'coping_strategy') {
          phrases.push(`${type.replace('_', ' ')} ${name}`)
        }
      }
    }

    // Deduplicate and limit
    return [...new Set(phrases)].slice(0, 5)
  }

  /**
   * Create fallback summary from memories
   */
  private createFallbackSummary(memories: string[]): string {
    if (memories.length === 0) {
      return 'Recovery support conversation'
    }

    // Extract names and types
    const items: string[] = []
    for (const entry of memories.slice(0, 5)) {
      const match = entry.match(/^-\s*([^:]+):(\w+)/)
      if (match) {
        items.push(match[1].trim())
      }
    }

    if (items.length === 0) {
      return 'Recovery support conversation'
    }

    return `Discussed: ${items.join(', ')}`
  }
}

/**
 * Stub implementation for testing
 */
export class StubTopicGenerator implements ITopicGenerator {
  async generateSearchPhrases(
    _exchanges: Exchange[],
    currentCache: string[],
    _ctx: TraceContext
  ): Promise<Result<string[], StoreError>> {
    // Return names from cache as search phrases
    const phrases = currentCache
      .map(entry => {
        const match = entry.match(/^-\s*([^:]+):/)
        return match ? match[1].trim() : null
      })
      .filter((p): p is string => p !== null)
      .slice(0, 3)
    return ok(phrases)
  }

  async generateSummary(
    _exchanges: Exchange[],
    memories: string[],
    _ctx: TraceContext
  ): Promise<Result<string, StoreError>> {
    return ok(memories.length > 0 ? `Conversation with ${memories.length} memories` : '')
  }
}
