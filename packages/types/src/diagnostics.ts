/**
 * CLI Diagnostics Types
 *
 * Comprehensive diagnostic information for pipeline processing.
 * Used by CLI to display detailed metrics about message processing.
 */

/**
 * Timing diagnostics - breakdown of pipeline stage durations
 */
export interface TimingDiagnostics {
  /** Total pipeline duration (ms) */
  totalDuration: number
  /** Crisis detection duration (ms) */
  crisisDuration: number
  /** Memory retrieval duration (ms) */
  memoryDuration: number
  /** Agent/LLM processing duration (ms) */
  agentDuration: number
  /** Message persistence duration (ms) */
  persistDuration: number
  /** Safety validation duration (ms) */
  safetyDuration?: number
  /** Evaluation duration (ms) */
  evaluationDuration?: number
}

/**
 * Crisis detection diagnostics
 */
export interface CrisisDiagnostics {
  /** Final crisis level (1-10) */
  level: number
  /** Whether emergency was triggered */
  emergencyTriggered: boolean
  /** Detected crisis patterns */
  patterns: Array<{
    type: string
    confidence: number
    matchedText?: string
  }>
  /** Recommended action */
  action: string
  /** Processing time (ms) */
  processingTimeMs: number
}

/**
 * Memory system diagnostics
 */
export interface MemoryDiagnostics {
  /** Cache hit count */
  cacheHits: number
  /** Cache miss count */
  cacheMisses: number
  /** Number of messages retrieved from L2 */
  messagesRetrieved: number
  /** Whether user profile was loaded */
  userProfileLoaded: boolean
  /** Number of previous session summaries loaded */
  previousSessionsCount: number
  /** Number of semantic matches found */
  semanticMatchesCount: number
  /** Retrieval latency (ms) */
  latencyMs: number
  /** L5 memory deduplication stats */
  l5Dedup?: {
    /** Duration of deduplication (ms) */
    durationMs: number
    /** Number of raw memories before dedup */
    rawCount: number
    /** Number of memories after dedup */
    dedupCount: number
  }
}

/**
 * Agent/LLM processing diagnostics
 */
export interface AgentDiagnostics {
  /** Model used for generation */
  model: string
  /** Input token count */
  inputTokens: number
  /** Output token count */
  outputTokens: number
  /** Tool calls made during generation */
  toolCalls: Array<{
    name: string
    arguments: Record<string, unknown>
    result?: unknown
  }>
  /** Why generation stopped */
  stopReason: string
  /** Number of agentic loop iterations */
  stepsCount: number
}

/**
 * Safety validation diagnostics
 */
export interface SafetyDiagnostics {
  /** Whether output passed safety validation */
  passed: boolean
  /** Safety violations detected */
  violations: Array<{
    type: string
    severity: string
    description: string
  }>
  /** Processing time (ms) */
  processingTimeMs: number
}

/**
 * Response evaluation diagnostics
 */
export interface EvaluationDiagnostics {
  /** Quality score (0-1) */
  qualityScore: number
  /** Relevance to user query (0-1) */
  relevanceScore: number
  /** Empathy in response (0-1) */
  empathyScore: number
  /** Recovery appropriateness (0-1) */
  recoveryScore: number
  /** Overall weighted score (0-1) */
  overallScore: number
  /** Optional feedback text */
  feedback?: string
}

/**
 * Complete diagnostics bundle
 */
export interface PipelineDiagnostics {
  timing: TimingDiagnostics
  crisis: CrisisDiagnostics
  memory: MemoryDiagnostics
  agent: AgentDiagnostics
  safety?: SafetyDiagnostics
  evaluation?: EvaluationDiagnostics
}
