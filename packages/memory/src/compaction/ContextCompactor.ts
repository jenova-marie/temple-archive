/**
 * Context Compactor - Summarizes older messages to reduce context size
 *
 * Runs fire-and-forget after memory retrieval to compress older messages
 * into summaries, keeping recent context intact while preserving key information.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Redis } from 'ioredis'
import type { Message, TraceContext, Result } from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import { RedisKeys, RedisTTL } from '../redis/keys.js'
import type {
  CompactionConfig,
  CompactionError,
  IContextCompactor,
  SummaryMetadata,
} from './types.js'
import { DEFAULT_COMPACTION_CONFIG } from './types.js'

const SUMMARIZATION_PROMPT = `You are summarizing older messages from a recovery support conversation.
Your goal is to preserve key information while condensing the content.

MESSAGES TO SUMMARIZE:
{messages}

Create a concise summary that preserves:
1. Key facts about the user (names, places, triggers mentioned)
2. Emotional context and progress
3. Important topics discussed
4. Any commitments or plans made

Format your response as a single paragraph, starting with "[Earlier in this conversation]".
Be warm and recovery-focused. Do not exceed 200 words.`

/**
 * Context compactor that summarizes older messages via Haiku
 */
export class ContextCompactor implements IContextCompactor {
  private readonly config: CompactionConfig

  constructor(
    private readonly redis: Redis,
    private readonly client: Anthropic,
    config: Partial<CompactionConfig> = {}
  ) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config }
  }

  /**
   * Fire-and-forget compaction check.
   * If message count exceeds threshold, summarizes oldest messages in background.
   */
  maybeCompact(
    conversationId: string,
    messages: Message[],
    ctx: TraceContext
  ): void {
    if (!this.config.enabled) return
    if (messages.length <= this.config.threshold) return

    // Check if any message is already a summary - avoid re-compacting summaries
    const hasSummary = messages.some((m) => m.metadata?.type === 'summary')
    if (hasSummary) return

    // Fire-and-forget - don't await
    this.runCompaction(conversationId, messages, ctx).catch((error) => {
      const logger = getLogger().child({ conversationId, requestId: ctx.requestId })
      logger.warn({ error }, 'Context compaction failed')
    })
  }

  /**
   * Run the actual compaction process
   */
  private async runCompaction(
    conversationId: string,
    messages: Message[],
    ctx: TraceContext
  ): Promise<Result<void, CompactionError>> {
    return withSpan('ContextCompactor.runCompaction', async () => {
      const logger = getLogger().child({
        conversationId,
        requestId: ctx.requestId,
        component: 'ContextCompactor',
      })
      const startTime = performance.now()

      try {
        // Take the oldest batchSize messages
        const toCompact = messages.slice(0, this.config.batchSize)

        if (toCompact.length < this.config.batchSize) {
          logger.debug({ count: toCompact.length }, 'Not enough messages to compact')
          return ok(undefined)
        }

        // Generate summary via Haiku
        const summaryResult = await this.generateSummary(toCompact, ctx)
        if (!summaryResult.ok) {
          return summaryResult
        }

        // Create summary message
        const firstMessage = toCompact[0]
        const lastMessage = toCompact[toCompact.length - 1]
        const summaryMessage: Message = {
          id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          conversationId,
          userId: firstMessage.userId,
          role: 'assistant',
          content: summaryResult.value,
          timestamp: firstMessage.timestamp, // Use FIRST message's timestamp
          metadata: {
            type: 'summary',
            originalMessageIds: toCompact.map((m) => m.id),
            compactedAt: Date.now(),
            originalCount: toCompact.length,
          } as SummaryMetadata,
        }

        // Atomic Redis update: remove old messages, add summary
        const messagesKey = RedisKeys.sessionMessages(conversationId)
        const stateKey = RedisKeys.sessionState(conversationId)

        const pipeline = this.redis.pipeline()

        // Remove original messages by score (timestamp) range
        pipeline.zremrangebyscore(
          messagesKey,
          firstMessage.timestamp,
          lastMessage.timestamp
        )

        // Add summary message
        pipeline.zadd(messagesKey, summaryMessage.timestamp, JSON.stringify(summaryMessage))

        // Refresh TTL
        pipeline.expire(messagesKey, RedisTTL.SESSION)

        // Update message count: removed batchSize messages, added 1 summary = net -(batchSize-1)
        pipeline.hincrby(stateKey, 'messageCount', -(this.config.batchSize - 1))

        await pipeline.exec()

        const duration = performance.now() - startTime
        pipelineMetrics.stageDuration.record(duration, { stage: 'context_compaction' })

        logger.info(
          {
            compacted: toCompact.length,
            summaryLength: summaryResult.value.length,
            duration: Math.round(duration),
          },
          'Context compaction completed'
        )

        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Context compaction error')
        return err({
          kind: 'RedisError',
          message: 'Failed to update Redis after compaction',
          context: { conversationId },
          cause: error,
        })
      }
    })
  }

  /**
   * Generate summary using Haiku
   */
  private async generateSummary(
    messages: Message[],
    ctx: TraceContext
  ): Promise<Result<string, CompactionError>> {
    const logger = getLogger().child({ requestId: ctx.requestId })

    try {
      // Format messages for the prompt
      const messagesText = messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')

      const prompt = SUMMARIZATION_PROMPT.replace('{messages}', messagesText)

      const response = await this.client.messages.create(
        {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          signal: AbortSignal.timeout(this.config.timeoutMs),
        }
      )

      const content = response.content[0]
      if (content.type !== 'text') {
        return err({
          kind: 'LLMError',
          message: 'LLM response was not text',
          context: { responseType: content.type },
        })
      }

      return ok(content.text.trim())
    } catch (error) {
      logger.error({ error }, 'Summary generation failed')
      return err({
        kind: 'LLMError',
        message: 'Failed to generate summary',
        context: {},
        cause: error,
      })
    }
  }

  getConfig(): CompactionConfig {
    return { ...this.config }
  }
}

/**
 * Stub implementation when compaction is disabled
 */
export class StubContextCompactor implements IContextCompactor {
  maybeCompact(): void {
    // No-op
  }

  getConfig(): CompactionConfig {
    return { ...DEFAULT_COMPACTION_CONFIG, enabled: false }
  }
}
