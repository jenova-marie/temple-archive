/**
 * Stub evaluator for testing
 *
 * In production, this would use LLM-based evaluation for:
 * - Response quality
 * - Relevance to user's situation
 * - Empathy and supportiveness
 * - Recovery-appropriateness
 */

import type {
  IEvaluator,
  EvaluationResult,
  EvaluationError,
  AssembledContext,
  TraceContext,
  Result,
} from '@pippa/types'
import { ok } from '@pippa/types'
import { getLogger, withSpan } from '@pippa/observability'

export class StubEvaluator implements IEvaluator {
  private mockScores: Partial<EvaluationResult> = {}

  async evaluate(
    userMessage: string,
    assistantResponse: string,
    _context: AssembledContext,
    ctx: TraceContext
  ): Promise<Result<EvaluationResult, EvaluationError>> {
    return withSpan('StubEvaluator.evaluate', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Simple heuristic-based scoring (placeholder for LLM evaluation)
      const qualityScore = this.calculateQualityScore(assistantResponse)
      const relevanceScore = this.calculateRelevanceScore(userMessage, assistantResponse)
      const empathyScore = this.calculateEmpathyScore(assistantResponse)
      const recoveryScore = this.calculateRecoveryScore(assistantResponse)

      const result: EvaluationResult = {
        qualityScore: this.mockScores.qualityScore ?? qualityScore,
        relevanceScore: this.mockScores.relevanceScore ?? relevanceScore,
        empathyScore: this.mockScores.empathyScore ?? empathyScore,
        recoveryScore: this.mockScores.recoveryScore ?? recoveryScore,
        overallScore: 0,
      }

      // Calculate overall score as weighted average
      result.overallScore = (
        result.qualityScore * 0.2 +
        result.relevanceScore * 0.3 +
        result.empathyScore * 0.3 +
        result.recoveryScore * 0.2
      )

      logger.debug(
        {
          qualityScore: result.qualityScore,
          relevanceScore: result.relevanceScore,
          empathyScore: result.empathyScore,
          recoveryScore: result.recoveryScore,
          overallScore: result.overallScore,
        },
        'Evaluation completed'
      )

      return ok(result)
    })
  }

  private calculateQualityScore(response: string): number {
    // Check for basic quality indicators
    let score = 0.5

    // Length check (not too short, not too long)
    if (response.length > 50 && response.length < 2000) {
      score += 0.2
    }

    // Proper punctuation
    if (response.includes('.') || response.includes('?')) {
      score += 0.1
    }

    // Complete sentences
    if (response.endsWith('.') || response.endsWith('?') || response.endsWith('!')) {
      score += 0.1
    }

    return Math.min(score, 1)
  }

  private calculateRelevanceScore(userMessage: string, response: string): number {
    // Simple keyword overlap check
    const userWords = new Set(userMessage.toLowerCase().split(/\s+/))
    const responseWords = new Set(response.toLowerCase().split(/\s+/))

    let overlap = 0
    for (const word of userWords) {
      if (word.length > 3 && responseWords.has(word)) {
        overlap++
      }
    }

    const relevance = Math.min(overlap / Math.max(userWords.size, 1), 1)
    return 0.5 + relevance * 0.5
  }

  private calculateEmpathyScore(response: string): number {
    const lower = response.toLowerCase()
    let score = 0.5

    // Empathy indicators
    const empathyPhrases = [
      'i understand',
      'i hear you',
      'that must be',
      'it sounds like',
      'thank you for sharing',
      'i\'m here',
      'you\'re not alone',
      'it takes courage',
    ]

    for (const phrase of empathyPhrases) {
      if (lower.includes(phrase)) {
        score += 0.1
      }
    }

    return Math.min(score, 1)
  }

  private calculateRecoveryScore(response: string): number {
    const lower = response.toLowerCase()
    let score = 0.6

    // Positive recovery indicators
    const positiveIndicators = [
      'support',
      'recovery',
      'progress',
      'strength',
      'coping',
      'help',
      'meeting',
      'sponsor',
    ]

    for (const indicator of positiveIndicators) {
      if (lower.includes(indicator)) {
        score += 0.05
      }
    }

    // Negative indicators (should reduce score)
    const negativeIndicators = [
      'just one drink',
      'you deserve to',
      'it\'s okay to use',
    ]

    for (const indicator of negativeIndicators) {
      if (lower.includes(indicator)) {
        score -= 0.2
      }
    }

    return Math.max(0, Math.min(score, 1))
  }

  /**
   * Set mock scores for testing
   */
  setMockScores(scores: Partial<EvaluationResult>): void {
    this.mockScores = scores
  }

  /**
   * Clear mock scores
   */
  clearMockScores(): void {
    this.mockScores = {}
  }
}
