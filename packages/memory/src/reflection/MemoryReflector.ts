/**
 * Memory Reflector
 *
 * Automatically extracts insights and observations from conversation exchanges.
 * Uses Claude Haiku to analyze exchanges and creates:
 * - User insights (attached to "self" entity)
 * - Entity observations (attached to mentioned entities)
 * - Reinforcements (boosts confidence on existing observations)
 *
 * Runs asynchronously after each exchange without blocking the response.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'
import type {
  Message,
  TraceContext,
  Result,
  StoreError,
  ToolCall,
  L3Observation,
  L3Entity,
} from '@siri/types'
import { ok, err } from '@siri/types'
import type { Neo4jKnowledgeStore } from '../stores/Neo4jKnowledgeStore.js'

/**
 * Context passed to the Memory Reflector for analysis.
 */
export interface ReflectionContext {
  /** The user's message */
  userMessage: Message
  /** The assistant's response */
  assistantMessage: Message
  /** Memory tool calls made during this exchange (to avoid duplicates) */
  toolCalls: ToolCall[]
  /** Recent insights from the user's self entity */
  recentInsights: L3Observation[]
  /** Entities mentioned in this exchange */
  mentionedEntities: L3Entity[]
}

/**
 * A single insight to create (about the user).
 */
export interface InsightExtraction {
  /** The insight content */
  content: string
  /** Confidence level (0-1) */
  confidence: number
  /** Entity names this insight relates to */
  relatedEntities?: string[]
}

/**
 * A single observation to create (about an entity).
 */
export interface ObservationExtraction {
  /** The entity name to attach the observation to */
  entityName: string
  /** The observation content */
  content: string
  /** Confidence level (0-1) */
  confidence: number
}

/**
 * A reinforcement to apply (confirms existing observation).
 */
export interface ReinforcementExtraction {
  /** The observation ID to reinforce */
  observationId: string
  /** Why this reinforces the observation */
  reason: string
}

/**
 * Result from the Memory Reflector analysis.
 */
export interface ReflectionResult {
  /** User insights to create */
  insights: InsightExtraction[]
  /** Entity observations to create */
  observations: ObservationExtraction[]
  /** Observations to reinforce */
  reinforcements: ReinforcementExtraction[]
}

/**
 * Configuration for the Memory Reflector.
 */
export interface MemoryReflectorConfig {
  /** Maximum recent insights to include in context (default: 10) */
  insightLimit?: number
  /** Maximum entities to include in context (default: 5) */
  entityLimit?: number
  /** Minimum confidence to persist (default: 0.5) */
  minConfidence?: number
  /** Model to use for reflection (default: claude-3-haiku-20240307) */
  model?: string
}

const DEFAULT_CONFIG: Required<MemoryReflectorConfig> = {
  insightLimit: 10,
  entityLimit: 5,
  minConfidence: 0.5,
  model: 'claude-3-haiku-20240307',
}

/**
 * System prompt for the Memory Reflector.
 */
const REFLECTION_SYSTEM_PROMPT = `You are a memory curator analyzing a conversation exchange between a user and an AI assistant.

Your job is to identify memorable information that should be stored for future reference.

EXTRACT THREE TYPES OF INFORMATION:

1. USER INSIGHTS - Things learned about the user themselves:
   - Preferences, habits, patterns (e.g., "prefers morning meetings")
   - Emotional breakthroughs or realizations
   - Goals, intentions, commitments
   - Corrections to existing knowledge
   - Personal history facts

2. ENTITY OBSERVATIONS - Facts about specific people, places, or things mentioned:
   - New information about known entities
   - Relationships between entities
   - Status updates or changes

3. REINFORCEMENTS - Existing knowledge being confirmed again:
   - Reference the specific observation ID being confirmed
   - Briefly explain why this confirms it

IMPORTANT RULES:
- Skip anything already saved via tool calls (provided in context)
- Skip facts already in recent insights (provided in context)
- Be CONSERVATIVE - only extract genuinely memorable/useful information
- Quality over quantity - it's fine to return empty arrays
- Use confidence scores appropriately:
  - 0.8-1.0: Explicit, clear statements
  - 0.6-0.7: Strong implications
  - 0.5-0.6: Reasonable inferences (use sparingly)

Output ONLY valid JSON in this exact format:
{
  "insights": [{"content": "...", "confidence": 0.8, "relatedEntities": ["entityname"]}],
  "observations": [{"entityName": "...", "content": "...", "confidence": 0.9}],
  "reinforcements": [{"observationId": "...", "reason": "..."}]
}

If nothing worth remembering, return:
{"insights": [], "observations": [], "reinforcements": []}`

/**
 * Memory Reflector Service
 *
 * Analyzes conversation exchanges and automatically creates memories.
 */
export class MemoryReflector {
  private readonly config: Required<MemoryReflectorConfig>

  constructor(
    private readonly anthropic: Anthropic,
    private readonly knowledgeStore: Neo4jKnowledgeStore,
    config?: MemoryReflectorConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Analyze an exchange and extract memories.
   */
  async reflect(
    context: ReflectionContext,
    ctx: TraceContext
  ): Promise<Result<ReflectionResult, StoreError>> {
    return withSpan('MemoryReflector.reflect', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        component: 'MemoryReflector',
        userId: context.userMessage.userId,
        conversationId: context.userMessage.conversationId,
        messageId: context.userMessage.id,
        requestId: ctx.requestId,
      })

      const userMsgPreview = context.userMessage.content.slice(0, 100)
      const assistantMsgPreview = context.assistantMessage.content.slice(0, 100)

      logger.info(
        {
          toolCallCount: context.toolCalls.length,
          recentInsightCount: context.recentInsights.length,
          mentionedEntityCount: context.mentionedEntities.length,
          userMsgLength: context.userMessage.content.length,
          assistantMsgLength: context.assistantMessage.content.length,
        },
        'Starting memory reflection analysis'
      )

      logger.debug(
        {
          userMsgPreview,
          assistantMsgPreview,
          toolCalls: context.toolCalls.map((tc) => tc.name),
          recentInsights: context.recentInsights.map((i) => i.content.slice(0, 50)),
          mentionedEntities: context.mentionedEntities.map((e) => e.name),
        },
        'Reflection context details'
      )

      try {
        // Build the user prompt with context
        const userPrompt = this.buildUserPrompt(context)
        logger.debug(
          { promptLength: userPrompt.length, model: this.config.model },
          'Built reflection prompt, calling LLM'
        )

        // Call Haiku for analysis
        const llmStartTime = Date.now()
        const response = await this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: 1024,
          system: REFLECTION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        })
        const llmDurationMs = Date.now() - llmStartTime

        logger.debug(
          {
            llmDurationMs,
            inputTokens: response.usage?.input_tokens,
            outputTokens: response.usage?.output_tokens,
            stopReason: response.stop_reason,
          },
          'LLM reflection call complete'
        )

        // Extract text content
        const textContent = response.content.find((c) => c.type === 'text')
        if (!textContent || textContent.type !== 'text') {
          logger.warn(
            { contentTypes: response.content.map((c) => c.type) },
            'No text content in reflection response'
          )
          return ok({ insights: [], observations: [], reinforcements: [] })
        }

        // Parse JSON response
        const result = this.parseResponse(textContent.text, logger)

        const durationMs = Date.now() - startTime
        const hasContent = result.insights.length > 0 || result.observations.length > 0 || result.reinforcements.length > 0

        logger.info(
          {
            insightCount: result.insights.length,
            observationCount: result.observations.length,
            reinforcementCount: result.reinforcements.length,
            durationMs,
            llmDurationMs,
            hasContent,
          },
          hasContent
            ? 'Memory reflection found memorable content'
            : 'Memory reflection complete - nothing to persist'
        )

        pipelineMetrics.stageDuration.record(durationMs, { stage: 'memory_reflection' })

        return ok(result)
      } catch (error) {
        const durationMs = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorName = error instanceof Error ? error.name : 'Unknown'

        logger.error(
          {
            error: errorMessage,
            errorName,
            stack: error instanceof Error ? error.stack : undefined,
            durationMs,
            toolCallCount: context.toolCalls.length,
            userMsgLength: context.userMessage.content.length,
          },
          'Memory reflection failed - LLM call or processing error'
        )
        pipelineMetrics.errors.add(1, { kind: 'memory_reflection_error' })

        return err({
          kind: 'UnexpectedError',
          message: `Memory reflection failed: ${errorMessage}`,
          context: { conversationId: context.userMessage.conversationId },
          cause: error,
        })
      }
    })
  }

  /**
   * Persist the reflection results to the knowledge store.
   */
  async persist(
    result: ReflectionResult,
    userId: string,
    messageId: string,
    conversationId: string,
    ctx: TraceContext
  ): Promise<void> {
    return withSpan('MemoryReflector.persist', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        component: 'MemoryReflector',
        operation: 'persist',
        userId,
        conversationId,
        messageId,
        requestId: ctx.requestId,
      })

      const totalItems = result.insights.length + result.observations.length + result.reinforcements.length
      logger.info(
        {
          insightCount: result.insights.length,
          observationCount: result.observations.length,
          reinforcementCount: result.reinforcements.length,
          minConfidence: this.config.minConfidence,
        },
        `Persisting ${totalItems} reflection items`
      )

      let insightsPersisted = 0
      let insightsSkipped = 0
      let observationsPersisted = 0
      let observationsSkipped = 0
      let reinforcementsPersisted = 0
      let reinforcementsFailed = 0

      try {
        // 1. Ensure self entity exists for insights
        if (result.insights.length > 0) {
          logger.debug('Ensuring self entity exists for user insights')
          const selfResult = await this.knowledgeStore.ensureSelfEntity(userId, ctx)
          if (!selfResult.ok) {
            logger.warn(
              { error: selfResult.error.message, errorKind: selfResult.error.kind },
              'Failed to ensure self entity - insights may not persist'
            )
          } else {
            logger.debug({ selfEntityName: `${userId}_self` }, 'Self entity ready')
          }
        }

        // 2. Create insights as observations on self entity
        for (const insight of result.insights) {
          if (insight.confidence < this.config.minConfidence) {
            logger.debug(
              {
                contentPreview: insight.content.slice(0, 50),
                confidence: insight.confidence,
                threshold: this.config.minConfidence,
              },
              'Skipping low-confidence insight'
            )
            insightsSkipped++
            continue
          }

          const selfName = `${userId}_self`
          logger.debug(
            {
              contentPreview: insight.content.slice(0, 80),
              confidence: insight.confidence,
              relatedEntities: insight.relatedEntities,
            },
            'Creating user insight observation'
          )

          const obsResult = await this.knowledgeStore.createObservation(
            selfName,
            {
              content: insight.content,
              conversationId,
              messageId,
              confidence: insight.confidence,
            },
            ctx
          )

          if (obsResult.ok) {
            insightsPersisted++
            logger.debug(
              { observationId: obsResult.value?.id, insightsPersisted },
              'Insight observation created'
            )

            // Link to related entities if any
            for (const entityName of insight.relatedEntities ?? []) {
              await this.knowledgeStore.createL3Relationship(
                selfName,
                entityName,
                'insight_about',
                {
                  context: insight.content.slice(0, 100),
                  conversationId,
                  messageId,
                },
                ctx
              ).catch((linkErr) => {
                logger.debug(
                  { error: linkErr instanceof Error ? linkErr.message : String(linkErr), entityName },
                  'Failed to link insight to entity (entity may not exist)'
                )
              })
            }
          } else {
            logger.warn(
              { error: obsResult.error.message, errorKind: obsResult.error.kind },
              'Failed to create insight observation'
            )
          }
        }

        // 3. Create entity observations
        for (const obs of result.observations) {
          if (obs.confidence < this.config.minConfidence) {
            logger.debug(
              {
                entityName: obs.entityName,
                confidence: obs.confidence,
                threshold: this.config.minConfidence,
              },
              'Skipping low-confidence entity observation'
            )
            observationsSkipped++
            continue
          }

          logger.debug(
            {
              entityName: obs.entityName,
              contentPreview: obs.content.slice(0, 80),
              confidence: obs.confidence,
            },
            'Creating entity observation'
          )

          const obsResult = await this.knowledgeStore.createObservation(
            obs.entityName,
            {
              content: obs.content,
              conversationId,
              messageId,
              confidence: obs.confidence,
            },
            ctx
          )

          if (obsResult.ok) {
            observationsPersisted++
            logger.debug(
              { entityName: obs.entityName, observationId: obsResult.value?.id, observationsPersisted },
              'Entity observation created'
            )
          } else {
            logger.debug(
              { error: obsResult.error.message, errorKind: obsResult.error.kind, entityName: obs.entityName },
              'Failed to create entity observation (entity may not exist)'
            )
          }
        }

        // 4. Process reinforcements
        for (const reinf of result.reinforcements) {
          logger.debug(
            { observationId: reinf.observationId, reason: reinf.reason.slice(0, 50) },
            'Reinforcing existing observation'
          )

          const reinforceResult = await this.knowledgeStore.reinforceObservation(
            reinf.observationId,
            messageId,
            conversationId,
            0.1,
            ctx
          )

          if (reinforceResult.ok) {
            reinforcementsPersisted++
            logger.debug(
              { observationId: reinf.observationId, reinforcementsPersisted },
              'Observation reinforced successfully'
            )
          } else {
            reinforcementsFailed++
            logger.debug(
              { error: reinforceResult.error.message, observationId: reinf.observationId },
              'Failed to reinforce observation (may not exist)'
            )
          }
        }

        const durationMs = Date.now() - startTime
        const totalPersisted = insightsPersisted + observationsPersisted + reinforcementsPersisted
        const totalSkipped = insightsSkipped + observationsSkipped

        logger.info(
          {
            insightsPersisted,
            insightsSkipped,
            observationsPersisted,
            observationsSkipped,
            reinforcementsPersisted,
            reinforcementsFailed,
            totalPersisted,
            totalSkipped,
            durationMs,
          },
          totalPersisted > 0
            ? `Reflection persistence complete: ${totalPersisted} items saved`
            : 'Reflection persistence complete: no items saved'
        )

        pipelineMetrics.stageDuration.record(durationMs, { stage: 'memory_reflection_persist' })
      } catch (error) {
        const durationMs = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : String(error)

        logger.error(
          {
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            durationMs,
            insightsPersisted,
            observationsPersisted,
            reinforcementsPersisted,
          },
          'Failed to persist reflection results'
        )
        pipelineMetrics.errors.add(1, { kind: 'memory_reflection_persist_error' })
      }
    })
  }

  /**
   * Build the user prompt with context.
   */
  private buildUserPrompt(context: ReflectionContext): string {
    const parts: string[] = []

    // Current exchange
    parts.push('## CURRENT EXCHANGE\n')
    parts.push(`User: ${context.userMessage.content}\n`)
    parts.push(`Assistant: ${context.assistantMessage.content}\n`)

    // Tool calls made (to avoid duplicates)
    if (context.toolCalls.length > 0) {
      parts.push('\n## MEMORY TOOLS ALREADY USED (skip these)\n')
      for (const tc of context.toolCalls) {
        const args = JSON.stringify(tc.arguments)
        parts.push(`- ${tc.name}: ${args.slice(0, 200)}${args.length > 200 ? '...' : ''}\n`)
      }
    }

    // Recent insights (to avoid duplicates)
    if (context.recentInsights.length > 0) {
      parts.push('\n## RECENT USER INSIGHTS (already known)\n')
      for (const insight of context.recentInsights.slice(0, this.config.insightLimit)) {
        parts.push(`- [${insight.id}] ${insight.content}\n`)
      }
    }

    // Mentioned entities (for context)
    if (context.mentionedEntities.length > 0) {
      parts.push('\n## ENTITIES MENTIONED (can add observations)\n')
      for (const entity of context.mentionedEntities.slice(0, this.config.entityLimit)) {
        const labels = entity.labels?.length ? ` (${entity.labels.join(', ')})` : ''
        parts.push(`- ${entity.displayName || entity.name}${labels}\n`)
      }
    }

    parts.push('\n## TASK\n')
    parts.push('Analyze the exchange above and extract any memorable information.')
    parts.push(' Output valid JSON only.')

    return parts.join('')
  }

  /**
   * Parse the LLM response into a ReflectionResult.
   */
  private parseResponse(
    text: string,
    logger: ReturnType<typeof getLogger>
  ): ReflectionResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        logger.warn(
          { responseLength: text.length, responsePreview: text.slice(0, 200) },
          'No JSON found in reflection response'
        )
        return { insights: [], observations: [], reinforcements: [] }
      }

      logger.debug({ jsonLength: jsonMatch[0].length }, 'Extracted JSON from response, parsing')

      const parsed = JSON.parse(jsonMatch[0])

      // Validate and normalize the structure
      const rawInsights = Array.isArray(parsed.insights) ? parsed.insights.length : 0
      const rawObservations = Array.isArray(parsed.observations) ? parsed.observations.length : 0
      const rawReinforcements = Array.isArray(parsed.reinforcements) ? parsed.reinforcements.length : 0

      const result: ReflectionResult = {
        insights: Array.isArray(parsed.insights)
          ? parsed.insights.filter(
              (i: unknown) =>
                typeof i === 'object' &&
                i !== null &&
                typeof (i as InsightExtraction).content === 'string' &&
                typeof (i as InsightExtraction).confidence === 'number'
            )
          : [],
        observations: Array.isArray(parsed.observations)
          ? parsed.observations.filter(
              (o: unknown) =>
                typeof o === 'object' &&
                o !== null &&
                typeof (o as ObservationExtraction).entityName === 'string' &&
                typeof (o as ObservationExtraction).content === 'string' &&
                typeof (o as ObservationExtraction).confidence === 'number'
            )
          : [],
        reinforcements: Array.isArray(parsed.reinforcements)
          ? parsed.reinforcements.filter(
              (r: unknown) =>
                typeof r === 'object' &&
                r !== null &&
                typeof (r as ReinforcementExtraction).observationId === 'string'
            )
          : [],
      }

      // Log if any items were filtered out due to validation
      const filteredInsights = rawInsights - result.insights.length
      const filteredObservations = rawObservations - result.observations.length
      const filteredReinforcements = rawReinforcements - result.reinforcements.length

      if (filteredInsights > 0 || filteredObservations > 0 || filteredReinforcements > 0) {
        logger.debug(
          { filteredInsights, filteredObservations, filteredReinforcements },
          'Some items filtered out due to invalid structure'
        )
      }

      logger.debug(
        {
          insights: result.insights.map((i) => ({ content: i.content.slice(0, 50), confidence: i.confidence })),
          observations: result.observations.map((o) => ({ entity: o.entityName, confidence: o.confidence })),
          reinforcements: result.reinforcements.map((r) => r.observationId),
        },
        'Parsed reflection result'
      )

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn(
        {
          error: errorMessage,
          responseLength: text.length,
          responsePreview: text.slice(0, 300),
        },
        'Failed to parse reflection response JSON'
      )
      return { insights: [], observations: [], reinforcements: [] }
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Required<MemoryReflectorConfig> {
    return { ...this.config }
  }
}
