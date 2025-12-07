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

// ============================================================================
// MCP-Compatible Memory Schema
// ============================================================================

/**
 * Memory types aligned with MCP memory schema.
 * These are generic categories that work across domains.
 */
export type MemoryType =
  | 'knowledge'       // Facts, information, people, places, things
  | 'pattern'         // Recurring behaviors, triggers, coping strategies
  | 'decision'        // Choices made, milestones, commitments
  | 'issue'           // Problems, emotions, events requiring attention
  | 'insight'         // Observations, learnings, realizations
  | 'implementation'  // Technical details, how things work
  | 'architecture'    // System structure, design patterns

/**
 * Standard relationship types for memory connections.
 * Maps to MCP relation types with recovery-specific extensions.
 */
export type MemoryRelationType =
  | 'INFLUENCES'      // A influences B
  | 'DEPENDS_ON'      // A depends on B
  | 'EXTENDS'         // A extends/builds on B
  | 'IMPLEMENTS'      // A implements B
  | 'CONTAINS'        // A contains B
  | 'TRIGGERS'        // A triggers B (recovery domain)
  | 'HELPS_WITH'      // A helps with B (recovery domain)
  | 'MENTIONED_WITH'  // A was mentioned alongside B

/**
 * Source of a memory relation
 */
export type MemoryRelationSource = 'agent' | 'user' | 'system'

/**
 * An observation attached to a memory.
 * Observations are rich narrative descriptions that provide context.
 * One observation per significant insight (not per message).
 */
export interface Observation {
  /** Unique observation ID */
  id: string
  /** Rich narrative content describing the observation */
  content: string
  /** When this observation was recorded */
  createdAt: number
}

/**
 * Recovery domain subtypes for metadata.
 * These map MCP generic types to recovery-specific concepts.
 */
export type RecoverySubtype =
  | 'person'           // knowledge: People (sponsor, therapist, family)
  | 'place'            // knowledge: Locations (meetings, rehab, safe spaces)
  | 'medication'       // knowledge: Medications (MAT, psychiatric)
  | 'trigger'          // pattern: Addiction triggers
  | 'coping_strategy'  // pattern: Coping mechanisms
  | 'milestone'        // decision: Recovery achievements
  | 'emotion'          // issue: Emotional states
  | 'event'            // issue: Significant events

/**
 * Base metadata interface for all memories.
 * Domain-specific fields extend this.
 */
export interface BaseMemoryMetadata {
  /** Domain identifier (always "recovery" for RecoverySky) */
  domain?: string
  /** Recovery-specific subtype */
  subtype?: RecoverySubtype
  /** User who owns this memory */
  userId?: string
  /** Importance score 0-1 */
  importance?: number
  /** Custom tags */
  tags?: string[]
}

/**
 * Person metadata (knowledge:person)
 */
export interface PersonMetadata extends BaseMemoryMetadata {
  subtype: 'person'
  /** Role in user's recovery */
  role?: 'sponsor' | 'therapist' | 'family' | 'friend' | 'doctor' | 'peer'
  /** Relationship description */
  relationship?: string
  /** Trust level 0-1 */
  trustLevel?: number
  /** How often they interact */
  contactFrequency?: string
}

/**
 * Medication metadata (knowledge:medication)
 */
export interface MedicationMetadata extends BaseMemoryMetadata {
  subtype: 'medication'
  /** Medication category */
  category?: 'MAT' | 'psychiatric' | 'other'
  /** Dosage information */
  dosage?: string
  /** Frequency of use */
  frequency?: string
  /** Prescribing doctor */
  prescriber?: string
}

/**
 * Trigger metadata (pattern:trigger)
 */
export interface TriggerMetadata extends BaseMemoryMetadata {
  subtype: 'trigger'
  /** Trigger category */
  category?: 'emotional' | 'environmental' | 'social' | 'physical'
  /** Severity 1-10 */
  severity?: number
  /** How often encountered */
  frequency?: string
  /** Known coping strategies that help */
  copingStrategies?: string[]
}

/**
 * Coping strategy metadata (pattern:coping_strategy)
 */
export interface CopingStrategyMetadata extends BaseMemoryMetadata {
  subtype: 'coping_strategy'
  /** Effectiveness 0-1 */
  effectiveness?: number
  /** Types of triggers this helps with */
  triggerTypes?: string[]
  /** How this was learned */
  learned?: 'program' | 'therapy' | 'self' | 'peer'
}

/**
 * Milestone metadata (decision:milestone)
 */
export interface MilestoneMetadata extends BaseMemoryMetadata {
  subtype: 'milestone'
  /** Days of sobriety at milestone */
  sobrietyDays?: number
  /** Milestone category */
  category?: 'sobriety' | 'program' | 'personal' | 'health'
  /** Date achieved */
  date?: string
}

/**
 * Emotion metadata (issue:emotion)
 */
export interface EmotionMetadata extends BaseMemoryMetadata {
  subtype: 'emotion'
  /** Emotional valence */
  valence?: 'positive' | 'negative' | 'neutral'
  /** Intensity 1-10 */
  intensity?: number
  /** Associated triggers */
  associatedTriggers?: string[]
}

/**
 * Event metadata (issue:event)
 */
export interface EventMetadata extends BaseMemoryMetadata {
  subtype: 'event'
  /** Event date */
  date?: string
  /** Impact on recovery: positive, negative, neutral */
  impact?: 'positive' | 'negative' | 'neutral'
  /** People involved */
  peopleInvolved?: string[]
}

/**
 * Union of all memory metadata types
 */
export type MemoryMetadata =
  | BaseMemoryMetadata
  | PersonMetadata
  | MedicationMetadata
  | TriggerMetadata
  | CopingStrategyMetadata
  | MilestoneMetadata
  | EmotionMetadata
  | EventMetadata

/**
 * A Memory in the knowledge graph (MCP-compatible).
 * This is the core unit of knowledge storage.
 */
export interface Memory {
  /** Unique memory ID */
  id: string
  /** Human-readable name/title */
  name: string
  /** MCP memory type */
  memoryType: MemoryType
  /** Flexible metadata (domain-specific schema) */
  metadata: MemoryMetadata
  /** Observations attached to this memory */
  observations: Observation[]
  /** When this memory was created */
  createdAt: number
  /** When this memory was last modified */
  modifiedAt: number
  /** When this memory was last accessed (for analytics) */
  lastAccessed: number
}

/**
 * Input for creating a new memory (without auto-generated fields)
 */
export interface CreateMemoryInput {
  /** Human-readable name */
  name: string
  /** MCP memory type */
  memoryType: MemoryType
  /** Flexible metadata */
  metadata?: MemoryMetadata
  /** Initial observations */
  observations?: string[]
}

/**
 * Input for updating a memory
 */
export interface UpdateMemoryInput {
  /** New name (optional) */
  name?: string
  /** New memory type (optional) */
  memoryType?: MemoryType
  /** Updated metadata (merged with existing) */
  metadata?: Partial<MemoryMetadata>
}

/**
 * A relation between two memories
 */
export interface MemoryRelation {
  /** Source memory ID */
  from: string
  /** Target memory ID */
  to: string
  /** Relation type */
  type: MemoryRelationType | string
  /** Relation strength 0.1-1.0 */
  strength: number
  /** Who created this relation */
  source: MemoryRelationSource
  /** When this relation was created */
  createdAt: number
}

/**
 * Options for searching memories
 */
export interface MemorySearchOptions {
  /** Filter by memory types */
  memoryTypes?: MemoryType[]
  /** Filter by user ID */
  userId?: string
  /** Filter by metadata subtype */
  subtype?: RecoverySubtype
  /** Filter by domain */
  domain?: string
  /** Created after this timestamp */
  createdAfter?: number
  /** Created before this timestamp */
  createdBefore?: number
  /** Maximum results */
  limit?: number
  /** Minimum relevance score */
  scoreThreshold?: number
}

/**
 * Memory with related memories included
 */
export interface MemoryWithRelations extends Memory {
  /** Related memories discovered by traversal */
  related: {
    /** Memories this one connects to */
    descendants: Array<Memory & { relation: MemoryRelation; distance: number }>
    /** Memories that connect to this one */
    ancestors: Array<Memory & { relation: MemoryRelation; distance: number }>
  }
}

/**
 * L3 Memory Store interface (Neo4j) - MCP Compatible
 * Replaces IKnowledgeStore with MCP-aligned structure.
 */
export interface IMemoryStore {
  // ============================================================================
  // Core CRUD Operations
  // ============================================================================

  /**
   * Create a new memory
   */
  createMemory(
    input: CreateMemoryInput,
    ctx: TraceContext
  ): Promise<Result<Memory, StoreError>>

  /**
   * Get a memory by ID
   */
  getMemory(
    id: string,
    ctx: TraceContext
  ): Promise<Result<Memory | null, StoreError>>

  /**
   * Update an existing memory
   */
  updateMemory(
    id: string,
    updates: UpdateMemoryInput,
    ctx: TraceContext
  ): Promise<Result<Memory, StoreError>>

  /**
   * Delete a memory and its observations
   */
  deleteMemory(
    id: string,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>>

  // ============================================================================
  // Observation Operations
  // ============================================================================

  /**
   * Add an observation to a memory
   */
  addObservation(
    memoryId: string,
    content: string,
    ctx: TraceContext
  ): Promise<Result<Observation, StoreError>>

  /**
   * Get observations for a memory
   */
  getObservations(
    memoryId: string,
    ctx: TraceContext
  ): Promise<Result<Observation[], StoreError>>

  // ============================================================================
  // Relation Operations
  // ============================================================================

  /**
   * Create a relation between two memories
   */
  createRelation(
    from: string,
    to: string,
    type: MemoryRelationType | string,
    strength: number,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>>

  /**
   * Get relations for a memory
   */
  getRelations(
    memoryId: string,
    direction: 'outbound' | 'inbound' | 'both',
    ctx: TraceContext
  ): Promise<Result<MemoryRelation[], StoreError>>

  // ============================================================================
  // Search Operations
  // ============================================================================

  /**
   * Search memories by text query
   */
  searchMemories(
    query: string,
    options: MemorySearchOptions,
    ctx: TraceContext
  ): Promise<Result<Memory[], StoreError>>

  /**
   * Get related memories by graph traversal
   */
  getRelatedMemories(
    memoryId: string,
    depth: number,
    ctx: TraceContext
  ): Promise<Result<MemoryWithRelations, StoreError>>

  /**
   * Find memories by name (exact or pattern match)
   */
  findByName(
    name: string,
    ctx: TraceContext
  ): Promise<Result<Memory[], StoreError>>
}

// ============================================================================
// Legacy Types (Deprecated - for backwards compatibility during migration)
// ============================================================================

/**
 * @deprecated Use IMemoryStore instead
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
 * @deprecated Use Memory instead
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
