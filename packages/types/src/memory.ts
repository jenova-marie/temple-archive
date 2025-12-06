import type { Message } from './messages.js'
import type { TraceContext } from './context.js'
import type { Result } from './result.js'

/**
 * User's long-term profile stored in L2
 */
export interface UserProfile {
  /** User identifier */
  userId: string
  /** Recovery phase (early, middle, maintenance) */
  recoveryPhase?: string
  /** Sobriety date (if applicable) */
  sobrietyDate?: string
  /** Known triggers */
  triggers: string[]
  /** Effective coping strategies */
  copingStrategies: string[]
  /** User preferences */
  preferences: UserPreferences
  /** Achieved milestones */
  milestones: Milestone[]
  /** Last profile update timestamp */
  lastUpdated: number
}

/**
 * User preferences for communication and support
 */
export interface UserPreferences {
  /** Preferred communication tone */
  tone?: 'formal' | 'casual' | 'supportive' | 'direct'
  /** Topics user prefers to discuss */
  preferredTopics?: string[]
  /** Topics to avoid */
  avoidTopics?: string[]
  /** Preferred response length */
  responseLength?: 'brief' | 'moderate' | 'detailed'
}

/**
 * A milestone in the user's journey
 */
export interface Milestone {
  /** Milestone identifier */
  id: string
  /** Achievement description */
  achievement: string
  /** Date achieved */
  date: string
  /** Category of milestone */
  category?: string
}

/**
 * Entities extracted from the current session
 */
export interface SessionEntities {
  /** People mentioned */
  people: string[]
  /** Places mentioned */
  places: string[]
  /** Events mentioned */
  events: string[]
  /** Emotions expressed */
  emotions: string[]
  /** Medications mentioned (if any) */
  medications: string[]
}

/**
 * Current session state
 */
export interface SessionState {
  /** Session start timestamp */
  startTime: number
  /** Last activity timestamp */
  lastActivity: number
  /** Message count in session */
  messageCount: number
  /** Current topic of discussion */
  currentTopic?: string
  /** Current crisis level (1-10) */
  crisisLevel: number
  /** Emotional trend */
  emotionalTrend?: 'improving' | 'stable' | 'declining'
  /** Inferred conversation goal */
  conversationGoal?: string
}

/**
 * Summary of a previous session
 */
export interface SessionSummary {
  /** Summary identifier */
  summaryId: string
  /** Conversation ID this summarizes */
  conversationId: string
  /** Time range covered */
  timeRange: { start: number; end: number }
  /** Summary text */
  summaryText: string
  /** Key topics discussed */
  keyTopics: string[]
  /** Entities mentioned */
  entitiesMentioned: string[]
  /** Created timestamp */
  createdAt: number
}

/**
 * Result from semantic search
 */
export interface SemanticMatch {
  /** Message or document ID */
  id: string
  /** Similarity score (0-1) */
  score: number
  /** Content matched */
  content: string
  /** Source metadata */
  metadata: {
    conversationId?: string
    timestamp?: number
    role?: string
  }
}

// ============================================================================
// Provider Interfaces
// ============================================================================

/**
 * Error types for store operations
 */
export type StoreErrorKind =
  | 'ConnectionError'
  | 'TimeoutError'
  | 'SerializationError'
  | 'NotFoundError'
  | 'ValidationError'
  | 'UnexpectedError'

/**
 * Store operation error
 */
export interface StoreError {
  kind: StoreErrorKind
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * L1 Context Store interface (Redis)
 */
export interface IContextStore {
  /** Get session context */
  get(sessionId: string, ctx: TraceContext): Promise<Result<SessionState | null, StoreError>>
  /** Set session context */
  set(sessionId: string, context: SessionState, ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Delete session context */
  delete(sessionId: string, ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Get recent messages */
  getRecentMessages(sessionId: string, limit: number, ctx: TraceContext): Promise<Result<Message[], StoreError>>
  /** Store a message */
  storeMessage(message: Message, ctx: TraceContext): Promise<Result<void, StoreError>>
}

/**
 * L2 Session Store interface (PostgreSQL)
 */
export interface ISessionStore {
  /** Get conversation history */
  getConversationHistory(conversationId: string, limit: number, ctx: TraceContext): Promise<Result<Message[], StoreError>>
  /** Store message with optional embedding */
  storeMessage(message: Message, embedding: number[] | null, ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Semantic search in conversation */
  semanticSearch(
    conversationId: string,
    queryEmbedding: number[],
    options: { limit?: number; daysBack?: number },
    ctx: TraceContext
  ): Promise<Result<Array<Message & { similarity: number }>, StoreError>>
  /** Get user profile */
  getUserProfile(userId: string, ctx: TraceContext): Promise<Result<UserProfile | null, StoreError>>
  /** Update user profile */
  updateUserProfile(userId: string, updates: Partial<UserProfile>, ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Get session summaries */
  getSessionSummaries(conversationId: string, limit: number, ctx: TraceContext): Promise<Result<SessionSummary[], StoreError>>
  /** Store session summary */
  storeSummary(summary: Omit<SessionSummary, 'summaryId' | 'createdAt'>, ctx: TraceContext): Promise<Result<string, StoreError>>
}

/**
 * L3 Knowledge Store interface (Neo4j)
 */
export interface IKnowledgeStore {
  /** Create or update an entity */
  upsertEntity(entity: Entity, ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Create a relationship between entities */
  createRelationship(
    fromEntity: string,
    toEntity: string,
    relationshipType: string,
    properties: Record<string, unknown>,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>>
  /** Query related entities */
  getRelatedEntities(entityName: string, hops: number, ctx: TraceContext): Promise<Result<Entity[], StoreError>>
  /** Search entities by pattern */
  searchEntities(pattern: string, ctx: TraceContext): Promise<Result<Entity[], StoreError>>
}

/**
 * Entity in the knowledge graph
 */
export interface Entity {
  /** Entity identifier */
  entityId: string
  /** Entity name */
  name: string
  /** Entity type (Person, Event, Concept, etc.) */
  type: string
  /** First mentioned timestamp */
  firstMentioned: number
  /** Last mentioned timestamp */
  lastMentioned: number
  /** Additional properties */
  properties?: Record<string, unknown>
}

/**
 * L4 Vector Store interface (Qdrant)
 */
export interface IVectorStore {
  /** Index a message with its embedding */
  indexMessage(message: Message, embedding: number[], ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Batch index messages */
  batchIndex(messages: Message[], embeddings: number[][], ctx: TraceContext): Promise<Result<void, StoreError>>
  /** Semantic search */
  search(
    queryEmbedding: number[],
    options: VectorSearchOptions,
    ctx: TraceContext
  ): Promise<Result<SemanticMatch[], StoreError>>
  /** Delete old vectors */
  prune(olderThanDays: number, ctx: TraceContext): Promise<Result<number, StoreError>>
}

/**
 * Options for vector search
 */
export interface VectorSearchOptions {
  /** Filter by user */
  userId?: string
  /** Filter by conversation */
  conversationId?: string
  /** Days to search back */
  daysBack?: number
  /** Exclude crisis levels */
  excludeCrisisLevels?: number[]
  /** Required topics */
  requiredTopics?: string[]
  /** Result limit */
  limit?: number
  /** Minimum similarity score */
  scoreThreshold?: number
}

/**
 * Archive Store interface (S3)
 */
export interface IArchiveStore {
  /** Archive a conversation */
  archiveConversation(conversation: ArchivedConversation, ctx: TraceContext): Promise<Result<string, StoreError>>
  /** Retrieve an archived conversation */
  getArchivedConversation(key: string, ctx: TraceContext): Promise<Result<ArchivedConversation, StoreError>>
  /** List archived conversations for a user */
  listArchives(userId: string, options: { limit?: number; after?: string }, ctx: TraceContext): Promise<Result<ArchiveListItem[], StoreError>>
}

/**
 * Archived conversation structure
 */
export interface ArchivedConversation {
  conversationId: string
  userId: string
  messages: Message[]
  summary?: string
  metadata: Record<string, unknown>
  archivedAt: number
}

/**
 * Item in archive listing
 */
export interface ArchiveListItem {
  key: string
  conversationId: string
  archivedAt: number
  size: number
}
