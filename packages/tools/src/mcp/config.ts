/**
 * MCP Configuration Loader
 *
 * Loads MCP server configuration from mcp.json file.
 * Supports config file path override via MCP_CONFIG_PATH environment variable.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { getLogger } from "@pippa/observability";
import type { MCPServerConfig, MCPConfigFile } from "./MCPToolManager.js";

/**
 * Find the MCP config file by walking up from cwd to find the monorepo root.
 * Looks for config/mcp.json in the root directory.
 */
function findMcpConfigFile(): string | null {
  // Check for explicit path override
  const overridePath = process.env.MCP_CONFIG_PATH;
  if (overridePath) {
    if (existsSync(overridePath)) {
      return overridePath;
    }
    getLogger().warn(
      { path: overridePath },
      "MCP_CONFIG_PATH specified but file not found"
    );
    return null;
  }

  // Walk up from cwd to find monorepo root
  let dir = process.cwd();

  for (let i = 0; i < 10; i++) {
    const configPath = join(dir, "config", "mcp.json");
    const pnpmWorkspacePath = join(dir, "pnpm-workspace.yaml");
    const pkgPath = join(dir, "package.json");

    // Check for monorepo root markers
    const isMonorepoRoot =
      existsSync(pnpmWorkspacePath) ||
      (existsSync(pkgPath) && hasWorkspaces(pkgPath));

    if (isMonorepoRoot && existsSync(configPath)) {
      return configPath;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Check if package.json has workspaces field (npm/yarn monorepo)
 */
function hasWorkspaces(pkgPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg.workspaces);
  } catch {
    return false;
  }
}

/**
 * Load MCP server configurations from the config file.
 * Returns empty array if config file not found or invalid.
 */
export function loadMcpConfig(): MCPServerConfig[] {
  const logger = getLogger().child({ component: "MCP" });

  const configPath = findMcpConfigFile();
  if (!configPath) {
    logger.debug("No MCP config file found");
    return [];
  }

  try {
    const content = readFileSync(configPath, "utf8");
    const config: MCPConfigFile = JSON.parse(content);

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      logger.warn({ path: configPath }, "Invalid MCP config: missing mcpServers");
      return [];
    }

    // Convert config format to MCPServerConfig array
    const servers: MCPServerConfig[] = Object.entries(config.mcpServers).map(
      ([name, serverConfig]) => ({
        name,
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
        cwd: serverConfig.cwd,
        enabled: serverConfig.enabled ?? true,
      })
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
