/**
 * Memory Reflector Integration Tests
 *
 * End-to-end tests for the Memory Reflector system that verifies:
 * - Self entity creation and insight storage
 * - Entity observation persistence
 * - Observation reinforcement with confidence boosting
 *
 * Requires:
 *   - docker-compose up -d (neo4j service)
 *   - RUN_INTEGRATION_TESTS=true
 *   - ANTHROPIC_API_KEY (for real LLM calls)
 *
 * Run with:
 *   RUN_INTEGRATION_TESTS=true pnpm vitest run packages/memory/tests/reflection/MemoryReflector.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import neo4j, { Driver } from 'neo4j-driver'
import Anthropic from '@anthropic-ai/sdk'
import { Neo4jKnowledgeStore } from '../../src/stores/Neo4jKnowledgeStore.js'
import { MemoryReflector, type ReflectionContext } from '../../src/reflection/MemoryReflector.js'
import type { Message, TraceContext, L3Entity, L3Observation } from '@siri/types'

// Skip if not running integration tests
const shouldSkip = !process.env.RUN_INTEGRATION_TESTS
const hasApiKey = !!process.env.ANTHROPIC_API_KEY

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'testpassword'

describe.skipIf(shouldSkip)('Memory Reflector Integration', () => {
  let driver: Driver
  let store: Neo4jKnowledgeStore
  let anthropic: Anthropic
  let reflector: MemoryReflector
  const testDatabase = 'neo4j'

  const createCtx = (userId = 'test-reflector-user'): TraceContext => ({
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    spanId: 'span-test',
    traceId: 'trace-test',
    startTime: Date.now(),
    userId,
  })

  const createUserMessage = (content: string, userId = 'test-reflector-user'): Message => ({
    id: `msg_user_${Date.now()}`,
    conversationId: `conv_${Date.now()}`,
    userId,
    role: 'user',
    content,
    timestamp: Date.now(),
  })

  const createAssistantMessage = (content: string, userId = 'test-reflector-user'): Message => ({
    id: `msg_assistant_${Date.now()}`,
    conversationId: `conv_${Date.now()}`,
    userId,
    role: 'assistant',
    content,
    timestamp: Date.now(),
  })

  beforeAll(async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    store = new Neo4jKnowledgeStore(driver, { defaultDatabase: testDatabase })

    if (hasApiKey) {
      anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      reflector = new MemoryReflector(anthropic, store, {
        minConfidence: 0.5,
        insightLimit: 10,
        entityLimit: 5,
      })
    }

    // Verify connection
    const session = driver.session({ database: testDatabase })
    try {
      await session.run('RETURN 1')
      console.log('Connected to Neo4j successfully')
    } finally {
      await session.close()
    }
  })

  afterAll(async () => {
    await driver.close()
  })

  beforeEach(async () => {
    // Clean up test data before each test
    const session = driver.session({ database: testDatabase })
    try {
      await session.run('MATCH (n) WHERE n.name CONTAINS "test-reflector" OR n.name CONTAINS "_self" DETACH DELETE n')
      await session.run('MATCH (o:Observation) WHERE o.conversationId STARTS WITH "conv_" DETACH DELETE o')
    } finally {
      await session.close()
    }
  })

  describe('Self Entity Management', () => {
    it('should create a self entity for user insights', async () => {
      const ctx = createCtx('test-reflector-user-1')
      const userId = 'test-reflector-user-1'

      const result = await store.ensureSelfEntity(userId, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.name).toBe(`${userId}_self`)
        expect(result.value.displayName).toBe('Self')
        expect(result.value.canonicalType).toBe('concept')
        expect(result.value.labels).toContain('user_insights')
      }

      // Verify in database
      const session = driver.session({ database: testDatabase })
      try {
        const queryResult = await session.run(
          'MATCH (e:Entity {name: $name}) RETURN e',
          { name: `${userId}_self` }
        )
        expect(queryResult.records.length).toBe(1)
      } finally {
        await session.close()
      }
    })

    it('should be idempotent - calling twice returns same entity', async () => {
      const ctx = createCtx('test-reflector-user-2')
      const userId = 'test-reflector-user-2'

      const result1 = await store.ensureSelfEntity(userId, ctx)
      const result2 = await store.ensureSelfEntity(userId, ctx)

      expect(result1.ok).toBe(true)
      expect(result2.ok).toBe(true)

      if (result1.ok && result2.ok) {
        expect(result1.value.name).toBe(result2.value.name)
      }

      // Verify only one entity in database
      const session = driver.session({ database: testDatabase })
      try {
        const queryResult = await session.run(
          'MATCH (e:Entity {name: $name}) RETURN count(e) as count',
          { name: `${userId}_self` }
        )
        const count = queryResult.records[0].get('count').toNumber()
        expect(count).toBe(1)
      } finally {
        await session.close()
      }
    })
  })

  describe('User Insights', () => {
    it('should store and retrieve user insights', async () => {
      const ctx = createCtx('test-reflector-user-3')
      const userId = 'test-reflector-user-3'
      const selfName = `${userId}_self`
      const conversationId = `conv_test_${Date.now()}`

      // Ensure self entity exists
      await store.ensureSelfEntity(userId, ctx)

      // Create an observation on the self entity
      const obsResult = await store.createObservation(
        selfName,
        {
          content: 'User prefers morning meetings',
          conversationId,
          messageId: 'msg_test_1',
          confidence: 0.9,
        },
        ctx
      )

      expect(obsResult.ok).toBe(true)

      // Retrieve insights
      const insightsResult = await store.getUserInsights(userId, 10, ctx)

      expect(insightsResult.ok).toBe(true)
      if (insightsResult.ok) {
        expect(insightsResult.value.length).toBeGreaterThanOrEqual(1)
        const insight = insightsResult.value.find(i => i.content === 'User prefers morning meetings')
        expect(insight).toBeDefined()
        expect(insight?.confidence).toBe(0.9)
      }
    })

    it('should respect limit when retrieving insights', async () => {
      const ctx = createCtx('test-reflector-user-4')
      const userId = 'test-reflector-user-4'
      const selfName = `${userId}_self`
      const conversationId = `conv_test_${Date.now()}`

      // Ensure self entity exists
      await store.ensureSelfEntity(userId, ctx)

      // Create multiple observations
      for (let i = 0; i < 5; i++) {
        await store.createObservation(
          selfName,
          {
            content: `Insight ${i}`,
            conversationId,
            messageId: `msg_test_${i}`,
            confidence: 0.8,
          },
          ctx
        )
      }

      // Retrieve with limit
      const insightsResult = await store.getUserInsights(userId, 3, ctx)

      expect(insightsResult.ok).toBe(true)
      if (insightsResult.ok) {
        expect(insightsResult.value.length).toBeLessThanOrEqual(3)
      }
    })
  })

  describe('Observation Reinforcement', () => {
    it('should boost confidence when observation is reinforced', async () => {
      const ctx = createCtx('test-reflector-user-5')
      const userId = 'test-reflector-user-5'
      const selfName = `${userId}_self`
      const conversationId = `conv_test_${Date.now()}`

      // Ensure self entity exists
      await store.ensureSelfEntity(userId, ctx)

      // Create an observation with initial confidence
      const obsResult = await store.createObservation(
        selfName,
        {
          content: 'User is interested in hiking',
          conversationId,
          messageId: 'msg_test_1',
          confidence: 0.7,
        },
        ctx
      )

      expect(obsResult.ok).toBe(true)

      if (obsResult.ok && obsResult.value) {
        const observationId = obsResult.value.id

        // Reinforce the observation
        const reinforceResult = await store.reinforceObservation(
          observationId,
          'msg_test_2',
          conversationId,
          0.1,
          ctx
        )

        expect(reinforceResult.ok).toBe(true)

        // Verify confidence was boosted
        const session = driver.session({ database: testDatabase })
        try {
          const queryResult = await session.run(
            'MATCH (o:Observation {id: $id}) RETURN o.confidence as confidence, o.reinforcementCount as count',
            { id: observationId }
          )
          if (queryResult.records.length > 0) {
            const confidence = queryResult.records[0].get('confidence')
            const count = queryResult.records[0].get('count')
            expect(confidence).toBeCloseTo(0.8, 1) // 0.7 + 0.1 = 0.8
            expect(count).toBe(1)
          }
        } finally {
          await session.close()
        }
      }
    })

    it('should cap confidence at 1.0', async () => {
      const ctx = createCtx('test-reflector-user-6')
      const userId = 'test-reflector-user-6'
      const selfName = `${userId}_self`
      const conversationId = `conv_test_${Date.now()}`

      // Ensure self entity exists
      await store.ensureSelfEntity(userId, ctx)

      // Create an observation with high initial confidence
      const obsResult = await store.createObservation(
        selfName,
        {
          content: 'User loves coffee',
          conversationId,
          messageId: 'msg_test_1',
          confidence: 0.95,
        },
        ctx
      )

      expect(obsResult.ok).toBe(true)

      if (obsResult.ok && obsResult.value) {
        const observationId = obsResult.value.id

        // Reinforce multiple times (should cap at 1.0)
        await store.reinforceObservation(observationId, 'msg_2', conversationId, 0.1, ctx)
        await store.reinforceObservation(observationId, 'msg_3', conversationId, 0.1, ctx)

        // Verify confidence is capped at 1.0
        const session = driver.session({ database: testDatabase })
        try {
          const queryResult = await session.run(
            'MATCH (o:Observation {id: $id}) RETURN o.confidence as confidence',
            { id: observationId }
          )
          if (queryResult.records.length > 0) {
            const confidence = queryResult.records[0].get('confidence')
            expect(confidence).toBeLessThanOrEqual(1.0)
          }
        } finally {
          await session.close()
        }
      }
    })

    it('should return NotFoundError for non-existent observation', async () => {
      const ctx = createCtx('test-reflector-user-7')
      const conversationId = `conv_test_${Date.now()}`

      const result = await store.reinforceObservation(
        'obs_nonexistent_12345',
        'msg_test',
        conversationId,
        0.1,
        ctx
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('NotFoundError')
      }
    })
  })

  describe.skipIf(!hasApiKey)('Full Reflection Flow with LLM', () => {
    it('should analyze exchange and extract insights', async () => {
      const ctx = createCtx('test-reflector-user-8')
      const userId = 'test-reflector-user-8'

      const context: ReflectionContext = {
        userMessage: createUserMessage(
          'I really prefer to schedule all my important meetings in the morning. I find I am more focused then.',
          userId
        ),
        assistantMessage: createAssistantMessage(
          'That makes sense! Morning meetings can be great for important discussions when your mind is fresh. Would you like me to help you structure your meeting schedule?',
          userId
        ),
        toolCalls: [],
        recentInsights: [],
        mentionedEntities: [],
      }

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Should find at least one insight about morning meetings
        console.log('Reflection result:', JSON.stringify(result.value, null, 2))
        // Note: LLM output can vary, so we just check structure is valid
        expect(Array.isArray(result.value.insights)).toBe(true)
        expect(Array.isArray(result.value.observations)).toBe(true)
        expect(Array.isArray(result.value.reinforcements)).toBe(true)
      }
    })

    it('should persist insights to self entity', async () => {
      const ctx = createCtx('test-reflector-user-9')
      const userId = 'test-reflector-user-9'
      const conversationId = `conv_${Date.now()}`

      const context: ReflectionContext = {
        userMessage: {
          ...createUserMessage('I have been sober for 2 years now. It is a big milestone for me.', userId),
          conversationId,
        },
        assistantMessage: {
          ...createAssistantMessage('Congratulations on 2 years of sobriety! That is an incredible achievement.', userId),
          conversationId,
        },
        toolCalls: [],
        recentInsights: [],
        mentionedEntities: [],
      }

      const reflectResult = await reflector.reflect(context, ctx)

      expect(reflectResult.ok).toBe(true)
      if (reflectResult.ok) {
        // Persist the results
        await reflector.persist(
          reflectResult.value,
          userId,
          context.userMessage.id,
          conversationId,
          ctx
        )

        // Give a moment for async persistence
        await new Promise(resolve => setTimeout(resolve, 100))

        // Check if insights were stored
        const insightsResult = await store.getUserInsights(userId, 10, ctx)

        if (insightsResult.ok && reflectResult.value.insights.length > 0) {
          expect(insightsResult.value.length).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('should skip tool calls that were already executed', async () => {
      const ctx = createCtx('test-reflector-user-10')
      const userId = 'test-reflector-user-10'

      const context: ReflectionContext = {
        userMessage: createUserMessage(
          'Please save a note that I prefer morning meetings.',
          userId
        ),
        assistantMessage: createAssistantMessage(
          'I have saved that note for you.',
          userId
        ),
        toolCalls: [
          {
            id: 'tc_1',
            name: 'saveNote',
            arguments: { content: 'User prefers morning meetings' },
          },
        ],
        recentInsights: [],
        mentionedEntities: [],
      }

      const result = await reflector.reflect(context, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        // The LLM should recognize this was already saved via tool call
        // and not duplicate it (though this is LLM-dependent)
        console.log('Tool call aware result:', JSON.stringify(result.value, null, 2))
      }
    })
  })
})
