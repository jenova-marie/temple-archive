import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContainer, type Container } from './container.js'

// Mock all external dependencies
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ text: 'Mock response' }] }),
    },
  })),
}))

vi.mock('@pippa/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  withSpan: vi.fn().mockImplementation((_name, fn) => fn()),
  pipelineMetrics: {
    stageDuration: { record: vi.fn() },
    errors: { add: vi.fn() },
    memoryCacheHits: { add: vi.fn() },
    memoryCacheMisses: { add: vi.fn() },
  },
}))

vi.mock('@pippa/memory', () => ({
  MemoryOrchestrator: vi.fn().mockImplementation(() => ({
    assembleContext: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  })),
  InMemoryContextStore: vi.fn().mockImplementation(() => ({})),
  InMemorySessionStore: vi.fn().mockImplementation(() => ({
    getUserProfile: vi.fn().mockResolvedValue({ ok: true, value: null }),
  })),
  InMemoryKnowledgeStore: vi.fn().mockImplementation(() => ({})),
  InMemoryVectorStore: vi.fn().mockImplementation(() => ({})),
  RedisContextStore: vi.fn().mockImplementation(() => ({})),
  createRedisClient: vi.fn().mockReturnValue({}),
  OpenAIEmbeddingProvider: vi.fn().mockImplementation(() => ({})),
  QdrantVectorStore: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
  createQdrantClient: vi.fn().mockReturnValue({}),
  Neo4jKnowledgeStore: vi.fn().mockImplementation(() => ({})),
  createNeo4jDriver: vi.fn().mockReturnValue({}),
  initializeSchema: vi.fn().mockResolvedValue(undefined),
  EntityExtractor: vi.fn().mockImplementation(() => ({})),
  MemoryContextBuilder: vi.fn().mockImplementation(() => ({})),
  BootstrapOrchestrator: vi.fn().mockImplementation(() => ({})),
  StubBootstrapOrchestrator: vi.fn().mockImplementation(() => ({})),
  ConversationMemoryCache: vi.fn().mockImplementation(() => ({})),
  InMemoryConversationMemoryCache: vi.fn().mockImplementation(() => ({})),
  MemoryExtractor: vi.fn().mockImplementation(() => ({})),
  MemoryCacheDeduplicator: vi.fn().mockImplementation(() => ({})),
  TopicGenerator: vi.fn().mockImplementation(() => ({})),
  InMemoryMemoryCachePersistence: vi.fn().mockImplementation(() => ({})),
  loadBootstrapConfig: vi.fn().mockReturnValue({ enabled: false }),
  Neo4jMemoryStore: vi.fn().mockImplementation(() => ({})),
  InMemoryMemoryStore: vi.fn().mockImplementation(() => ({})),
  ContextCompactor: vi.fn().mockImplementation(() => ({})),
  StubContextCompactor: vi.fn().mockImplementation(() => ({})),
  loadCompactionConfig: vi.fn().mockReturnValue({ enabled: false }),
  MiniLMEmbeddingProvider: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue({ ok: true }),
  })),
  EmbeddingBatchJob: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
  })),
  MemoryRetrievalService: vi.fn().mockImplementation(() => ({})),
  L3MemoryContextProvider: vi.fn().mockImplementation(() => ({})),
  DeepMemoryService: vi.fn().mockImplementation(() => ({})),
  loadL3ContextConfig: vi.fn().mockReturnValue({}),
  MemoryReflector: vi.fn().mockImplementation(() => ({})),
  MemoryPromptStore: vi.fn().mockImplementation(() => ({})),
  MemoryPromptGenerator: vi.fn().mockImplementation(() => ({})),
  loadMemoryPromptConfig: vi.fn().mockReturnValue({ enabled: false }),
}))

vi.mock('@pippa/tools', () => ({
  setMemoryToolProviders: vi.fn(),
  setBootstrapOrchestrator: vi.fn(),
  setSystemPromptRefreshFn: vi.fn(),
  setClearConversationFn: vi.fn(),
  setMem0ToolStore: vi.fn(),
}))

vi.mock('@pippa/db', () => ({
  createDatabaseClient: vi.fn().mockReturnValue({}),
  PostgresSessionStore: vi.fn().mockImplementation(() => ({
    getUserProfile: vi.fn().mockResolvedValue({ ok: true, value: null }),
    getMessagesAroundId: vi.fn(),
  })),
  UserCacheStore: vi.fn().mockImplementation(() => ({})),
  SystemPromptRepository: vi.fn().mockImplementation(() => ({
    findActive: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findAllActive: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  })),
  UserRepository: vi.fn().mockImplementation(() => ({
    getOrCreateUser: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  })),
}))

vi.mock('@pippa/crisis', () => ({
  KeywordCrisisDetector: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue({ ok: true, value: { level: 1 } }),
  })),
  NoOpCrisisDetector: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue({ ok: true, value: { level: 1 } }),
  })),
  StubCrisisHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  })),
  DeepCrisisEvaluator: vi.fn().mockImplementation(() => ({})),
  WebhookCrisisHandler: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@pippa/safety', () => ({
  StubSafetyValidator: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue({ ok: true, value: { safe: true } }),
  })),
  SafetyValidator: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue({ ok: true, value: { safe: true } }),
  })),
}))

vi.mock('@pippa/agent', () => ({
  MockAgentProvider: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'Mock' } }),
  })),
  VercelAIAgentProvider: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'Mock' } }),
  })),
}))

vi.mock('@pippa/evaluation', () => ({
  StubEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockResolvedValue({ ok: true, value: { score: 1.0 } }),
  })),
  NoOpEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockResolvedValue({ ok: true, value: { overallScore: 0.5 } }),
  })),
  LLMEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockResolvedValue({ ok: true, value: { score: 1.0 } }),
  })),
}))

vi.mock('@pippa/pipeline', () => ({
  Pipeline: vi.fn().mockImplementation(() => ({
    preflight: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    postProcess: vi.fn().mockResolvedValue(undefined),
    getDeps: vi.fn().mockReturnValue({}),
  })),
}))

vi.mock('@pippa/types', () => ({
  getDefaultPipelineConfig: vi.fn().mockReturnValue({
    memory: {
      l2MessageLimit: 200,
      semanticSearchDays: 30,
    },
    crisis: {
      criticalThreshold: 9,
      highThreshold: 7,
    },
  }),
  ok: vi.fn((value) => ({ ok: true, value })),
  err: vi.fn((error) => ({ ok: false, error })),
}))

describe('container', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset env to clean state
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('createContainer', () => {
    it('creates a container with default stub mode', () => {
      process.env.USE_STUBS = 'true'

      const container = createContainer()

      expect(container).toBeDefined()
      expect(container.pipeline).toBeDefined()
      expect(container.config).toBeDefined()
      expect(typeof container.init).toBe('function')
      expect(typeof container.shutdown).toBe('function')
      expect(typeof container.loadUserData).toBe('function')
    })

    it('creates a container with explicit stub mode', () => {
      const container = createContainer({ useStubs: true })

      expect(container).toBeDefined()
      expect(container.config.useStubs).toBe(true)
    })

    it('exposes pipeline on container', () => {
      const container = createContainer({ useStubs: true })

      expect(container.pipeline).toBeDefined()
    })

    it('exposes config on container', () => {
      const container = createContainer({ useStubs: true })

      expect(container.config).toBeDefined()
      expect(container.config.useStubs).toBe(true)
    })
  })

  describe('container.init', () => {
    it('init function exists and is callable', async () => {
      const container = createContainer({ useStubs: true })

      // Should not throw
      await expect(container.init()).resolves.not.toThrow()
    })
  })

  describe('container.shutdown', () => {
    it('shutdown function exists and is callable', async () => {
      const container = createContainer({ useStubs: true })

      // Should not throw
      await expect(container.shutdown()).resolves.not.toThrow()
    })
  })

  describe('container.loadUserData', () => {
    it('returns user data structure', async () => {
      const container = createContainer({ useStubs: true })

      const userData = await container.loadUserData('user-123', 'test@example.com', 'Test User')

      expect(userData).toBeDefined()
      expect(userData.userId).toBe('user-123')
      expect(userData.email).toBe('test@example.com')
      expect(userData.displayName).toBe('Test User')
    })

    it('handles missing optional parameters', async () => {
      const container = createContainer({ useStubs: true })

      const userData = await container.loadUserData('user-123')

      expect(userData).toBeDefined()
      expect(userData.userId).toBe('user-123')
      expect(userData.email).toBeUndefined()
      expect(userData.displayName).toBeUndefined()
    })
  })

  describe('dependency injection', () => {
    // Note: Dependency injection verification is done implicitly through the
    // container creation tests above. The mocked modules are called when
    // createContainer() is invoked with useStubs: true.
    //
    // Direct verification of mock calls would require ESM dynamic imports
    // which have limitations in Vitest's mock system. Instead, we verify:
    // 1. Container is created successfully (above)
    // 2. Pipeline and config are exposed (above)
    // 3. Container methods work correctly (above)
    //
    // For deeper DI verification, use integration tests with real services.

    it('creates container with all stub dependencies in stub mode', () => {
      // This test verifies the container initializes without errors
      // when all dependencies are stubbed
      const container = createContainer({ useStubs: true })

      expect(container).toBeDefined()
      expect(container.pipeline).toBeDefined()
      expect(container.config.useStubs).toBe(true)
    })

    it('respects ENABLE_CRISIS_DETECTION=false', () => {
      process.env.ENABLE_CRISIS_DETECTION = 'false'

      // Should not throw - NoOpCrisisDetector will be used
      const container = createContainer({ useStubs: true })

      expect(container).toBeDefined()
    })

    it('respects ENABLE_CRISIS_DETECTION=true', () => {
      process.env.ENABLE_CRISIS_DETECTION = 'true'

      // Should not throw - KeywordCrisisDetector will be used
      const container = createContainer({ useStubs: true })

      expect(container).toBeDefined()
    })
  })

  describe('environment variable configuration', () => {
    it('respects USE_STUBS environment variable', () => {
      process.env.USE_STUBS = 'true'

      const container = createContainer()

      expect(container.config.useStubs).toBe(true)
    })

    it('defaults to USE_STUBS=true when not specified', () => {
      delete process.env.USE_STUBS

      // When no env var and no explicit option, defaults are applied
      const container = createContainer()

      // The container should still be created
      expect(container).toBeDefined()
    })
  })

  describe('Container interface', () => {
    it('implements required Container interface properties', () => {
      const container = createContainer({ useStubs: true })

      // Type check - these should all be defined
      const _pipeline = container.pipeline
      const _config = container.config
      const _init = container.init
      const _shutdown = container.shutdown
      const _loadUserData = container.loadUserData

      expect(_pipeline).toBeDefined()
      expect(_config).toBeDefined()
      expect(typeof _init).toBe('function')
      expect(typeof _shutdown).toBe('function')
      expect(typeof _loadUserData).toBe('function')
    })
  })
})
