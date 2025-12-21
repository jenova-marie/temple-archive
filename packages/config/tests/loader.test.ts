import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig, validateConfig } from "../src/loader.js"

describe("loadConfig", () => {
  const testDir = join(tmpdir(), `config-test-${Date.now()}`)
  let originalEnv: NodeJS.ProcessEnv

  // List of env vars that affect config loading
  const CONFIG_ENV_VARS = [
    "NODE_ENV", "PORT", "LOG_LEVEL", "USE_STUBS",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
    "REDIS_URL", "REDIS_PASSWORD", "REDIS_USERNAME", "REDIS_DB", "REDIS_TLS", "USER_CACHE_TTL_MINUTES",
    "DATABASE_URL", "DATABASE_SSL",
    "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD", "NEO4J_DATABASE", "NEO4J_DATABASE_PER_USER",
    "QDRANT_URL", "QDRANT_API_KEY", "QDRANT_COLLECTION_NAME", "QDRANT_SEARCH_MODE",
    "LITERATURE_SEARCH_LIMIT",
    "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME",
    "CRISIS_THRESHOLD_HIGH", "CRISIS_THRESHOLD_CRITICAL", "CRISIS_WEBHOOK_URL", "CRISIS_WEBHOOK_SECRET",
    "ENABLE_CRISIS_DETECTION", "ENABLE_DEEP_CRISIS_EVAL",
    "EVALUATION_MODE",
    "ZITADEL_ISSUER", "ZITADEL_AUDIENCE",
    "MEETING_API_URL", "MEETING_API_TOKEN",
    "MEMORY_CONTEXT_MODE", "MEMORY_TOOL_ACCESS",
    "ENTITY_EXTRACTION_MODE", "ENTITY_EXTRACTION_MODEL", "ENTITY_EXTRACTION_TYPES", "ENTITY_MIN_IMPORTANCE", "ENTITY_INFER_RELATIONSHIPS",
    "USE_L3_EXTRACTION", "USE_L3_RETRIEVAL", "L3_INCLUDE_OBSERVATIONS", "L3_RETRIEVAL_LIMIT", "L3_RETRIEVAL_MAX_TOKENS", "L3_RETRIEVAL_MIN_SCORE",
    "DEEP_MEMORY_ENABLED", "DEEP_MEMORY_STRATEGY", "DEEP_MEMORY_WINDOW",
    "EMBEDDING_BATCH_INTERVAL_MS", "EMBEDDING_BATCH_SIZE",
    "MEMORY_BOOTSTRAP_ENABLED", "MEMORY_BOOTSTRAP_START", "MEMORY_BOOTSTRAP_END", "MEMORY_CACHE_LIMIT", "MEMORY_CACHE_TTL_HOURS", "MEMORY_CACHE_DEDUP_THRESHOLD", "MEMORY_EXTRACTION_MODEL",
    "COMPACTION_ENABLED", "COMPACTION_THRESHOLD", "COMPACTION_BATCH_SIZE", "COMPACTION_MODEL", "COMPACTION_MAX_TOKENS", "COMPACTION_TIMEOUT_MS",
    // Test-specific
    "TEST_API_KEY",
  ]

  function clearConfigEnvVars() {
    for (const key of CONFIG_ENV_VARS) {
      delete process.env[key]
    }
  }

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }
    // Clear config-related env vars for test isolation
    clearConfigEnvVars()
    // Create test directory
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("with defaults only", () => {
    it("returns default values when no config file exists", () => {
      const config = loadConfig({ allowMissingConfig: true })

      expect(config.app.port).toBe(3333)
      expect(config.app.nodeEnv).toBe("development")
      expect(config.app.useStubs).toBe(true)
      expect(config.redis.url).toBe("redis://localhost:6379")
      expect(config.memory.contextMode).toBe(1)
      expect(config.memory.toolAccess).toBe("read")
    })
  })

  describe("with YAML config", () => {
    it("loads values from YAML file", () => {
      const configPath = join(testDir, "pippa.agent.yaml")
      writeFileSync(
        configPath,
        `
app:
  port: 4000
  nodeEnv: production
redis:
  url: redis://custom:6380
`
      )

      const config = loadConfig({ configPath })

      expect(config.app.port).toBe(4000)
      expect(config.app.nodeEnv).toBe("production")
      expect(config.redis.url).toBe("redis://custom:6380")
      // Defaults still apply for unset values
      expect(config.app.useStubs).toBe(true)
    })

    it("interpolates ${VAR} in YAML values", () => {
      process.env.TEST_API_KEY = "secret-key-123"
      const configPath = join(testDir, "pippa.agent.yaml")
      writeFileSync(
        configPath,
        `
ai:
  anthropic:
    apiKey: \${TEST_API_KEY}
`
      )

      const config = loadConfig({ configPath })

      expect(config.ai.anthropic.apiKey).toBe("secret-key-123")
    })

    it("interpolates ${VAR:-default} syntax", () => {
      // Don't set the env var
      const configPath = join(testDir, "pippa.agent.yaml")
      writeFileSync(
        configPath,
        `
postgresql:
  url: \${DATABASE_URL:-postgresql://fallback:5432/db}
`
      )

      const config = loadConfig({ configPath })

      expect(config.postgresql.url).toBe("postgresql://fallback:5432/db")
    })

    it("uses env var when set despite default in interpolation", () => {
      process.env.DATABASE_URL = "postgresql://actual:5432/realdb"
      const configPath = join(testDir, "pippa.agent.yaml")
      writeFileSync(
        configPath,
        `
postgresql:
  url: \${DATABASE_URL:-postgresql://fallback:5432/db}
`
      )

      const config = loadConfig({ configPath })

      expect(config.postgresql.url).toBe("postgresql://actual:5432/realdb")
    })
  })

  describe("with environment variable overrides", () => {
    it("env vars override YAML values", () => {
      const configPath = join(testDir, "pippa.agent.yaml")
      writeFileSync(
        configPath,
        `
app:
  port: 4000
`
      )
      process.env.PORT = "5000"

      const config = loadConfig({ configPath })

      expect(config.app.port).toBe(5000)
    })

    it("env vars override defaults when no YAML", () => {
      process.env.PORT = "8080"
      process.env.LOG_LEVEL = "warn"
      process.env.USE_STUBS = "false"

      const config = loadConfig({ allowMissingConfig: true })

      expect(config.app.port).toBe(8080)
      expect(config.app.logLevel).toBe("warn")
      expect(config.app.useStubs).toBe(false)
    })

    it("handles nested env vars correctly", () => {
      process.env.NEO4J_URI = "bolt://neo4j:7687"
      process.env.NEO4J_PASSWORD = "supersecret"
      process.env.MEMORY_CONTEXT_MODE = "2"
      process.env.DEEP_MEMORY_ENABLED = "false"

      const config = loadConfig({ allowMissingConfig: true })

      expect(config.neo4j.uri).toBe("bolt://neo4j:7687")
      expect(config.neo4j.password).toBe("supersecret")
      expect(config.memory.contextMode).toBe(2)
      expect(config.memory.deepMemory.enabled).toBe(false)
    })

    it("handles comma-separated ENTITY_EXTRACTION_TYPES", () => {
      process.env.ENTITY_EXTRACTION_TYPES = "person,place,custom_type"

      const config = loadConfig({ allowMissingConfig: true })

      expect(config.memory.entityExtraction.types).toEqual([
        "person",
        "place",
        "custom_type",
      ])
    })
  })

  describe("validation", () => {
    it("throws on invalid enum value", () => {
      process.env.LOG_LEVEL = "invalid_level"

      expect(() => loadConfig({ allowMissingConfig: true })).toThrow()
    })

    it("coerces string numbers to numbers", () => {
      process.env.CRISIS_THRESHOLD_HIGH = "8"
      process.env.COMPACTION_THRESHOLD = "50"

      const config = loadConfig({ allowMissingConfig: true })

      expect(config.crisis.thresholdHigh).toBe(8)
      expect(typeof config.crisis.thresholdHigh).toBe("number")
      expect(config.memory.compaction.threshold).toBe(50)
    })

    it("coerces string booleans", () => {
      process.env.USE_STUBS = "true"
      process.env.COMPACTION_ENABLED = "false"

      const config = loadConfig({ allowMissingConfig: true })

      expect(config.app.useStubs).toBe(true)
      expect(config.memory.compaction.enabled).toBe(false)
    })
  })

  describe("error handling", () => {
    it("throws when explicit configPath not found", () => {
      expect(() =>
        loadConfig({ configPath: "/nonexistent/config.yaml" })
      ).toThrow("Config file not found")
    })

    it("does not throw when allowMissingConfig is true", () => {
      expect(() =>
        loadConfig({ allowMissingConfig: true })
      ).not.toThrow()
    })
  })
})

describe("validateConfig", () => {
  it("validates a complete config object", () => {
    const config = validateConfig({
      app: { port: 3000 },
      postgresql: { url: "postgresql://localhost/test" },
    })

    expect(config.app.port).toBe(3000)
    expect(config.postgresql.url).toBe("postgresql://localhost/test")
    // Defaults applied
    expect(config.app.nodeEnv).toBe("development")
  })

  it("throws on invalid config", () => {
    expect(() =>
      validateConfig({
        app: { nodeEnv: "invalid" },
      })
    ).toThrow()
  })

  it("applies all defaults for empty object", () => {
    const config = validateConfig({})

    expect(config.app.port).toBe(3333)
    expect(config.memory.toolAccess).toBe("read")
    expect(config.crisis.thresholdHigh).toBe(7)
  })
})
