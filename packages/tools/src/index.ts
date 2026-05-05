// Agent tools
export { logMood, agentTools } from "./definitions.js";

// Mem0 tools (L5 - primary memory system)
export {
  searchMemories,
  listMemories,
  rememberThis,
  forgetThis,
  mem0Tools,
  readOnlyMem0Tools,
  getMem0Tools,
  getReadOnlyMem0Tools,
  setMem0ToolStore,
  setMem0ToolTraceContext,
  clearMem0ToolTraceContext,
} from "./mem0Tools.js";

// RAG tools (read-only consumer of ninshubur's wisdom archive)
export {
  searchKnowledge,
  ragTools,
  getRagTools,
  setRagToolStore,
  setRagToolTraceContext,
  clearRagToolTraceContext,
} from "./ragTools.js";

// Legacy L3/L4 memory tools (kept for hybrid mode)
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

// MCP (Model Context Protocol) tools
export {
  MCPToolManager,
  type MCPServerConfig,
  type MCPServerConfigStdio,
  type MCPServerConfigHttp,
  type MCPConfigFile,
  setMcpToolManager,
  getMcpTools,
  getMcpToolsPrefixed,
  hasMcpTools,
  getMcpServerCount,
  getMcpServerNames,
  getMcpServerDescriptions,
  shutdownMcpTools,
  getMcpManager,
  loadMcpConfig,
  isMcpEnabled,
} from "./mcp/index.js";
