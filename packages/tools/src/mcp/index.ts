/**
 * MCP (Model Context Protocol) Integration
 *
 * Provides support for connecting to MCP servers and using their tools.
 */

// Manager
export { MCPToolManager } from "./MCPToolManager.js";
export type {
  MCPServerConfig,
  MCPServerConfigStdio,
  MCPServerConfigHttp,
  MCPServerConfigRaw,
  MCPConfigFile,
} from "./MCPToolManager.js";

// Provider
export {
  setMcpToolManager,
  getMcpTools,
  getMcpToolsPrefixed,
  hasMcpTools,
  getMcpServerCount,
  getMcpServerNames,
  getMcpServerDescriptions,
  shutdownMcpTools,
  getMcpManager,
} from "./provider.js";

// Config
export { loadMcpConfig, isMcpEnabled } from "./config.js";
