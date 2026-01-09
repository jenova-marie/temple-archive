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
  MessageTurn,
  StoreErrorKind,
  StoreError,
  IContextStore,
  ISessionStore,
  IVectorStore,
  VectorSearchOptions,
  IArchiveStore,
  ArchivedConversation,
  ArchiveListItem,
  // MCP-compatible Memory types
  MemoryType,
  MemoryRelationType,
  MemoryRelationSource,
  Observation,
  RecoverySubtype,
  BaseMemoryMetadata,
  PersonMetadata,
  MedicationMetadata,
  TriggerMetadata,
  CopingStrategyMetadata,
  MilestoneMetadata,
  EmotionMetadata,
  EventMetadata,
  MemoryMetadata,
  Memory,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryRelation,
  MemorySearchOptions,
  MemoryWithRelations,
  IMemoryStore,
  // Legacy (deprecated)
  IKnowledgeStore,
  Entity,
  // L3 Memory Cadillac types
  CanonicalType,
  SourceEntry,
  L3Entity,
  L3Observation,
  L3Relationship,
  L3EntityWithObservations,
  EnrichedL3Entity,
  ConversationContext,
  ScoredL3Entity,
  L3RetrievalOptions,
  L3RetrievalResult,
  // L5 Mem0 types (primary memory system)
  Mem0Message,
  AddMemoryOptions,
  AddMemoryResponse,
  Mem0AddResult,
  Mem0AddRawResponse,
  SearchMemoryOptions,
  Mem0Memory,
  Mem0SearchResult,
  GetMemoriesOptions,
  IMem0Store,
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
  EmbeddingOptions,
  IEmbeddingProvider,
  SafetyError,
  SafetyValidationResult,
  ISafetyValidator,
  EvaluationResult,
  EvaluationError,
  IEvaluator,
} from './providers.js'

// Diagnostics types
export type {
  TimingDiagnostics,
  CrisisDiagnostics,
  MemoryDiagnostics,
  AgentDiagnostics,
  SafetyDiagnostics,
  EvaluationDiagnostics,
  PipelineDiagnostics,
} from './diagnostics.js'

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
