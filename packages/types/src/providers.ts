import type { StreamChunk, ToolCall } from './messages.js'
import type { AssembledContext, TraceContext } from './context.js'
import type { CrisisCheckResult } from './crisis.js'
import type { Result } from './result.js'

/**
 * Agent provider error
 */
export interface AgentError {
  kind: 'ProviderError' | 'RateLimitError' | 'ContextLengthError' | 'TimeoutError' | 'ToolError' | 'UnexpectedError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * Agent provider interface
 */
export interface IAgentProvider {
  /**
   * Generate a response using the LLM
   */
  generate(
    input: AgentInput,
    ctx: TraceContext
  ): Promise<Result<AgentResponse, AgentError>>

  /**
   * Stream a response using the LLM
   */
  stream(
    input: AgentInput,
    ctx: TraceContext
  ): AsyncGenerator<StreamChunk, AgentResponse, unknown>
}

/**
 * Input to agent provider
 */
export interface AgentInput {
  /** User's message */
  userMessage: string
  /** Assembled context from memory */
  context: AssembledContext
  /** Crisis check result (for adjusting response) */
  crisisCheck?: CrisisCheckResult
  /** System prompt to use */
  systemPrompt: string
  /** Available tools */
  tools?: ToolDefinition[]
}

/**
 * Tool definition for agent
 */
export interface ToolDefinition {
  /** Tool name */
  name: string
  /** Tool description */
  description: string
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>
  /** Function to execute the tool */
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

/**
 * Response from agent provider
 */
export interface AgentResponse {
  /** Generated content */
  content: string
  /** Tool calls made */
  toolCalls: ToolCall[]
  /** Token usage */
  usage: {
    inputTokens: number
    outputTokens: number
  }
  /** Model used */
  model: string
  /** Stop reason */
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
}

/**
 * Embedding provider error
 */
export interface EmbeddingError {
  kind: 'ProviderError' | 'RateLimitError' | 'InputTooLongError' | 'UnexpectedError'
  message: string
  context: Record<string, unknown>
}

/**
 * Embedding provider interface
 */
export interface IEmbeddingProvider {
  /**
   * Generate embedding for a single text
   */
  embed(text: string, ctx: TraceContext): Promise<Result<number[], EmbeddingError>>

  /**
   * Generate embeddings for multiple texts
   */
  embedBatch(texts: string[], ctx: TraceContext): Promise<Result<number[][], EmbeddingError>>

  /**
   * Get the embedding dimension
   */
  readonly dimension: number
}

/**
 * Safety validator error
 */
export interface SafetyError {
  kind: 'ValidationError' | 'ConfigError' | 'UnexpectedError'
  message: string
  context: Record<string, unknown>
}

/**
 * Safety validation result
 */
export interface SafetyValidationResult {
  /** Whether the output passed validation */
  passed: boolean
  /** Violations found */
  violations: SafetyViolation[]
  /** Sanitized output (if violations were fixed) */
  sanitizedOutput?: string
  /** Processing time in ms */
  processingTimeMs: number
}

import type { SafetyViolation } from './messages.js'

/**
 * Safety validator interface
 */
export interface ISafetyValidator {
  /**
   * Validate output for safety issues
   */
  validate(
    output: string,
    context: AssembledContext,
    ctx: TraceContext
  ): Promise<Result<SafetyValidationResult, SafetyError>>
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  /** Quality score (0-1) */
  qualityScore: number
  /** Relevance score (0-1) */
  relevanceScore: number
  /** Empathy score (0-1) */
  empathyScore: number
  /** Recovery appropriateness (0-1) */
  recoveryScore: number
  /** Overall score (0-1) */
  overallScore: number
  /** Detailed feedback */
  feedback?: string
}

/**
 * Evaluation error
 */
export interface EvaluationError {
  kind: 'EvaluationFailed' | 'TimeoutError' | 'UnexpectedError'
  message: string
  context: Record<string, unknown>
}

/**
 * Evaluator interface
 */
export interface IEvaluator {
  /**
   * Evaluate a response
   */
  evaluate(
    userMessage: string,
    assistantResponse: string,
    context: AssembledContext,
    ctx: TraceContext
  ): Promise<Result<EvaluationResult, EvaluationError>>
}
