/**
 * Dependency Injection Container
 *
 * Sets up all dependencies for the pipeline, using stubs or real implementations
 * based on configuration.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { PipelineConfig, IAgentProvider, ISessionStore, IContextStore, IEmbeddingProvider, IVectorStore, IKnowledgeStore, ICrisisHandler, ICrisisEvaluator, ISafetyValidator, IEvaluator } from '@recoverysky/types'
import { getDefaultPipelineConfig } from '@recoverysky/types'
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
} from '@recoverysky/memory'
import { setMemoryToolProviders, setBootstrapOrchestrator, type MemoryToolAccessLevel } from '@recoverysky/tools'
import { createDatabaseClient, PostgresSessionStore } from '@recoverysky/db'
import { KeywordCrisisDetector, StubCrisisHandler, DeepCrisisEvaluator, WebhookCrisisHandler } from '@recoverysky/crisis'
import { StubSafetyValidator, SafetyValidator } from '@recoverysky/safety'
import { MockAgentProvider, VercelAIAgentProvider } from '@recoverysky/agent'
import { StubEvaluator, LLMEvaluator, type EvaluationMode } from '@recoverysky/evaluation'
import { Pipeline, type PipelineDependencies } from '@recoverysky/pipeline'
import { getLogger } from '@recoverysky/observability'
import { SystemPromptRepository } from '@recoverysky-org/common'

export interface Container {
  pipeline: Pipeline
  config: PipelineConfig
  /** Initialize async services (Qdrant collection, etc). Call after creation. */
  init: () => Promise<void>
}

export interface ContainerConfig {
  useStubs?: boolean
}

/**
 * Create and configure the dependency container
 */
export function createContainer(options: ContainerConfig = {}): Container {
  const useStubs = options.useStubs ?? process.env.USE_STUBS === 'true'
  const logger = getLogger().child({ component: 'container' })

  logger.info({ useStubs }, 'Creating container')

  // Pipeline configuration
  const pipelineConfig: PipelineConfig = {
    ...getDefaultPipelineConfig(),
    useStubs,
  }

  // L3 Knowledge Store - Neo4j when NEO4J_URI is set, otherwise in-memory
  // Database-per-user mode: each user gets their own database (requires Dozer or Neo4j Enterprise)
  let knowledgeStore: IKnowledgeStore
  if (!useStubs && process.env.NEO4J_URI) {
    const databasePerUser = process.env.NEO4J_DATABASE_PER_USER === 'true'
    logger.info({ databasePerUser }, 'Using Neo4jKnowledgeStore (L3)')

    const driver = createNeo4jDriver({
      uri: process.env.NEO4J_URI,
      user: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
    })
    knowledgeStore = new Neo4jKnowledgeStore(driver, {
      databasePerUser,
      defaultDatabase: process.env.NEO4J_DATABASE || 'neo4j',
    })

    // Initialize schema in background (don't block startup)
    // Note: In database-per-user mode, schema is initialized per-database on first use
    if (!databasePerUser) {
      initializeSchema(driver).catch((err) => {
        logger.error({ err }, 'Failed to initialize Neo4j schema')
      })
    }
  } else {
    logger.info('Using InMemoryKnowledgeStore (L3 stub)')
    knowledgeStore = new InMemoryKnowledgeStore()
  }

  // L4 Vector Store - Qdrant when QDRANT_URL is set, otherwise in-memory
  let vectorStore: IVectorStore
  let qdrantVectorStore: QdrantVectorStore | null = null
  if (!useStubs && process.env.QDRANT_URL) {
    logger.info('Using QdrantVectorStore (L4)')
    const qdrant = createQdrantClient({ url: process.env.QDRANT_URL })
    qdrantVectorStore = new QdrantVectorStore(qdrant)
    vectorStore = qdrantVectorStore
  } else {
    logger.info('Using InMemoryVectorStore (L4 stub)')
    vectorStore = new InMemoryVectorStore()
  }

  // L1 Context Store - Redis when REDIS_URL is set, otherwise in-memory
  let contextStore: IContextStore
  if (!useStubs && process.env.REDIS_URL) {
    logger.info('Using RedisContextStore (L1)')
    const redis = createRedisClient({ url: process.env.REDIS_URL })
    contextStore = new RedisContextStore(redis, { ttlSeconds: 4 * 60 * 60 }) // 4 hours
  } else {
    logger.info('Using InMemoryContextStore (L1 stub)')
    contextStore = new InMemoryContextStore()
  }

  // L2 Session Store - PostgreSQL when DATABASE_URL is set, otherwise in-memory
  let sessionStore: ISessionStore
  let systemPromptRepo: SystemPromptRepository | null = null

  if (!useStubs && process.env.DATABASE_URL) {
    logger.info('Using PostgresSessionStore (L2)')
    const db = createDatabaseClient({ connectionString: process.env.DATABASE_URL })
    sessionStore = new PostgresSessionStore(db)

    // Create SystemPromptRepository for fetching base identity from database
    systemPromptRepo = new SystemPromptRepository(db as any)
    logger.info('SystemPromptRepository initialized')
  } else {
    logger.info('Using InMemorySessionStore (L2 stub)')
    sessionStore = new InMemorySessionStore()
  }

  // Create memory orchestrator
  const memory = new MemoryOrchestrator(
    contextStore,
    sessionStore,
    knowledgeStore,
    vectorStore,
    {
      l1MessageLimit: pipelineConfig.memory.l1MessageLimit,
      l2MessageLimit: pipelineConfig.memory.l2MessageLimit,
      semanticSearchDays: pipelineConfig.memory.semanticSearchDays,
    }
  )

  // Create crisis detection components
  const crisisDetector = new KeywordCrisisDetector({
    emergencyThreshold: pipelineConfig.crisis.criticalThreshold as 9,
    resourceThreshold: pipelineConfig.crisis.highThreshold as 7,
  })

  // Crisis Handler - webhook when CRISIS_WEBHOOK_URL is set, otherwise stub
  let crisisHandler: ICrisisHandler
  if (!useStubs && process.env.CRISIS_WEBHOOK_URL) {
    logger.info('Using WebhookCrisisHandler')
    crisisHandler = new WebhookCrisisHandler({
      webhookUrl: process.env.CRISIS_WEBHOOK_URL,
      webhookSecret: process.env.CRISIS_WEBHOOK_SECRET,
    })
  } else {
    logger.info('Using StubCrisisHandler')
    crisisHandler = new StubCrisisHandler()
  }

  // Crisis Evaluator (LLM-based deep analysis) - optional
  let crisisEvaluator: ICrisisEvaluator | undefined
  if (!useStubs && process.env.ANTHROPIC_API_KEY) {
    logger.info('Using DeepCrisisEvaluator for LLM-based crisis detection')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    crisisEvaluator = new DeepCrisisEvaluator(anthropic)
  }

  // Create agent - real or mock based on USE_STUBS
  let agent: IAgentProvider
  if (useStubs) {
    logger.info('Using MockAgentProvider (USE_STUBS=true)')
    agent = new MockAgentProvider({ delayMs: 100 })
  } else {
    logger.info('Using VercelAIAgentProvider with Claude')
    agent = new VercelAIAgentProvider({
      model: 'claude-sonnet-4-20250514',
      maxSteps: 5,
      maxTokens: 4096,
      temperature: 0.7,
    })
  }

  // Create safety validator
  // Uses SafetyValidator with PII detection, medical advice detection, and enabling language detection
  // LLM-based detection is enabled when ANTHROPIC_API_KEY is set
  let safety: ISafetyValidator
  if (useStubs) {
    logger.info('Using StubSafetyValidator')
    safety = new StubSafetyValidator()
  } else {
    const anthropicForSafety = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null
    logger.info({ llmEnabled: !!anthropicForSafety }, 'Using SafetyValidator')
    safety = new SafetyValidator(anthropicForSafety, {
      enableLLMDetection: !!anthropicForSafety,
      redactPII: true,
    })
  }

  // Create evaluator
  // Uses LLMEvaluator when ANTHROPIC_API_KEY is set, otherwise StubEvaluator
  const stubEvaluator = new StubEvaluator()
  let evaluator: IEvaluator
  if (useStubs) {
    logger.info('Using StubEvaluator')
    evaluator = stubEvaluator
  } else if (process.env.ANTHROPIC_API_KEY) {
    const anthropicForEval = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const evalMode = (process.env.EVALUATION_MODE as EvaluationMode) || 'on_demand'
    logger.info({ mode: evalMode }, 'Using LLMEvaluator')
    evaluator = new LLMEvaluator(anthropicForEval, stubEvaluator, {
      mode: evalMode,
      minCrisisLevelToTrigger: 4,
    })
  } else {
    logger.info('Using StubEvaluator (no ANTHROPIC_API_KEY)')
    evaluator = stubEvaluator
  }

  // Create embedding provider - requires OPENAI_API_KEY
  let embedding: IEmbeddingProvider | undefined
  if (!useStubs && process.env.OPENAI_API_KEY) {
    logger.info('Using OpenAIEmbeddingProvider for semantic search')
    embedding = new OpenAIEmbeddingProvider()
  } else if (!useStubs) {
    logger.warn('OPENAI_API_KEY not set - semantic search disabled')
  }

  // Create entity extractor for knowledge graph
  // Controlled by ENTITY_EXTRACTION_MODE env var (default: 'all')
  let entityExtractor: EntityExtractor | undefined
  const extractionMode = (process.env.ENTITY_EXTRACTION_MODE as ExtractionMode) || 'all'
  if (extractionMode !== 'none' && !useStubs && process.env.ANTHROPIC_API_KEY) {
    const anthropicForExtraction = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Parse entity types from env (comma-separated)
    const enabledTypes = process.env.ENTITY_EXTRACTION_TYPES
      ? process.env.ENTITY_EXTRACTION_TYPES.split(',').map((t) => t.trim())
      : ['person', 'place', 'event', 'emotion', 'trigger', 'coping_strategy', 'milestone', 'medication']

    entityExtractor = new EntityExtractor(anthropicForExtraction, knowledgeStore, {
      mode: extractionMode,
      model: process.env.ENTITY_EXTRACTION_MODEL || 'claude-3-haiku-20240307',
      enabledTypes: enabledTypes as Array<'person' | 'place' | 'event' | 'emotion' | 'trigger' | 'coping_strategy' | 'milestone' | 'medication'>,
      minImportance: parseFloat(process.env.ENTITY_MIN_IMPORTANCE || '0.3'),
      inferRelationships: process.env.ENTITY_INFER_RELATIONSHIPS !== 'false',
    })

    logger.info({
      mode: extractionMode,
      model: process.env.ENTITY_EXTRACTION_MODEL || 'claude-3-haiku-20240307',
      types: enabledTypes.length,
      minImportance: process.env.ENTITY_MIN_IMPORTANCE || '0.3',
      inferRelationships: process.env.ENTITY_INFER_RELATIONSHIPS !== 'false',
    }, 'Entity extraction enabled')
  } else if (extractionMode === 'none') {
    logger.info('Entity extraction disabled (mode=none)')
  } else if (useStubs) {
    logger.info('Entity extraction disabled (USE_STUBS=true)')
  } else {
    logger.info('Entity extraction disabled (no ANTHROPIC_API_KEY)')
  }

  // Memory Context Builder for pre-agent memory injection
  // Controlled by MEMORY_CONTEXT_MODE env var (default: 1 = template)
  let memoryContextBuilder: MemoryContextBuilder | undefined
  const memoryContextMode = parseInt(process.env.MEMORY_CONTEXT_MODE || '1', 10) as MemoryContextMode

  if (memoryContextMode > 0 && !useStubs) {
    // Haiku mode (2) and hybrid mode (3) require Anthropic API key
    const anthropicForContext = (memoryContextMode >= 2 && process.env.ANTHROPIC_API_KEY)
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null

    memoryContextBuilder = new MemoryContextBuilder(knowledgeStore, anthropicForContext, {
      mode: memoryContextMode,
      maxEntities: 10,
      maxRelationships: 15,
      traversalDepth: 2,
      hybridThreshold: 5,
    })

    logger.info({
      mode: memoryContextMode,
      modeName: ['off', 'template', 'haiku', 'hybrid'][memoryContextMode] || 'unknown',
      hasLLM: !!anthropicForContext,
    }, 'Memory context builder enabled')
  } else if (memoryContextMode === 0) {
    logger.info('Memory context builder disabled (mode=0)')
  } else if (useStubs) {
    logger.info('Memory context builder disabled (USE_STUBS=true)')
  }

  // Memory tool access level
  // Controlled by MEMORY_TOOL_ACCESS env var (default: 'off')
  const memoryToolAccess = (process.env.MEMORY_TOOL_ACCESS as MemoryToolAccessLevel) || 'off'

  if (memoryToolAccess !== 'off' && !useStubs) {
    // Set up memory tool providers so tools can access the knowledge store
    // This needs to be set before the pipeline uses the tools
    let currentTraceContext: import('@recoverysky/types').TraceContext | null = null

    setMemoryToolProviders(
      () => knowledgeStore,
      () => {
        if (!currentTraceContext) {
          throw new Error('TraceContext not set - memory tools called outside of request context')
        }
        return currentTraceContext
      }
    )

    // TODO: The trace context provider is a bit awkward - we need a way to set it per-request
    // For now, memory tools will fail if called outside of the pipeline context
    // This should be refactored when we add proper request-scoped DI

    logger.info({ level: memoryToolAccess }, 'Memory tools enabled')
  } else if (useStubs) {
    logger.info('Memory tools disabled (USE_STUBS=true)')
  } else {
    logger.info('Memory tools disabled (MEMORY_TOOL_ACCESS=off)')
  }

  // Bootstrap Orchestrator for conversation memory priming
  // Controlled by MEMORY_BOOTSTRAP_ENABLED env var (default: false)
  let bootstrapOrchestrator: IBootstrapOrchestrator | undefined
  const bootstrapConfig = loadBootstrapConfig()

  if (bootstrapConfig.enabled && !useStubs) {
    // Create bootstrap dependencies
    // L1 cache - Redis when available, otherwise in-memory
    const bootstrapCache = process.env.REDIS_URL
      ? new ConversationMemoryCache(
          createRedisClient({ url: process.env.REDIS_URL }),
          bootstrapConfig
        )
      : new InMemoryConversationMemoryCache(bootstrapConfig)

    // Anthropic client for Haiku extraction/deduplication
    const anthropicForBootstrap = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null

    // Create bootstrap components
    const memoryExtractor = new MemoryExtractor(anthropicForBootstrap, bootstrapConfig)
    const deduplicator = new MemoryCacheDeduplicator(anthropicForBootstrap, bootstrapConfig)
    const topicGenerator = new TopicGenerator(anthropicForBootstrap, bootstrapConfig)

    // L2 persistence - for now using in-memory (TODO: PostgresMemoryCachePersistence)
    const persistence = new InMemoryMemoryCachePersistence(bootstrapCache)

    // Memory store for bootstrap - uses IMemoryStore interface
    // Reuses existing Neo4j driver if available, otherwise in-memory
    const bootstrapMemoryStore = process.env.NEO4J_URI
      ? new Neo4jMemoryStore(createNeo4jDriver({
          uri: process.env.NEO4J_URI,
          user: process.env.NEO4J_USER || 'neo4j',
          password: process.env.NEO4J_PASSWORD || '',
        }), {
          databasePerUser: process.env.NEO4J_DATABASE_PER_USER === 'true',
          defaultDatabase: process.env.NEO4J_DATABASE || 'neo4j',
        })
      : new InMemoryMemoryStore()

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
      bootstrapConfig
    )

    logger.info({
      bootstrapStart: bootstrapConfig.bootstrapStart,
      bootstrapEnd: bootstrapConfig.bootstrapEnd,
      cacheLimit: bootstrapConfig.cacheLimit,
      hasLLM: !!anthropicForBootstrap,
      hasRedis: !!process.env.REDIS_URL,
    }, 'Memory bootstrap enabled')

    // Set up bootstrap orchestrator for memory tools (clearMemoryCache)
    setBootstrapOrchestrator(bootstrapOrchestrator)
  } else if (!bootstrapConfig.enabled) {
    logger.info('Memory bootstrap disabled (MEMORY_BOOTSTRAP_ENABLED=false)')
    // Use stub that does nothing
    bootstrapOrchestrator = new StubBootstrapOrchestrator()
  } else if (useStubs) {
    logger.info('Memory bootstrap disabled (USE_STUBS=true)')
    bootstrapOrchestrator = new StubBootstrapOrchestrator()
  }

  // Base identity will be fetched during init()
  let baseIdentity: string | undefined

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
    // baseIdentity is set after init() fetches it from the database
    get baseIdentity() { return baseIdentity },
  }

  // Create pipeline
  const pipeline = new Pipeline(deps, pipelineConfig)

  // Init function for async service initialization
  const init = async (): Promise<void> => {
    const initTasks: Promise<void>[] = []

    // Initialize Qdrant collection if using real Qdrant
    if (qdrantVectorStore) {
      logger.info('Initializing Qdrant collection...')
      initTasks.push(
        qdrantVectorStore.init().then(() => {
          logger.info('Qdrant collection initialized successfully')
        })
      )
    } else {
      logger.info('Skipping Qdrant init (using stub or not configured)')
    }

    // Fetch base identity from database
    if (systemPromptRepo) {
      logger.info('Fetching base identity from database...')
      initTasks.push(
        systemPromptRepo.findActive('base-identity').then((result) => {
          if (!result.ok) {
            logger.error({ error: result.error }, 'Failed to fetch base identity from database, using default')
            return
          }
          if (result.value) {
            baseIdentity = result.value.content
            logger.info({ promptId: result.value.id, promptName: result.value.name }, 'Base identity loaded from database')
          } else {
            logger.warn('No active base-identity prompt found in database, using default')
          }
        })
      )
    } else {
      logger.info('Skipping base identity fetch (no database configured)')
    }

    await Promise.all(initTasks)
    logger.info('Container initialization complete')
  }

  return {
    pipeline,
    config: pipelineConfig,
    init,
  }
}
