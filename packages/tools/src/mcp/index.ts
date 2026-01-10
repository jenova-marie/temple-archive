/**
 * MCP (Model Context Protocol) Integration
 *
 * Provides support for connecting to MCP servers and using their tools.
 */

// Manager
export { MCPToolManager } from "./MCPToolManager.js";
export type { MCPServerConfig, MCPConfigFile } from "./MCPToolManager.js";

// Provider
export {
  setMcpToolManager,
  getMcpTools,
  getMcpToolsPrefixed,
  hasMcpTools,
  getMcpServerCount,
  getMcpServerNames,
  shutdownMcpTools,
  getMcpManager,
} from "./provider.js";

// Config
export { loadMcpConfig, isMcpEnabled } from "./config.js";
