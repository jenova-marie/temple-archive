/**
 * Trace context for distributed tracing and log correlation
 */
export interface TraceContext {
  /** OpenTelemetry trace ID */
  traceId: string
  /** Current span ID */
  spanId: string
  /** Request-level correlation ID */
  requestId: string
  /** User identifier (if authenticated) */
  userId?: string
  /** Active session/conversation ID */
  sessionId?: string
  /** Request start timestamp (Unix ms) */
  startTime: number
}

/**
 * Pipeline context passed through all processing stages
 */
export interface PipelineContext extends TraceContext {
  /** Input message from user */
  input: PipelineInput
  /** Assembled memory context */
  memory?: AssembledContext
  /** Current crisis detection result */
  crisisCheck?: CrisisCheckResult
  /** Metrics for this pipeline execution */
  metrics: PipelineMetrics
}

/**
 * Metrics collected during pipeline execution
 */
export interface PipelineMetrics {
  /** Time spent in each stage (ms) */
  stageDurations: Record<string, number>
  /** Cache hit/miss info */
  cacheHits: number
  cacheMisses: number
  /** Memory tier that provided context */
  memoryTier?: 'L1_REDIS' | 'L2_POSTGRESQL' | 'L3_NEO4J_L4_QDRANT' | 'COMBINED'
  /** Total tokens used (input + output) */
  tokensUsed?: { input: number; output: number }
}

/**
 * Assembled context from multi-tier memory system
 */
export interface AssembledContext {
  /** Recent conversation messages */
  messages: Message[]
  /** User's long-term profile */
  userProfile: UserProfile | null
  /** Entities extracted from current session */
  sessionEntities: SessionEntities
  /** Current session state */
  sessionState: SessionState
  /** Summaries from previous sessions */
  previousSessions: SessionSummary[]
  /** Semantic search results */
  semanticMatches?: SemanticMatch[]
}

import type { Message, PipelineInput } from './messages.js'
import type { UserProfile, SessionEntities, SessionState, SessionSummary, SemanticMatch } from './memory.js'
import type { CrisisCheckResult } from './crisis.js'
