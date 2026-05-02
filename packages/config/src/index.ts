/**
 * @siri/config
 *
 * Centralized configuration management for Siri Agent.
 *
 * Features:
 * - YAML config file support (siri.agent.yaml)
 * - Environment variable interpolation (${VAR} and ${VAR:-default})
 * - Environment variable overrides
 * - Strict Zod validation with sensible defaults
 *
 * Loading order (later values override earlier):
 * 1. Default values from Zod schema
 * 2. YAML config file (with ${VAR} interpolation)
 * 3. Environment variables
 *
 * @example
 * ```typescript
 * import { loadConfig, type Config } from '@siri/config'
 *
 * const config = loadConfig()
 * console.log(config.app.port) // 3333
 * console.log(config.neo4j.uri) // from YAML or NEO4J_URI env var
 * ```
 */

// Schema and types
export { configSchema, type Config } from "./schema.js"

// Loader functions
export {
  loadConfig,
  getConfigPath,
  validateConfig,
  type LoadConfigOptions,
} from "./loader.js"
