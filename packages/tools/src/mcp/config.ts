/**
 * MCP Configuration Loader
 *
 * Loads MCP server configuration from mcp.json file.
 * Supports config file path override via MCP_CONFIG_PATH environment variable.
 *
 * Priority:
 * 1. MCP_CONFIG_PATH environment variable (explicit override)
 * 2. {CONTAINER_ROOT}/mcp.local.json (local overrides, not committed)
 * 3. {CONTAINER_ROOT}/mcp.json (default config)
 *
 * Use CONTAINER_ROOT to control the base path:
 *   - Default: /container (production/Docker)
 *   - Override: CONTAINER_ROOT=./opt pnpm dev (development)
 */

import { readFileSync, existsSync } from "node:fs";
import { getLogger } from "@pippa/observability";
import { containerPath, ContainerPaths } from "@pippa/shared/server";
import type { MCPServerConfig, MCPConfigFile } from "./MCPToolManager.js";

/**
 * Find the MCP config file.
 * Priority:
 * 1. MCP_CONFIG_PATH environment variable override
 * 2. {CONTAINER_ROOT}/mcp.local.json (local development overrides)
 * 3. {CONTAINER_ROOT}/mcp.json (default)
 */
function findMcpConfigFile(): string | null {
  const logger = getLogger().child({ component: "MCP" });

  // Check for explicit path override
  const overridePath = process.env.MCP_CONFIG_PATH;
  if (overridePath) {
    if (existsSync(overridePath)) {
      return overridePath;
    }
    logger.warn(
      { path: overridePath },
      "MCP_CONFIG_PATH specified but file not found"
    );
    return null;
  }

  // Check for local config first (mcp.local.json - for development overrides)
  const localConfigPath = containerPath("mcp.local.json");
  if (existsSync(localConfigPath)) {
    logger.debug({ path: localConfigPath }, "Found local MCP config override");
    return localConfigPath;
  }

  // Check for default config (mcp.json)
  const defaultConfigPath = containerPath(ContainerPaths.MCP_CONFIG);
  if (existsSync(defaultConfigPath)) {
    return defaultConfigPath;
  }

  return null;
}

/**
 * Load MCP server configurations from the config file.
 * Returns empty array if config file not found or invalid.
 */
export function loadMcpConfig(): MCPServerConfig[] {
  const logger = getLogger().child({ component: "MCP" });

  logger.debug({ cwd: process.cwd() }, "Loading MCP config");

  const configPath = findMcpConfigFile();
  if (!configPath) {
    const containerRoot = process.env.CONTAINER_ROOT || "/container";
    logger.warn(
      {
        cwd: process.cwd(),
        containerRoot,
        MCP_CONFIG_PATH: process.env.MCP_CONFIG_PATH,
        lookedIn: [
          `${containerRoot}/mcp.local.json`,
          `${containerRoot}/mcp.json`,
        ],
      },
      "No MCP config file found"
    );
    return [];
  }

  logger.info({ path: configPath }, "Found MCP config file");

  try {
    const content = readFileSync(configPath, "utf8");
    const config: MCPConfigFile = JSON.parse(content);

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      logger.warn({ path: configPath }, "Invalid MCP config: missing mcpServers");
      return [];
    }

    // Convert config format to MCPServerConfig array
    // Handle both stdio (command-based) and http (url-based) servers
    const servers: MCPServerConfig[] = Object.entries(config.mcpServers).map(
      ([name, serverConfig]): MCPServerConfig => {
        // Check if this is an HTTP/SSE server (has url) or stdio server (has command)
        if ("url" in serverConfig && serverConfig.url) {
          return {
            name,
            type: (serverConfig as { type?: "http" | "sse" }).type ?? "http",
            url: serverConfig.url as string,
            enabled: serverConfig.enabled ?? true,
            description: (serverConfig as { description?: string }).description,
          };
        } else if ("command" in serverConfig && serverConfig.command) {
          return {
            name,
            type: "stdio",
            command: serverConfig.command as string,
            args: serverConfig.args,
            env: serverConfig.env,
            cwd: serverConfig.cwd,
            enabled: serverConfig.enabled ?? true,
            description: (serverConfig as { description?: string }).description,
          };
        } else {
          // Invalid config - log warning and mark as disabled
          logger.warn(
            { name, config: serverConfig },
            "Invalid MCP server config: missing command or url"
          );
          return {
            name,
            type: "stdio",
            command: "",
            enabled: false,
          };
        }
      }
    );

    // Filter to only enabled servers
    const enabledServers = servers.filter((s) => s.enabled);

    logger.info(
      {
        path: configPath,
        totalServers: servers.length,
        enabledServers: enabledServers.length,
        serverNames: enabledServers.map((s) => s.name),
      },
      "Loaded MCP config"
    );

    return enabledServers;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      { path: configPath, error: errorMessage },
      "Failed to load MCP config"
    );
    return [];
  }
}

/**
 * Check if MCP is enabled via environment variable.
 */
export function isMcpEnabled(): boolean {
  return process.env.ENABLE_MCP === "true";
}
