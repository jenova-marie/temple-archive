/**
 * Container Root Path Configuration
 *
 * Provides a configurable container root path for file lookups.
 * In production (Docker), defaults to /container.
 * In development, can be overridden via CONTAINER_ROOT env var.
 *
 * Usage:
 *   CONTAINER_ROOT=./opt pnpm dev
 *
 * This allows local development to use ./opt instead of /container
 * for paths like /container/data/locale-data.json -> ./opt/data/locale-data.json
 */

import { join, isAbsolute, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'

/**
 * Default container root path (for production/Docker)
 */
const DEFAULT_CONTAINER_ROOT = '/container'

/** Cached monorepo root */
let monorepoRootCache: string | null = null

/**
 * Find the monorepo root by walking up from cwd looking for pnpm-workspace.yaml
 */
function findMonorepoRoot(): string {
  if (monorepoRootCache) {
    return monorepoRootCache
  }

  let dir = process.cwd()

  for (let i = 0; i < 10; i++) {
    // Check for pnpm-workspace.yaml (pnpm monorepo marker)
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      monorepoRootCache = dir
      return dir
    }

    // Check for package.json with workspaces (npm/yarn monorepo marker)
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.workspaces) {
          monorepoRootCache = dir
          return dir
        }
      } catch {
        // Ignore parse errors
      }
    }

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fallback to cwd if no monorepo root found
  monorepoRootCache = process.cwd()
  return monorepoRootCache
}

/**
 * Get the container root path.
 * Reads from CONTAINER_ROOT environment variable, defaults to /container.
 * For relative paths, resolves from the monorepo root.
 */
export function getContainerRoot(): string {
  const containerRoot = process.env.CONTAINER_ROOT || DEFAULT_CONTAINER_ROOT

  // If it's an absolute path, use as-is
  if (isAbsolute(containerRoot)) {
    return containerRoot
  }

  // For relative paths (like ./opt), resolve from monorepo root
  return join(findMonorepoRoot(), containerRoot)
}

/**
 * Resolve a path relative to the container root.
 *
 * @param relativePath - Path relative to container root (e.g., 'data/locale-data.json')
 * @returns Absolute path (e.g., '/container/data/locale-data.json' or '/path/to/monorepo/opt/data/locale-data.json')
 *
 * @example
 * // With CONTAINER_ROOT=/container (default)
 * containerPath('data/locale-data.json') // => '/container/data/locale-data.json'
 *
 * // With CONTAINER_ROOT=./opt (resolved from monorepo root)
 * containerPath('data/locale-data.json') // => '/path/to/monorepo/opt/data/locale-data.json'
 */
export function containerPath(relativePath: string): string {
  return join(getContainerRoot(), relativePath)
}

/**
 * Common container paths
 */
export const ContainerPaths = {
  /** Locale data JSON file */
  LOCALE_DATA: 'data/locale-data.json',
  /** MCP configuration file */
  MCP_CONFIG: 'mcp.json',
} as const

/**
 * Clear the monorepo root cache (useful for testing)
 */
export function clearPathCache(): void {
  monorepoRootCache = null
}
