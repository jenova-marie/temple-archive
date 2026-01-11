/**
 * MCP Tool Manager
 *
 * Manages connections to MCP (Model Context Protocol) servers and aggregates their tools.
 * Supports stdio transport for spawning local MCP server processes.
 */

import { experimental_createMCPClient as createMCPClient, type experimental_MCPClient as MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { getLogger } from "@pippa/observability";

// MCP tools have a slightly different type than ToolSet, so we use a flexible record type
// that's compatible with streamText's tools parameter
type MCPToolSet = Record<string, unknown>;

/**
 * Configuration for a stdio-based MCP server (spawns a child process)
 */
export interface MCPServerConfigStdio {
  /** Unique name for this server */
  name: string;
  /** Transport type (default: stdio if command is present) */
  type?: "stdio";
  /** Command to run (e.g., "npx", "node") */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables for the process */
  env?: Record<string, string>;
  /** Working directory for the process */
  cwd?: string;
  /** Whether this server is enabled */
  enabled?: boolean;
  /** Description for the AI to know when/how to use this server's tools */
  description?: string;
}

/**
 * Configuration for an HTTP/SSE-based MCP server (connects to a URL)
 */
export interface MCPServerConfigHttp {
  /** Unique name for this server */
  name: string;
  /** Transport type */
  type: "http" | "sse";
  /** URL to connect to */
  url: string;
  /** Whether this server is enabled */
  enabled?: boolean;
  /** Description for the AI to know when/how to use this server's tools */
  description?: string;
}

/**
 * Union type for all MCP server configurations
 */
export type MCPServerConfig = MCPServerConfigStdio | MCPServerConfigHttp;

/**
 * Raw server config from mcp.json (before adding name)
 */
export type MCPServerConfigRaw = Omit<MCPServerConfigStdio, "name"> | Omit<MCPServerConfigHttp, "name">;

/**
 * MCP JSON config file format (matches Claude Desktop format)
 */
export interface MCPConfigFile {
  mcpServers: Record<string, MCPServerConfigRaw>;
}

/**
 * Type guard to check if config is stdio-based
 */
function isStdioConfig(config: MCPServerConfig): config is MCPServerConfigStdio {
  return "command" in config && typeof config.command === "string";
}

/**
 * Type guard to check if config is http-based
 */
function isHttpConfig(config: MCPServerConfig): config is MCPServerConfigHttp {
  return "url" in config && typeof config.url === "string";
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

    // Determine transport type and log appropriately
    const transportType = isHttpConfig(config) ? config.type : "stdio";
    const transportInfo = isHttpConfig(config)
      ? { url: config.url }
      : { command: config.command, args: config.args };

    this.logger.info(
      { name: config.name, transport: transportType, ...transportInfo },
      "Connecting to MCP server"
    );

    try {
      let client: MCPClient;

      if (isHttpConfig(config)) {
        // HTTP/SSE transport - connect to URL
        client = await createMCPClient({
          transport: {
            type: config.type === "http" ? "sse" : config.type, // Use SSE for http type
            url: config.url,
          },
        });
      } else if (isStdioConfig(config)) {
        // Stdio transport - spawn child process
        const transport = new Experimental_StdioMCPTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          cwd: config.cwd,
        });
        client = await createMCPClient({ transport });
      } else {
        throw new Error(`Invalid MCP server config: missing command or url`);
      }

      // Get tools from the server
      const tools = await client.tools();

      // Store the client and its tools
      this.clients.set(config.name, { client, config, tools });

      const toolNames = Object.keys(tools);
      this.logger.info(
        { name: config.name, transport: transportType, toolCount: toolNames.length, tools: toolNames },
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

    for (const [serverName, entry] of this.clients) {
      for (const [toolName, tool] of Object.entries(entry.tools)) {
        if (allTools[toolName]) {
          this.logger.warn(
            { toolName, serverName, existingServer: "previous" },
            "Tool name collision - later server's tool will overwrite"
          );
        }
        allTools[toolName] = tool;
      }
    }

    this.logger.debug(
      { toolCount: Object.keys(allTools).length, serverCount: this.clients.size },
      "Aggregated unprefixed tools"
    );

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
   * Get descriptions of all connected servers for system prompt injection.
   * Returns an array of { name, description, tools } for servers that have descriptions.
   */
  getServerDescriptions(): Array<{ name: string; description: string; tools: string[] }> {
    const descriptions: Array<{ name: string; description: string; tools: string[] }> = [];

    for (const [name, entry] of this.clients) {
      const description = entry.config.description;
      if (description) {
        descriptions.push({
          name,
          description,
          tools: Object.keys(entry.tools),
        });
      }
    }

    return descriptions;
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
        entry.client.close().catch((error: unknown) => {
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
