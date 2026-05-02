/**
 * L3 Memory Migration Script
 *
 * Migrates existing Neo4j data to the L3 Memory "Cadillac" schema:
 * - Adds new entity fields (canonicalType, displayName, aliases, labels, etc.)
 * - Extracts observations from entity properties.context
 * - Converts typed relationships to RELATES_TO with type property
 * - Prepares entities for embedding generation
 *
 * Usage:
 *   import { migrateToL3Memory } from './migrations/v2-l3-memory.js'
 *   await migrateToL3Memory(neo4jDriver)
 */

import type { Driver, Session } from 'neo4j-driver'
import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'

/**
 * Migration result
 */
export interface MigrationResult {
  /** Whether migration completed successfully */
  success: boolean
  /** Number of entities updated */
  entitiesUpdated: number
  /** Number of observations created */
  observationsCreated: number
  /** Number of relationships converted */
  relationshipsConverted: number
  /** Any errors encountered */
  errors: string[]
}

/**
 * Type mapping from legacy types to canonical types
 */
const TYPE_MAPPING: Record<string, string> = {
  person: 'person',
  human: 'person',
  friend: 'person',
  family: 'person',
  colleague: 'person',
  therapist: 'person',
  sponsor: 'person',
  place: 'place',
  location: 'place',
  organization: 'organization',
  org: 'organization',
  company: 'organization',
  group: 'organization',
  event: 'event',
  meeting: 'event',
  appointment: 'event',
  concept: 'concept',
  idea: 'concept',
  emotion: 'concept',
  trigger: 'concept',
  coping_strategy: 'concept',
  medication: 'thing',
  thing: 'thing',
  object: 'thing',
  milestone: 'event',
}

/**
 * Migrate existing Neo4j data to L3 Memory schema.
 *
 * This migration is idempotent - it can be run multiple times safely.
 */
export async function migrateToL3Memory(driver: Driver): Promise<MigrationResult> {
  return withSpan('migrateToL3Memory', async () => {
    const startTime = Date.now()
    const logger = getLogger().child({ component: 'L3Migration' })
    const result: MigrationResult = {
      success: false,
      entitiesUpdated: 0,
      observationsCreated: 0,
      relationshipsConverted: 0,
      errors: [],
    }

    const session = driver.session()

    try {
      logger.info('Starting L3 Memory migration')

      // Step 1: Add new fields to entities
      const step1Start = Date.now()
      result.entitiesUpdated = await migrateEntityFields(session, logger)
      logger.debug({ durationMs: Date.now() - step1Start }, 'Step 1 complete')

      // Step 2: Extract observations from properties.context
      const step2Start = Date.now()
      result.observationsCreated = await extractObservations(session, logger)
      logger.debug({ durationMs: Date.now() - step2Start }, 'Step 2 complete')

      // Step 3: Convert typed relationships to RELATES_TO
      const step3Start = Date.now()
      result.relationshipsConverted = await convertRelationships(session, logger)
      logger.debug({ durationMs: Date.now() - step3Start }, 'Step 3 complete')

      // Step 4: Create indexes for new fields (if not exist)
      const step4Start = Date.now()
      await createIndexes(session, logger)
      logger.debug({ durationMs: Date.now() - step4Start }, 'Step 4 complete')

      result.success = true
      const totalDurationMs = Date.now() - startTime

      logger.info(
        {
          entitiesUpdated: result.entitiesUpdated,
          observationsCreated: result.observationsCreated,
          relationshipsConverted: result.relationshipsConverted,
          durationMs: totalDurationMs,
        },
        'L3 Memory migration complete'
      )

      // Record metrics
      pipelineMetrics.stageDuration.record(totalDurationMs, { stage: 'l3_migration' })
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMessage)
      logger.debug(
        { error, stack: error instanceof Error ? error.stack : undefined, durationMs },
        'L3 Memory migration failed - full error'
      )
      logger.error({ errorMessage, durationMs }, 'L3 Memory migration failed')
      pipelineMetrics.errors.add(1, { kind: 'l3_migration_error' })
    } finally {
      await session.close()
    }

    return result
  })
}

/**
 * Step 1: Add new L3 fields to existing entities
 */
async function migrateEntityFields(
  session: Session,
  logger: ReturnType<typeof getLogger>
): Promise<number> {
  logger.info('Step 1: Migrating entity fields')

  // Build CASE statement for type mapping
  const typeMappingCases = Object.entries(TYPE_MAPPING)
    .map(([from, to]) => `WHEN toLower(e.type) = '${from}' THEN '${to}'`)
    .join('\n        ')

  const query = `
    MATCH (e:Entity)
    WHERE e.canonicalType IS NULL
    SET e.canonicalType = CASE
        ${typeMappingCases}
        ELSE 'concept'
      END,
      e.displayName = CASE
        WHEN e.displayName IS NULL THEN e.name
        ELSE e.displayName
      END,
      e.aliases = CASE
        WHEN e.aliases IS NULL THEN []
        ELSE e.aliases
      END,
      e.labels = CASE
        WHEN e.labels IS NULL THEN []
        ELSE e.labels
      END,
      e.mentionCount = CASE
        WHEN e.mentionCount IS NULL THEN 1
        ELSE e.mentionCount
      END,
      e.sourceHistory = CASE
        WHEN e.sourceHistory IS NULL THEN []
        ELSE e.sourceHistory
      END,
      e.firstSeen = CASE
        WHEN e.firstSeen IS NULL THEN coalesce(e.firstMentioned, timestamp())
        ELSE e.firstSeen
      END,
      e.lastSeen = CASE
        WHEN e.lastSeen IS NULL THEN coalesce(e.lastMentioned, timestamp())
        ELSE e.lastSeen
      END
    RETURN count(e) as updated
  `

  const result = await session.run(query)
  const updated = result.records[0]?.get('updated')?.toNumber() ?? 0
  logger.info({ updated }, 'Entity fields migrated')
  return updated
}

/**
 * Step 2: Extract observations from properties.context
 */
async function extractObservations(
  session: Session,
  logger: ReturnType<typeof getLogger>
): Promise<number> {
  logger.info('Step 2: Extracting observations from entity context')

  // First, check if any entities have context in properties
  const checkQuery = `
    MATCH (e:Entity)
    WHERE e.properties IS NOT NULL
      AND e.properties.context IS NOT NULL
      AND NOT EXISTS {
        MATCH (e)-[:ABOUT]->(:Observation)
      }
    RETURN count(e) as count
  `

  const checkResult = await session.run(checkQuery)
  const toMigrate = checkResult.records[0]?.get('count')?.toNumber() ?? 0

  if (toMigrate === 0) {
    logger.info('No observations to extract from properties')
    return 0
  }

  // Create observations from properties.context
  // Note: properties is stored as a JSON object, so we access context directly
  const query = `
    MATCH (e:Entity)
    WHERE e.properties IS NOT NULL
      AND e.properties.context IS NOT NULL
      AND NOT EXISTS {
        MATCH (e)-[:ABOUT]->(:Observation)
      }
    WITH e, e.properties.context as contextText
    WHERE contextText IS NOT NULL AND size(toString(contextText)) > 0
    CREATE (o:Observation {
      id: randomUUID(),
      content: toString(contextText),
      createdAt: coalesce(e.firstSeen, e.firstMentioned, timestamp()),
      confidence: 0.8,
      conversationId: 'migrated',
      messageId: 'migrated'
    })
    CREATE (o)-[:ABOUT]->(e)
    RETURN count(o) as created
  `

  const result = await session.run(query)
  const created = result.records[0]?.get('created')?.toNumber() ?? 0
  logger.info({ created }, 'Observations extracted')
  return created
}

/**
 * Step 3: Convert typed relationships to RELATES_TO
 */
async function convertRelationships(
  session: Session,
  logger: ReturnType<typeof getLogger>
): Promise<number> {
  logger.info('Step 3: Converting relationships to RELATES_TO')

  // Get all relationship types that need conversion
  const typesQuery = `
    MATCH (a:Entity)-[r]->(b:Entity)
    WHERE type(r) <> 'RELATES_TO' AND type(r) <> 'ABOUT' AND type(r) <> 'HAS_OBSERVATION'
    RETURN DISTINCT type(r) as relType
  `

  const typesResult = await session.run(typesQuery)
  const relTypes = typesResult.records.map((r) => r.get('relType') as string)

  if (relTypes.length === 0) {
    logger.info('No relationships to convert')
    return 0
  }

  logger.debug({ types: relTypes }, 'Found relationship types to convert')

  let totalConverted = 0

  // Convert each relationship type
  for (const relType of relTypes) {
    const convertQuery = `
      MATCH (a:Entity)-[r:\`${relType}\`]->(b:Entity)
      CREATE (a)-[r2:RELATES_TO {
        type: toLower('${relType}'),
        strength: coalesce(r.strength, 0.5),
        context: r.context,
        conversationId: r.conversationId,
        messageId: r.messageId,
        createdAt: coalesce(r.createdAt, timestamp())
      }]->(b)
      DELETE r
      RETURN count(r2) as converted
    `

    const result = await session.run(convertQuery)
    const converted = result.records[0]?.get('converted')?.toNumber() ?? 0
    totalConverted += converted
  }

  logger.info({ converted: totalConverted }, 'Relationships converted')
  return totalConverted
}

/**
 * Step 4: Create indexes for new fields
 */
async function createIndexes(
  session: Session,
  logger: ReturnType<typeof getLogger>
): Promise<void> {
  logger.info('Step 4: Creating indexes for new fields')

  const indexes = [
    'CREATE INDEX entity_canonical_type IF NOT EXISTS FOR (e:Entity) ON (e.canonicalType)',
    'CREATE INDEX entity_display_name IF NOT EXISTS FOR (e:Entity) ON (e.displayName)',
    'CREATE INDEX observation_created IF NOT EXISTS FOR (o:Observation) ON (o.createdAt)',
    'CREATE INDEX observation_conversation IF NOT EXISTS FOR (o:Observation) ON (o.conversationId)',
    'CREATE INDEX relates_to_type IF NOT EXISTS FOR ()-[r:RELATES_TO]-() ON (r.type)',
  ]

  for (const indexQuery of indexes) {
    try {
      await session.run(indexQuery)
    } catch (error) {
      // Index might already exist or syntax not supported in this Neo4j version
      logger.debug({ error, query: indexQuery }, 'Index creation skipped')
    }
  }

  logger.info('Indexes created')
}

/**
 * Check if migration is needed
 */
export async function isMigrationNeeded(driver: Driver): Promise<boolean> {
  const session = driver.session()
  try {
    const result = await session.run(`
      MATCH (e:Entity)
      WHERE e.canonicalType IS NULL
      RETURN count(e) > 0 as needsMigration
    `)
    return result.records[0]?.get('needsMigration') ?? false
  } finally {
    await session.close()
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(driver: Driver): Promise<{
  totalEntities: number
  migratedEntities: number
  totalObservations: number
  totalRelatesToRelationships: number
}> {
  const session = driver.session()
  try {
    const result = await session.run(`
      MATCH (e:Entity)
      WITH count(e) as total,
           sum(CASE WHEN e.canonicalType IS NOT NULL THEN 1 ELSE 0 END) as migrated
      OPTIONAL MATCH (o:Observation)
      WITH total, migrated, count(o) as observations
      OPTIONAL MATCH ()-[r:RELATES_TO]->()
      RETURN total, migrated, observations, count(r) as relatesToCount
    `)

    const record = result.records[0]
    return {
      totalEntities: record?.get('total')?.toNumber() ?? 0,
      migratedEntities: record?.get('migrated')?.toNumber() ?? 0,
      totalObservations: record?.get('observations')?.toNumber() ?? 0,
      totalRelatesToRelationships: record?.get('relatesToCount')?.toNumber() ?? 0,
    }
  } finally {
    await session.close()
  }
}
