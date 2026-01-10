/**
 * MCP Tool Manager
 *
 * Manages connections to MCP (Model Context Protocol) servers and aggregates their tools.
 * Supports stdio transport for spawning local MCP server processes.
 */

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { getLogger } from "@pippa/observability";

// MCP tools have a slightly different type than ToolSet, so we use a flexible record type
// that's compatible with streamText's tools parameter
type MCPToolSet = Record<string, unknown>;

/**
 * Configuration for an MCP server
 */
export interface MCPServerConfig {
  /** Unique name for this server */
  name: string;
  /** Command to run (e.g., "npx") */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables for the process */
  env?: Record<string, string>;
  /** Working directory for the process */
  cwd?: string;
  /** Whether this server is enabled */
  enabled?: boolean;
}

/**
 * MCP JSON config file format (matches Claude Desktop format)
 */
export interface MCPConfigFile {
  mcpServers: Record<string, Omit<MCPServerConfig, "name">>;
}

interface MCPClientEntry {
  client: MCPClient;
  config: MCPServerConfig;
  tools: MCPToolSet;
}

/**
 * Manages MCP client connections and aggregates tools from all servers.
 */
export class MCPToolManager {
  private clients: Map<string, MCPClientEntry> = new Map();
  private logger = getLogger().child({ component: "MCPToolManager" });

  /**
   * Add and connect to an MCP server.
   * Tools from the server will be available via getTools().
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      this.logger.warn(
        { name: config.name },
        "MCP server already connected, skipping"
      );
      return;
    }

    this.logger.info(
      { name: config.name, command: config.command, args: config.args },
      "Connecting to MCP server"
    );

    try {
      // Create stdio transport for spawning the MCP server process
      const transport = new Experimental_StdioMCPTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });

      // Create MCP client with the transport
      const client = await createMCPClient({ transport });

      // Get tools from the server
      const tools = await client.tools();

      // Store the client and its tools
      this.clients.set(config.name, { client, config, tools });

      const toolNames = Object.keys(tools);
      this.logger.info(
        { name: config.name, toolCount: toolNames.length, tools: toolNames },
        "MCP server connected"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        { name: config.name, error: errorMessage },
        "Failed to connect to MCP server"
      );
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server and remove its tools.
   */
  async removeServer(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) {
      this.logger.warn({ name }, "MCP server not found");
      return;
    }

    this.logger.info({ name }, "Disconnecting from MCP server");

    try {
      await entry.client.close();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { name, error: errorMessage },
        "Error closing MCP client"
      );
    }

    this.clients.delete(name);
  }

  /**
   * Get all tools from all connected MCP servers.
   * Tool names are prefixed with server name to avoid collisions.
   */
  getTools(): MCPToolSet {
    const allTools: MCPToolSet = {};

    for (const [serverName, entry] of this.clients) {
      for (const [toolName, tool] of Object.entries(entry.tools)) {
        // Prefix tool names with server name to avoid collisions
        // e.g., "fetch.fetch_url" or just use the tool name if unique
        const prefixedName = `${serverName}_${toolName}`;
        allTools[prefixedName] = tool;
      }
    }

    return allTools;
  }

  /**
   * Get tools without server name prefix (use when you only have one server)
   */
  getToolsUnprefixed(): MCPToolSet {
    const allTools: MCPToolSet = {};

    for (const entry of this.clients.values()) {
      for (const [toolName, tool] of Object.entries(entry.tools)) {
        allTools[toolName] = tool;
      }
    }

    return allTools;
  }

  /**
   * Get the number of connected servers
   */
  get serverCount(): number {
    return this.clients.size;
  }

  /**
   * Get names of all connected servers
   */
  get serverNames(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Shutdown all MCP connections.
   * Should be called when the application is shutting down.
   */
  async shutdown(): Promise<void> {
    this.logger.info(
      { serverCount: this.clients.size },
      "Shutting down MCP connections"
    );

    const closePromises: Promise<void>[] = [];

    for (const [name, entry] of this.clients) {
      closePromises.push(
        entry.client.close().catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            { name, error: errorMessage },
            "Error closing MCP client during shutdown"
          );
        })
      );
    }

    await Promise.all(closePromises);
    this.clients.clear();

    this.logger.info("MCP connections shutdown complete");
  }
}
