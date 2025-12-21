/**
 * Integration tests for Neo4jKnowledgeStore
 *
 * These tests run against a real Neo4j instance.
 * Requires: docker-compose up -d (neo4j service)
 *
 * Run with: pnpm vitest run packages/memory/tests/stores/Neo4jKnowledgeStore.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import neo4j, { Driver } from 'neo4j-driver'
import { Neo4jKnowledgeStore } from '../../src/stores/Neo4jKnowledgeStore.js'
import type { Entity, TraceContext } from '@pippa/types'

// Skip if NEO4J_URI not set (CI without Neo4j)
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'testpassword'

const shouldSkip = !process.env.RUN_INTEGRATION_TESTS

describe.skipIf(shouldSkip)('Neo4jKnowledgeStore Integration', () => {
  let driver: Driver
  let store: Neo4jKnowledgeStore
  const testDatabase = 'neo4j' // Use default database for tests

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
      await session.run('MATCH (e:Entity) WHERE e.userId STARTS WITH "test-" DETACH DELETE e')
    } finally {
      await session.close()
    }
  })

  describe('Relationship Creation Bug Investigation', () => {
    it('should create relationships when entities exist with exact names', async () => {
      const ctx = createCtx('test-user-rel-1')
      const now = Date.now()

      // Step 1: Create two entities
      const entity1: Entity = {
        entityId: `${ctx.userId}_person_alex`,
        name: 'alex',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId, importance: 0.8, context: 'Friend from work' },
      }

      const entity2: Entity = {
        entityId: `${ctx.userId}_place_google`,
        name: 'google',
        type: 'place',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId, importance: 0.7, context: 'Tech company' },
      }

      const upsert1 = await store.upsertEntity(entity1, ctx)
      const upsert2 = await store.upsertEntity(entity2, ctx)

      expect(upsert1.ok).toBe(true)
      expect(upsert2.ok).toBe(true)

      // Step 2: Create relationship
      const relResult = await store.createRelationship(
        'alex',
        'google',
        'WORKS_AT',
        { strength: 0.9, userId: ctx.userId, context: 'Software engineer' },
        ctx
      )

      expect(relResult.ok).toBe(true)

      // Step 3: Verify relationship was created
      const relCount = await store.getRelationshipCount(ctx)
      expect(relCount.ok).toBe(true)
      if (relCount.ok) {
        expect(relCount.value).toBeGreaterThanOrEqual(1)
      }

      // Step 4: Verify via getRelatedEntities
      const related = await store.getRelatedEntities('alex', 1, ctx)
      expect(related.ok).toBe(true)
      if (related.ok) {
        expect(related.value.length).toBeGreaterThanOrEqual(1)
        expect(related.value.some(e => e.name === 'google')).toBe(true)
      }
    })

    it('should FAIL to create relationship when entity names do not match (case mismatch)', async () => {
      const ctx = createCtx('test-user-rel-2')
      const now = Date.now()

      // Create entity with lowercase name
      const entity: Entity = {
        entityId: `${ctx.userId}_person_alex`,
        name: 'alex', // lowercase
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }

      await store.upsertEntity(entity, ctx)

      // Try to create relationship with different case
      // This simulates what happens when LLM returns "Alex" in relationships but "alex" in entities
      const relResult = await store.createRelationship(
        'Alex', // uppercase A - will be lowercased to 'alex'
        'NonExistent', // This entity doesn't exist
        'KNOWS',
        { strength: 0.5 },
        ctx
      )

      // The call succeeds (no error thrown) but no relationship is created
      // because "nonexistent" entity doesn't exist
      expect(relResult.ok).toBe(true)

      // Verify NO relationship was created (this is the bug - silent failure)
      const related = await store.getRelatedEntities('alex', 1, ctx)
      expect(related.ok).toBe(true)
      if (related.ok) {
        // Should be empty because 'nonexistent' entity doesn't exist
        expect(related.value.length).toBe(0)
      }
    })

    it('should demonstrate the LLM name mismatch problem', async () => {
      const ctx = createCtx('test-user-rel-3')
      const now = Date.now()

      // Simulate what EntityExtractor does:
      // 1. LLM extracts entity: { name: "John Smith", type: "person" }
      // 2. EntityExtractor stores with: name: entity.name.toLowerCase() = "john smith"
      const entity: Entity = {
        entityId: `${ctx.userId}_person_john_smith`,
        name: 'john smith', // This is what gets stored (lowercased)
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }

      await store.upsertEntity(entity, ctx)

      // Simulate LLM extracting relationship: { from: "John", to: "Work", type: "TRIGGERS" }
      // The LLM might use a shortened name "John" instead of "John Smith"
      const relResult = await store.createRelationship(
        'John', // LLM returned "John" but entity is "john smith"
        'work', // Doesn't exist at all
        'TRIGGERS',
        { strength: 0.8 },
        ctx
      )

      // This "succeeds" but actually does nothing
      expect(relResult.ok).toBe(true)

      // Verify the issue - no related entities found
      const related = await store.getRelatedEntities('john smith', 1, ctx)
      expect(related.ok).toBe(true)
      if (related.ok) {
        expect(related.value.length).toBe(0) // BUG: Relationship was silently not created
      }
    })

    it('should verify MATCH silently returns nothing for non-existent entities', async () => {
      const ctx = createCtx('test-user-rel-4')

      // Create relationship between entities that don't exist
      const relResult = await store.createRelationship(
        'phantom1',
        'phantom2',
        'GHOST_REL',
        { strength: 1.0 },
        ctx
      )

      // No error is thrown - this is the problem!
      expect(relResult.ok).toBe(true)

      // But relationship count should be 0
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          MATCH (:Entity {name: 'phantom1'})-[r:GHOST_REL]->(:Entity {name: 'phantom2'})
          RETURN count(r) as count
        `)
        const count = result.records[0]?.get('count')?.toNumber() ?? 0
        expect(count).toBe(0) // Confirms: relationship was NOT created
      } finally {
        await session.close()
      }
    })
  })

  describe('Proposed Fix: Verify entities exist before relationship creation', () => {
    it('should demonstrate fix using OPTIONAL MATCH and conditional MERGE', async () => {
      const ctx = createCtx('test-user-fix-1')
      const now = Date.now()

      // Create only one entity
      const entity: Entity = {
        entityId: `${ctx.userId}_person_alice`,
        name: 'alice',
        type: 'person',
        firstMentioned: now,
        lastMentioned: now,
        properties: { userId: ctx.userId },
      }

      await store.upsertEntity(entity, ctx)

      // Try proposed fix query - returns whether entities existed
      const session = driver.session({ database: testDatabase })
      try {
        const result = await session.run(`
          OPTIONAL MATCH (from:Entity {name: $fromEntity})
          OPTIONAL MATCH (to:Entity {name: $toEntity})
          WITH from, to,
               CASE WHEN from IS NOT NULL AND to IS NOT NULL THEN true ELSE false END as canCreate
          FOREACH (_ IN CASE WHEN canCreate THEN [1] ELSE [] END |
            MERGE (from)-[r:TEST_REL]->(to)
            ON CREATE SET r.strength = 1, r.createdAt = timestamp()
          )
          RETURN from IS NOT NULL as fromExists, to IS NOT NULL as toExists, canCreate
        `, {
          fromEntity: 'alice',
          toEntity: 'nonexistent',
        })

        const record = result.records[0]
        expect(record.get('fromExists')).toBe(true)
        expect(record.get('toExists')).toBe(false)
        expect(record.get('canCreate')).toBe(false)
      } finally {
        await session.close()
      }
    })
  })
})
