/**
 * No-op evaluator for when evaluation is disabled
 *
 * Returns hardcoded neutral scores without any logging or computation.
 * Use when ENABLE_RESPONSE_EVALUATION=false to minimize overhead.
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

const NEUTRAL_RESULT: EvaluationResult = {
  qualityScore: 0.5,
  relevanceScore: 0.5,
  empathyScore: 0.5,
  recoveryScore: 0.5,
  overallScore: 0.5,
}

export class NoOpEvaluator implements IEvaluator {
  async evaluate(
    _userMessage: string,
    _assistantResponse: string,
    _context: AssembledContext,
    _ctx: TraceContext
  ): Promise<Result<EvaluationResult, EvaluationError>> {
    // Return immediately with neutral scores, no logging
    return ok(NEUTRAL_RESULT)
  }
}
