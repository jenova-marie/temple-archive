/**
 * Memory Extractor - Uses Haiku to extract memories from exchanges
 *
 * Extracts both:
 * - Pre-formatted strings for L1 cache (ready for LLM)
 * - Structured Memory objects for L3 storage (Neo4j)
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Memory, TraceContext, Result, StoreError } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'
import { nanoid } from 'nanoid'
import type { IMemoryExtractor, Exchange, ExtractionResult, BootstrapConfig } from './types.js'

/**
 * Memory types that can be extracted
 */
const MEMORY_TYPES = [
  'person',
  'place',
  'event',
  'trigger',
  'emotion',
  'coping_strategy',
  'medication',
  'milestone',
] as const

type MemorySubtype = typeof MEMORY_TYPES[number]

/**
 * Map subtypes to MCP memory types
 */
const SUBTYPE_TO_MEMORYTYPE: Record<MemorySubtype, string> = {
  person: 'knowledge',
  place: 'knowledge',
  medication: 'knowledge',
  event: 'issue',
  trigger: 'pattern',
  emotion: 'issue',
  coping_strategy: 'pattern',
  milestone: 'decision',
}

/**
 * Extraction prompt for Haiku
 */
const EXTRACTION_PROMPT = `You are extracting memories from a conversation for a recovery support agent.

CURRENT MEMORIES (already remembered - do not duplicate):
{currentCache}

EXCHANGE:
User: {userMessage}
Assistant: {assistantResponse}

Extract any NEW facts worth remembering. For each memory:
1. Format as: "- Name:type -> description"
2. Types: person, place, event, trigger, emotion, coping_strategy, medication, milestone
3. Only extract if NOT already in current memories
4. Be concise but include key context

Return JSON:
{
  "cacheEntries": ["- Mike:person -> User's sponsor, very supportive"],
  "memories": [
    {
      "name": "Mike",
      "type": "person",
      "observation": "User's sponsor, described as very supportive"
    }
  ]
}

If nothing new to remember, return null.`

/**
 * Haiku-based memory extractor
 */
export class MemoryExtractor implements IMemoryExtractor {
  private readonly model: string

  constructor(
    private readonly client: Anthropic | null,
    config: BootstrapConfig
  ) {
    this.model = config.extractionModel === 'sonnet'
      ? 'claude-sonnet-4-20250514'
      : 'claude-3-haiku-20240307'
  }

  async extract(
    exchange: Exchange,
    currentCache: string[],
    userId: string,
    ctx: TraceContext
  ): Promise<Result<ExtractionResult | null, StoreError>> {
    return withSpan('MemoryExtractor.extract', async () => {
      const logger = getLogger().child({
        component: 'MemoryExtractor',
        requestId: ctx.requestId,
      })

      if (!this.client) {
        logger.debug('No Anthropic client, skipping extraction')
        return ok(null)
      }

      try {
        const prompt = EXTRACTION_PROMPT
          .replace('{currentCache}', currentCache.length > 0 ? currentCache.join('\n') : '(none)')
          .replace('{userMessage}', exchange.userMessage)
          .replace('{assistantResponse}', exchange.assistantResponse)

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            signal: AbortSignal.timeout(15000), // 15 second timeout
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          logger.warn('LLM response was not text')
          return ok(null)
        }

        // Check for null response (nothing to remember)
        const trimmed = content.text.trim().toLowerCase()
        if (trimmed === 'null' || trimmed === '{}') {
          logger.debug('No new memories to extract')
          return ok(null)
        }

        // Parse JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          logger.warn({ response: content.text.slice(0, 200) }, 'Failed to parse JSON from response')
          return ok(null)
        }

        const parsed = JSON.parse(jsonMatch[0]) as {
          cacheEntries?: string[]
          memories?: Array<{
            name: string
            type: string
            observation: string
          }>
        }

        // Validate response
        if (!parsed.cacheEntries || parsed.cacheEntries.length === 0) {
          logger.debug('No cache entries in response')
          return ok(null)
        }

        // Build Memory objects for L3 storage
        // CreateMemoryInput expects observations as string[]
        const memories: Memory[] = (parsed.memories ?? [])
          .filter(m => MEMORY_TYPES.includes(m.type as MemorySubtype))
          .map(m => {
            const now = Date.now()
            return {
              id: nanoid(),
              name: m.name,
              memoryType: SUBTYPE_TO_MEMORYTYPE[m.type as MemorySubtype] as Memory['memoryType'],
              metadata: {
                domain: 'recovery' as const,
                subtype: m.type as MemorySubtype,
                userId,
              },
              observations: [{
                id: nanoid(),
                content: m.observation,
                createdAt: now,
              }],
              createdAt: now,
              modifiedAt: now,
              lastAccessed: now,
            }
          })

        const result: ExtractionResult = {
          cacheEntries: parsed.cacheEntries,
          memories,
        }

        logger.info(
          { cacheEntries: result.cacheEntries.length, memories: result.memories.length },
          'Extracted memories from exchange'
        )

        return ok(result)
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.warn({ error }, 'Failed to parse LLM response JSON')
          return ok(null)
        }

        logger.error({ error }, 'Memory extraction failed')
        return err({
          kind: 'UnexpectedError',
          message: 'Memory extraction failed',
          context: {},
          cause: error,
        })
      }
    })
  }
}

/**
 * Stub implementation for testing
 */
export class StubMemoryExtractor implements IMemoryExtractor {
  async extract(
    _exchange: Exchange,
    _currentCache: string[],
    _userId: string,
    _ctx: TraceContext
  ): Promise<Result<ExtractionResult | null, StoreError>> {
    return ok(null)
  }
}
