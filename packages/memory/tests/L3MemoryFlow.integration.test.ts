/**
 * L3 Memory Flow Integration Tests
 *
 * Comprehensive tests to verify entities are being stored to Neo4j correctly.
 * These tests run against a real Neo4j instance.
 *
 * Requires:
 *   - docker-compose up -d (neo4j service)
 *   - RUN_INTEGRATION_TESTS=true
 *
 * Run with:
 *   RUN_INTEGRATION_TESTS=true pnpm vitest run packages/memory/tests/L3MemoryFlow.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import neo4j, { Driver } from 'neo4j-driver'
import { Neo4jKnowledgeStore } from '../src/stores/Neo4jKnowledgeStore.js'
import { EntityExtractor, type ExtractionMode } from '../src/extraction/EntityExtractor.js'
import type { Entity, Message, TraceContext, L3Entity } from '@siri/types'
import Anthropic from '@anthropic-ai/sdk'

// Skip if not running integration tests
const shouldSkip = !process.env.RUN_INTEGRATION_TESTS
const hasApiKey = !!process.env.ANTHROPIC_API_KEY

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'testpassword'

describe.skipIf(shouldSkip)('L3 Memory Flow Integration', () => {
  let driver: Driver
  let store: Neo4jKnowledgeStore
  const testDatabase = 'neo4j'

  const createCtx = (userId = 'test-user'): TraceContext => ({
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    spanId: 'span-test',
    traceId: 'trace-test',
    startTime: Date.now(),
    userId,
  })

  beforeAll(async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    store = new Neo4jKnowledgeStore(driver, { defaultDatabase: testDatabase })

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
      await session.run('MATCH (n) WHERE n.userId STARTS WITH "test-" DETACH DELETE n')
      await session.run('MATCH (e:Entity) WHERE e.name STARTS WITH "test" DETACH DELETE e')
    } finally {
      await session.close()
    }
  })

  describe('1. Basic Entity Storage (Legacy Path)', () => {
    it('should store an entity using upsertEntity', async () => {
      const ctx = createCtx('test-legacy-1')
      const now = Date.now()

      const entity: Entity = {
        entityId: `${ctx.userId}_person_john`,
        name: 'john',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: {
          userId: ctx.userId,
          importance: 0.8,
          context: 'Best friend from childhood',
        },
      }

      const result = await store.upsertEntity(entity, ctx)
      if (!result.ok) {
        console.error('upsertEntity failed:', result.error)
      }
      expect(result.ok).toBe(true)

      // Verify entity was stored via direct query
      const session = driver.session({ database: testDatabase })
      try {
        const queryResult = await session.run(
          'MATCH (e:Entity {entityId: $entityId}) RETURN e',
          { entityId: entity.entityId }
        )
        expect(queryResult.records.length).toBe(1)
        const node = queryResult.records[0].get('e')
        expect(node.properties.name).toBe('john')
        expect(node.properties.type).toBe('person')
      } finally {
        await session.close()
      }
    })

    it('should update entity on second upsert', async () => {
      const ctx = createCtx('test-legacy-2')
      const now = Date.now()

      const entity: Entity = {
        entityId: `${ctx.userId}_person_jane`,
        name: 'jane',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId, context: 'Original context' },
      }

      await store.upsertEntity(entity, ctx)

      // Update with new context
      const updated: Entity = {
        ...entity,
        lastMentioned: now + 1000,
        properties: { userId: ctx.userId, context: 'Updated context' },
      }

      const result = await store.upsertEntity(updated, ctx)
      expect(result.ok).toBe(true)

      // Verify updated via direct query
      const session = driver.session({ database: testDatabase })
      try {
        const queryResult = await session.run(
          'MATCH (e:Entity {entityId: $entityId}) RETURN e',
          { entityId: entity.entityId }
        )
        expect(queryResult.records.length).toBe(1)
        const node = queryResult.records[0].get('e')
        const props = JSON.parse(node.properties.properties || '{}')
        expect(props.context).toBe('Updated context')
      } finally {
        await session.close()
      }
    })
  })

  describe('2. L3 Entity Storage', () => {
    it('should store an L3 entity with rich metadata', async () => {
      const ctx = createCtx('test-l3-1')

      const l3Entity: Partial<L3Entity> = {
        name: 'testjohn',
        displayName: 'John Smith',
        aliases: ['johnny', 'j-man'],
        canonicalType: 'person',
        labels: ['friend', 'coworker'],
        importance: 0.9,
        metadata: {
          context: 'Known from work',
        },
      }

      const result = await store.upsertL3Entity(l3Entity, ctx)
      if (!result.ok) {
        console.error('upsertL3Entity failed:', result.error)
      }
      expect(result.ok).toBe(true)

      // Verify via direct query
      const session = driver.session({ database: testDatabase })
      try {
        const queryResult = await session.run(
          'MATCH (e:Entity {name: $name}) RETURN e',
          { name: 'testjohn' }
        )
        expect(queryResult.records.length).toBe(1)

        const node = queryResult.records[0].get('e')
        expect(node.properties.displayName).toBe('John Smith')
        expect(node.properties.canonicalType).toBe('person')
        expect(node.properties.importance).toBeCloseTo(0.9, 1)
      } finally {
        await session.close()
      }
    })

    it('should retrieve L3 entity with getL3Entity', async () => {
      const ctx = createCtx('test-l3-2')

      // Store entity
      await store.upsertL3Entity({
        name: 'testalice',
        displayName: 'Alice',
        canonicalType: 'person',
        importance: 0.7,
      }, ctx)

      // Retrieve
      const result = await store.getL3Entity('testalice', ctx)
      expect(result.ok).toBe(true)
      if (result.ok && result.value) {
        expect(result.value.name).toBe('testalice')
        expect(result.value.displayName).toBe('Alice')
        expect(result.value.canonicalType).toBe('person')
      }
    })
  })

  describe('3. Relationship Creation Issues', () => {
    it('should create relationship when BOTH entities exist', async () => {
      const ctx = createCtx('test-rel-success')
      const now = Date.now()

      // Create both entities first
      await store.upsertEntity({
        entityId: `${ctx.userId}_person_bob`,
        name: 'bob',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }, ctx)

      await store.upsertEntity({
        entityId: `${ctx.userId}_place_office`,
        name: 'office',
        type: 'place',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }, ctx)

      // Create relationship
      const relResult = await store.createRelationship(
        'bob',
        'office',
        'WORKS_AT',
        { strength: 0.8, userId: ctx.userId },
        ctx
      )
      expect(relResult.ok).toBe(true)

      // Verify relationship exists
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (a:Entity {name: 'bob'})-[r:WORKS_AT]->(b:Entity {name: 'office'})
          RETURN count(r) as count
        `)
        const count = result.records[0]?.get('count')?.toNumber() ?? 0
        expect(count).toBe(1)
      } finally {
        await session.close()
      }
    })

    it('should SILENTLY FAIL when target entity does not exist (BUG)', async () => {
      const ctx = createCtx('test-rel-fail')
      const now = Date.now()

      // Create only one entity
      await store.upsertEntity({
        entityId: `${ctx.userId}_person_charlie`,
        name: 'charlie',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }, ctx)

      // Try to create relationship to non-existent entity
      const relResult = await store.createRelationship(
        'charlie',
        'nonexistent',
        'KNOWS',
        { strength: 0.5 },
        ctx
      )

      // BUG: Returns ok(undefined) even though nothing was created
      expect(relResult.ok).toBe(true)

      // Verify NO relationship was created
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (a:Entity {name: 'charlie'})-[r:KNOWS]->()
          RETURN count(r) as count
        `)
        const count = result.records[0]?.get('count')?.toNumber() ?? 0
        expect(count).toBe(0) // Silent failure - relationship not created
      } finally {
        await session.close()
      }
    })

    it('should SILENTLY FAIL when neither entity exists (BUG)', async () => {
      const ctx = createCtx('test-rel-neither')

      // No entities created - try to create relationship
      const relResult = await store.createRelationship(
        'ghost1',
        'ghost2',
        'HAUNTS',
        { strength: 1.0 },
        ctx
      )

      // BUG: Returns ok even though nothing happened
      expect(relResult.ok).toBe(true)

      // Verify no entities or relationships were created
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (a:Entity {name: 'ghost1'})-[r:HAUNTS]->(b:Entity {name: 'ghost2'})
          RETURN count(r) as count
        `)
        const count = result.records[0]?.get('count')?.toNumber() ?? 0
        expect(count).toBe(0)
      } finally {
        await session.close()
      }
    })
  })

  describe('4. L3 Relationship Creation', () => {
    it('should create L3 relationship using createL3Relationship', async () => {
      const ctx = createCtx('test-l3-rel-1')

      // Create entities using L3 method
      await store.upsertL3Entity({
        name: 'testdavid',
        displayName: 'David',
        canonicalType: 'person',
      }, ctx)

      await store.upsertL3Entity({
        name: 'testproject',
        displayName: 'Project Alpha',
        canonicalType: 'thing',
      }, ctx)

      // Create L3 relationship
      const relResult = await store.createL3Relationship(
        'testdavid',
        'testproject',
        'MANAGES',
        { strength: 0.9, context: 'Since 2024' },
        ctx
      )

      if (!relResult.ok) {
        console.error('createL3Relationship failed:', relResult.error)
      }
      expect(relResult.ok).toBe(true)

      // Debug: verify entities exist
      const debugSession = driver.session({ database: testDatabase })
      try {
        const entities = await debugSession.run(
          'MATCH (e:Entity) WHERE e.name IN ["testdavid", "testproject"] RETURN e.name as name'
        )
        console.log('Entities found for relationship:', entities.records.map(r => r.get('name')))
      } finally {
        await debugSession.close()
      }

      // Verify relationship (type is lowercased by createL3Relationship)
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (a:Entity {name: 'testdavid'})-[r:RELATES_TO {type: 'manages'}]->(b:Entity {name: 'testproject'})
          RETURN r
        `)
        expect(result.records.length).toBe(1)
      } finally {
        await session.close()
      }
    })
  })

  describe('5. Observation Storage', () => {
    it('should create observation linked to entity', async () => {
      const ctx = createCtx('test-obs-1')

      // Create entity first
      await store.upsertL3Entity({
        name: 'testeve',
        displayName: 'Eve',
        canonicalType: 'person',
      }, ctx)

      // Create observation
      const obsResult = await store.createObservation(
        'testeve',
        {
          content: 'Eve mentioned she likes hiking',
          conversationId: 'conv-123',
          messageId: 'msg-456',
          confidence: 0.85,
        },
        ctx
      )

      expect(obsResult.ok).toBe(true)

      // Verify observation exists and is linked
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (e:Entity {name: 'testeve'})-[:HAS_OBSERVATION]->(o:Observation)
          RETURN o.content as content, o.confidence as confidence
        `)
        expect(result.records.length).toBe(1)
        expect(result.records[0].get('content')).toBe('Eve mentioned she likes hiking')
      } finally {
        await session.close()
      }
    })

    it('should SILENTLY FAIL when entity does not exist (BUG)', async () => {
      const ctx = createCtx('test-obs-fail')

      // Try to create observation for non-existent entity
      const obsResult = await store.createObservation(
        'nonexistent_entity',
        {
          content: 'This should fail but does not return error',
          conversationId: 'conv-789',
          messageId: 'msg-012',
          confidence: 0.9,
        },
        ctx
      )

      // BUG: Returns ok even if entity doesn't exist
      // The observation might be created as orphan OR not at all
      expect(obsResult.ok).toBe(true)

      // Verify observation is NOT properly linked
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (e:Entity {name: 'nonexistent_entity'})-[:HAS_OBSERVATION]->(o:Observation)
          RETURN count(o) as count
        `)
        const count = result.records[0]?.get('count')?.toNumber() ?? 0
        expect(count).toBe(0) // Observation not created because entity doesn't exist
      } finally {
        await session.close()
      }
    })
  })

  describe('6. Entity Count Verification', () => {
    it('should accurately count entities for a user', async () => {
      const ctx = createCtx('test-count-user')
      const now = Date.now()

      // Create 3 entities
      for (let i = 0; i < 3; i++) {
        await store.upsertEntity({
          entityId: `${ctx.userId}_person_testperson${i}`,
          name: `testperson${i}`,
          type: 'person',
          firstMentioned: now,
          lastMentioned: now,
          properties: { userId: ctx.userId },
        }, ctx)
      }

      const countResult = await store.getEntityCount(ctx)
      expect(countResult.ok).toBe(true)
      if (countResult.ok) {
        expect(countResult.value).toBeGreaterThanOrEqual(3)
      }
    })
  })

  describe('7. Search Entities', () => {
    it('should find entities by type', async () => {
      const ctx = createCtx('test-search-type')
      const now = Date.now()

      // Create entities of different types
      await store.upsertEntity({
        entityId: `${ctx.userId}_person_testfrank`,
        name: 'testfrank',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }, ctx)

      await store.upsertEntity({
        entityId: `${ctx.userId}_place_testcafe`,
        name: 'testcafe',
        type: 'place',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }, ctx)

      // Search for 'person' type pattern
      const searchResult = await store.searchEntities('person', ctx)
      if (!searchResult.ok) {
        console.error('searchEntities failed:', searchResult.error)
      }
      expect(searchResult.ok).toBe(true)
      if (searchResult.ok) {
        // Should find testfrank (person type)
        expect(searchResult.value.some(e => e.name === 'testfrank')).toBe(true)
        // Should NOT find testcafe in results (it's type 'place')
        expect(searchResult.value.some(e => e.name === 'testcafe')).toBe(false)
      }
    })
  })

  // This test requires ANTHROPIC_API_KEY
  describe.skipIf(!hasApiKey)('8. Full EntityExtractor Flow', () => {
    let extractor: EntityExtractor

    beforeAll(() => {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      extractor = new EntityExtractor(
        anthropic,
        store,
        {
          mode: 'all' as ExtractionMode,
          model: 'claude-3-haiku-20240307',
          enabledTypes: ['person', 'place', 'emotion'],
          minImportance: 0.3,
          inferRelationships: true,
        },
        // Enable L3 extraction
        { l3Store: store, useL3Extraction: true }
      )
    })

    it('should extract and store entities from conversation', async () => {
      const ctx = createCtx('test-extractor-flow')

      const userMessage: Message = {
        id: 'msg-test-1',
        conversationId: 'conv-test-1',
        userId: ctx.userId!,
        role: 'user',
        content: 'I had lunch with my friend TestSarah at TestBlueCafe downtown. It was a really happy moment.',
        timestamp: Date.now(),
      }

      const assistantMessage: Message = {
        id: 'msg-test-2',
        conversationId: 'conv-test-1',
        userId: ctx.userId!,
        role: 'assistant',
        content: 'It sounds like you had a wonderful time with TestSarah! TestBlueCafe sounds like a nice spot.',
        timestamp: Date.now() + 1000,
      }

      const result = await extractor.extract(userMessage, assistantMessage, 1, ctx)

      expect(result.ok).toBe(true)
      if (result.ok) {
        console.log('Extracted entities:', result.value.entities)
        console.log('Extracted relationships:', result.value.relationships)

        // Should have extracted some entities
        expect(result.value.entities.length).toBeGreaterThan(0)

        // Verify entities are in Neo4j
        const session = driver.session({ database: testDatabase })
        try {
          // Check for any entities we just created
          const queryResult = await session.run(`
            MATCH (e:Entity)
            WHERE e.name CONTAINS 'testsarah' OR e.name CONTAINS 'testbluecafe'
            RETURN e.name as name, e.type as type
          `)
          console.log('Stored entities:', queryResult.records.map(r => ({
            name: r.get('name'),
            type: r.get('type'),
          })))

          // At least one entity should be stored
          expect(queryResult.records.length).toBeGreaterThan(0)
        } finally {
          await session.close()
        }
      }
    }, 30000) // 30 second timeout for API call
  })
})
