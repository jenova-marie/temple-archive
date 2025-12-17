// Recovery tools (mood, crisis, resources)
export {
  logMood,
  getCrisisResources,
  getResources,
  recoveryTools,
} from "./definitions.js";

// Meeting tools
export {
  findMeetings,
  getLiveMeetings,
  meetingTools,
} from "./meetingTools.js";

// Meeting client
export {
  MeetingClient,
  getMeetingClient,
  resetMeetingClient,
  type Meeting,
  type LiveMeetingsResponse,
  type ScheduleResponse,
  type Periodicity,
  type MeetingClientConfig,
} from "./clients/index.js";

// Literature tools for searching recovery literature
export {
  searchLiterature,
  getLiteraturePassage,
  listLiterature,
  literatureTools,
  setLiteratureRepository,
  setLiteratureQdrantStore,
  setLiteratureEmbeddingProvider,
  setLiteratureToolsConfig,
  setLiteratureTraceContext,
  clearLiteratureTraceContext,
  clearLiteratureRepository,
  type LiteratureToolsConfig,
} from "./literatureTools.js";

// Memory tools for Claude to interact with Neo4j knowledge graph
export {
  recallMemory,
  searchEntities,
  getRelatedEntities,
  saveNote,
  logObservation,
  updateEntity,
  deleteEntity,
  createRelationship,
  clearMemoryCache,
  readOnlyMemoryTools,
  writeMemoryTools,
  fullMemoryTools,
  getMemoryTools,
  setMemoryToolProviders,
  setMemoryToolKnowledgeStore,
  setMemoryToolTraceContext,
  clearMemoryToolTraceContext,
  setBootstrapOrchestrator,
  type MemoryToolAccessLevel,
} from "./memoryTools.js";

// System tools for dynamic prompt updates and conversation management
export {
  refreshSystemPrompt,
  clearConversation,
  systemPromptTools,
  setSystemPromptRefreshFn,
  setClearConversationFn,
  setGetConversationIdFn,
  clearSystemPromptRefreshFn,
  clearSystemToolFunctions,
} from "./systemPromptTools.js";
