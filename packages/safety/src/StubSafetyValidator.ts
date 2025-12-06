/**
 * Stub safety validator for testing
 *
 * In production, this would implement:
 * - PII detection (names, phone numbers, SSN, etc.)
 * - Medical advice detection
 * - Enabling language detection (glorifying substance use)
 * - Harmful content detection
 */

import type {
  ISafetyValidator,
  SafetyValidationResult,
  SafetyError,
  SafetyViolation,
  AssembledContext,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'

export class StubSafetyValidator implements ISafetyValidator {
  private mockViolations: SafetyViolation[] = []

  async validate(
    output: string,
    _context: AssembledContext,
    ctx: TraceContext
  ): Promise<Result<SafetyValidationResult, SafetyError>> {
    return withSpan('StubSafetyValidator.validate', async () => {
      const startTime = performance.now()
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Simple pattern-based checks (placeholder for real implementation)
      const violations: SafetyViolation[] = [...this.mockViolations]

      // Check for potential PII patterns (very basic)
      const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/
      if (ssnPattern.test(output)) {
        violations.push({
          type: 'pii',
          severity: 'critical',
          description: 'Potential SSN detected in output',
        })
      }

      // Check for medical dosage recommendations (very basic)
      const dosagePattern = /\btake\s+\d+\s*(mg|ml|pills?|tablets?)\b/i
      if (dosagePattern.test(output)) {
        violations.push({
          type: 'medical_advice',
          severity: 'high',
          description: 'Potential medical dosage advice detected',
        })
      }

      // Record metrics for violations
      for (const violation of violations) {
        pipelineMetrics.safetyViolations.add(1, { type: violation.type })
      }

      const processingTimeMs = performance.now() - startTime

      logger.debug(
        {
          violationCount: violations.length,
          processingTimeMs,
        },
        'Safety validation completed'
      )

      return ok({
        passed: violations.length === 0,
        violations,
        processingTimeMs,
      })
    })
  }

  /**
   * Add mock violations for testing
   */
  addMockViolation(violation: SafetyViolation): void {
    this.mockViolations.push(violation)
  }

  /**
   * Clear mock violations
   */
  clearMockViolations(): void {
    this.mockViolations = []
  }
}
