import type { PipelineContext } from './context.js'
import type { Result } from './result.js'

/**
 * Pipeline stage result
 */
export interface StageResult<T> {
  /** Stage output data */
  data: T
  /** Processing duration in ms */
  durationMs: number
  /** Whether stage should skip subsequent stages */
  skipRemaining?: boolean
  /** Metadata about stage execution */
  metadata?: Record<string, unknown>
}

/**
 * Pipeline stage error
 */
export interface PipelineError {
  kind: 'StageError' | 'TimeoutError' | 'ValidationError' | 'ConfigError' | 'UnexpectedError'
  message: string
  stage?: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * Generic pipeline stage interface
 */
export interface IPipelineStage<TInput, TOutput> {
  /** Stage name for logging/tracing */
  readonly name: string
  /** Execute the stage */
  execute(input: TInput, ctx: PipelineContext): Promise<Result<StageResult<TOutput>, PipelineError>>
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /** Whether to use stub implementations */
  useStubs: boolean
  /** Timeout for entire pipeline (ms) */
  timeoutMs: number
  /** Crisis detection thresholds */
  crisis: {
    /** Level at which to inject resources (default: 7) */
    highThreshold: number
    /** Level at which to trigger emergency (default: 9) */
    criticalThreshold: number
  }
  /** Memory configuration */
  memory: {
    /** Max messages to retrieve from L2 */
    l2MessageLimit: number
    /** Days back to search for semantic matches */
    semanticSearchDays: number
  }
  /** Agent configuration */
  agent: {
    /** LLM model to use */
    model: string
    /** Max tokens for response */
    maxTokens: number
    /** Temperature for generation */
    temperature: number
  }
}

/**
 * Default pipeline configuration
 */
export function getDefaultPipelineConfig(): PipelineConfig {
  return {
    useStubs: process.env.USE_STUBS === 'true',
    timeoutMs: 30000,
    crisis: {
      highThreshold: 7,
      criticalThreshold: 9,
    },
    memory: {
      l2MessageLimit: 50,
      semanticSearchDays: 90,
    },
    agent: {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.7,
    },
  }
}
