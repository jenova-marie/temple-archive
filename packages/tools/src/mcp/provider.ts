/**
 * MCP Tool Provider
 *
 * Provider pattern for accessing MCP tools from the MCPToolManager.
 * Matches the existing pattern used by memory tools and other tool providers.
 */

import type { MCPToolManager } from "./MCPToolManager.js";

// MCP tools have a slightly different type than ToolSet, so we use a flexible record type
type MCPToolSet = Record<string, unknown>;

let mcpManager: MCPToolManager | null = null;

/**
 * Set the MCP tool manager instance.
 * Should be called during container initialization.
 */
export function setMcpToolManager(manager: MCPToolManager): void {
  mcpManager = manager;
}

/**
 * Get all MCP tools from connected servers.
 * Returns empty object if no manager is set or no servers are connected.
 */
export function getMcpTools(): MCPToolSet {
  return mcpManager?.getToolsUnprefixed() ?? {};
}

/**
 * Get all MCP tools with server name prefixes (for multi-server scenarios).
 * Tool names will be prefixed like "servername_toolname".
 */
export function getMcpToolsPrefixed(): MCPToolSet {
  return mcpManager?.getTools() ?? {};
}

/**
 * Check if MCP tools are available.
 */
export function hasMcpTools(): boolean {
  return mcpManager !== null && mcpManager.serverCount > 0;
}

/**
 * Get the number of connected MCP servers.
 */
export function getMcpServerCount(): number {
  return mcpManager?.serverCount ?? 0;
}

/**
 * Get names of connected MCP servers.
 */
export function getMcpServerNames(): string[] {
  return mcpManager?.serverNames ?? [];
}

/**
 * Get descriptions of connected MCP servers for system prompt injection.
 * Only returns servers that have descriptions configured.
 */
export function getMcpServerDescriptions(): Array<{ name: string; description: string; tools: string[] }> {
  return mcpManager?.getServerDescriptions() ?? [];
}

/**
 * Shutdown all MCP connections.
 * Should be called when the application is shutting down.
 */
export async function shutdownMcpTools(): Promise<void> {
  if (mcpManager) {
    await mcpManager.shutdown();
    mcpManager = null;
  }
}

/**
 * Get the MCP manager instance (for advanced use cases).
 */
export function getMcpManager(): MCPToolManager | null {
  return mcpManager;
}
