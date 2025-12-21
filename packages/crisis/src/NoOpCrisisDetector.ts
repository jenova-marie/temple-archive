/**
 * No-op crisis detector for when crisis detection is disabled
 * Always returns safe result (level 1, no patterns, no emergency)
 */
import type {
  ICrisisDetector,
  CrisisCheckResult,
  CrisisError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok } from '@recoverysky/types'

export class NoOpCrisisDetector implements ICrisisDetector {
  async detect(
    _message: string,
    _ctx: TraceContext
  ): Promise<Result<CrisisCheckResult, CrisisError>> {
    return ok({
      level: 1,
      patterns: [],
      triggerEmergency: false,
      action: 'none',
      processingTimeMs: 0,
    })
  }
}
