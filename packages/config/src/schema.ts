import { z } from "zod"

/**
 * Custom boolean coercion that handles string "true"/"false" properly.
 * booleanString doesn't work because non-empty strings are truthy.
 */
const booleanString = z.preprocess((val) => {
  if (typeof val === "string") {
    if (val.toLowerCase() === "true" || val === "1") return true
    if (val.toLowerCase() === "false" || val === "0") return false
  }
  return val
}, z.boolean().optional())

/**
 * Zod sub-schemas for nested configuration objects.
 * Each field has its own default so partial config works.
 * We use .optional() on nested objects and apply defaults via transform.
 */

const appSchema = z.object({
  nodeEnv: z.enum(["development", "production", "test"]).optional(),
  port: z.coerce.number().optional(),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).optional(),
  useStubs: booleanString.optional(),
}).transform((val) => ({
  nodeEnv: val.nodeEnv ?? "development",
  port: val.port ?? 3333,
  logLevel: val.logLevel ?? "debug",
  useStubs: val.useStubs ?? true,
}))

const anthropicSchema = z.object({
  apiKey: z.string().optional(),
}).optional().transform((val) => val ?? {})

const openaiSchema = z.object({
  apiKey: z.string().optional(),
}).optional().transform((val) => val ?? {})

const aiSchema = z.object({
  anthropic: anthropicSchema,
  openai: openaiSchema,
}).optional().transform((val) => ({
  anthropic: val?.anthropic ?? {},
  openai: val?.openai ?? {},
}))

const redisSchema = z.object({
  url: z.string().optional(),
  password: z.string().optional(),
  username: z.string().optional(),
  db: z.coerce.number().optional(),
  tls: booleanString.optional(),
  userCacheTtlMinutes: z.coerce.number().optional(),
}).optional().transform((val) => ({
  url: val?.url ?? "redis://localhost:6379",
  password: val?.password,
  username: val?.username,
  db: val?.db ?? 0,
  tls: val?.tls ?? false,
  userCacheTtlMinutes: val?.userCacheTtlMinutes ?? 60,
}))

const postgresqlSchema = z.object({
  url: z.string().optional(),
  ssl: z.union([
    booleanString,
    z.object({ rejectUnauthorized: z.boolean() }),
  ]).optional(),
}).optional().transform((val) => ({
  url: val?.url ?? "postgresql://postgres:postgres@localhost:5432/siri",
  ssl: val?.ssl,
}))

const neo4jSchema = z.object({
  uri: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
  databasePerUser: booleanString.optional(),
}).optional().transform((val) => ({
  uri: val?.uri,
  user: val?.user ?? "neo4j",
  password: val?.password,
  database: val?.database ?? "neo4j",
  databasePerUser: val?.databasePerUser ?? false,
}))

const qdrantSchema = z.object({
  url: z.string().optional(),
  apiKey: z.string().optional(),
  collectionName: z.string().optional(),
  searchMode: z.enum(["hybrid", "simple"]).optional(),
}).optional().transform((val) => ({
  url: val?.url ?? "http://localhost:6333",
  apiKey: val?.apiKey,
  collectionName: val?.collectionName ?? "messages",
  searchMode: val?.searchMode ?? "hybrid",
}))

const literatureSearchSchema = z.object({
  limit: z.coerce.number().optional(),
}).optional().transform((val) => ({
  limit: val?.limit ?? 10,
}))

const observabilitySchema = z.object({
  otlpEndpoint: z.string().optional(),
  serviceName: z.string().optional(),
}).optional().transform((val) => ({
  otlpEndpoint: val?.otlpEndpoint,
  serviceName: val?.serviceName ?? "ninshubur",
}))

const crisisSchema = z.object({
  thresholdHigh: z.coerce.number().optional(),
  thresholdCritical: z.coerce.number().optional(),
  webhookUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
  detectionEnabled: booleanString.optional(),
  deepEvalEnabled: booleanString.optional(),
}).optional().transform((val) => ({
  thresholdHigh: val?.thresholdHigh ?? 7,
  thresholdCritical: val?.thresholdCritical ?? 9,
  webhookUrl: val?.webhookUrl,
  webhookSecret: val?.webhookSecret,
  detectionEnabled: val?.detectionEnabled ?? true,
  deepEvalEnabled: val?.deepEvalEnabled ?? true,
}))

const evaluationSchema = z.object({
  mode: z.enum(["all", "on_demand"]).or(z.string().regex(/^sample:\d+$/)).optional(),
}).optional().transform((val) => ({
  mode: val?.mode ?? "on_demand",
}))

const auth0Schema = z.object({
  issuerBaseURL: z.string().optional(),
  audience: z.string().optional(),
  clientId: z.string().optional(),
}).optional().transform((val) => val ?? {})

const authSchema = z.object({
  auth0: auth0Schema,
}).optional().transform((val) => ({
  auth0: val?.auth0 ?? {},
}))

const meetingApiSchema = z.object({
  url: z.string().optional(),
  token: z.string().optional(),
}).optional().transform((val) => ({
  url: val?.url ?? "http://localhost:4000",
  token: val?.token,
}))

const entityExtractionSchema = z.object({
  mode: z.enum(["all", "none", "significant"]).or(z.string().regex(/^sample:\d+$/)).optional(),
  model: z.string().optional(),
  types: z.array(z.string()).optional(),
  minImportance: z.coerce.number().min(0).max(1).optional(),
  inferRelationships: booleanString.optional(),
}).optional().transform((val) => ({
  mode: val?.mode ?? "all",
  model: val?.model ?? "claude-haiku-4-5",
  types: val?.types ?? [
    "person",
    "place",
    "event",
    "emotion",
    "trigger",
    "coping_strategy",
    "milestone",
    "medication",
  ],
  minImportance: val?.minImportance ?? 0.3,
  inferRelationships: val?.inferRelationships ?? true,
}))

const l3Schema = z.object({
  extractionEnabled: booleanString.optional(),
  retrievalEnabled: booleanString.optional(),
  includeObservations: booleanString.optional(),
  retrievalLimit: z.coerce.number().optional(),
  retrievalMaxTokens: z.coerce.number().optional(),
  retrievalMinScore: z.coerce.number().optional(),
}).optional().transform((val) => ({
  extractionEnabled: val?.extractionEnabled ?? true,
  retrievalEnabled: val?.retrievalEnabled ?? false,
  includeObservations: val?.includeObservations ?? true,
  retrievalLimit: val?.retrievalLimit ?? 10,
  retrievalMaxTokens: val?.retrievalMaxTokens ?? 2000,
  retrievalMinScore: val?.retrievalMinScore ?? 0.1,
}))

const deepMemorySchema = z.object({
  enabled: booleanString.optional(),
  strategy: z.enum(["latest", "created_and_latest", "all"]).optional(),
  window: z.coerce.number().optional(),
}).optional().transform((val) => ({
  enabled: val?.enabled ?? true,
  strategy: val?.strategy ?? "latest",
  window: val?.window ?? 5,
}))

const embeddingBatchSchema = z.object({
  intervalMs: z.coerce.number().optional(),
  batchSize: z.coerce.number().optional(),
}).optional().transform((val) => ({
  intervalMs: val?.intervalMs ?? 30000,
  batchSize: val?.batchSize ?? 100,
}))

const bootstrapSchema = z.object({
  enabled: booleanString.optional(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
  cacheLimit: z.union([z.coerce.number(), z.literal("all"), z.literal("none")]).optional(),
  cacheTtlHours: z.coerce.number().optional(),
  dedupThreshold: z.coerce.number().optional(),
  extractionModel: z.enum(["haiku", "sonnet"]).optional(),
}).optional().transform((val) => ({
  enabled: val?.enabled ?? false,
  start: val?.start ?? 3,
  end: val?.end ?? 8,
  cacheLimit: val?.cacheLimit ?? 50,
  cacheTtlHours: val?.cacheTtlHours ?? 4,
  dedupThreshold: val?.dedupThreshold ?? 10,
  extractionModel: val?.extractionModel ?? "haiku",
}))

const compactionSchema = z.object({
  enabled: booleanString.optional(),
  threshold: z.coerce.number().optional(),
  batchSize: z.coerce.number().optional(),
  model: z.string().optional(),
  maxTokens: z.coerce.number().optional(),
  timeoutMs: z.coerce.number().optional(),
}).optional().transform((val) => ({
  enabled: val?.enabled ?? true,
  threshold: val?.threshold ?? 30,
  batchSize: val?.batchSize ?? 15,
  model: val?.model ?? "claude-haiku-4-5",
  maxTokens: val?.maxTokens ?? 512,
  timeoutMs: val?.timeoutMs ?? 15000,
}))

const memoryReflectorSchema = z.object({
  enabled: booleanString.optional(),
  insightLimit: z.coerce.number().optional(),
  entityLimit: z.coerce.number().optional(),
  minConfidence: z.coerce.number().optional(),
}).optional().transform((val) => ({
  enabled: val?.enabled ?? true,
  insightLimit: val?.insightLimit ?? 10,
  entityLimit: val?.entityLimit ?? 5,
  minConfidence: val?.minConfidence ?? 0.5,
}))

const memorySchema = z.object({
  contextMode: z.coerce.number().min(0).max(3).optional(),
  toolAccess: z.enum(["off", "read", "write", "full"]).optional(),
  entityExtraction: entityExtractionSchema,
  l3: l3Schema,
  deepMemory: deepMemorySchema,
  embeddingBatch: embeddingBatchSchema,
  bootstrap: bootstrapSchema,
  compaction: compactionSchema,
  reflector: memoryReflectorSchema,
}).optional().transform((val) => ({
  contextMode: val?.contextMode ?? 0,
  toolAccess: val?.toolAccess ?? "read",
  entityExtraction: val?.entityExtraction ?? {
    mode: "all",
    model: "claude-haiku-4-5",
    types: ["person", "place", "event", "emotion", "trigger", "coping_strategy", "milestone", "medication"],
    minImportance: 0.3,
    inferRelationships: true,
  },
  l3: val?.l3 ?? {
    extractionEnabled: true,
    retrievalEnabled: false,
    includeObservations: true,
    retrievalLimit: 10,
    retrievalMaxTokens: 2000,
    retrievalMinScore: 0.1,
  },
  deepMemory: val?.deepMemory ?? {
    enabled: true,
    strategy: "latest" as const,
    window: 5,
  },
  embeddingBatch: val?.embeddingBatch ?? {
    intervalMs: 30000,
    batchSize: 100,
  },
  bootstrap: val?.bootstrap ?? {
    enabled: false,
    start: 3,
    end: 8,
    cacheLimit: 50,
    cacheTtlHours: 4,
    dedupThreshold: 10,
    extractionModel: "haiku" as const,
  },
  compaction: val?.compaction ?? {
    enabled: true,
    threshold: 30,
    batchSize: 15,
    model: "claude-haiku-4-5",
    maxTokens: 512,
    timeoutMs: 15000,
  },
  reflector: val?.reflector ?? {
    enabled: true,
    insightLimit: 10,
    entityLimit: 5,
    minConfidence: 0.5,
  },
}))

/**
 * RAG (read-only consumer of ninshubur's wisdom archive).
 *
 * Connection details are read directly from env vars (NINSHUBUR_*,
 * VOYAGE_API_KEY) at container init — they're not part of the YAML
 * schema because they're sensitive (API keys, DB credentials).
 *
 * What lives here is the safe-to-version-control behavior:
 * collection names, default scope, default limit, etc.
 */
const ragSchema = z.object({
  enabled: booleanString.optional(),
  voyageModel: z.string().optional(),
  qdrantCollectionMessages: z.string().optional(),
  qdrantCollectionGroups: z.string().optional(),
  defaultScope: z.enum(["messages", "groups"]).optional(),
  defaultLimit: z.coerce.number().optional(),
}).optional().transform((val) => ({
  enabled: val?.enabled ?? false,
  voyageModel: val?.voyageModel ?? "voyage-3.5",
  qdrantCollectionMessages: val?.qdrantCollectionMessages ?? "ninshubur_messages",
  qdrantCollectionGroups: val?.qdrantCollectionGroups ?? "ninshubur_groups",
  defaultScope: val?.defaultScope ?? "groups",
  defaultLimit: val?.defaultLimit ?? 10,
}))

/**
 * Zod schema for Siri Agent configuration.
 * All fields have sensible defaults to allow minimal configuration.
 */
export const configSchema = z.object({
  app: appSchema.optional(),
  ai: aiSchema,
  redis: redisSchema,
  postgresql: postgresqlSchema,
  neo4j: neo4jSchema,
  qdrant: qdrantSchema,
  literatureSearch: literatureSearchSchema,
  observability: observabilitySchema,
  crisis: crisisSchema,
  evaluation: evaluationSchema,
  auth: authSchema,
  meetingApi: meetingApiSchema,
  memory: memorySchema,
  rag: ragSchema,
}).transform((val) => ({
  app: val.app ?? {
    nodeEnv: "development" as const,
    port: 3333,
    logLevel: "debug" as const,
    useStubs: true,
  },
  ai: val.ai,
  redis: val.redis,
  postgresql: val.postgresql,
  neo4j: val.neo4j,
  qdrant: val.qdrant,
  literatureSearch: val.literatureSearch,
  observability: val.observability,
  crisis: val.crisis,
  evaluation: val.evaluation,
  auth: val.auth,
  meetingApi: val.meetingApi,
  memory: val.memory,
  rag: val.rag,
}))

/**
 * Inferred TypeScript type from the Zod schema.
 * Use this for type-safe config access throughout the application.
 */
export type Config = z.output<typeof configSchema>
