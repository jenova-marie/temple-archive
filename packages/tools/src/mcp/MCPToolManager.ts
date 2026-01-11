/**
 * MCP Tool Manager
 *
 * Manages connections to MCP (Model Context Protocol) servers and aggregates their tools.
 * Uses the official @modelcontextprotocol/sdk for transport handling.
 * Converts MCP tools to Vercel AI SDK compatible format.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { getLogger } from "@pippa/observability";

// Type for Vercel AI SDK tools - use the generic Tool type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AITool = Tool<any, any>;
type AIToolSet = Record<string, AITool>;

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

/**
 * MCP Tool definition from the server
 */
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

interface MCPClientEntry {
  client: Client;
  config: MCPServerConfig;
  tools: MCPTool[];
}

/**
 * Convert JSON Schema to Zod schema
 * Handles common JSON Schema types and nested structures
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;

  let zodSchema: z.ZodTypeAny;

  switch (type) {
    case "string": {
      let strSchema = z.string();
      if (schema.enum) {
        const enumValues = schema.enum as string[];
        if (enumValues.length > 0) {
          zodSchema = z.enum(enumValues as [string, ...string[]]);
          break;
        }
      }
      if (schema.minLength) strSchema = strSchema.min(schema.minLength as number);
      if (schema.maxLength) strSchema = strSchema.max(schema.maxLength as number);
      if (schema.pattern) strSchema = strSchema.regex(new RegExp(schema.pattern as string));
      zodSchema = strSchema;
      break;
    }
    case "number":
    case "integer": {
      let numSchema = type === "integer" ? z.number().int() : z.number();
      if (schema.minimum !== undefined) numSchema = numSchema.min(schema.minimum as number);
      if (schema.maximum !== undefined) numSchema = numSchema.max(schema.maximum as number);
      zodSchema = numSchema;
      break;
    }
    case "boolean":
      zodSchema = z.boolean();
      break;
    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      zodSchema = items ? z.array(jsonSchemaToZod(items)) : z.array(z.unknown());
      break;
    }
    case "object": {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = schema.required as string[] | undefined;

      if (properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, propSchema] of Object.entries(properties)) {
          let propZod = jsonSchemaToZod(propSchema);
          if (!required?.includes(key)) {
            propZod = propZod.optional();
          }
          shape[key] = propZod;
        }
        zodSchema = z.object(shape);
      } else {
        zodSchema = z.record(z.string(), z.unknown());
      }
      break;
    }
    case "null":
      zodSchema = z.null();
      break;
    default:
      // Handle union types (anyOf, oneOf)
      if (schema.anyOf || schema.oneOf) {
        const variants = (schema.anyOf || schema.oneOf) as Record<string, unknown>[];
        if (variants.length >= 2) {
          const [first, second, ...rest] = variants.map(v => jsonSchemaToZod(v));
          zodSchema = z.union([first, second, ...rest]);
        } else if (variants.length === 1) {
          zodSchema = jsonSchemaToZod(variants[0]);
        } else {
          zodSchema = z.unknown();
        }
      } else {
        zodSchema = z.unknown();
      }
  }

  if (description) {
    zodSchema = zodSchema.describe(description);
  }

  return zodSchema;
}

/**
 * Convert MCP tool input schema to Zod schema
 */
function mcpSchemaToZod(inputSchema: MCPTool["inputSchema"]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const properties = inputSchema.properties || {};
  const required = inputSchema.required || [];

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    let propZod = jsonSchemaToZod(propSchema as Record<string, unknown>);
    if (!required.includes(key)) {
      propZod = propZod.optional();
    }
    shape[key] = propZod;
  }

  return z.object(shape);
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
      let client: Client;
      let actualTransport: string = transportType;

      if (isHttpConfig(config)) {
        // For HTTP servers, try Streamable HTTP first (newer protocol), then fall back to SSE
        const url = new URL(config.url);

        // Try Streamable HTTP first
        try {
          this.logger.debug(
            { name: config.name, url: config.url },
            "Trying Streamable HTTP transport"
          );
          client = new Client(
            { name: "pippa-agent", version: "1.0.0" },
            { capabilities: {} }
          );
          const transport = new StreamableHTTPClientTransport(url);
          await client.connect(transport);
          actualTransport = "streamable-http";
          this.logger.debug(
            { name: config.name },
            "Connected via Streamable HTTP"
          );
        } catch (streamableError) {
          // Streamable HTTP failed, try SSE as fallback
          this.logger.debug(
            { name: config.name, error: streamableError instanceof Error ? streamableError.message : String(streamableError) },
            "Streamable HTTP failed, trying SSE transport"
          );
          client = new Client(
            { name: "pippa-agent", version: "1.0.0" },
            { capabilities: {} }
          );
          const sseTransport = new SSEClientTransport(url);
          await client.connect(sseTransport);
          actualTransport = "sse";
          this.logger.debug(
            { name: config.name },
            "Connected via SSE"
          );
        }
      } else if (isStdioConfig(config)) {
        // Stdio transport - spawn child process
        client = new Client(
          { name: "pippa-agent", version: "1.0.0" },
          { capabilities: {} }
        );
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          cwd: config.cwd,
        });
        await client.connect(transport);
      } else {
        throw new Error(`Invalid MCP server config: missing command or url`);
      }

      // Get tools from the server
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools as MCPTool[];

      // Store the client and its tools
      this.clients.set(config.name, { client, config, tools });

      const toolNames = tools.map(t => t.name);
      this.logger.info(
        { name: config.name, transport: actualTransport, toolCount: tools.length, tools: toolNames },
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
   * Create a Vercel AI SDK tool from an MCP tool definition
   */
  private createAITool(serverName: string, mcpTool: MCPTool, client: Client): AITool {
    const inputSchema = mcpSchemaToZod(mcpTool.inputSchema);

    return tool({
      description: mcpTool.description || `Tool from ${serverName}`,
      inputSchema,
      execute: async (args: Record<string, unknown>) => {
        this.logger.debug(
          { server: serverName, tool: mcpTool.name, args },
          "Executing MCP tool"
        );

        try {
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: args,
          });

          // Extract text content from the result
          if ("content" in result && Array.isArray(result.content)) {
            const textContent = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map(c => c.text)
              .join("\n");

            if (textContent) {
              return textContent;
            }

            // Return the full result if no text content
            return JSON.stringify(result.content);
          }

          // Return structured content if available
          if ("structuredContent" in result && result.structuredContent) {
            return result.structuredContent;
          }

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(
            { server: serverName, tool: mcpTool.name, error: errorMessage },
            "MCP tool execution failed"
          );
          throw error;
        }
      },
    });
  }

  /**
   * Get all tools from all connected MCP servers.
   * Tool names are prefixed with "mcp__<server>__" to avoid collisions.
   */
  getTools(): AIToolSet {
    const allTools: AIToolSet = {};

    for (const [serverName, entry] of this.clients) {
      for (const mcpTool of entry.tools) {
        // Prefix tool names with server name to avoid collisions
        // Format: mcp__<server>__<tool>
        const prefixedName = `mcp__${serverName}__${mcpTool.name}`;
        allTools[prefixedName] = this.createAITool(serverName, mcpTool, entry.client);
      }
    }

    return allTools;
  }

  /**
   * Get tools without server name prefix (use when you only have one server)
   */
  getToolsUnprefixed(): AIToolSet {
    const allTools: AIToolSet = {};

    for (const [serverName, entry] of this.clients) {
      for (const mcpTool of entry.tools) {
        if (allTools[mcpTool.name]) {
          this.logger.warn(
            { toolName: mcpTool.name, serverName, existingServer: "previous" },
            "Tool name collision - later server's tool will overwrite"
          );
        }
        allTools[mcpTool.name] = this.createAITool(serverName, mcpTool, entry.client);
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
          tools: entry.tools.map(t => t.name),
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
