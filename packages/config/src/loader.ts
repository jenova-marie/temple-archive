import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { parse as parseYaml } from "yaml"
import { configSchema, type Config } from "./schema.js"

/**
 * Options for loading configuration.
 */
export interface LoadConfigOptions {
  /** Path to the YAML config file. If not provided, searches for pippa.agent.yaml */
  configPath?: string
  /** If true, don't throw when config file is not found (use defaults only) */
  allowMissingConfig?: boolean
}

/**
 * Mapping of environment variable names to config paths.
 * Format: ENV_VAR_NAME -> "dotted.path.to.config"
 */
const ENV_VAR_MAPPING: Record<string, string> = {
  // App
  NODE_ENV: "app.nodeEnv",
  PORT: "app.port",
  AGENT_API_PORT: "app.port",
  LOG_LEVEL: "app.logLevel",
  USE_STUBS: "app.useStubs",

  // AI Providers
  ANTHROPIC_API_KEY: "ai.anthropic.apiKey",
  OPENAI_API_KEY: "ai.openai.apiKey",

  // Redis
  REDIS_URL: "redis.url",
  REDIS_PASSWORD: "redis.password",
  REDIS_USERNAME: "redis.username",
  REDIS_DB: "redis.db",
  REDIS_TLS: "redis.tls",
  USER_CACHE_TTL_MINUTES: "redis.userCacheTtlMinutes",

  // PostgreSQL
  DATABASE_URL: "postgresql.url",
  DATABASE_SSL: "postgresql.ssl",

  // Neo4j
  NEO4J_URI: "neo4j.uri",
  NEO4J_USER: "neo4j.user",
  NEO4J_PASSWORD: "neo4j.password",
  NEO4J_DATABASE: "neo4j.database",
  NEO4J_DATABASE_PER_USER: "neo4j.databasePerUser",

  // Qdrant
  QDRANT_URL: "qdrant.url",
  QDRANT_API_KEY: "qdrant.apiKey",
  QDRANT_COLLECTION_NAME: "qdrant.collectionName",
  QDRANT_SEARCH_MODE: "qdrant.searchMode",

  // Literature Search
  LITERATURE_SEARCH_LIMIT: "literatureSearch.limit",

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: "observability.otlpEndpoint",
  OTEL_SERVICE_NAME: "observability.serviceName",

  // Crisis
  CRISIS_THRESHOLD_HIGH: "crisis.thresholdHigh",
  CRISIS_THRESHOLD_CRITICAL: "crisis.thresholdCritical",
  CRISIS_WEBHOOK_URL: "crisis.webhookUrl",
  CRISIS_WEBHOOK_SECRET: "crisis.webhookSecret",
  ENABLE_CRISIS_DETECTION: "crisis.detectionEnabled",
  ENABLE_DEEP_CRISIS_EVAL: "crisis.deepEvalEnabled",

  // Feature Flags - Pipeline Processing
  ENABLE_SAFETY_VALIDATION: "features.safetyValidation",
  ENABLE_RESPONSE_EVALUATION: "features.responseEvaluation",
  ENABLE_STREAMING: "features.streaming",
  ENABLE_AGENT_TOOLS: "features.agentTools",

  // Feature Flags - Memory System
  ENABLE_ENTITY_EXTRACTION: "features.entityExtraction",
  EMBEDDING_BATCH_ENABLED: "features.embeddingBatch",

  // Feature Flags - Tools
  ENABLE_MEETING_TOOLS: "features.meetingTools",
  ENABLE_LITERATURE_TOOLS: "features.literatureTools",

  // Feature Flags - Observability
  ENABLE_TRACING: "features.tracing",

  // Evaluation
  EVALUATION_MODE: "evaluation.mode",

  // Auth
  ZITADEL_ISSUER: "auth.zitadel.issuer",
  ZITADEL_AUDIENCE: "auth.zitadel.audience",

  // Meeting API
  MEETING_API_URL: "meetingApi.url",
  MEETING_API_TOKEN: "meetingApi.token",

  // Memory
  MEMORY_CONTEXT_MODE: "memory.contextMode",
  MEMORY_TOOL_ACCESS: "memory.toolAccess",

  // Entity Extraction
  ENTITY_EXTRACTION_MODE: "memory.entityExtraction.mode",
  ENTITY_EXTRACTION_MODEL: "memory.entityExtraction.model",
  ENTITY_EXTRACTION_TYPES: "memory.entityExtraction.types",
  ENTITY_MIN_IMPORTANCE: "memory.entityExtraction.minImportance",
  ENTITY_INFER_RELATIONSHIPS: "memory.entityExtraction.inferRelationships",

  // L3 Memory
  USE_L3_EXTRACTION: "memory.l3.extractionEnabled",
  USE_L3_RETRIEVAL: "memory.l3.retrievalEnabled",
  L3_INCLUDE_OBSERVATIONS: "memory.l3.includeObservations",
  L3_RETRIEVAL_LIMIT: "memory.l3.retrievalLimit",
  L3_RETRIEVAL_MAX_TOKENS: "memory.l3.retrievalMaxTokens",
  L3_RETRIEVAL_MIN_SCORE: "memory.l3.retrievalMinScore",

  // Deep Memory
  DEEP_MEMORY_ENABLED: "memory.deepMemory.enabled",
  DEEP_MEMORY_STRATEGY: "memory.deepMemory.strategy",
  DEEP_MEMORY_WINDOW: "memory.deepMemory.window",

  // Embedding Batch
  EMBEDDING_BATCH_INTERVAL_MS: "memory.embeddingBatch.intervalMs",
  EMBEDDING_BATCH_SIZE: "memory.embeddingBatch.batchSize",

  // Bootstrap
  MEMORY_BOOTSTRAP_ENABLED: "memory.bootstrap.enabled",
  MEMORY_BOOTSTRAP_START: "memory.bootstrap.start",
  MEMORY_BOOTSTRAP_END: "memory.bootstrap.end",
  MEMORY_CACHE_LIMIT: "memory.bootstrap.cacheLimit",
  MEMORY_CACHE_TTL_HOURS: "memory.bootstrap.cacheTtlHours",
  MEMORY_CACHE_DEDUP_THRESHOLD: "memory.bootstrap.dedupThreshold",
  MEMORY_EXTRACTION_MODEL: "memory.bootstrap.extractionModel",

  // Compaction
  COMPACTION_ENABLED: "memory.compaction.enabled",
  COMPACTION_THRESHOLD: "memory.compaction.threshold",
  COMPACTION_BATCH_SIZE: "memory.compaction.batchSize",
  COMPACTION_MODEL: "memory.compaction.model",
  COMPACTION_MAX_TOKENS: "memory.compaction.maxTokens",
  COMPACTION_TIMEOUT_MS: "memory.compaction.timeoutMs",

  // Memory Reflector
  MEMORY_REFLECTOR_ENABLED: "memory.reflector.enabled",
  MEMORY_REFLECTOR_INSIGHT_LIMIT: "memory.reflector.insightLimit",
  MEMORY_REFLECTOR_ENTITY_LIMIT: "memory.reflector.entityLimit",
  MEMORY_REFLECTOR_MIN_CONFIDENCE: "memory.reflector.minConfidence",
}

/**
 * Interpolates ${VAR} and ${VAR:-default} syntax in strings.
 * Recursively processes objects and arrays.
 */
function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
      // Support ${VAR:-default} syntax
      const colonIdx = expr.indexOf(":-")
      if (colonIdx !== -1) {
        const varName = expr.slice(0, colonIdx)
        const defaultVal = expr.slice(colonIdx + 2)
        return process.env[varName] ?? defaultVal
      }
      // Simple ${VAR} syntax
      return process.env[expr] ?? ""
    })
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars)
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, interpolateEnvVars(v)])
    )
  }
  return obj
}

/**
 * Sets a value at a dotted path in an object.
 * Creates intermediate objects as needed.
 */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".")
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}

/**
 * Builds config overrides from environment variables.
 * Only includes env vars that are actually set.
 */
function buildEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {}

  for (const [envVar, configPath] of Object.entries(ENV_VAR_MAPPING)) {
    const value = process.env[envVar]
    if (value !== undefined && value !== "") {
      // Special handling for comma-separated arrays
      if (configPath === "memory.entityExtraction.types") {
        setPath(overrides, configPath, value.split(",").map((s) => s.trim()))
      } else {
        setPath(overrides, configPath, value)
      }
    }
  }

  return overrides
}

/**
 * Deep merges source into target.
 * Source values override target values.
 * Arrays are replaced, not merged.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = result[key]

    if (
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      )
    } else {
      result[key] = sourceVal
    }
  }

  return result
}

/**
 * Searches for the config file by walking up the directory tree.
 * Looks for pippa.agent.yaml or pippa.agent.yml.
 */
function findConfigFile(startDir: string = process.cwd()): string | null {
  const configNames = ["pippa.agent.yaml", "pippa.agent.yml"]
  let currentDir = startDir

  // Walk up until we hit root or find config
  const root = dirname(currentDir)
  while (currentDir !== root) {
    for (const name of configNames) {
      const configPath = join(currentDir, name)
      if (existsSync(configPath)) {
        return configPath
      }
    }
    // Also check for pnpm-workspace.yaml to identify monorepo root
    if (existsSync(join(currentDir, "pnpm-workspace.yaml"))) {
      for (const name of configNames) {
        const configPath = join(currentDir, name)
        if (existsSync(configPath)) {
          return configPath
        }
      }
      // Reached monorepo root without finding config
      return null
    }
    currentDir = dirname(currentDir)
  }

  return null
}

/**
 * Loads and validates the configuration.
 *
 * Loading order (later values override earlier):
 * 1. Default values from Zod schema
 * 2. YAML config file (with ${VAR} interpolation)
 * 3. Environment variables
 *
 * @param options - Configuration loading options
 * @returns Validated configuration object
 * @throws Error if validation fails
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  // 1. Find and load YAML config
  const configPath = options.configPath ?? findConfigFile()
  let yamlConfig: Record<string, unknown> = {}

  if (configPath && existsSync(configPath)) {
    const yamlContent = readFileSync(configPath, "utf-8")
    const parsed = parseYaml(yamlContent)
    if (parsed && typeof parsed === "object") {
      yamlConfig = parsed as Record<string, unknown>
    }
  } else if (!options.allowMissingConfig && options.configPath) {
    throw new Error(`Config file not found: ${options.configPath}`)
  }

  // 2. Interpolate ${VAR} references in YAML values
  const interpolated = interpolateEnvVars(yamlConfig) as Record<string, unknown>

  // 3. Build overrides from environment variables
  const envOverrides = buildEnvOverrides()

  // 4. Merge: interpolated YAML + env overrides
  const merged = deepMerge(interpolated, envOverrides)

  // 5. Validate with Zod schema (applies defaults)
  return configSchema.parse(merged)
}

/**
 * Returns the path to the config file if found, null otherwise.
 */
export function getConfigPath(): string | null {
  return findConfigFile()
}

/**
 * Validates a config object without loading from file.
 * Useful for testing or programmatic config creation.
 */
export function validateConfig(config: unknown): Config {
  return configSchema.parse(config)
}
