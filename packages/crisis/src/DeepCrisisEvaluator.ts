/**
 * Deep crisis evaluator using LLM for nuanced crisis detection
 *
 * Runs in parallel with agent processing to catch crises that
 * regex-based detection might miss (subtle expressions, metaphors,
 * context-dependent statements).
 */

import type Anthropic from '@anthropic-ai/sdk'
import type {
  ICrisisEvaluator,
  CrisisCheckResult,
  CrisisError,
  CrisisLevel,
  CrisisPatternType,
  DetectedPattern,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'

export interface DeepCrisisEvaluatorConfig {
  /** Model to use for evaluation (default: claude-3-haiku-20240307) */
  model?: string
  /** Maximum tokens for response (default: 512) */
  maxTokens?: number
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number
}

/**
 * Schema for LLM response
 */
interface DeepEvaluationResponse {
  crisisDetected: boolean
  level: number
  patterns: Array<{
    type: string
    confidence: number
    reasoning: string
  }>
  requiresEscalation: boolean
}

const SYSTEM_PROMPT = `You are a crisis detection system for an addiction recovery support application.
Your job is to analyze user messages for signs of crisis that require immediate attention.

IMPORTANT CONTEXT:
- Users are people in addiction recovery seeking support
- They may discuss difficult topics as part of their healing journey
- Not every mention of substance use or difficult feelings is a crisis
- Focus on CURRENT, ACTIVE crisis indicators, not past experiences or hypothetical questions

CRISIS INDICATORS TO DETECT:
1. suicidal_ideation - Active thoughts of ending one's life
2. self_harm - Active urges or recent acts of self-harm
3. overdose_risk - Current or imminent overdose danger
4. violence_risk - Active urges to harm others
5. active_relapse - Currently using substances after period of sobriety
6. imminent_relapse - About to use, has obtained substances
7. withdrawal_symptoms - Dangerous withdrawal requiring medical attention
8. severe_distress - Acute mental health crisis, panic

NOT CRISES (do not flag):
- Discussing past experiences ("I used to...")
- Hypothetical questions ("What if someone...")
- Talking about media (movies, books, shows)
- Helping others ("My friend is...")
- General recovery discussions
- Cravings without imminent action
- Bad days that aren't acute crises

CRISIS LEVELS:
- 1-3: Normal conversation, no concern
- 4-6: Elevated concern, monitor
- 7-8: High risk, resources needed
- 9-10: Critical, emergency response

Respond with JSON only, no markdown:
{
  "crisisDetected": boolean,
  "level": number (1-10),
  "patterns": [{"type": string, "confidence": number (0-1), "reasoning": string}],
  "requiresEscalation": boolean
}`

export class DeepCrisisEvaluator implements ICrisisEvaluator {
  private readonly client: Anthropic
  private readonly config: Required<DeepCrisisEvaluatorConfig>

  constructor(client: Anthropic, config?: DeepCrisisEvaluatorConfig) {
    this.client = client
    this.config = {
      model: config?.model ?? 'claude-3-haiku-20240307',
      maxTokens: config?.maxTokens ?? 512,
      timeoutMs: config?.timeoutMs ?? 5000,
    }
  }

  async evaluate(
    message: string,
    conversationHistory: string[],
    ctx: TraceContext
  ): Promise<Result<CrisisCheckResult, CrisisError>> {
    return withSpan('DeepCrisisEvaluator.evaluate', async () => {
      const startTime = performance.now()
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Skip trivial messages
      if (message.length < 20) {
        logger.debug('Message too short for deep evaluation')
        return ok(this.createEmptyResult(performance.now() - startTime))
      }

      try {
        // Build conversation context (last 3 messages max)
        const recentHistory = conversationHistory.slice(-3)
        const contextMessages = recentHistory.length > 0
          ? `\n\nRecent conversation:\n${recentHistory.map((m, i) => `[${i + 1}] ${m}`).join('\n')}`
          : ''

        const userContent = `Analyze this message for crisis indicators:

"${message}"${contextMessages}`

        // Create abort controller for timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

        try {
          const response = await this.client.messages.create(
            {
              model: this.config.model,
              max_tokens: this.config.maxTokens,
              system: SYSTEM_PROMPT,
              messages: [{ role: 'user', content: userContent }],
            },
            { signal: controller.signal }
          )

          clearTimeout(timeoutId)

          // Extract text content
          const textContent = response.content.find((c) => c.type === 'text')
          if (!textContent || textContent.type !== 'text') {
            logger.warn('No text content in LLM response')
            return ok(this.createEmptyResult(performance.now() - startTime))
          }

          // Parse JSON response
          const parsed = this.parseResponse(textContent.text)
          if (!parsed) {
            logger.warn({ response: textContent.text }, 'Failed to parse LLM response')
            return ok(this.createEmptyResult(performance.now() - startTime))
          }

          const processingTimeMs = performance.now() - startTime

          // Record metrics
          pipelineMetrics.crisisDetections.add(1, {
            source: 'deep_evaluator',
            level: String(parsed.level),
          })

          logger.info(
            {
              crisisDetected: parsed.crisisDetected,
              level: parsed.level,
              patternCount: parsed.patterns.length,
              processingTimeMs,
            },
            'Deep crisis evaluation completed'
          )

          // Convert to CrisisCheckResult
          const level = Math.max(1, Math.min(10, parsed.level)) as CrisisLevel
          const detectedPatterns: DetectedPattern[] = parsed.patterns.map((p) => ({
            type: this.validatePatternType(p.type),
            confidence: p.confidence,
            matchedText: p.reasoning,
          }))

          return ok({
            level,
            patterns: detectedPatterns,
            triggerEmergency: level >= 9,
            action: this.determineAction(level),
            processingTimeMs,
          })
        } catch (abortError) {
          clearTimeout(timeoutId)
          throw abortError
        }
      } catch (error) {
        const processingTimeMs = performance.now() - startTime

        if (error instanceof Error && error.name === 'AbortError') {
          logger.warn({ processingTimeMs }, 'Deep crisis evaluation timed out')
          return err({
            kind: 'TimeoutError',
            message: `Evaluation timed out after ${this.config.timeoutMs}ms`,
            context: { processingTimeMs },
          })
        }

        logger.error({ error }, 'Deep crisis evaluation failed')
        return err({
          kind: 'EvaluationError',
          message: error instanceof Error ? error.message : 'Unknown error',
          context: { error: String(error) },
        })
      }
    })
  }

  private parseResponse(text: string): DeepEvaluationResponse | null {
    try {
      // Try to extract JSON from response (in case there's extra text)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0])

      // Validate required fields
      if (
        typeof parsed.crisisDetected !== 'boolean' ||
        typeof parsed.level !== 'number' ||
        !Array.isArray(parsed.patterns)
      ) {
        return null
      }

      return parsed as DeepEvaluationResponse
    } catch {
      return null
    }
  }

  private validatePatternType(type: string): CrisisPatternType {
    const validTypes: CrisisPatternType[] = [
      'suicidal_ideation',
      'self_harm',
      'active_relapse',
      'imminent_relapse',
      'overdose_risk',
      'violence_risk',
      'severe_distress',
      'hopelessness',
      'isolation',
      'withdrawal_symptoms',
      'medication_noncompliance',
      'financial_crisis',
    ]

    if (validTypes.includes(type as CrisisPatternType)) {
      return type as CrisisPatternType
    }

    // Default to severe_distress for unknown types
    return 'severe_distress'
  }

  private determineAction(level: CrisisLevel): CrisisCheckResult['action'] {
    if (level >= 9) return 'emergency_protocol'
    if (level >= 7) return 'inject_resources'
    if (level >= 4) return 'monitor'
    return 'none'
  }

  private createEmptyResult(processingTimeMs: number): CrisisCheckResult {
    return {
      level: 1,
      patterns: [],
      triggerEmergency: false,
      action: 'none',
      processingTimeMs,
    }
  }
}
