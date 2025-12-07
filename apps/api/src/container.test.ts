import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all external dependencies
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@recoverysky/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}))

vi.mock('@recoverysky/memory', () => ({
  MemoryOrchestrator: vi.fn().mockImplementation(() => ({})),
  InMemoryContextStore: vi.fn().mockImplementation(() => ({})),
  InMemorySessionStore: vi.fn().mockImplementation(() => ({})),
  InMemoryKnowledgeStore: vi.fn().mockImplementation(() => ({})),
  InMemoryVectorStore: vi.fn().mockImplementation(() => ({})),
  RedisContextStore: vi.fn().mockImplementation(() => ({})),
  createRedisClient: vi.fn().mockReturnValue({}),
  OpenAIEmbeddingProvider: vi.fn().mockImplementation(() => ({})),
  QdrantVectorStore: vi.fn().mockImplementation(() => ({})),
  createQdrantClient: vi.fn().mockReturnValue({}),
}))

vi.mock('@recoverysky/db', () => ({
  createDatabaseClient: vi.fn().mockReturnValue({}),
  PostgresSessionStore: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@recoverysky/crisis', () => ({
  KeywordCrisisDetector: vi.fn().mockImplementation(() => ({})),
  StubCrisisHandler: vi.fn().mockImplementation(() => ({})),
  DeepCrisisEvaluator: vi.fn().mockImplementation(() => ({})),
  WebhookCrisisHandler: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@recoverysky/safety', () => ({
  StubSafetyValidator: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@recoverysky/agent', () => ({
  MockAgentProvider: vi.fn().mockImplementation(() => ({})),
  VercelAIAgentProvider: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@recoverysky/evaluation', () => ({
  StubEvaluator: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@recoverysky/pipeline', () => ({
  Pipeline: vi.fn().mockImplementation(() => ({})),
}))

// Import after mocks are set up
import { createContainer } from './container.js'
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
} from '@recoverysky/memory'
import { createDatabaseClient, PostgresSessionStore } from '@recoverysky/db'
import {
  KeywordCrisisDetector,
  StubCrisisHandler,
  DeepCrisisEvaluator,
  WebhookCrisisHandler,
} from '@recoverysky/crisis'
import { StubSafetyValidator } from '@recoverysky/safety'
import { MockAgentProvider, VercelAIAgentProvider } from '@recoverysky/agent'
import { StubEvaluator } from '@recoverysky/evaluation'
import { Pipeline } from '@recoverysky/pipeline'
import Anthropic from '@anthropic-ai/sdk'

describe('container', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    originalEnv = { ...process.env }
    // Clear relevant env vars
    delete process.env.USE_STUBS
    delete process.env.REDIS_URL
    delete process.env.DATABASE_URL
    delete process.env.QDRANT_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CRISIS_WEBHOOK_URL
    delete process.env.CRISIS_WEBHOOK_SECRET
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('createContainer', () => {
    it('creates container with default stub configuration', () => {
      process.env.USE_STUBS = 'true'

      const container = createContainer()

      expect(container).toBeDefined()
      expect(container.pipeline).toBeDefined()
      expect(container.config).toBeDefined()
    })

    it('uses useStubs option over environment variable', () => {
      process.env.USE_STUBS = 'false'

      createContainer({ useStubs: true })

      expect(MockAgentProvider).toHaveBeenCalled()
      expect(VercelAIAgentProvider).not.toHaveBeenCalled()
    })

    it('creates pipeline with all dependencies', () => {
      createContainer({ useStubs: true })

      expect(Pipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          crisisDetector: expect.anything(),
          crisisHandler: expect.anything(),
          memory: expect.anything(),
          agent: expect.anything(),
          safety: expect.anything(),
          evaluator: expect.anything(),
        }),
        expect.anything()
      )
    })

    describe('with stubs', () => {
      it('uses InMemoryContextStore when stubs enabled', () => {
        createContainer({ useStubs: true })

        expect(InMemoryContextStore).toHaveBeenCalled()
        expect(RedisContextStore).not.toHaveBeenCalled()
      })

      it('uses InMemorySessionStore when stubs enabled', () => {
        createContainer({ useStubs: true })

        expect(InMemorySessionStore).toHaveBeenCalled()
        expect(PostgresSessionStore).not.toHaveBeenCalled()
      })

      it('uses InMemoryVectorStore when stubs enabled', () => {
        createContainer({ useStubs: true })

        expect(InMemoryVectorStore).toHaveBeenCalled()
        expect(QdrantVectorStore).not.toHaveBeenCalled()
      })

      it('uses MockAgentProvider when stubs enabled', () => {
        createContainer({ useStubs: true })

        expect(MockAgentProvider).toHaveBeenCalledWith({ delayMs: 100 })
        expect(VercelAIAgentProvider).not.toHaveBeenCalled()
      })

      it('uses StubCrisisHandler when stubs enabled', () => {
        createContainer({ useStubs: true })

        expect(StubCrisisHandler).toHaveBeenCalled()
        expect(WebhookCrisisHandler).not.toHaveBeenCalled()
      })

      it('always creates InMemoryKnowledgeStore', () => {
        createContainer({ useStubs: true })

        expect(InMemoryKnowledgeStore).toHaveBeenCalled()
      })

      it('always creates KeywordCrisisDetector', () => {
        createContainer({ useStubs: true })

        expect(KeywordCrisisDetector).toHaveBeenCalled()
      })

      it('always creates StubSafetyValidator', () => {
        createContainer({ useStubs: true })

        expect(StubSafetyValidator).toHaveBeenCalled()
      })

      it('always creates StubEvaluator', () => {
        createContainer({ useStubs: true })

        expect(StubEvaluator).toHaveBeenCalled()
      })
    })

    describe('without stubs', () => {
      beforeEach(() => {
        process.env.USE_STUBS = 'false'
      })

      it('uses RedisContextStore when REDIS_URL is set', () => {
        process.env.REDIS_URL = 'redis://localhost:6379'

        createContainer({ useStubs: false })

        expect(createRedisClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' })
        expect(RedisContextStore).toHaveBeenCalled()
      })

      it('falls back to InMemoryContextStore without REDIS_URL', () => {
        createContainer({ useStubs: false })

        expect(InMemoryContextStore).toHaveBeenCalled()
        expect(RedisContextStore).not.toHaveBeenCalled()
      })

      it('uses PostgresSessionStore when DATABASE_URL is set', () => {
        process.env.DATABASE_URL = 'postgresql://localhost:5432/test'

        createContainer({ useStubs: false })

        expect(createDatabaseClient).toHaveBeenCalledWith({
          connectionString: 'postgresql://localhost:5432/test',
        })
        expect(PostgresSessionStore).toHaveBeenCalled()
      })

      it('falls back to InMemorySessionStore without DATABASE_URL', () => {
        createContainer({ useStubs: false })

        expect(InMemorySessionStore).toHaveBeenCalled()
        expect(PostgresSessionStore).not.toHaveBeenCalled()
      })

      it('uses QdrantVectorStore when QDRANT_URL is set', () => {
        process.env.QDRANT_URL = 'http://localhost:6333'

        createContainer({ useStubs: false })

        expect(createQdrantClient).toHaveBeenCalledWith({ url: 'http://localhost:6333' })
        expect(QdrantVectorStore).toHaveBeenCalled()
      })

      it('falls back to InMemoryVectorStore without QDRANT_URL', () => {
        createContainer({ useStubs: false })

        expect(InMemoryVectorStore).toHaveBeenCalled()
        expect(QdrantVectorStore).not.toHaveBeenCalled()
      })

      it('uses VercelAIAgentProvider when not using stubs', () => {
        createContainer({ useStubs: false })

        expect(VercelAIAgentProvider).toHaveBeenCalledWith({
          model: 'claude-sonnet-4-20250514',
          maxSteps: 5,
          maxTokens: 4096,
          temperature: 0.7,
        })
        expect(MockAgentProvider).not.toHaveBeenCalled()
      })

      it('uses OpenAIEmbeddingProvider when OPENAI_API_KEY is set', () => {
        process.env.OPENAI_API_KEY = 'sk-test-key'

        createContainer({ useStubs: false })

        expect(OpenAIEmbeddingProvider).toHaveBeenCalled()
      })

      it('does not create embedding provider without OPENAI_API_KEY', () => {
        createContainer({ useStubs: false })

        expect(OpenAIEmbeddingProvider).not.toHaveBeenCalled()
      })

      it('uses DeepCrisisEvaluator when ANTHROPIC_API_KEY is set', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

        createContainer({ useStubs: false })

        expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'sk-ant-test-key' })
        expect(DeepCrisisEvaluator).toHaveBeenCalled()
      })

      it('does not create crisis evaluator without ANTHROPIC_API_KEY', () => {
        createContainer({ useStubs: false })

        expect(DeepCrisisEvaluator).not.toHaveBeenCalled()
      })

      it('uses WebhookCrisisHandler when CRISIS_WEBHOOK_URL is set', () => {
        process.env.CRISIS_WEBHOOK_URL = 'https://example.com/webhook'
        process.env.CRISIS_WEBHOOK_SECRET = 'secret123'

        createContainer({ useStubs: false })

        expect(WebhookCrisisHandler).toHaveBeenCalledWith({
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret123',
        })
        expect(StubCrisisHandler).not.toHaveBeenCalled()
      })

      it('falls back to StubCrisisHandler without CRISIS_WEBHOOK_URL', () => {
        createContainer({ useStubs: false })

        expect(StubCrisisHandler).toHaveBeenCalled()
        expect(WebhookCrisisHandler).not.toHaveBeenCalled()
      })
    })

    describe('pipeline config', () => {
      it('returns config with useStubs setting', () => {
        const container = createContainer({ useStubs: true })

        expect(container.config.useStubs).toBe(true)
      })

      it('passes config to MemoryOrchestrator', () => {
        createContainer({ useStubs: true })

        expect(MemoryOrchestrator).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            l1MessageLimit: expect.any(Number),
            l2MessageLimit: expect.any(Number),
            semanticSearchDays: expect.any(Number),
          })
        )
      })

      it('passes config to KeywordCrisisDetector', () => {
        createContainer({ useStubs: true })

        expect(KeywordCrisisDetector).toHaveBeenCalledWith(
          expect.objectContaining({
            emergencyThreshold: expect.any(Number),
            resourceThreshold: expect.any(Number),
          })
        )
      })
    })
  })
})
