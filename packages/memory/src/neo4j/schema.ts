/**
 * Neo4j Schema Setup
 *
 * Defines constraints and indexes for the knowledge graph.
 * Run once on application startup.
 */

import type { Driver } from 'neo4j-driver'
import { getLogger, withSpan } from '@recoverysky/observability'

/**
 * Cypher statements to create schema constraints and indexes
 */
export const SCHEMA_STATEMENTS = [
  // Unique constraint on entityId
  `CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.entityId IS UNIQUE`,

  // Indexes for common query patterns
  `CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)`,
  `CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)`,
  `CREATE INDEX entity_user IF NOT EXISTS FOR (e:Entity) ON (e.userId)`,
  `CREATE INDEX entity_last_mentioned IF NOT EXISTS FOR (e:Entity) ON (e.lastMentioned)`,

  // Composite index for user + type queries
  `CREATE INDEX entity_user_type IF NOT EXISTS FOR (e:Entity) ON (e.userId, e.type)`,
]

/**
 * Initialize the Neo4j schema with required constraints and indexes
 */
export async function initializeSchema(driver: Driver): Promise<void> {
  return withSpan('initializeNeo4jSchema', async () => {
    const logger = getLogger().child({ component: 'neo4j-schema' })
    const session = driver.session()

    try {
      logger.info('Initializing Neo4j schema')

      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await session.run(statement)
          logger.debug({ statement: statement.slice(0, 50) + '...' }, 'Schema statement executed')
        } catch (error) {
          // Ignore "already exists" errors
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (!errorMessage.includes('already exists')) {
            logger.warn({ error, statement }, 'Schema statement failed')
          }
        }
      }

      logger.info('Neo4j schema initialization complete')
    } finally {
      await session.close()
    }
  })
}

/**
 * Drop all schema constraints and indexes (for testing)
 */
export async function dropSchema(driver: Driver): Promise<void> {
  return withSpan('dropNeo4jSchema', async () => {
    const logger = getLogger().child({ component: 'neo4j-schema' })
    const session = driver.session()

    try {
      logger.warn('Dropping Neo4j schema')

      // Get all constraints and drop them
      const constraintsResult = await session.run('SHOW CONSTRAINTS')
      for (const record of constraintsResult.records) {
        const name = record.get('name')
        if (name) {
          await session.run(`DROP CONSTRAINT ${name} IF EXISTS`)
        }
      }

      // Get all indexes and drop them
      const indexesResult = await session.run('SHOW INDEXES')
      for (const record of indexesResult.records) {
        const name = record.get('name')
        const type = record.get('type')
        // Don't drop lookup indexes (they're built-in)
        if (name && type !== 'LOOKUP') {
          await session.run(`DROP INDEX ${name} IF EXISTS`)
        }
      }

      logger.info('Neo4j schema dropped')
    } finally {
      await session.close()
    }
  })
}

/**
 * Clear all data but keep schema (for testing)
 */
export async function clearData(driver: Driver): Promise<void> {
  return withSpan('clearNeo4jData', async () => {
    const logger = getLogger().child({ component: 'neo4j-schema' })
    const session = driver.session()

    try {
      logger.warn('Clearing all Neo4j data')

      // Delete all nodes and relationships in batches to avoid memory issues
      let deleted = 0
      do {
        const result = await session.run(`
          MATCH (n)
          WITH n LIMIT 10000
          DETACH DELETE n
          RETURN count(*) as deleted
        `)
        deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0
      } while (deleted > 0)

      logger.info('Neo4j data cleared')
    } finally {
      await session.close()
    }
  })
}
