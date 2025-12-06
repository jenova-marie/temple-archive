// Context types
export type {
  TraceContext,
  PipelineContext,
  PipelineMetrics,
  AssembledContext,
} from './context.js'

// Message types
export type {
  MessageRole,
  Message,
  MessageMetadata,
  ToolCall,
  StreamChunk,
  PipelineInput,
  PipelineResult,
  PipelineResultMetrics,
  SafetyViolation,
} from './messages.js'

// Memory types
export type {
  UserProfile,
  UserPreferences,
  Milestone,
  SessionEntities,
  SessionState,
  SessionSummary,
  SemanticMatch,
  StoreErrorKind,
  StoreError,
  IContextStore,
  ISessionStore,
  IKnowledgeStore,
  Entity,
  IVectorStore,
  VectorSearchOptions,
  IArchiveStore,
  ArchivedConversation,
  ArchiveListItem,
} from './memory.js'

// Crisis types
export type {
  CrisisLevel,
  CrisisPatternType,
  DetectedPattern,
  CrisisCheckResult,
  CrisisError,
  ICrisisDetector,
  ICrisisEvaluator,
  ICrisisHandler,
  CrisisHandlerResponse,
  CrisisResource,
} from './crisis.js'

// Pipeline types
export type {
  StageResult,
  PipelineError,
  IPipelineStage,
  PipelineConfig,
} from './pipeline.js'
export { getDefaultPipelineConfig } from './pipeline.js'

// Provider types
export type {
  AgentError,
  IAgentProvider,
  AgentInput,
  ToolDefinition,
  AgentResponse,
  EmbeddingError,
  IEmbeddingProvider,
  SafetyError,
  SafetyValidationResult,
  ISafetyValidator,
  EvaluationResult,
  EvaluationError,
  IEvaluator,
} from './providers.js'

// Result types
export type {
  Ok,
  Err,
  Result,
  DomainError,
} from './result.js'
export {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  toLogContext,
  toSpanAttributes,
  toMetricLabels,
} from './result.js'
