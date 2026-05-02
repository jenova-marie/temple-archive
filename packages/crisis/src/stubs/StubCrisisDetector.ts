/**
 * Stub crisis detector for testing
 */

import type {
  ICrisisDetector,
  CrisisCheckResult,
  CrisisError,
  TraceContext,
  Result,
} from '@siri/types'
import { ok } from '@siri/types'

export class StubCrisisDetector implements ICrisisDetector {
  private mockResult: CrisisCheckResult = {
    level: 1,
    patterns: [],
    triggerEmergency: false,
    action: 'none',
    processingTimeMs: 1,
  }

  async detect(
    _message: string,
    _ctx: TraceContext
  ): Promise<Result<CrisisCheckResult, CrisisError>> {
    return ok(this.mockResult)
  }

  /**
   * Set the mock result for testing
   */
  setMockResult(result: Partial<CrisisCheckResult>): void {
    this.mockResult = {
      ...this.mockResult,
      ...result,
    }
  }

  /**
   * Reset to default (safe) result
   */
  reset(): void {
    this.mockResult = {
      level: 1,
      patterns: [],
      triggerEmergency: false,
      action: 'none',
      processingTimeMs: 1,
    }
  }
}
