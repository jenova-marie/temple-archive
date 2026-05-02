/**
 * Enabling Language Detector - Detects language that enables or encourages substance use
 *
 * Uses a two-stage approach:
 * 1. Fast regex pre-filter to identify potential enabling language
 * 2. LLM-based contextual analysis for confirmation (when enabled)
 *
 * Detects:
 * - Glorification of substance use
 * - Minimization of risks or harm
 * - Normalization of addictive behavior
 * - Permission-giving language
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { TraceContext, SafetyViolation } from '@siri/types'
import { getLogger, withSpan } from '@siri/observability'

export type EnablingType =
  | 'glorification'
  | 'minimization'
  | 'normalization'
  | 'permission'

export interface EnablingMatch {
  pattern: string
  type: EnablingType
  matchedText: string
  position: { start: number; end: number }
  confidence: number
  requiresLLMReview: boolean
}

export interface EnablingResult {
  isEnabling: boolean
  confidence: number
  reasoning: string
  type: EnablingType | null
  matchedPatterns: string[]
}

// Pre-filter patterns that trigger LLM review
const ENABLING_PREFILTER_PATTERNS = [
  // Glorification patterns
  {
    name: 'deserve_drink',
    type: 'glorification' as EnablingType,
    pattern: /\b(?:you\s+)?(?:deserve|earned|need)\s+(?:a|that|this)?\s*(?:drink|beer|wine|shot)\b/gi,
    description: 'Suggesting user deserves alcohol',
  },
  {
    name: 'celebrate_with',
    type: 'glorification' as EnablingType,
    pattern: /\bcelebrate\s+(?:with|by\s+having)\s+(?:a\s+)?(?:drink|drinks|beer|wine)\b/gi,
    description: 'Suggesting celebration with alcohol',
  },
  {
    name: 'good_times',
    type: 'glorification' as EnablingType,
    pattern: /\bremember\s+(?:the\s+)?good\s+times\s+(?:when\s+)?(?:we\s+)?(?:used\s+to\s+)?(?:used|drank|partied|party)\b/gi,
    description: 'Romanticizing past substance use',
  },

  // Minimization patterns
  {
    name: 'just_one',
    type: 'minimization' as EnablingType,
    pattern: /\b(?:just\s+)?one\s+(?:drink|beer|hit|line|pill)\s+(?:won'?t|wouldn'?t|can'?t|will\s+not|would\s+not|does\s+not)\s+(?:hurt|kill|matter)\b/gi,
    description: 'Minimizing single use',
  },
  {
    name: 'not_that_bad',
    type: 'minimization' as EnablingType,
    pattern: /\b(?:it'?s\s+)?not\s+(?:that|so|really)\s+bad\b/gi,
    description: 'Minimizing harm',
  },
  {
    name: 'little_bit',
    type: 'minimization' as EnablingType,
    pattern: /\ba\s+little\s+(?:bit|won'?t\s+hurt|never\s+hurt)\b/gi,
    description: 'Minimizing quantity',
  },
  {
    name: 'moderation_okay',
    type: 'minimization' as EnablingType,
    pattern: /\b(?:in\s+)?moderation\s+(?:is\s+)?(?:fine|okay|ok|alright)\b/gi,
    description: 'Suggesting moderation is acceptable',
  },

  // Normalization patterns
  {
    name: 'everyone_does',
    type: 'normalization' as EnablingType,
    pattern: /\beveryone\s+(?:does\s+it|drinks|uses|parties)\b/gi,
    description: 'Normalizing through universality',
  },
  {
    name: 'normal_to',
    type: 'normalization' as EnablingType,
    pattern: /\b(?:it'?s\s+)?(?:normal|natural|common)\s+to\s+(?:want|crave|feel\s+like)\b/gi,
    description: 'Normalizing cravings as permission',
  },
  {
    name: 'part_of_life',
    type: 'normalization' as EnablingType,
    pattern: /\b(?:drinking|partying|using)\s+is\s+(?:just\s+)?(?:part\s+of|a\s+normal\s+part)\b/gi,
    description: 'Normalizing substance use as life component',
  },

  // Permission patterns
  {
    name: 'go_ahead',
    type: 'permission' as EnablingType,
    pattern: /\bgo\s+ahead\s+(?:and\s+)?(?:have|drink|use|take)\b/gi,
    description: 'Giving explicit permission',
  },
  {
    name: 'treat_yourself',
    type: 'permission' as EnablingType,
    pattern: /\btreat\s+yourself\s+(?:to\s+)?(?:a\s+)?(?:drink|one|it)\b/gi,
    description: 'Framing use as self-care',
  },
  {
    name: 'you_can',
    type: 'permission' as EnablingType,
    pattern: /\byou\s+can\s+(?:have|drink|use)\s+(?:just\s+)?(?:one|a\s+little|some)\b/gi,
    description: 'Giving permission for limited use',
  },
  {
    name: 'why_not',
    type: 'permission' as EnablingType,
    pattern: /\bwhy\s+not\s+(?:have|just|treat)\b/gi,
    description: 'Rhetorical permission',
  },
]

// Patterns that indicate it's NOT enabling (dampeners)
const ENABLING_DAMPENER_PATTERNS = [
  /\bused\s+to\s+(?:think|believe|say)\b/gi, // Past beliefs
  /\bbefore\s+(?:i\s+)?(?:got\s+sober|started\s+recovery)\b/gi, // Past context
  /\bpeople\s+(?:sometimes|often)\s+think\b/gi, // Discussing misconceptions
  /\bbut\s+(?:that'?s|this\s+is)\s+not\s+true\b/gi, // Correcting misconception
  /\byour\s+(?:recovery|sobriety)\s+(?:is|comes)\s+first\b/gi, // Pro-recovery
  /\bi'?m\s+here\s+to\s+support\s+your\s+recovery\b/gi, // Support statement
  /\brelapse\s+(?:is|can\s+be)\s+(?:part\s+of|dangerous)\b/gi, // Relapse discussion (not enabling)
]

const LLM_PROMPT = `You are a safety classifier for an addiction recovery chatbot. Analyze the following text for language that enables or encourages substance use.

IMPORTANT CONTEXT: This is a chatbot helping people in addiction recovery. The following are NOT enabling:
- Discussing relapse as a challenge (without encouraging it)
- Acknowledging that cravings are normal (without suggesting acting on them)
- Talking about past substance use in a reflective way
- Discussing how others might think or behave (without endorsing it)
- Validating difficult feelings without suggesting substance use as a solution

The following ARE enabling (problematic):
- Suggesting the person "deserves" or has "earned" a drink/use
- Minimizing the harm of "just one" drink/use
- Normalizing substance use as acceptable behavior
- Giving permission to use substances
- Romanticizing or glorifying past substance use
- Suggesting moderation is possible for someone in recovery

TEXT TO ANALYZE:
"""
{text}
"""

Respond with ONLY a JSON object (no other text):
{
  "isEnabling": boolean,
  "confidence": number between 0 and 1,
  "reasoning": "brief explanation",
  "type": "glorification" | "minimization" | "normalization" | "permission" | null
}`

export class EnablingDetector {
  private client: Anthropic | null
  private model: string

  constructor(client: Anthropic | null, model = 'claude-3-haiku-20240307') {
    this.client = client
    this.model = model
  }

  /**
   * Check for pre-filter pattern matches (fast, no LLM call)
   */
  preFilter(text: string): EnablingMatch[] {
    const matches: EnablingMatch[] = []

    // Check for dampeners first
    let hasDampener = false
    for (const dampener of ENABLING_DAMPENER_PATTERNS) {
      dampener.lastIndex = 0
      if (dampener.test(text)) {
        hasDampener = true
        break
      }
    }

    for (const prefilter of ENABLING_PREFILTER_PATTERNS) {
      prefilter.pattern.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = prefilter.pattern.exec(text)) !== null) {
        matches.push({
          pattern: prefilter.name,
          type: prefilter.type,
          matchedText: match[0],
          position: { start: match.index, end: match.index + match[0].length },
          confidence: hasDampener ? 0.3 : 0.6,
          requiresLLMReview: true,
        })
      }
    }

    return matches
  }

  /**
   * Perform LLM-based analysis for confirmation
   */
  async analyzeLLM(text: string, ctx: TraceContext): Promise<EnablingResult | null> {
    if (!this.client) {
      return null
    }

    return withSpan('EnablingDetector.analyzeLLM', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      try {
        const prompt = LLM_PROMPT.replace('{text}', text)

        const response = await this.client!.messages.create(
          {
            model: this.model,
            max_tokens: 256,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          },
          {
            signal: AbortSignal.timeout(5000),
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          return null
        }

        // Parse JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          logger.warn('Failed to parse LLM response as JSON')
          return null
        }

        const result = JSON.parse(jsonMatch[0]) as {
          isEnabling: boolean
          confidence: number
          reasoning: string
          type: EnablingType | null
        }

        return {
          isEnabling: result.isEnabling,
          confidence: Math.max(0, Math.min(1, result.confidence)),
          reasoning: result.reasoning,
          type: result.type,
          matchedPatterns: [],
        }
      } catch (error) {
        logger.error({ error }, 'LLM enabling language analysis failed')
        return null
      }
    })
  }

  /**
   * Full detection with optional LLM confirmation
   */
  async detect(
    text: string,
    ctx: TraceContext,
    useLLM = true
  ): Promise<EnablingResult> {
    return withSpan('EnablingDetector.detect', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Stage 1: Pre-filter
      const prefilterMatches = this.preFilter(text)

      if (prefilterMatches.length === 0) {
        return {
          isEnabling: false,
          confidence: 0.9,
          reasoning: 'No enabling language patterns detected',
          type: null,
          matchedPatterns: [],
        }
      }

      logger.debug(
        {
          matchCount: prefilterMatches.length,
          patterns: prefilterMatches.map((m) => m.pattern),
          types: prefilterMatches.map((m) => m.type),
        },
        'Enabling language pre-filter matches found'
      )

      // Stage 2: LLM confirmation (if enabled and available)
      if (useLLM && this.client) {
        const llmResult = await this.analyzeLLM(text, ctx)

        if (llmResult) {
          return {
            ...llmResult,
            matchedPatterns: prefilterMatches.map((m) => m.pattern),
          }
        }
      }

      // Fallback: Use pre-filter results only
      const maxConfidence = Math.max(...prefilterMatches.map((m) => m.confidence))
      const primaryType = prefilterMatches[0]?.type ?? null

      return {
        isEnabling: maxConfidence > 0.5,
        confidence: maxConfidence,
        reasoning: `Pre-filter patterns matched: ${prefilterMatches.map((m) => m.pattern).join(', ')}`,
        type: primaryType,
        matchedPatterns: prefilterMatches.map((m) => m.pattern),
      }
    })
  }

  /**
   * Detect and return as SafetyViolation array
   */
  async detectViolations(
    text: string,
    ctx: TraceContext,
    useLLM = true
  ): Promise<SafetyViolation[]> {
    const result = await this.detect(text, ctx, useLLM)

    if (!result.isEnabling) {
      return []
    }

    return [
      {
        type: 'enabling_language',
        severity: result.confidence >= 0.8 ? 'high' : 'medium',
        description: `Enabling language detected (${result.type}): ${result.reasoning}`,
      },
    ]
  }
}
