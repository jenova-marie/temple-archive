/**
 * Dependency Injection Container
 *
 * Sets up all dependencies for the pipeline, using stubs or real implementations
 * based on configuration.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type {
  PipelineConfig,
  IAgentProvider,
  ISessionStore,
  IContextStore,
  IEmbeddingProvider,
  IVectorStore,
  IKnowledgeStore,
  ICrisisDetector,
  ICrisisHandler,
  ICrisisEvaluator,
  ISafetyValidator,
  IEvaluator,
} from "@pippa/types";
import { getDefaultPipelineConfig } from "@pippa/types";
import {
  MemoryOrchestrator,
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
  RedisContextStore,
  createRedisClient,
  OpenAIEmbeddingProvider,
  QdrantVectorStore,
  createQdrantClient,
  Neo4jKnowledgeStore,
  createNeo4jDriver,
  initializeSchema,
  EntityExtractor,
  MemoryContextBuilder,
  type ExtractionMode,
  type MemoryContextMode,
  // Bootstrap system
  BootstrapOrchestrator,
  StubBootstrapOrchestrator,
  ConversationMemoryCache,
  InMemoryConversationMemoryCache,
  MemoryExtractor,
  MemoryCacheDeduplicator,
  TopicGenerator,
  InMemoryMemoryCachePersistence,
  loadBootstrapConfig,
  type IBootstrapOrchestrator,
  // Memory stores for bootstrap (implements IMemoryStore)
  Neo4jMemoryStore,
  InMemoryMemoryStore,
  // Context compaction
  ContextCompactor,
  StubContextCompactor,
  loadCompactionConfig,
  type IContextCompactor,
  // L3 Memory embedding components
  MiniLMEmbeddingProvider,
  EmbeddingBatchJob,
  // L3 Memory retrieval
  MemoryRetrievalService,
  L3MemoryContextProvider,
  DeepMemoryService,
  loadL3ContextConfig,
  // Memory Reflector
  MemoryReflector,
} from "@pippa/memory";
import {
  setMemoryToolProviders,
  setBootstrapOrchestrator,
  setSystemPromptRefreshFn,
  setClearConversationFn,
  type MemoryToolAccessLevel,
} from "@pippa/tools";
import {
  createDatabaseClient,
  PostgresSessionStore,
  UserCacheStore,
} from "@pippa/db";
import {
  KeywordCrisisDetector,
  NoOpCrisisDetector,
  StubCrisisHandler,
  DeepCrisisEvaluator,
  WebhookCrisisHandler,
} from "@pippa/crisis";
import { StubSafetyValidator, SafetyValidator } from "@pippa/safety";
import { MockAgentProvider, VercelAIAgentProvider } from "@pippa/agent";
import {
  StubEvaluator,
  NoOpEvaluator,
  LLMEvaluator,
  type EvaluationMode,
} from "@pippa/evaluation";
import { Pipeline, type PipelineDependencies } from "@pippa/pipeline";
import { getLogger } from "@pippa/observability";
import { SystemPromptRepository, UserRepository } from "@pippa/db";

import type { UserProfile } from "@pippa/types";

export interface RequestUserData {
  userId: string;
  email?: string;
  displayName?: string;
  profile: UserProfile | null;
}

export interface Container {
  pipeline: Pipeline;
  config: PipelineConfig;
  /** Initialize async services (Qdrant collection, etc). Call after creation. */
  init: () => Promise<void>;
  /** Graceful shutdown - stops background jobs, closes connections. */
  shutdown: () => Promise<void>;
  /**
   * Load user and profile data - call once early in request after JWT auth.
   * Returns user + profile to be passed through the request lifecycle.
   */
  loadUserData: (
    userId: string,
    email?: string,
    displayName?: string,
  ) => Promise<RequestUserData>;
}

export interface ContainerConfig {
  useStubs?: boolean;
}

/**
 * Create and configure the dependency container
 */
export function createContainer(options: ContainerConfig = {}): Container {
  const useStubs = options.useStubs ?? process.env.USE_STUBS === "true";
  const logger = getLogger().child({ component: "container" });

  logger.info({ useStubs }, "Creating container");

  // Pipeline configuration
  const pipelineConfig: PipelineConfig = {
    ...getDefaultPipelineConfig(),
    useStubs,
  };

  // L3 Knowledge Store - Neo4j when NEO4J_URI is set, otherwise in-memory
  // Database-per-user mode: each user gets their own database (requires Dozer or Neo4j Enterprise)
  let knowledgeStore: IKnowledgeStore;
  if (!useStubs && process.env.NEO4J_URI) {
    const databasePerUser = process.env.NEO4J_DATABASE_PER_USER === "true";
    logger.info({ databasePerUser }, "Using Neo4jKnowledgeStore (L3)");

    const driver = createNeo4jDriver({
      uri: process.env.NEO4J_URI,
      user: process.env.NEO4J_USER || "neo4j",
      password: process.env.NEO4J_PASSWORD || "",
    });
    knowledgeStore = new Neo4jKnowledgeStore(driver, {
      databasePerUser,
      defaultDatabase: process.env.NEO4J_DATABASE || "neo4j",
    });

    // Initialize schema in background (don't block startup)
    // Note: In database-per-user mode, schema is initialized per-database on first use
    if (!databasePerUser) {
      initializeSchema(driver).catch((err) => {
        logger.error({ err }, "Failed to initialize Neo4j schema");
      });
    }
  } else {
    logger.info("Using InMemoryKnowledgeStore (L3 stub)");
    knowledgeStore = new InMemoryKnowledgeStore();
  }

  // L4 Vector Store - Qdrant when QDRANT_URL is set, otherwise in-memory
  let vectorStore: IVectorStore;
  let qdrantVectorStore: QdrantVectorStore | null = null;
  if (!useStubs && process.env.QDRANT_URL) {
    logger.info("Using QdrantVectorStore (L4)");
    const qdrant = createQdrantClient({ url: process.env.QDRANT_URL });
    qdrantVectorStore = new QdrantVectorStore(qdrant);
    vectorStore = qdrantVectorStore;
  } else {
    logger.info("Using InMemoryVectorStore (L4 stub)");
    vectorStore = new InMemoryVectorStore();
  }

  // L1 Context Store - Redis when REDIS_URL is set, otherwise in-memory
  let contextStore: IContextStore;
  if (!useStubs && process.env.REDIS_URL) {
    logger.info("Using RedisContextStore (L1)");
    const redis = createRedisClient({ url: process.env.REDIS_URL });
    contextStore = new RedisContextStore(redis, { ttlSeconds: 4 * 60 * 60 }); // 4 hours
  } else {
    logger.info("Using InMemoryContextStore (L1 stub)");
    contextStore = new InMemoryContextStore();
  }

  // L2 Session Store - PostgreSQL when DATABASE_URL is set, otherwise in-memory
  let sessionStore: ISessionStore;
  let systemPromptRepo: SystemPromptRepository | null = null;
  let userRepo: UserRepository | null = null;
  let userCacheStore: UserCacheStore | null = null;

  // Create UserCacheStore if Redis is available (for caching user/profile data)
  if (!useStubs && process.env.REDIS_URL) {
    const userCacheTTLMinutes = parseInt(
      process.env.USER_CACHE_TTL_MINUTES || "60",
      10,
    );
    const userCacheRedis = createRedisClient({ url: process.env.REDIS_URL });
    userCacheStore = new UserCacheStore(userCacheRedis, {
      ttlSeconds: userCacheTTLMinutes * 60,
    });
    logger.info(
      { ttlMinutes: userCacheTTLMinutes },
      "Using Redis UserCacheStore for user/profile caching",
    );
  }

  if (!useStubs && process.env.DATABASE_URL) {
    logger.info("Using PostgresSessionStore (L2)");
    const ssl =
      process.env.DATABASE_SSL === "false"
        ? false
        : process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : undefined;
    const db = createDatabaseClient({
      connectionString: process.env.DATABASE_URL,
      ssl,
    });

    // Pass userCacheStore to PostgresSessionStore for profile caching
    sessionStore = new PostgresSessionStore(db, userCacheStore ?? undefined);

    // Create repositories for database operations
    systemPromptRepo = new SystemPromptRepository(db);
    // Pass userCacheStore to UserRepository for user caching
    userRepo = new UserRepository(db, userCacheStore ?? undefined);

    logger.info(
      "Database repositories initialized (SystemPromptRepository, UserRepository)",
    );
  } else {
    logger.info("Using InMemorySessionStore (L2 stub)");
    sessionStore = new InMemorySessionStore();
  }

  // Create memory orchestrator
  // ENABLE_L3_QUERIES controls Neo4j entity lookups during retrieval (default: true)
  const l3QueriesEnabled = process.env.ENABLE_L3_QUERIES !== "false";
  if (!l3QueriesEnabled) {
    logger.info("L3 Neo4j queries disabled (ENABLE_L3_QUERIES=false)");
  }

  const memory = new MemoryOrchestrator(
    contextStore,
    sessionStore,
    knowledgeStore,
    vectorStore,
    {
      l1MessageLimit: pipelineConfig.memory.l1MessageLimit,
      l2MessageLimit: pipelineConfig.memory.l2MessageLimit,
      semanticSearchDays: pipelineConfig.memory.semanticSearchDays,
      enableL3Queries: l3QueriesEnabled,
    },
  );

  // Create crisis detection components
  // Controlled by ENABLE_CRISIS_DETECTION env var (default: true)
  let crisisDetector: ICrisisDetector;
  const crisisDetectionEnabled =
    process.env.ENABLE_CRISIS_DETECTION !== "false";

  if (!crisisDetectionEnabled) {
    logger.info("Crisis detection disabled (ENABLE_CRISIS_DETECTION=false)");
    crisisDetector = new NoOpCrisisDetector();
  } else {
    logger.info("Using KeywordCrisisDetector for fast crisis pattern matching");
    crisisDetector = new KeywordCrisisDetector({
      emergencyThreshold: pipelineConfig.crisis.criticalThreshold as 9,
      resourceThreshold: pipelineConfig.crisis.highThreshold as 7,
    });
  }

  // Crisis Handler - webhook when CRISIS_WEBHOOK_URL is set, otherwise stub
  let crisisHandler: ICrisisHandler;
  if (!useStubs && process.env.CRISIS_WEBHOOK_URL) {
    logger.info("Using WebhookCrisisHandler");
    crisisHandler = new WebhookCrisisHandler({
      webhookUrl: process.env.CRISIS_WEBHOOK_URL,
      webhookSecret: process.env.CRISIS_WEBHOOK_SECRET,
    });
  } else {
    logger.info("Using StubCrisisHandler");
    crisisHandler = new StubCrisisHandler();
  }

  // Crisis Evaluator (LLM-based deep analysis) - optional
  // Controlled by ENABLE_DEEP_CRISIS_EVAL env var (default: true)
  let crisisEvaluator: ICrisisEvaluator | undefined;
  const deepCrisisEnabled = process.env.ENABLE_DEEP_CRISIS_EVAL !== "false";

  if (!deepCrisisEnabled) {
    logger.info(
      "Deep crisis evaluation disabled (ENABLE_DEEP_CRISIS_EVAL=false)",
    );
  } else if (!useStubs && process.env.ANTHROPIC_API_KEY) {
    logger.info("Using DeepCrisisEvaluator for LLM-based crisis detection");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    crisisEvaluator = new DeepCrisisEvaluator(anthropic);
  } else if (!useStubs) {
    logger.info("Deep crisis evaluation disabled (no ANTHROPIC_API_KEY)");
  }

  // Create agent - real or mock based on USE_STUBS
  let agent: IAgentProvider;
  if (useStubs) {
    logger.info("Using MockAgentProvider (USE_STUBS=true)");
    agent = new MockAgentProvider({ delayMs: 100 });
  } else {
    logger.info("Using VercelAIAgentProvider with Claude");
    agent = new VercelAIAgentProvider({
      model: "claude-sonnet-4-20250514",
      maxSteps: 5,
      maxTokens: 4096,
      temperature: 0.7,
    });
  }

  // Create safety validator
  // Uses SafetyValidator with PII detection, medical advice detection, and enabling language detection
  // LLM-based detection is enabled when ANTHROPIC_API_KEY is set
  const safetyValidationEnabled =
    process.env.ENABLE_SAFETY_VALIDATION !== "false";
  let safety: ISafetyValidator;
  if (!safetyValidationEnabled) {
    logger.info("Safety validation disabled (ENABLE_SAFETY_VALIDATION=false)");
    safety = new StubSafetyValidator();
  } else if (useStubs) {
    logger.info("Using StubSafetyValidator");
    safety = new StubSafetyValidator();
  } else {
    const anthropicForSafety = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
    logger.info({ llmEnabled: !!anthropicForSafety }, "Using SafetyValidator");
    safety = new SafetyValidator(anthropicForSafety, {
      enableLLMDetection: !!anthropicForSafety,
      redactPII: true,
    });
  }

  // Create evaluator
  // Uses LLMEvaluator when ANTHROPIC_API_KEY is set, otherwise StubEvaluator
  // Uses NoOpEvaluator (silent, no logging) when evaluation is disabled
  const responseEvaluationEnabled =
    process.env.ENABLE_RESPONSE_EVALUATION !== "false";
  const stubEvaluator = new StubEvaluator();
  let evaluator: IEvaluator;
  if (!responseEvaluationEnabled) {
    logger.info(
      "Response evaluation disabled (ENABLE_RESPONSE_EVALUATION=false)"
    );
    evaluator = new NoOpEvaluator();
  } else if (useStubs) {
    logger.info("Using StubEvaluator");
    evaluator = stubEvaluator;
  } else if (process.env.ANTHROPIC_API_KEY) {
    const anthropicForEval = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const evalMode =
      (process.env.EVALUATION_MODE as EvaluationMode) || "on_demand";
    logger.info({ mode: evalMode }, "Using LLMEvaluator");
    evaluator = new LLMEvaluator(anthropicForEval, stubEvaluator, {
      mode: evalMode,
      minCrisisLevelToTrigger: 4,
    });
  } else {
    logger.info("Using StubEvaluator (no ANTHROPIC_API_KEY)");
    evaluator = stubEvaluator;
  }

  // Create embedding provider - requires OPENAI_API_KEY and ENABLE_EMBEDDINGS=true
  // When disabled, skips embedding generation and L4 storage (saves OpenAI API costs)
  const embeddingsEnabled = process.env.ENABLE_EMBEDDINGS !== "false";
  let embedding: IEmbeddingProvider | undefined;

  if (!embeddingsEnabled) {
    logger.info("Embeddings disabled (ENABLE_EMBEDDINGS=false) - no semantic search or L4 storage");
  } else if (!useStubs && process.env.OPENAI_API_KEY) {
    logger.info("Using OpenAIEmbeddingProvider for semantic search");
    embedding = new OpenAIEmbeddingProvider();
  } else if (!useStubs) {
    logger.warn("OPENAI_API_KEY not set - semantic search disabled");
  }

  // L3 Memory Embedding Batch Job
  // Generates dual-store embeddings (L3: 384-dim MiniLM, L4: 1536-dim OpenAI)
  // Controlled by EMBEDDING_BATCH_ENABLED env var (default: true when all stores available)
  let embeddingBatchJob: EmbeddingBatchJob | undefined;
  let miniLMProvider: MiniLMEmbeddingProvider | undefined;
  const embeddingBatchEnabled = process.env.EMBEDDING_BATCH_ENABLED !== "false";
  const neo4jL3Store =
    knowledgeStore instanceof Neo4jKnowledgeStore ? knowledgeStore : null;

  if (
    embeddingBatchEnabled &&
    !useStubs &&
    neo4jL3Store &&
    qdrantVectorStore &&
    embedding
  ) {
    miniLMProvider = new MiniLMEmbeddingProvider();

    const batchIntervalMs = parseInt(
      process.env.EMBEDDING_BATCH_INTERVAL_MS || "30000",
      10,
    );
    const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || "100", 10);

    embeddingBatchJob = new EmbeddingBatchJob(
      neo4jL3Store,
      qdrantVectorStore,
      miniLMProvider,
      embedding as OpenAIEmbeddingProvider,
      {
        intervalMs: batchIntervalMs,
        batchSize,
        runImmediately: false, // Start after init()
      },
    );

    logger.info(
      {
        intervalMs: batchIntervalMs,
        batchSize,
      },
      "Embedding batch job configured (will start after init)",
    );
  } else if (!embeddingBatchEnabled) {
    logger.info("Embedding batch job disabled (EMBEDDING_BATCH_ENABLED=false)");
  } else if (useStubs) {
    logger.info("Embedding batch job disabled (USE_STUBS=true)");
  } else {
    logger.info(
      "Embedding batch job disabled (requires Neo4j, Qdrant, and OpenAI)",
    );
  }

  // Create entity extractor for knowledge graph
  // Controlled by ENABLE_ENTITY_EXTRACTION master switch and ENTITY_EXTRACTION_MODE for fine-tuning
  const entityExtractionEnabled =
    process.env.ENABLE_ENTITY_EXTRACTION !== "false";
  let entityExtractor: EntityExtractor | undefined;
  // If master switch is off, treat as mode=none
  const extractionMode = entityExtractionEnabled
    ? ((process.env.ENTITY_EXTRACTION_MODE as ExtractionMode) || "all")
    : "none";
  // Use L3 Memory extraction when Neo4j is available
  const useL3Extraction =
    process.env.USE_L3_EXTRACTION !== "false" && neo4jL3Store !== null;

  if (extractionMode !== "none" && !useStubs && process.env.ANTHROPIC_API_KEY) {
    const anthropicForExtraction = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Parse entity types from env (comma-separated)
    const enabledTypes = process.env.ENTITY_EXTRACTION_TYPES
      ? process.env.ENTITY_EXTRACTION_TYPES.split(",").map((t) => t.trim())
      : [
          "person",
          "place",
          "event",
          "emotion",
          "trigger",
          "coping_strategy",
          "milestone",
          "medication",
        ];

    entityExtractor = new EntityExtractor(
      anthropicForExtraction,
      knowledgeStore,
      {
        mode: extractionMode,
        model: process.env.ENTITY_EXTRACTION_MODEL || "claude-3-haiku-20240307",
        enabledTypes: enabledTypes as Array<
          | "person"
          | "place"
          | "event"
          | "emotion"
          | "trigger"
          | "coping_strategy"
          | "milestone"
          | "medication"
        >,
        minImportance: parseFloat(process.env.ENTITY_MIN_IMPORTANCE || "0.3"),
        inferRelationships: process.env.ENTITY_INFER_RELATIONSHIPS !== "false",
      },
      // L3 Memory options - enable rich extraction when Neo4j is available
      useL3Extraction
        ? { l3Store: neo4jL3Store, useL3Extraction: true }
        : undefined,
    );

    logger.info(
      {
        mode: extractionMode,
        model: process.env.ENTITY_EXTRACTION_MODEL || "claude-3-haiku-20240307",
        types: enabledTypes.length,
        minImportance: process.env.ENTITY_MIN_IMPORTANCE || "0.3",
        inferRelationships: process.env.ENTITY_INFER_RELATIONSHIPS !== "false",
        useL3Extraction,
      },
      "Entity extraction enabled",
    );
  } else if (!entityExtractionEnabled) {
    logger.info(
      "Entity extraction disabled (ENABLE_ENTITY_EXTRACTION=false)"
    );
  } else if (extractionMode === "none") {
    logger.info("Entity extraction disabled (ENTITY_EXTRACTION_MODE=none)");
  } else if (useStubs) {
    logger.info("Entity extraction disabled (USE_STUBS=true)");
  } else {
    logger.info("Entity extraction disabled (no ANTHROPIC_API_KEY)");
  }

  // Memory Context Builder for pre-agent memory injection
  // USE_L3_RETRIEVAL=true uses new L3 Memory retrieval system
  // Otherwise falls back to legacy MEMORY_CONTEXT_MODE (default: 1 = template)
  let memoryContextBuilder:
    | MemoryContextBuilder
    | L3MemoryContextProvider
    | undefined;
  const useL3Retrieval = process.env.USE_L3_RETRIEVAL === "true";
  const memoryContextMode = parseInt(
    process.env.MEMORY_CONTEXT_MODE || "1",
    10,
  ) as MemoryContextMode;

  if (useL3Retrieval && !useStubs && neo4jL3Store) {
    // L3 Memory Retrieval - new Cadillac system
    const l3Config = loadL3ContextConfig();

    // Create DeepMemoryService if enabled and we have a session store with getMessagesAroundId
    let deepMemoryService: DeepMemoryService | null = null;
    if (
      l3Config.includeConversationContext &&
      sessionStore &&
      "getMessagesAroundId" in sessionStore
    ) {
      const messageWindow = parseInt(process.env.DEEP_MEMORY_WINDOW || "5", 10);
      deepMemoryService = new DeepMemoryService(sessionStore as any, {
        messageWindow,
      });
      logger.info(
        { messageWindow, strategy: l3Config.contextStrategy },
        "Deep Memory enabled",
      );
    }

    // Create retrieval service
    const retrievalService = new MemoryRetrievalService(
      neo4jL3Store,
      miniLMProvider ?? null,
      deepMemoryService,
    );

    // Create L3 context provider
    memoryContextBuilder = new L3MemoryContextProvider(
      retrievalService,
      l3Config,
    );

    logger.info(
      {
        includeObservations: l3Config.includeObservations,
        includeConversationContext: l3Config.includeConversationContext,
        contextStrategy: l3Config.contextStrategy,
        limit: l3Config.limit,
        maxTokens: l3Config.maxTokens,
        hasDeepMemory: !!deepMemoryService,
        hasMiniLM: !!miniLMProvider,
      },
      "L3 Memory retrieval enabled",
    );
  } else if (memoryContextMode > 0 && !useStubs) {
    // Legacy MemoryContextBuilder
    // Haiku mode (2) and hybrid mode (3) require Anthropic API key
    const anthropicForContext =
      memoryContextMode >= 2 && process.env.ANTHROPIC_API_KEY
        ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        : null;

    memoryContextBuilder = new MemoryContextBuilder(
      knowledgeStore,
      anthropicForContext,
      {
        mode: memoryContextMode,
        maxEntities: 10,
        maxRelationships: 15,
        traversalDepth: 2,
        hybridThreshold: 5,
      },
    );

    logger.info(
      {
        mode: memoryContextMode,
        modeName:
          ["off", "template", "haiku", "hybrid"][memoryContextMode] ||
          "unknown",
        hasLLM: !!anthropicForContext,
      },
      "Legacy memory context builder enabled",
    );
  } else if (useL3Retrieval && !neo4jL3Store) {
    logger.warn(
      "USE_L3_RETRIEVAL=true but Neo4j not available, disabling memory context",
    );
  } else if (memoryContextMode === 0) {
    logger.info("Memory context builder disabled (mode=0)");
  } else if (useStubs) {
    logger.info("Memory context builder disabled (USE_STUBS=true)");
  }

  // Memory tool access level
  // Controlled by MEMORY_TOOL_ACCESS env var (default: 'off')
  const memoryToolAccess =
    (process.env.MEMORY_TOOL_ACCESS as MemoryToolAccessLevel) || "off";

  if (memoryToolAccess !== "off" && !useStubs) {
    // Set up memory tool providers so tools can access the knowledge store
    // This needs to be set before the pipeline uses the tools
    let currentTraceContext: import("@pippa/types").TraceContext | null = null;

    setMemoryToolProviders(
      () => knowledgeStore,
      () => {
        if (!currentTraceContext) {
          throw new Error(
            "TraceContext not set - memory tools called outside of request context",
          );
        }
        return currentTraceContext;
      },
    );

    // TODO: The trace context provider is a bit awkward - we need a way to set it per-request
    // For now, memory tools will fail if called outside of the pipeline context
    // This should be refactored when we add proper request-scoped DI

    logger.info({ level: memoryToolAccess }, "Memory tools enabled");
  } else if (useStubs) {
    logger.info("Memory tools disabled (USE_STUBS=true)");
  } else {
    logger.info("Memory tools disabled (MEMORY_TOOL_ACCESS=off)");
  }

  // Bootstrap Orchestrator for conversation memory priming
  // Controlled by MEMORY_BOOTSTRAP_ENABLED env var (default: false)
  let bootstrapOrchestrator: IBootstrapOrchestrator | undefined;
  const bootstrapConfig = loadBootstrapConfig();

  if (bootstrapConfig.enabled && !useStubs) {
    // Create bootstrap dependencies
    // L1 cache - Redis when available, otherwise in-memory
    const bootstrapCache = process.env.REDIS_URL
      ? new ConversationMemoryCache(
          createRedisClient({ url: process.env.REDIS_URL }),
          bootstrapConfig,
        )
      : new InMemoryConversationMemoryCache(bootstrapConfig);

    // Anthropic client for Haiku extraction/deduplication
    const anthropicForBootstrap = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;

    // Create bootstrap components
    const memoryExtractor = new MemoryExtractor(
      anthropicForBootstrap,
      bootstrapConfig,
    );
    const deduplicator = new MemoryCacheDeduplicator(
      anthropicForBootstrap,
      bootstrapConfig,
    );
    const topicGenerator = new TopicGenerator(
      anthropicForBootstrap,
      bootstrapConfig,
    );

    // L2 persistence - for now using in-memory (TODO: PostgresMemoryCachePersistence)
    const persistence = new InMemoryMemoryCachePersistence(bootstrapCache);

    // Memory store for bootstrap - uses IMemoryStore interface
    // Reuses existing Neo4j driver if available, otherwise in-memory
    const bootstrapMemoryStore = process.env.NEO4J_URI
      ? new Neo4jMemoryStore(
          createNeo4jDriver({
            uri: process.env.NEO4J_URI,
            user: process.env.NEO4J_USER || "neo4j",
            password: process.env.NEO4J_PASSWORD || "",
          }),
          {
            databasePerUser: process.env.NEO4J_DATABASE_PER_USER === "true",
            defaultDatabase: process.env.NEO4J_DATABASE || "neo4j",
          },
        )
      : new InMemoryMemoryStore();

    bootstrapOrchestrator = new BootstrapOrchestrator(
      {
        cache: bootstrapCache,
        extractor: memoryExtractor,
        deduplicator,
        topicGenerator,
        persistence,
        memoryStore: bootstrapMemoryStore,
        vectorStore,
        embeddingProvider: embedding ?? null,
      },
      bootstrapConfig,
    );

    logger.info(
      {
        bootstrapStart: bootstrapConfig.bootstrapStart,
        bootstrapEnd: bootstrapConfig.bootstrapEnd,
        cacheLimit: bootstrapConfig.cacheLimit,
        hasLLM: !!anthropicForBootstrap,
        hasRedis: !!process.env.REDIS_URL,
      },
      "Memory bootstrap enabled",
    );

    // Set up bootstrap orchestrator for memory tools (clearMemoryCache)
    setBootstrapOrchestrator(bootstrapOrchestrator);
  } else if (!bootstrapConfig.enabled) {
    logger.info("Memory bootstrap disabled (MEMORY_BOOTSTRAP_ENABLED=false)");
    // Use stub that does nothing
    bootstrapOrchestrator = new StubBootstrapOrchestrator();
  } else if (useStubs) {
    logger.info("Memory bootstrap disabled (USE_STUBS=true)");
    bootstrapOrchestrator = new StubBootstrapOrchestrator();
  }

  // Context Compactor for summarizing older messages
  // Controlled by COMPACTION_ENABLED env var (default: true)
  let contextCompactor: IContextCompactor;
  const compactionConfig = loadCompactionConfig();

  if (
    compactionConfig.enabled &&
    !useStubs &&
    process.env.REDIS_URL &&
    process.env.ANTHROPIC_API_KEY
  ) {
    const anthropicForCompaction = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const redisForCompaction = createRedisClient({
      url: process.env.REDIS_URL,
    });

    contextCompactor = new ContextCompactor(
      redisForCompaction,
      anthropicForCompaction,
      compactionConfig,
    );

    logger.info(
      {
        threshold: compactionConfig.threshold,
        batchSize: compactionConfig.batchSize,
        model: compactionConfig.model,
      },
      "Context compaction enabled",
    );
  } else {
    contextCompactor = new StubContextCompactor();
    if (!compactionConfig.enabled) {
      logger.info("Context compaction disabled (COMPACTION_ENABLED=false)");
    } else if (useStubs) {
      logger.info("Context compaction disabled (USE_STUBS=true)");
    } else if (!process.env.REDIS_URL) {
      logger.info("Context compaction disabled (no REDIS_URL)");
    } else if (!process.env.ANTHROPIC_API_KEY) {
      logger.info("Context compaction disabled (no ANTHROPIC_API_KEY)");
    }
  }

  // Memory Reflector for automatic insight extraction
  // Controlled by MEMORY_REFLECTOR_ENABLED env var (default: true when Neo4j + Anthropic available)
  let memoryReflector: MemoryReflector | undefined;
  const reflectorEnabled = process.env.MEMORY_REFLECTOR_ENABLED !== "false";

  if (
    reflectorEnabled &&
    !useStubs &&
    neo4jL3Store &&
    process.env.ANTHROPIC_API_KEY
  ) {
    const anthropicForReflector = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    memoryReflector = new MemoryReflector(anthropicForReflector, neo4jL3Store, {
      insightLimit: Number(process.env.MEMORY_REFLECTOR_INSIGHT_LIMIT) || 10,
      entityLimit: Number(process.env.MEMORY_REFLECTOR_ENTITY_LIMIT) || 5,
      minConfidence: Number(process.env.MEMORY_REFLECTOR_MIN_CONFIDENCE) || 0.5,
    });

    logger.info(
      {
        insightLimit: Number(process.env.MEMORY_REFLECTOR_INSIGHT_LIMIT) || 10,
        entityLimit: Number(process.env.MEMORY_REFLECTOR_ENTITY_LIMIT) || 5,
        minConfidence:
          Number(process.env.MEMORY_REFLECTOR_MIN_CONFIDENCE) || 0.5,
      },
      "Memory Reflector enabled",
    );
  } else {
    if (!reflectorEnabled) {
      logger.info("Memory Reflector disabled (MEMORY_REFLECTOR_ENABLED=false)");
    } else if (useStubs) {
      logger.info("Memory Reflector disabled (USE_STUBS=true)");
    } else if (!neo4jL3Store) {
      logger.info("Memory Reflector disabled (no Neo4j L3 store)");
    } else if (!process.env.ANTHROPIC_API_KEY) {
      logger.info("Memory Reflector disabled (no ANTHROPIC_API_KEY)");
    }
  }

  // Base identity will be fetched during init()
  let baseIdentity: string | undefined;

  // Set up system prompt refresh function for the refreshSystemPrompt tool
  if (systemPromptRepo) {
    const repo = systemPromptRepo; // Capture for closure
    setSystemPromptRefreshFn(async () => {
      const result = await repo.findActive("pippa");
      if (result.ok && result.value) {
        baseIdentity = result.value.content;
        return {
          content: result.value.content,
          id: result.value.id,
          name: result.value.name,
        };
      }
      return null;
    });
    logger.info("System prompt refresh function configured");
  }

  // Set up clear conversation function for the clearConversation tool
  // Uses the bootstrap orchestrator to clear all memory tiers
  setClearConversationFn(async (conversationId: string) => {
    try {
      // Use bootstrap orchestrator to clear memory cache across all tiers
      if (
        bootstrapOrchestrator &&
        "clearMemoryCache" in bootstrapOrchestrator
      ) {
        await bootstrapOrchestrator.clearMemoryCache(conversationId, [
          "L1",
          "L2",
          "L4",
        ]);
        logger.info(
          { conversationId },
          "Conversation memory cleared via bootstrap orchestrator",
        );
        return true;
      } else {
        logger.warn("Bootstrap orchestrator not available for clearing memory");
        return false;
      }
    } catch (error) {
      logger.error(
        { error, conversationId },
        "Failed to clear conversation memory",
      );
      return false;
    }
  });
  logger.info("Clear conversation function configured");

  // Assemble dependencies
  const deps: PipelineDependencies = {
    crisisDetector,
    crisisHandler,
    crisisEvaluator,
    memory,
    agent,
    safety,
    evaluator,
    embedding,
    entityExtractor,
    memoryContextBuilder,
    memoryToolAccess,
    bootstrapOrchestrator,
    contextCompactor,
    memoryReflector,
    // baseIdentity is set after init() fetches it from the database
    get baseIdentity() {
      return baseIdentity;
    },
    // getSystemPrompt: disk first, then database, then null
    // Priority: 1) src/prompts/{name}.md on disk, 2) database, 3) null
    getSystemPrompt: async (name: string) => {
      // 1. Check for prompt file on disk first
      // Try multiple locations to handle both dev (tsx) and production (dist/)
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const possiblePaths = [
        join(__dirname, "prompts", `${name}.md`),           // Same dir (dev: src/, prod: dist/)
        join(__dirname, "..", "src", "prompts", `${name}.md`), // From dist/ -> src/
      ];

      for (const promptPath of possiblePaths) {
        if (existsSync(promptPath)) {
          try {
            const content = readFileSync(promptPath, "utf-8");
            logger.debug({
              agent: name,
              source: "disk",
              path: promptPath,
              contentLength: content.length,
            }, "Loaded system prompt from disk");
            return {
              id: `disk:${name}`,
              name,
              content,
            };
          } catch (err) {
            logger.warn({ agent: name, error: err, path: promptPath }, "Failed to read prompt file from disk");
          }
        }
      }

      // 2. Fall back to database
      if (systemPromptRepo) {
        logger.debug({ agent: name }, "Looking up system prompt in database");
        const result = await systemPromptRepo.findActive(name);
        if (!result.ok) {
          logger.error({ agent: name, error: result.error }, "Database error looking up system prompt");
          return null;
        }
        if (result.value) {
          logger.debug({
            agent: name,
            source: "database",
            promptId: result.value.id,
            contentLength: result.value.content.length,
          }, "Found system prompt in database");
          return {
            id: result.value.id,
            name: result.value.name,
            content: result.value.content,
          };
        }
      }

      logger.debug({ agent: name }, "No system prompt found (disk or database)");
      return null;
    },
    // getDefaultSystemPrompt: same priority - disk first, then database
    getDefaultSystemPrompt: async () => {
      const name = "pippa";

      // 1. Check for prompt file on disk first
      // Try multiple locations to handle both dev (tsx) and production (dist/)
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const possiblePaths = [
        join(__dirname, "prompts", `${name}.md`),           // Same dir (dev: src/, prod: dist/)
        join(__dirname, "..", "src", "prompts", `${name}.md`), // From dist/ -> src/
      ];

      for (const promptPath of possiblePaths) {
        if (existsSync(promptPath)) {
          try {
            const content = readFileSync(promptPath, "utf-8");
            logger.debug({
              agent: name,
              source: "disk",
              path: promptPath,
              contentLength: content.length,
            }, "Loaded default system prompt from disk");
            return {
              id: `disk:${name}`,
              name,
              content,
            };
          } catch (err) {
            logger.warn({ agent: name, error: err, path: promptPath }, "Failed to read default prompt file from disk");
          }
        }
      }

      // 2. Fall back to database
      if (systemPromptRepo) {
        logger.debug("Looking up default pippa prompt in database");
        const result = await systemPromptRepo.findActive("pippa");
        if (!result.ok) {
          logger.error({ error: result.error }, "Database error looking up default pippa prompt");
          return null;
        }
        if (result.value) {
          logger.debug({
            source: "database",
            promptId: result.value.id,
            contentLength: result.value.content.length,
          }, "Found default pippa prompt in database");
          return {
            id: result.value.id,
            name: result.value.name,
            content: result.value.content,
          };
        }
      }

      logger.debug("No default pippa prompt found (disk or database)");
      return null;
    },
  };

  // Create pipeline
  const pipeline = new Pipeline(deps, pipelineConfig);

  // Init function for async service initialization
  const init = async (): Promise<void> => {
    const initTasks: Promise<void>[] = [];

    // Initialize Qdrant collection if using real Qdrant
    if (qdrantVectorStore) {
      logger.info("Initializing Qdrant collection...");
      initTasks.push(
        qdrantVectorStore.init().then(() => {
          logger.info("Qdrant collection initialized successfully");
        }),
      );
    } else {
      logger.info("Skipping Qdrant init (using stub or not configured)");
    }

    // Fetch base identity from database
    if (systemPromptRepo) {
      logger.info("Fetching base identity from database...");
      initTasks.push(
        systemPromptRepo.findActive("pippa").then((result) => {
          if (!result.ok) {
            logger.error(
              { error: result.error },
              "Failed to fetch base identity from database, using default",
            );
            return;
          }
          if (result.value) {
            baseIdentity = result.value.content;
            logger.info(
              { promptId: result.value.id, promptName: result.value.name },
              "Base identity loaded from database",
            );
          } else {
            logger.warn(
              "No active pippa prompt found in database, using default",
            );
          }
        }),
      );
    } else {
      logger.info("Skipping base identity fetch (no database configured)");
    }

    await Promise.all(initTasks);

    // Initialize MiniLM provider and start embedding batch job
    if (miniLMProvider && embeddingBatchJob) {
      logger.info("Initializing MiniLM embedding model...");
      const initResult = await miniLMProvider.init();
      if (initResult.ok) {
        logger.info("MiniLM model initialized, starting embedding batch job");
        embeddingBatchJob.start();
      } else {
        logger.error(
          { error: initResult.error },
          "Failed to initialize MiniLM model - batch job will not start",
        );
      }
    }

    logger.info("Container initialization complete");
  };

  // Shutdown function for graceful termination
  const shutdown = async (): Promise<void> => {
    logger.info("Container shutdown initiated");

    // Stop embedding batch job
    if (embeddingBatchJob && embeddingBatchJob.isRunning()) {
      logger.info("Stopping embedding batch job...");
      embeddingBatchJob.stop();
    }

    logger.info("Container shutdown complete");
  };

  // Load user and profile data - call once early in request after JWT auth
  const loadUserData = async (
    userId: string,
    email?: string,
    displayName?: string,
  ): Promise<RequestUserData> => {
    const ctx = {
      traceId: "",
      spanId: "",
      requestId: userId,
      userId,
      startTime: Date.now(),
    };
    let profile: UserProfile | null = null;

    // Ensure user exists in database
    if (userRepo) {
      const result = await userRepo.getOrCreateUser(
        { userId, email, displayName },
        ctx,
      );
      if (!result.ok) {
        logger.error({ error: result.error }, "Failed to ensure user exists");
      }
    } else {
      logger.debug("No userRepo configured, skipping user creation");
    }

    // Load user profile (will be passed through request lifecycle)
    const profileResult = await sessionStore.getUserProfile(userId, ctx);
    if (profileResult.ok) {
      profile = profileResult.value;
    } else {
      logger.error(
        { error: profileResult.error },
        "Failed to load user profile",
      );
    }

    return { userId, email, displayName, profile };
  };

  return {
    pipeline,
    config: pipelineConfig,
    init,
    shutdown,
    loadUserData,
  };
}
