/**
 * Medical Advice Detector - Detects inappropriate medical advice in AI responses
 *
 * Uses a two-stage approach:
 * 1. Fast regex pre-filter to identify potential medical advice
 * 2. LLM-based contextual analysis for confirmation (when enabled)
 *
 * Detects:
 * - Specific medication dosage recommendations
 * - Diagnostic statements ("you have X condition")
 * - Treatment advice that should come from a doctor
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { TraceContext, SafetyViolation } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

export interface MedicalAdviceMatch {
  pattern: string
  matchedText: string
  position: { start: number; end: number }
  confidence: number
  requiresLLMReview: boolean
}

export interface MedicalAdviceResult {
  isMedicalAdvice: boolean
  confidence: number
  reasoning: string
  matchedPatterns: string[]
}

// Pre-filter patterns that trigger LLM review
const MEDICAL_PREFILTER_PATTERNS = [
  // Dosage patterns
  {
    name: 'dosage_recommendation',
    pattern: /\b(?:take\s+)?\d+\s*(?:mg|ml|mcg|g|pills?|tablets?|capsules?|drops?)\b/gi,
    description: 'Specific dosage recommendation',
  },
  {
    name: 'dosage_frequency',
    pattern: /\b(?:once|twice|three times|four times)\s+(?:a|per)\s+day\b/gi,
    description: 'Dosage frequency recommendation',
  },
  {
    name: 'medication_should',
    pattern: /\byou\s+should\s+(?:take|try|use|start|stop)\s+\w+(?:azepam|amine|oid|one|pam|ine|ide|ate|fen|done)\b/gi,
    description: 'Medication recommendation with common drug suffixes',
  },
  // Diagnostic patterns
  {
    name: 'diagnosis_statement',
    pattern: /\byou\s+(?:have|might have|probably have|could have|likely have)\s+(?:\w+\s+){0,2}(?:disorder|syndrome|disease|condition|deficiency)\b/gi,
    description: 'Diagnostic statement',
  },
  {
    name: 'diagnosis_sounds_like',
    pattern: /\b(?:sounds like|appears to be|seems like)\s+(?:you have|a case of)\b/gi,
    description: 'Implied diagnosis',
  },
  // Treatment patterns
  {
    name: 'treatment_instruction',
    pattern: /\b(?:treat|cure|fix|heal)\s+(?:your|the)\s+\w+\s+(?:with|by|using)\b/gi,
    description: 'Treatment instruction',
  },
  {
    name: 'medical_procedure',
    pattern: /\byou\s+(?:need|should|must)\s+(?:get|have|undergo)\s+(?:a|an\s+)?(?:\w+\s+)?(?:surgery|procedure|operation|scan|test|biopsy)\b/gi,
    description: 'Medical procedure recommendation',
  },
  // Dangerous advice patterns
  {
    name: 'stop_medication',
    pattern: /\b(?:stop|quit|discontinue|don'?t take)\s+(?:taking\s+)?(?:your\s+)?(?:medication|medicine|meds|prescription)\b/gi,
    description: 'Advice to stop medication',
  },
  {
    name: 'increase_dosage',
    pattern: /\b(?:increase|double|triple)\s+(?:your\s+)?(?:dose|dosage|medication)\b/gi,
    description: 'Advice to increase dosage',
  },
]

// Patterns that indicate it's NOT medical advice (dampeners)
const MEDICAL_DAMPENER_PATTERNS = [
  /\bconsult\s+(?:your\s+)?(?:doctor|physician|healthcare|medical)\b/gi,
  /\bspeak\s+(?:to|with)\s+(?:your\s+)?(?:doctor|physician)\b/gi,
  /\bi'?m\s+not\s+(?:a\s+)?(?:doctor|medical|qualified)\b/gi,
  /\bthis\s+is\s+not\s+medical\s+advice\b/gi,
  /\bseek\s+(?:professional\s+)?medical\s+(?:advice|help|attention)\b/gi,
]

const LLM_PROMPT = `You are a safety classifier for an addiction recovery chatbot. Analyze the following text for inappropriate medical advice.

IMPORTANT: This is an addiction recovery context. The following ARE acceptable:
- General wellness suggestions (exercise, sleep, hydration)
- Encouraging someone to speak with their doctor
- Discussing the importance of medication compliance (without specific dosages)
- Mentioning that certain medications exist (without recommending them)
- Discussing general categories of treatment (therapy, support groups)

The following are NOT acceptable:
- Recommending specific medications by name with dosages
- Diagnosing medical or psychiatric conditions
- Advising to start, stop, or change prescription medications
- Providing specific treatment protocols
- Medical advice that should come from a licensed professional

TEXT TO ANALYZE:
"""
{text}
"""

Respond with ONLY a JSON object (no other text):
{
  "isMedicalAdvice": boolean,
  "confidence": number between 0 and 1,
  "reasoning": "brief explanation"
}`

export class MedicalAdviceDetector {
  private client: Anthropic | null
  private model: string

  constructor(client: Anthropic | null, model = 'claude-3-haiku-20240307') {
    this.client = client
    this.model = model
  }

  /**
   * Check for pre-filter pattern matches (fast, no LLM call)
   */
  preFilter(text: string): MedicalAdviceMatch[] {
    const matches: MedicalAdviceMatch[] = []

    // Check for dampeners first - if present, reduce likelihood of flagging
    let hasDampener = false
    for (const dampener of MEDICAL_DAMPENER_PATTERNS) {
      dampener.lastIndex = 0
      if (dampener.test(text)) {
        hasDampener = true
        break
      }
    }

    for (const prefilter of MEDICAL_PREFILTER_PATTERNS) {
      prefilter.pattern.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = prefilter.pattern.exec(text)) !== null) {
        matches.push({
          pattern: prefilter.name,
          matchedText: match[0],
          position: { start: match.index, end: match.index + match[0].length },
          confidence: hasDampener ? 0.3 : 0.6, // Lower confidence if dampener present
          requiresLLMReview: true,
        })
      }
    }

    return matches
  }

  /**
   * Perform LLM-based analysis for confirmation
   */
  async analyzeLLM(text: string, ctx: TraceContext): Promise<MedicalAdviceResult | null> {
    if (!this.client) {
      return null
    }

    return withSpan('MedicalAdviceDetector.analyzeLLM', async () => {
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
          isMedicalAdvice: boolean
          confidence: number
          reasoning: string
        }

        return {
          isMedicalAdvice: result.isMedicalAdvice,
          confidence: Math.max(0, Math.min(1, result.confidence)),
          reasoning: result.reasoning,
          matchedPatterns: [],
        }
      } catch (error) {
        logger.error({ error }, 'LLM medical advice analysis failed')
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
  ): Promise<MedicalAdviceResult> {
    return withSpan('MedicalAdviceDetector.detect', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Stage 1: Pre-filter
      const prefilterMatches = this.preFilter(text)

      if (prefilterMatches.length === 0) {
        return {
          isMedicalAdvice: false,
          confidence: 0.9,
          reasoning: 'No medical advice patterns detected',
          matchedPatterns: [],
        }
      }

      logger.debug(
        {
          matchCount: prefilterMatches.length,
          patterns: prefilterMatches.map((m) => m.pattern),
        },
        'Medical advice pre-filter matches found'
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
      return {
        isMedicalAdvice: maxConfidence > 0.5,
        confidence: maxConfidence,
        reasoning: `Pre-filter patterns matched: ${prefilterMatches.map((m) => m.pattern).join(', ')}`,
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

    if (!result.isMedicalAdvice) {
      return []
    }

    return [
      {
        type: 'medical_advice',
        severity: result.confidence >= 0.8 ? 'high' : 'medium',
        description: `Medical advice detected: ${result.reasoning}`,
      },
    ]
  }
}
