/**
 * Memory Cache Deduplicator - Uses Haiku to consolidate and merge cache entries
 *
 * Two operations:
 * - deduplicate: Consolidate entries within a single cache
 * - merge: Combine current L1 cache with L2 memories from related conversations
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { TraceContext, Result, StoreError } from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan } from '@siri/observability'
import type { IMemoryCacheDeduplicator, BootstrapConfig } from './types.js'

/**
 * Deduplication prompt
 */
const DEDUP_PROMPT = `Consolidate and deduplicate these memory entries.
Merge related entries, remove redundant info, keep the most recent/relevant details.

ENTRIES:
{entries}

Return ONLY the cleaned list (same format, fewer entries):
- Name:type -> description
- Name:type -> description
...`

/**
 * Bootstrap merge prompt
 */
const MERGE_PROMPT = `You are merging memories for a recovery support conversation.

CURRENT CONVERSATION MEMORIES (from this session):
{currentL1Cache}

RELATED MEMORIES FROM PAST CONVERSATIONS:
{l2Memories}

Merge these into a single clean list:
1. Keep all current conversation memories (they're most relevant)
2. Add past memories that provide useful context
3. Remove duplicates - if same person/topic exists, keep the richer entry
4. Prioritize recent/relevant over old/tangential
5. Limit to {cacheLimit} entries max

Return ONLY the merged list (same format):
- Name:type -> description
- Name:type -> description
...`

/**
 * Haiku-based cache deduplicator
 */
export class MemoryCacheDeduplicator implements IMemoryCacheDeduplicator {
  private readonly model: string
  private readonly defaultLimit: number

  constructor(
    private readonly client: Anthropic | null,
    config: BootstrapConfig
  ) {
    this.model = config.extractionModel === 'sonnet'
      ? 'claude-sonnet-4-20250514'
      : 'claude-3-haiku-20240307'
    this.defaultLimit = config.cacheLimit === 'all' ? 100 :
                        config.cacheLimit === 'none' ? 0 :
                        config.cacheLimit
  }

  async deduplicate(
    entries: string[],
    ctx: TraceContext
  ): Promise<Result<string[], StoreError>> {
    return withSpan('MemoryCacheDeduplicator.deduplicate', async () => {
      const logger = getLogger().child({
        component: 'MemoryCacheDeduplicator',
        requestId: ctx.requestId,
      })

      if (entries.length === 0) {
        return ok([])
      }

      if (!this.client) {
        logger.debug('No Anthropic client, returning entries unchanged')
        return ok(entries)
      }

      try {
        const prompt = DEDUP_PROMPT.replace('{entries}', entries.join('\n'))

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            signal: AbortSignal.timeout(15000),
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          logger.warn('LLM response was not text')
          return ok(entries)
        }

        // Parse the response - each line starting with "- " is an entry
        const deduplicated = this.parseEntries(content.text)

        if (deduplicated.length === 0) {
          logger.warn('Deduplication returned no entries, keeping original')
          return ok(entries)
        }

        logger.info(
          { before: entries.length, after: deduplicated.length },
          'Deduplicated cache entries'
        )

        return ok(deduplicated)
      } catch (error) {
        logger.error({ error }, 'Deduplication failed')
        return err({
          kind: 'UnexpectedError',
          message: 'Deduplication failed',
          context: {},
          cause: error,
        })
      }
    })
  }

  async merge(
    currentL1: string[],
    l2Memories: string[],
    cacheLimit: number,
    ctx: TraceContext
  ): Promise<Result<string[], StoreError>> {
    return withSpan('MemoryCacheDeduplicator.merge', async () => {
      const logger = getLogger().child({
        component: 'MemoryCacheDeduplicator',
        requestId: ctx.requestId,
      })

      // If no L2 memories, just return current L1
      if (l2Memories.length === 0) {
        return ok(currentL1)
      }

      // If no L1, just return L2 (limited)
      if (currentL1.length === 0) {
        const limited = l2Memories.slice(0, cacheLimit || this.defaultLimit)
        return ok(limited)
      }

      if (!this.client) {
        // Without LLM, do simple concatenation and limit
        const combined = [...currentL1, ...l2Memories]
        const limited = combined.slice(0, cacheLimit || this.defaultLimit)
        logger.debug('No Anthropic client, using simple merge')
        return ok(limited)
      }

      try {
        const prompt = MERGE_PROMPT
          .replace('{currentL1Cache}', currentL1.join('\n'))
          .replace('{l2Memories}', l2Memories.join('\n'))
          .replace('{cacheLimit}', String(cacheLimit || this.defaultLimit))

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            signal: AbortSignal.timeout(20000),
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          logger.warn('LLM response was not text')
          return ok(currentL1)
        }

        const merged = this.parseEntries(content.text)

        if (merged.length === 0) {
          logger.warn('Merge returned no entries, keeping current L1')
          return ok(currentL1)
        }

        logger.info(
          { currentL1: currentL1.length, l2: l2Memories.length, merged: merged.length },
          'Merged cache entries'
        )

        return ok(merged)
      } catch (error) {
        logger.error({ error }, 'Merge failed')
        return err({
          kind: 'UnexpectedError',
          message: 'Merge failed',
          context: {},
          cause: error,
        })
      }
    })
  }

  /**
   * Parse entries from LLM response
   * Expects lines starting with "- "
   */
  private parseEntries(text: string): string[] {
    const lines = text.split('\n')
    const entries: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('- ') && trimmed.includes(':') && trimmed.includes('->')) {
        entries.push(trimmed)
      }
    }

    return entries
  }
}

/**
 * Stub implementation for testing
 */
export class StubMemoryCacheDeduplicator implements IMemoryCacheDeduplicator {
  async deduplicate(entries: string[], _ctx: TraceContext): Promise<Result<string[], StoreError>> {
    // Simple dedup by removing exact duplicates
    return ok([...new Set(entries)])
  }

  async merge(
    currentL1: string[],
    l2Memories: string[],
    cacheLimit: number,
    _ctx: TraceContext
  ): Promise<Result<string[], StoreError>> {
    const combined = [...currentL1, ...l2Memories]
    const limited = combined.slice(0, cacheLimit)
    return ok(limited)
  }
}
