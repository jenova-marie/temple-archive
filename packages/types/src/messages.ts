/**
 * Role in the conversation
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * A message in the conversation
 */
export interface Message {
  /** Unique message identifier */
  id: string
  /** Conversation/session this message belongs to */
  conversationId: string
  /** User who owns this conversation */
  userId: string
  /** Role of the message sender */
  role: MessageRole
  /** Message content */
  content: string
  /** Timestamp in Unix milliseconds */
  timestamp: number
  /** Optional metadata */
  metadata?: MessageMetadata
}

/**
 * Message metadata for tracking and filtering
 */
export interface MessageMetadata {
  /** Detected entities in this message */
  entities?: string[]
  /** Topics discussed */
  topics?: string[]
  /** Crisis level at time of message (1-10) */
  crisisLevel?: number
  /** Detected sentiment (-1 to 1) */
  sentiment?: number
  /** User agent or platform */
  userAgent?: string
  /** Any tool calls made */
  toolCalls?: ToolCall[]
}

/**
 * A tool call made by the assistant
 */
export interface ToolCall {
  /** Tool identifier */
  toolId: string
  /** Tool name */
  name: string
  /** Arguments passed to tool */
  arguments: Record<string, unknown>
  /** Tool result (if available) */
  result?: unknown
}

/**
 * Streaming chunk during response generation
 */
export interface StreamChunk {
  /** Chunk type */
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
  /** Text content (for type='text') */
  content?: string
  /** Tool call info (for type='tool_call') */
  toolCall?: Partial<ToolCall>
  /** Error message (for type='error') */
  error?: string
  /** Metadata about the stream */
  metadata?: {
    /** Current crisis level */
    crisisLevel?: number
    /** Whether emergency response was triggered */
    emergencyTriggered?: boolean
  }
}

import type { UserProfile } from './memory.js'

/**
 * Input to the pipeline
 */
export interface PipelineInput {
  /** User's message content */
  message: string
  /** Conversation ID */
  conversationId: string
  /** User ID */
  userId: string
  /** Optional session metadata */
  sessionMetadata?: Record<string, unknown>
  /** Optional system prompt ID to use instead of default base-identity */
  systemPromptId?: string
  /** Pre-loaded user profile (loaded once per request, passed through) */
  userProfile?: UserProfile | null
  /** User's display name from JWT (for personalization) */
  displayName?: string
}

import type { PipelineDiagnostics } from './diagnostics.js'

/**
 * Result from pipeline processing
 */
export interface PipelineResult {
  /** Generated response */
  response: string
  /** Message objects created */
  messages: {
    user: Message
    assistant: Message
  }
  /** Pipeline execution metrics */
  metrics: PipelineResultMetrics
  /** Any safety violations detected */
  safetyViolations?: SafetyViolation[]
  /** Final crisis level */
  crisisLevel: number
  /** Whether emergency response was triggered */
  emergencyTriggered: boolean
  /** Full diagnostic information (for CLI/debugging) */
  diagnostics?: PipelineDiagnostics
}

/**
 * Metrics returned with pipeline result
 */
export interface PipelineResultMetrics {
  /** Total pipeline duration (ms) */
  totalDuration: number
  /** Memory retrieval duration (ms) */
  memoryDuration: number
  /** Agent processing duration (ms) */
  agentDuration: number
  /** Tokens used */
  tokensUsed: { input: number; output: number }
  /** Memory source */
  memorySource: string
}

/**
 * Safety violation detected in output
 */
export interface SafetyViolation {
  /** Type of violation */
  type: 'pii' | 'medical_advice' | 'enabling_language' | 'harmful_content'
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical'
  /** Description of the violation */
  description: string
  /** Position in output where violation was detected */
  position?: { start: number; end: number }
}
