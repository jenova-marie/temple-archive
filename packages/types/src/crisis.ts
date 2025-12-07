import type { TraceContext } from './context.js'
import type { Result } from './result.js'

/**
 * Crisis severity levels
 *
 * | Level | Severity | Action |
 * |-------|----------|--------|
 * | 1-3   | Normal   | No action |
 * | 4-6   | Elevated | Monitor, log for analysis |
 * | 7-8   | High     | Inject crisis resources, flag for review |
 * | 9-10  | Critical | Alert on-call team, emergency protocols |
 */
export type CrisisLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

/**
 * Types of crisis patterns detected
 */
export type CrisisPatternType =
  | 'suicidal_ideation'
  | 'self_harm'
  | 'active_relapse'
  | 'imminent_relapse'
  | 'overdose_risk'
  | 'violence_risk'
  | 'severe_distress'
  | 'hopelessness'
  | 'isolation'
  | 'withdrawal_symptoms'
  | 'medication_noncompliance'
  | 'financial_crisis'

/**
 * A detected crisis pattern
 */
export interface DetectedPattern {
  /** Pattern type */
  type: CrisisPatternType
  /** Confidence score (0-1) */
  confidence: number
  /** Matched text or phrase */
  matchedText?: string
  /** Position in input */
  position?: { start: number; end: number }
}

/**
 * Result from crisis detection
 */
export interface CrisisCheckResult {
  /** Overall crisis level (1-10) */
  level: CrisisLevel
  /** Detected patterns */
  patterns: DetectedPattern[]
  /** Whether to trigger emergency response */
  triggerEmergency: boolean
  /** Recommended action */
  action: 'none' | 'monitor' | 'inject_resources' | 'alert_team' | 'emergency_protocol'
  /** Processing time in ms */
  processingTimeMs: number
}

/**
 * Crisis detection error
 */
export interface CrisisError {
  kind: 'PatternError' | 'EvaluationError' | 'TimeoutError' | 'UnexpectedError'
  message: string
  context: Record<string, unknown>
}

/**
 * Crisis detector interface (pre-flight check)
 */
export interface ICrisisDetector {
  /**
   * Quick pre-flight crisis check using pattern matching
   * Should complete in <10ms
   */
  detect(message: string, ctx: TraceContext): Promise<Result<CrisisCheckResult, CrisisError>>
}

/**
 * Deep crisis evaluator interface (LLM-based)
 */
export interface ICrisisEvaluator {
  /**
   * Deep evaluation using LLM for nuanced crisis detection
   * Runs in parallel with agent processing
   */
  evaluate(
    message: string,
    conversationHistory: string[],
    ctx: TraceContext
  ): Promise<Result<CrisisCheckResult, CrisisError>>
}

/**
 * Crisis handler interface
 */
export interface ICrisisHandler {
  /**
   * Handle a detected crisis situation
   */
  handle(
    result: CrisisCheckResult,
    userId: string,
    conversationId: string,
    ctx: TraceContext
  ): Promise<Result<CrisisHandlerResponse, CrisisError>>
}

/**
 * Response from crisis handler
 */
export interface CrisisHandlerResponse {
  /** Resources to inject into response */
  resources?: CrisisResource[]
  /** Whether team was alerted */
  teamAlerted: boolean
  /** Additional actions taken */
  actionsTaken: string[]
  /** Message to prepend to response */
  prependMessage?: string
}

/**
 * A crisis resource to share with user
 */
export interface CrisisResource {
  /** Resource name */
  name: string
  /** Resource description */
  description: string
  /** Contact method (phone, chat, text) */
  contactMethod: 'phone' | 'chat' | 'text' | 'web'
  /** Contact value (number, URL, etc.) */
  contactValue: string
  /** Whether available 24/7 */
  available24x7: boolean
}
