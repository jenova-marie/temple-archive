/**
 * Neo4j Knowledge Store - L3 Memory Tier
 *
 * Implements IKnowledgeStore using Neo4j graph database for
 * entity storage and relationship tracking.
 *
 * ## Neo4j Version Compatibility
 *
 * This implementation uses standard Cypher without APOC dependencies.
 *
 * In Neo4j 5.x, the APOC plugin was restructured into two editions:
 * - **APOC Core**: Included by default in Neo4j installation/Docker images
 * - **APOC Extended**: Must be manually installed (contains external dependencies)
 *
 * We intentionally avoid APOC to ensure compatibility across all Neo4j deployments:
 * - Neo4j Community Edition
 * - Neo4j Enterprise Edition
 * - Neo4j Aura (cloud)
 * - Docker deployments without plugin configuration
 *
 * ## Properties Storage
 *
 * Entity properties are stored as JSON strings rather than native Neo4j maps.
 * This simplifies the implementation and avoids APOC dependencies like
 * `apoc.map.merge()` for property merging.
 *
 * Trade-off: On entity update, properties are fully replaced rather than merged.
 * This is acceptable because:
 * 1. EntityExtractor provides complete property objects on each extraction
 * 2. Important fields (name, type, timestamps) are stored as node properties
 * 3. The `properties` field contains supplementary metadata only
 *
 * If property merging becomes necessary, options include:
 * - Install APOC Core and use `apoc.map.merge()`
 * - Store properties as native Neo4j map and use Cypher map operations
 * - Perform merge logic in TypeScript before upserting
 */

import type { Driver, Session } from 'neo4j-driver'
import neo4j from 'neo4j-driver'
import type {
  IKnowledgeStore,
  Entity,
  StoreError,
  TraceContext,
  Result,
  L3Entity,
  L3Observation,
  SourceEntry,
  CanonicalType,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import { nanoid } from 'nanoid'

export interface Neo4jKnowledgeStoreConfig {
  /**
   * Enable database-per-user mode.
   * When true, each user's data is stored in a separate database named by userId.
   * Requires Neo4j Enterprise, Aura, or Dozer (multi-tenant Neo4j).
   * Default: false (uses default database)
   */
  databasePerUser?: boolean
  /**
   * Default database name when databasePerUser is false.
   * Default: 'neo4j' (Neo4j default)
   */
  defaultDatabase?: string
}

export class Neo4jKnowledgeStore implements IKnowledgeStore {
  private readonly config: Neo4jKnowledgeStoreConfig
  /** Track which databases have been initialized (schema created) */
  private readonly initializedDatabases: Set<string> = new Set()

  constructor(
    private readonly driver: Driver,
    config?: Neo4jKnowledgeStoreConfig
  ) {
    this.config = {
      databasePerUser: false,
      defaultDatabase: 'neo4j',
      ...config,
    }

    const logger = getLogger().child({ component: 'Neo4jKnowledgeStore' })
    logger.info({
      databasePerUser: this.config.databasePerUser,
      defaultDatabase: this.config.defaultDatabase,
    }, 'Neo4jKnowledgeStore initialized')
  }

  /**
   * Create a session for a query.
   * In database-per-user mode, uses userId as the database name.
   * Dozer/Neo4j Enterprise will auto-create the database if it doesn't exist.
   */
  private getSession(ctx: TraceContext): Session {
    if (this.config.databasePerUser && ctx.userId) {
      // Sanitize userId for use as database name
      // Neo4j database names: lowercase alphanumeric, dots, dashes, underscores
      const databaseName = this.sanitizeDatabaseName(ctx.userId)
      return this.driver.session({ database: databaseName })
    }
    return this.driver.session({ database: this.config.defaultDatabase })
  }

  /**
   * Sanitize a userId for use as a Neo4j database name.
   * Neo4j database names: lowercase letters, numbers, and hyphens only.
   * Must start and end with alphanumeric character.
   * Max length: 63 characters.
   */
  private sanitizeDatabaseName(userId: string): string {
    // Convert to lowercase, replace spaces with hyphens
    let name = userId.toLowerCase().replace(/\s+/g, '-')

    // Remove invalid characters (keep only lowercase letters, numbers, and hyphens)
    name = name.replace(/[^a-z0-9-]/g, '')

    // Remove leading hyphens
    name = name.replace(/^-+/, '')

    // Neo4j database names must start with a letter, prefix numeric names with 'u'
    if (/^[0-9]/.test(name)) {
      name = 'u' + name
    }

    // Remove trailing hyphens
    name = name.replace(/-+$/, '')

    // Trim to max length (63 chars - Neo4j limit)
    if (name.length > 63) {
      name = name.substring(0, 63)
    }

    // Ensure not empty
    if (!name) {
      name = 'default-user'
    }

    return name
  }

  /**
   * Get the database name for the given context.
   * Returns the sanitized userId if in database-per-user mode, otherwise the default database.
   */
  private getDatabaseName(ctx: TraceContext): string {
    if (this.config.databasePerUser && ctx.userId) {
      return this.sanitizeDatabaseName(ctx.userId)
    }
    return this.config.defaultDatabase || 'neo4j'
  }

  /**
   * Schema statements for Entity nodes (knowledge graph)
   * Includes legacy schema + L3 Memory Cadillac schema
   */
  private static readonly SCHEMA_STATEMENTS = [
    // Legacy Entity schema (backwards compatible)
    'CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.entityId IS UNIQUE',
    'CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)',
    'CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)',
    'CREATE INDEX entity_user IF NOT EXISTS FOR (e:Entity) ON (e.userId)',
    'CREATE INDEX entity_last_mentioned IF NOT EXISTS FOR (e:Entity) ON (e.lastMentioned)',
    'CREATE INDEX entity_user_type IF NOT EXISTS FOR (e:Entity) ON (e.userId, e.type)',

    // L3 Memory Cadillac schema - Entity enhancements
    'CREATE INDEX entity_canonical_type IF NOT EXISTS FOR (e:Entity) ON (e.canonicalType)',
    'CREATE INDEX entity_display_name IF NOT EXISTS FOR (e:Entity) ON (e.displayName)',
    'CREATE INDEX entity_last_seen IF NOT EXISTS FOR (e:Entity) ON (e.lastSeen)',

    // L3 Memory - Observation nodes
    'CREATE CONSTRAINT observation_id IF NOT EXISTS FOR (o:Observation) REQUIRE o.id IS UNIQUE',
    'CREATE INDEX observation_created IF NOT EXISTS FOR (o:Observation) ON (o.createdAt)',
    'CREATE INDEX observation_conversation IF NOT EXISTS FOR (o:Observation) ON (o.conversationId)',

    // L3 Memory - RELATES_TO relationship indexes
    'CREATE INDEX relates_to_type IF NOT EXISTS FOR ()-[r:RELATES_TO]-() ON (r.type)',
    'CREATE INDEX relates_to_strength IF NOT EXISTS FOR ()-[r:RELATES_TO]-() ON (r.strength)',
  ]

  /**
   * Schema statements that require APOC or special handling.
   * These are run separately and may fail on non-APOC installations.
   */
  private static readonly ADVANCED_SCHEMA_STATEMENTS = [
    // Fulltext indexes for content search
    'CREATE FULLTEXT INDEX observation_content IF NOT EXISTS FOR (o:Observation) ON EACH [o.content]',
    'CREATE FULLTEXT INDEX entity_metadata IF NOT EXISTS FOR (e:Entity) ON EACH [e.metadata]',
  ]

  /**
   * Check if a database exists using the system database.
   */
  private async databaseExists(databaseName: string): Promise<boolean> {
    const systemSession = this.driver.session({ database: 'system' })
    try {
      const result = await systemSession.run(
        'SHOW DATABASES YIELD name WHERE name = $name',
        { name: databaseName }
      )
      return result.records.length > 0
    } catch {
      // Fallback for older Neo4j versions or if SHOW DATABASES not supported
      return false
    } finally {
      await systemSession.close()
    }
  }

  /**
   * Create a database using the system database.
   * Returns true if creation command succeeded, false if it failed.
   */
  private async createDatabase(databaseName: string): Promise<boolean> {
    const logger = getLogger().child({
      component: 'Neo4jKnowledgeStore',
      database: databaseName,
    })

    const systemSession = this.driver.session({ database: 'system' })
    try {
      logger.info('Creating database via system session')
      await systemSession.run('CREATE DATABASE $name IF NOT EXISTS', { name: databaseName })
      // Wait for database to be ready (Neo4j needs time to initialize new databases)
      await new Promise(resolve => setTimeout(resolve, 1000))
      logger.info('Database creation command succeeded')
      return true
    } catch (error) {
      // Log the actual error - this is important for debugging
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorCode = (error as { code?: string }).code
      logger.error(
        { error: errorMessage, errorCode, databaseName },
        'Database creation failed. This may indicate: ' +
        '1) Neo4j Community Edition (single DB only), ' +
        '2) Insufficient privileges (need CREATE DATABASE permission), ' +
        '3) Neo4j version < 4.0 (no multi-database support)'
      )
      return false
    } finally {
      await systemSession.close()
    }
  }

  /**
   * Ensure database exists and schema (indexes/constraints) is initialized.
   * In database-per-user mode, each user's database needs to be created first,
   * then schema must be set up.
   *
   * This method is idempotent and tracks which databases have been initialized
   * to avoid redundant creation/schema setup on every request.
   */
  private async ensureSchemaInitialized(ctx: TraceContext): Promise<void> {
    const databaseName = this.getDatabaseName(ctx)

    const logger = getLogger().child({
      component: 'Neo4jKnowledgeStore',
      database: databaseName,
      databasePerUser: this.config.databasePerUser,
    })

    // Skip if already initialized this session
    if (this.initializedDatabases.has(databaseName)) {
      logger.trace('Database already initialized, skipping')
      return
    }

    logger.info({ userId: ctx.userId }, 'Ensuring database exists and schema initialized')

    // Step 1: Check if database exists and create if needed (per-user mode only)
    if (this.config.databasePerUser && databaseName !== 'neo4j' && databaseName !== 'system') {
      logger.info('Per-user mode: checking if database exists')
      let exists = await this.databaseExists(databaseName)
      logger.info({ exists }, 'Database existence check result')

      if (!exists) {
        const created = await this.createDatabase(databaseName)

        if (!created) {
          // createDatabase already logged the error
          throw new Error(
            `Failed to create database '${databaseName}'. Per-user database mode requires ` +
            `Neo4j Enterprise, Aura, or Dozer with multi-database support.`
          )
        }

        // CRITICAL: Verify database was actually created
        // Wait a bit more and re-check (Neo4j needs time to propagate)
        await new Promise(resolve => setTimeout(resolve, 500))
        exists = await this.databaseExists(databaseName)

        if (!exists) {
          // Database creation failed - this is a critical error in per-user mode
          // Don't mark as initialized, don't proceed with schema
          logger.error(
            { databaseName },
            'Database creation failed - database does not exist after creation attempt. ' +
            'This may indicate: Neo4j Community Edition (single DB only), insufficient permissions, ' +
            'or Dozer/Enterprise not configured. Per-user database mode requires multi-database support.'
          )
          throw new Error(
            `Failed to create database '${databaseName}'. Per-user database mode requires ` +
            `Neo4j Enterprise, Aura, or Dozer with multi-database support.`
          )
        }

        logger.info({ databaseName }, 'Database verified to exist after creation')
      }
    }

    // Step 2: Initialize schema in the user's database
    const session = this.driver.session({ database: databaseName })

    try {
      logger.debug('Initializing schema for database')

      for (const statement of Neo4jKnowledgeStore.SCHEMA_STATEMENTS) {
        try {
          await session.run(statement)
        } catch (error) {
          // Ignore "already exists" errors - these are expected
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (!errorMessage.includes('already exists')) {
            // Check for database not found - this is critical
            if (errorMessage.includes('DatabaseNotFound') || errorMessage.includes('Database does not exist')) {
              logger.error({ error, databaseName }, 'Database not found during schema initialization')
              throw new Error(`Database '${databaseName}' not found during schema initialization`)
            }
            logger.warn({ error, statement: statement.slice(0, 50) }, 'Schema statement failed')
          }
        }
      }

      // Try advanced schema statements (may fail without APOC/proper Neo4j version)
      for (const statement of Neo4jKnowledgeStore.ADVANCED_SCHEMA_STATEMENTS) {
        try {
          await session.run(statement)
        } catch (error) {
          // These are optional - log at debug level
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (!errorMessage.includes('already exists')) {
            logger.debug({ statement: statement.slice(0, 50) }, 'Advanced schema statement skipped')
          }
        }
      }

      // Mark as initialized
      this.initializedDatabases.add(databaseName)
      logger.info('Database and schema initialized')
    } finally {
      await session.close()
    }
  }

  /**
   * Create or update an entity in the knowledge graph
   *
   * Uses MERGE to upsert: creates new entity or updates existing one.
   *
   * On update (ON MATCH):
   * - `lastMentioned` is updated to track recency
   * - `properties` is fully replaced (not merged)
   *
   * Note: We intentionally replace properties rather than merge them to avoid
   * APOC plugin dependency (`apoc.map.merge`). Since EntityExtractor provides
   * complete property objects on each extraction, this is the correct behavior.
   * See file header for detailed rationale.
   */
  async upsertEntity(entity: Entity, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.upsertEntity', async () => {
      const logger = getLogger().child({
        entityId: entity.entityId,
        entityName: entity.name,
        entityType: entity.type,
        requestId: ctx.requestId,
      })

      // Ensure schema exists for this database (lazy initialization for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        // Standard Cypher MERGE - no APOC dependencies
        // Properties stored as JSON string for simplicity
        await session.run(
          `
          MERGE (e:Entity {entityId: $entityId})
          ON CREATE SET
            e.name = $name,
            e.type = $type,
            e.firstMentioned = $firstMentioned,
            e.lastMentioned = $lastMentioned,
            e.userId = $userId,
            e.properties = $properties
          ON MATCH SET
            e.lastMentioned = $lastMentioned,
            e.properties = $properties
          `,
          {
            entityId: entity.entityId,
            name: entity.name,
            type: entity.type,
            firstMentioned: entity.firstMentioned,
            lastMentioned: entity.lastMentioned,
            userId: entity.properties?.userId ?? null,
            properties: JSON.stringify(entity.properties ?? {}),
          }
        )

        logger.debug({ entity: entity.name, type: entity.type }, 'Entity upserted in Neo4j')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to upsert entity in Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to upsert entity',
          context: { entityId: entity.entityId },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Create a relationship between two entities
   */
  async createRelationship(
    fromEntity: string,
    toEntity: string,
    relationshipType: string,
    properties: Record<string, unknown>,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.createRelationship', async () => {
      const logger = getLogger().child({
        fromEntity,
        toEntity,
        relationshipType,
        requestId: ctx.requestId,
      })

      // Ensure schema exists for this database (lazy initialization for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        // Sanitize relationship type (Neo4j requires alphanumeric + underscore)
        const sanitizedType = relationshipType.toUpperCase().replace(/[^A-Z0-9_]/g, '_')

        await session.run(
          `
          MATCH (from:Entity {name: $fromEntity})
          MATCH (to:Entity {name: $toEntity})
          MERGE (from)-[r:${sanitizedType}]->(to)
          ON CREATE SET
            r.strength = $strength,
            r.createdAt = timestamp(),
            r.properties = $properties
          ON MATCH SET
            r.strength = r.strength + 1,
            r.updatedAt = timestamp()
          `,
          {
            fromEntity: fromEntity.toLowerCase(),
            toEntity: toEntity.toLowerCase(),
            strength: (properties.strength as number) ?? 1,
            properties: JSON.stringify(properties),
          }
        )

        logger.debug({ from: fromEntity, to: toEntity, type: relationshipType }, 'Relationship created/updated in Neo4j')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to create relationship in Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to create relationship',
          context: { fromEntity, toEntity, relationshipType },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get entities related to a given entity within N hops
   */
  async getRelatedEntities(
    entityName: string,
    hops: number,
    ctx: TraceContext
  ): Promise<Result<Entity[], StoreError>> {
    return withSpan('Neo4jKnowledgeStore.getRelatedEntities', async () => {
      const logger = getLogger().child({
        entityName,
        hops,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        // Use variable-length path pattern for multi-hop traversal
        const result = await session.run(
          `
          MATCH (start:Entity {name: $entityName})
          MATCH (start)-[*1..${Math.min(hops, 5)}]-(related:Entity)
          WHERE related <> start
          RETURN DISTINCT related
          ORDER BY related.lastMentioned DESC
          LIMIT 50
          `,
          {
            entityName: entityName.toLowerCase(),
          }
        )

        const entities: Entity[] = result.records.map((record) => {
          const node = record.get('related')
          const props = node.properties

          return {
            entityId: props.entityId,
            name: props.name,
            type: props.type,
            firstMentioned: this.toNumber(props.firstMentioned),
            lastMentioned: this.toNumber(props.lastMentioned),
            properties: props.properties ? JSON.parse(props.properties) : undefined,
          }
        })

        logger.debug({ count: entities.length }, 'Related entities found in Neo4j')
        return ok(entities)
      } catch (error) {
        logger.error({ error }, 'Failed to get related entities from Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get related entities',
          context: { entityName, hops },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Search entities by pattern (name or type)
   */
  async searchEntities(
    pattern: string,
    ctx: TraceContext
  ): Promise<Result<Entity[], StoreError>> {
    return withSpan('Neo4jKnowledgeStore.searchEntities', async () => {
      const logger = getLogger().child({
        pattern,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        const result = await session.run(
          `
          MATCH (e:Entity)
          WHERE toLower(e.name) CONTAINS toLower($pattern)
             OR toLower(e.type) CONTAINS toLower($pattern)
          RETURN e
          ORDER BY e.lastMentioned DESC
          LIMIT 50
          `,
          {
            pattern,
          }
        )

        const entities: Entity[] = result.records.map((record) => {
          const node = record.get('e')
          const props = node.properties

          return {
            entityId: props.entityId,
            name: props.name,
            type: props.type,
            firstMentioned: this.toNumber(props.firstMentioned),
            lastMentioned: this.toNumber(props.lastMentioned),
            properties: props.properties ? JSON.parse(props.properties) : undefined,
          }
        })

        logger.debug({ count: entities.length }, 'Entity search completed in Neo4j')
        return ok(entities)
      } catch (error) {
        logger.error({ error }, 'Failed to search entities in Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to search entities',
          context: { pattern },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get entities for a specific user
   */
  async getUserEntities(
    userId: string,
    options: { type?: string; limit?: number },
    ctx: TraceContext
  ): Promise<Result<Entity[], StoreError>> {
    return withSpan('Neo4jKnowledgeStore.getUserEntities', async () => {
      const logger = getLogger().child({
        userId,
        options,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        const typeFilter = options.type ? 'AND e.type = $type' : ''
        const limit = neo4j.int(options.limit ?? 100)

        const result = await session.run(
          `
          MATCH (e:Entity {userId: $userId})
          ${typeFilter}
          RETURN e
          ORDER BY e.lastMentioned DESC
          LIMIT $limit
          `,
          {
            userId,
            type: options.type ?? null,
            limit,
          }
        )

        const entities: Entity[] = result.records.map((record) => {
          const node = record.get('e')
          const props = node.properties

          return {
            entityId: props.entityId,
            name: props.name,
            type: props.type,
            firstMentioned: this.toNumber(props.firstMentioned),
            lastMentioned: this.toNumber(props.lastMentioned),
            properties: props.properties ? JSON.parse(props.properties) : undefined,
          }
        })

        logger.debug({ count: entities.length }, 'User entities found in Neo4j')
        return ok(entities)
      } catch (error) {
        logger.error({ error }, 'Failed to get user entities from Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get user entities',
          context: { userId },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Delete an entity and its relationships
   */
  async deleteEntity(entityId: string, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.deleteEntity', async () => {
      const logger = getLogger().child({
        entityId,
        requestId: ctx.requestId,
      })

      const session = this.getSession(ctx)

      try {
        await session.run(
          `
          MATCH (e:Entity {entityId: $entityId})
          DETACH DELETE e
          `,
          { entityId }
        )

        logger.debug('Entity deleted from Neo4j')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to delete entity from Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to delete entity',
          context: { entityId },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get entity count (for monitoring)
   * Note: In database-per-user mode, this counts entities in the user's database.
   */
  async getEntityCount(ctx: TraceContext): Promise<Result<number, StoreError>> {
    const session = this.getSession(ctx)

    try {
      const result = await session.run('MATCH (e:Entity) RETURN count(e) as count')
      const count = result.records[0]?.get('count')?.toNumber() ?? 0
      return ok(count)
    } catch (error) {
      return err({
        kind: 'UnexpectedError',
        message: 'Failed to get entity count',
        context: {},
        cause: error,
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Get relationship count (for monitoring)
   * Note: In database-per-user mode, this counts relationships in the user's database.
   */
  async getRelationshipCount(ctx: TraceContext): Promise<Result<number, StoreError>> {
    const session = this.getSession(ctx)

    try {
      const result = await session.run('MATCH ()-[r]->() RETURN count(r) as count')
      const count = result.records[0]?.get('count')?.toNumber() ?? 0
      return ok(count)
    } catch (error) {
      return err({
        kind: 'UnexpectedError',
        message: 'Failed to get relationship count',
        context: {},
        cause: error,
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Convert Neo4j Integer to JavaScript number
   */
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) {
      return 0
    }
    if (typeof value === 'number') {
      return value
    }
    // Neo4j integers have a toNumber() method
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
      return (value as { toNumber: () => number }).toNumber()
    }
    return Number(value)
  }

  // ============================================================================
  // L3 Memory Cadillac Methods
  // ============================================================================

  /**
   * Create or update an L3 entity with full Cadillac schema support.
   * Fields like firstSeen, lastSeen, mentionCount, sourceHistory are auto-managed.
   */
  async upsertL3Entity(
    entity: {
      id?: string
      name: string
      displayName?: string
      aliases?: string[]
      canonicalType: CanonicalType
      labels?: string[]
      importance?: number
      summary?: string
      sourceHistory?: SourceEntry[]
      metadata?: Record<string, unknown>
    },
    ctx: TraceContext
  ): Promise<Result<L3Entity, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.upsertL3Entity', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        entityName: entity.name,
        canonicalType: entity.canonicalType,
        requestId: ctx.requestId,
      })

      logger.debug(
        {
          hasDisplayName: !!entity.displayName,
          aliasCount: entity.aliases?.length ?? 0,
          labelCount: entity.labels?.length ?? 0,
          importance: entity.importance,
          sourceHistoryCount: entity.sourceHistory?.length ?? 0,
        },
        'Upserting L3 entity'
      )

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        const entityId = entity.id ?? nanoid()
        const now = Date.now()

        await session.run(
          `
          MERGE (e:Entity {name: $name})
          ON CREATE SET
            e.id = $id,
            e.entityId = $id,
            e.displayName = $displayName,
            e.aliases = $aliases,
            e.canonicalType = $canonicalType,
            e.type = $canonicalType,
            e.labels = $labels,
            e.importance = $importance,
            e.firstSeen = $now,
            e.firstMentioned = $now,
            e.lastSeen = $now,
            e.lastMentioned = $now,
            e.mentionCount = 1,
            e.summary = $summary,
            e.sourceHistory = $sourceHistory,
            e.metadata = $metadata,
            e.userId = $userId
          ON MATCH SET
            e.lastSeen = $now,
            e.lastMentioned = $now,
            e.mentionCount = coalesce(e.mentionCount, 0) + 1,
            e.importance = CASE WHEN $importance > coalesce(e.importance, 0) THEN $importance ELSE e.importance END,
            e.labels = CASE WHEN size($labels) > 0 THEN $labels ELSE e.labels END,
            e.summary = CASE WHEN $summary IS NOT NULL THEN $summary ELSE e.summary END
          RETURN e
          `,
          {
            id: entityId,
            name: entity.name,
            displayName: entity.displayName ?? entity.name,
            aliases: entity.aliases ?? [],
            canonicalType: entity.canonicalType,
            labels: entity.labels ?? [],
            importance: entity.importance ?? 0.5,
            now,
            summary: entity.summary ?? null,
            sourceHistory: JSON.stringify(entity.sourceHistory ?? []),
            metadata: JSON.stringify(entity.metadata ?? {}),
            userId: ctx.userId ?? null,
          }
        )

        const durationMs = Date.now() - startTime
        const result: L3Entity = {
          id: entityId,
          name: entity.name,
          displayName: entity.displayName ?? entity.name,
          aliases: entity.aliases ?? [],
          canonicalType: entity.canonicalType,
          labels: entity.labels ?? [],
          importance: entity.importance ?? 0.5,
          firstSeen: now,
          lastSeen: now,
          mentionCount: 1,
          summary: entity.summary,
          sourceHistory: entity.sourceHistory ?? [],
          metadata: entity.metadata ?? {},
        }

        logger.debug({ entityId, name: entity.name, durationMs }, 'L3 entity upserted')
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_entity_upsert' })
        return ok(result)
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.error({ error, durationMs }, 'Failed to upsert L3 entity')
        pipelineMetrics.errors.add(1, { kind: 'l3_entity_upsert_error' })
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to upsert L3 entity',
          context: { name: entity.name },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Create an observation for an entity.
   * The createdAt field is auto-generated if not provided.
   */
  async createObservation(
    entityName: string,
    observation: {
      content: string
      conversationId: string
      messageId: string
      confidence: number
      createdAt?: number
      supersedes?: string
    },
    ctx: TraceContext
  ): Promise<Result<L3Observation, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.createObservation', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        entityName,
        requestId: ctx.requestId,
      })

      logger.debug(
        {
          contentLength: observation.content.length,
          confidence: observation.confidence,
          hasSupersedes: !!observation.supersedes,
        },
        'Creating observation'
      )

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        const observationId = nanoid()

        await session.run(
          `
          MATCH (e:Entity {name: $entityName})
          CREATE (o:Observation {
            id: $id,
            content: $content,
            createdAt: $createdAt,
            conversationId: $conversationId,
            messageId: $messageId,
            confidence: $confidence,
            supersedes: $supersedes
          })
          CREATE (e)-[:HAS_OBSERVATION]->(o)
          RETURN o
          `,
          {
            entityName: entityName.toLowerCase(),
            id: observationId,
            content: observation.content,
            createdAt: observation.createdAt ?? Date.now(),
            conversationId: observation.conversationId,
            messageId: observation.messageId,
            confidence: observation.confidence,
            supersedes: observation.supersedes ?? null,
          }
        )

        const durationMs = Date.now() - startTime
        const result: L3Observation = {
          id: observationId,
          content: observation.content,
          createdAt: observation.createdAt ?? Date.now(),
          conversationId: observation.conversationId,
          messageId: observation.messageId,
          confidence: observation.confidence,
          supersedes: observation.supersedes,
        }

        logger.debug({ observationId, entityName, durationMs }, 'Observation created')
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_observation_create' })
        return ok(result)
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.error({ error, durationMs }, 'Failed to create observation')
        pipelineMetrics.errors.add(1, { kind: 'l3_observation_create_error' })
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to create observation',
          context: { entityName },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get observations for an entity.
   */
  async getEntityObservations(
    entityName: string,
    options: { limit?: number; since?: number },
    ctx: TraceContext
  ): Promise<Result<L3Observation[], StoreError>> {
    return withSpan('Neo4jKnowledgeStore.getEntityObservations', async () => {
      const logger = getLogger().child({
        entityName,
        requestId: ctx.requestId,
      })

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        const limit = neo4j.int(options.limit ?? 50)
        const sinceFilter = options.since ? 'AND o.createdAt >= $since' : ''

        const result = await session.run(
          `
          MATCH (e:Entity {name: $entityName})-[:HAS_OBSERVATION]->(o:Observation)
          ${sinceFilter}
          RETURN o
          ORDER BY o.createdAt DESC
          LIMIT $limit
          `,
          {
            entityName: entityName.toLowerCase(),
            limit,
            since: options.since ?? 0,
          }
        )

        const observations: L3Observation[] = result.records.map((record) => {
          const node = record.get('o')
          const props = node.properties
          return {
            id: props.id,
            content: props.content,
            createdAt: this.toNumber(props.createdAt),
            conversationId: props.conversationId,
            messageId: props.messageId,
            confidence: props.confidence,
            supersedes: props.supersedes ?? undefined,
          }
        })

        logger.debug({ count: observations.length }, 'Observations retrieved')
        return ok(observations)
      } catch (error) {
        logger.error({ error }, 'Failed to get observations')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get observations',
          context: { entityName },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Create a RELATES_TO relationship with semantic type property.
   */
  async createL3Relationship(
    from: string,
    to: string,
    type: string,
    properties: {
      strength?: number
      context?: string
      conversationId?: string
      messageId?: string
      source?: 'agent' | 'user' | 'system'
      /** When relationship was observed/established */
      when?: string
      /** How the relationship manifests */
      method?: string
      /** Frequency of relationship occurrence */
      frequency?: string
      /** Additional notes */
      notes?: string
    },
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.createL3Relationship', async () => {
      const logger = getLogger().child({
        from,
        to,
        type,
        requestId: ctx.requestId,
      })

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        await session.run(
          `
          MATCH (fromEntity:Entity {name: $from})
          MATCH (toEntity:Entity {name: $to})
          MERGE (fromEntity)-[r:RELATES_TO {type: $type}]->(toEntity)
          ON CREATE SET
            r.strength = $strength,
            r.context = $context,
            r.conversationId = $conversationId,
            r.messageId = $messageId,
            r.source = $source,
            r.when = $when,
            r.method = $method,
            r.frequency = $frequency,
            r.notes = $notes,
            r.createdAt = timestamp()
          ON MATCH SET
            r.strength = CASE WHEN $strength > r.strength THEN $strength ELSE r.strength END,
            r.updatedAt = timestamp()
          `,
          {
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            type: type.toLowerCase(),
            strength: properties.strength ?? 0.5,
            context: properties.context ?? null,
            conversationId: properties.conversationId ?? null,
            messageId: properties.messageId ?? null,
            source: properties.source ?? 'agent',
            when: properties.when ?? null,
            method: properties.method ?? null,
            frequency: properties.frequency ?? null,
            notes: properties.notes ?? null,
          }
        )

        logger.debug({ from, to, type }, 'L3 Relationship created')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to create L3 relationship')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to create L3 relationship',
          context: { from, to, type },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get entities and observations that need embeddings.
   * Used by the EmbeddingBatchJob.
   */
  async getUnembeddedItems(
    limit: number,
    ctx: TraceContext
  ): Promise<Result<Array<{ id: string; type: 'entity' | 'observation'; text: string }>, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.getUnembeddedItems', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({ requestId: ctx.requestId })

      logger.debug({ limit }, 'Fetching unembedded items')

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        // Get entities without embeddings
        // Use neo4j.int() to ensure limit is passed as integer, not float
        const entityLimit = neo4j.int(Math.floor(limit / 2))
        const entityResult = await session.run(
          `
          MATCH (e:Entity)
          WHERE e.embedding IS NULL
          RETURN e.id as id, e.name as name, e.displayName as displayName,
                 e.labels as labels, e.summary as summary
          ORDER BY e.lastSeen DESC
          LIMIT $limit
          `,
          { limit: entityLimit }
        )

        // Get observations without embeddings
        const obsLimit = neo4j.int(Math.floor(limit / 2))
        const obsResult = await session.run(
          `
          MATCH (o:Observation)
          WHERE o.embedding IS NULL
          RETURN o.id as id, o.content as content
          ORDER BY o.createdAt DESC
          LIMIT $limit
          `,
          { limit: obsLimit }
        )

        const items: Array<{ id: string; type: 'entity' | 'observation'; text: string }> = []

        // Process entities
        for (const record of entityResult.records) {
          const id = record.get('id')
          const name = record.get('name') ?? ''
          const displayName = record.get('displayName') ?? name
          const labels = record.get('labels') ?? []
          const summary = record.get('summary') ?? ''

          // Compose text for embedding
          const text = [displayName, ...labels, summary].filter(Boolean).join(' ')
          if (id && text) {
            items.push({ id, type: 'entity', text })
          }
        }

        // Process observations
        for (const record of obsResult.records) {
          const id = record.get('id')
          const content = record.get('content')
          if (id && content) {
            items.push({ id, type: 'observation', text: content })
          }
        }

        const durationMs = Date.now() - startTime
        const entityCount = items.filter((i) => i.type === 'entity').length
        const obsCount = items.filter((i) => i.type === 'observation').length

        logger.debug(
          { count: items.length, entities: entityCount, observations: obsCount, durationMs },
          'Unembedded items fetched'
        )
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_get_unembedded' })
        return ok(items)
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.error({ error, durationMs }, 'Failed to get unembedded items')
        pipelineMetrics.errors.add(1, { kind: 'l3_get_unembedded_error' })
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get unembedded items',
          context: {},
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Batch update embeddings for entities and observations.
   * Used by the EmbeddingBatchJob.
   */
  async batchUpdateEmbeddings(
    items: Array<{ id: string; type: 'entity' | 'observation'; embedding: number[] }>,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.batchUpdateEmbeddings', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({ requestId: ctx.requestId })

      const entities = items.filter((i) => i.type === 'entity')
      const observations = items.filter((i) => i.type === 'observation')

      logger.debug(
        { total: items.length, entities: entities.length, observations: observations.length },
        'Updating embeddings in batch'
      )

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        // Update entities
        if (entities.length > 0) {
          for (const entity of entities) {
            await session.run(
              `
              MATCH (e:Entity {id: $id})
              SET e.embedding = $embedding
              `,
              { id: entity.id, embedding: entity.embedding }
            )
          }
        }

        // Update observations
        if (observations.length > 0) {
          for (const obs of observations) {
            await session.run(
              `
              MATCH (o:Observation {id: $id})
              SET o.embedding = $embedding
              `,
              { id: obs.id, embedding: obs.embedding }
            )
          }
        }

        const durationMs = Date.now() - startTime
        logger.debug(
          { count: items.length, entities: entities.length, observations: observations.length, durationMs },
          'Embeddings batch update complete'
        )
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_batch_update_embeddings' })
        return ok(undefined)
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.error({ error, durationMs }, 'Failed to batch update embeddings')
        pipelineMetrics.errors.add(1, { kind: 'l3_batch_update_embeddings_error' })
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to batch update embeddings',
          context: {},
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Append to an entity's sourceHistory.
   * Uses APOC if available, falls back to full replacement.
   */
  async appendSourceHistory(
    entityName: string,
    entry: SourceEntry,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.appendSourceHistory', async () => {
      const logger = getLogger().child({
        entityName,
        action: entry.action,
        requestId: ctx.requestId,
      })

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        // Try APOC first for proper array append
        try {
          await session.run(
            `
            MATCH (e:Entity {name: $name})
            SET e.sourceHistory = apoc.coll.union(
              coalesce(apoc.convert.fromJsonList(e.sourceHistory), []),
              [$entry]
            )
            `,
            {
              name: entityName.toLowerCase(),
              entry: JSON.stringify(entry),
            }
          )
        } catch {
          // Fallback: read, parse, append, write
          const result = await session.run(
            `
            MATCH (e:Entity {name: $name})
            RETURN e.sourceHistory as history
            `,
            { name: entityName.toLowerCase() }
          )

          const record = result.records[0]
          const historyStr = record?.get('history') ?? '[]'
          let history: SourceEntry[] = []
          try {
            history = JSON.parse(historyStr)
          } catch {
            history = []
          }

          history.push(entry)

          await session.run(
            `
            MATCH (e:Entity {name: $name})
            SET e.sourceHistory = $history
            `,
            {
              name: entityName.toLowerCase(),
              history: JSON.stringify(history),
            }
          )
        }

        logger.debug('SourceHistory appended')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to append sourceHistory')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to append sourceHistory',
          context: { entityName },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get an L3 entity by name.
   */
  async getL3Entity(
    name: string,
    ctx: TraceContext
  ): Promise<Result<L3Entity | null, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.getL3Entity', async () => {
      const logger = getLogger().child({ name, requestId: ctx.requestId })

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        const result = await session.run(
          `
          MATCH (e:Entity {name: $name})
          RETURN e
          `,
          { name: name.toLowerCase() }
        )

        if (result.records.length === 0) {
          return ok(null)
        }

        const node = result.records[0].get('e')
        const props = node.properties

        const entity: L3Entity = {
          id: props.id ?? props.entityId,
          name: props.name,
          displayName: props.displayName ?? props.name,
          aliases: props.aliases ?? [],
          canonicalType: (props.canonicalType ?? props.type ?? 'concept') as CanonicalType,
          labels: props.labels ?? [],
          embedding: props.embedding ?? undefined,
          importance: props.importance ?? 0.5,
          firstSeen: this.toNumber(props.firstSeen ?? props.firstMentioned),
          lastSeen: this.toNumber(props.lastSeen ?? props.lastMentioned),
          mentionCount: this.toNumber(props.mentionCount ?? 1),
          summary: props.summary ?? undefined,
          sourceHistory: this.parseSourceHistory(props.sourceHistory),
          metadata: this.parseMetadata(props.metadata),
        }

        logger.debug({ entityId: entity.id }, 'L3 Entity retrieved')
        return ok(entity)
      } catch (error) {
        logger.error({ error }, 'Failed to get L3 entity')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get L3 entity',
          context: { name },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Parse sourceHistory from stored format.
   */
  private parseSourceHistory(value: unknown): SourceEntry[] {
    if (!value) return []
    if (Array.isArray(value)) return value as SourceEntry[]
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return []
      }
    }
    return []
  }

  /**
   * Parse metadata from stored format.
   */
  private parseMetadata(value: unknown): Record<string, unknown> {
    if (!value) return {}
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return {}
      }
    }
    return {}
  }

  // =========================================================================
  // Self Entity Methods (for Memory Reflector user insights)
  // =========================================================================

  /**
   * Ensure a "self" entity exists for the user.
   * This is where user-level insights are stored as observations.
   *
   * @param userId - The user ID
   * @param ctx - Trace context
   * @returns The self entity
   */
  async ensureSelfEntity(
    userId: string,
    ctx: TraceContext
  ): Promise<Result<L3Entity, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.ensureSelfEntity', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        component: 'Neo4jKnowledgeStore',
        operation: 'ensureSelfEntity',
        userId,
        requestId: ctx.requestId,
      })
      const selfName = `${userId}_self`

      logger.debug({ selfName }, 'Ensuring self entity exists for user insights')

      // Use upsertL3Entity to create or update the self entity
      const result = await this.upsertL3Entity(
        {
          name: selfName,
          displayName: 'Self',
          canonicalType: 'concept',
          labels: ['user_insights', 'introspection'],
          importance: 1.0,
          metadata: { role: 'user_self_entity', userId },
        },
        ctx
      )

      const durationMs = Date.now() - startTime

      if (result.ok) {
        logger.info(
          { selfName, entityId: result.value.id, durationMs },
          'Self entity ensured'
        )
      } else {
        logger.warn(
          { selfName, error: result.error.message, errorKind: result.error.kind, durationMs },
          'Failed to ensure self entity'
        )
      }

      return result
    })
  }

  /**
   * Get recent insights for a user (observations on their self entity).
   *
   * @param userId - The user ID
   * @param limit - Maximum number of insights to return
   * @param ctx - Trace context
   * @returns Recent insights as observations
   */
  async getUserInsights(
    userId: string,
    limit: number,
    ctx: TraceContext
  ): Promise<Result<L3Observation[], StoreError>> {
    return withSpan('Neo4jKnowledgeStore.getUserInsights', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        component: 'Neo4jKnowledgeStore',
        operation: 'getUserInsights',
        userId,
        limit,
        requestId: ctx.requestId,
      })
      const selfName = `${userId}_self`

      logger.debug({ selfName }, 'Fetching user insights from self entity')

      // Get observations attached to the self entity
      const result = await this.getEntityObservations(selfName, { limit }, ctx)

      const durationMs = Date.now() - startTime

      if (result.ok) {
        logger.info(
          {
            selfName,
            insightCount: result.value.length,
            requestedLimit: limit,
            durationMs,
          },
          `Retrieved ${result.value.length} user insights`
        )

        if (result.value.length > 0) {
          logger.debug(
            {
              insights: result.value.map((i) => ({
                id: i.id,
                contentPreview: i.content.slice(0, 50),
                confidence: i.confidence,
              })),
            },
            'User insight details'
          )
        }
      } else {
        logger.debug(
          { selfName, error: result.error.message, errorKind: result.error.kind, durationMs },
          'No insights found (self entity may not exist yet)'
        )
      }

      return result
    })
  }

  /**
   * Reinforce an existing observation by boosting its confidence.
   * Used when the Memory Reflector detects that an observation is confirmed again.
   *
   * @param observationId - The observation ID to reinforce
   * @param messageId - The message ID that triggered reinforcement
   * @param conversationId - The conversation ID
   * @param confidenceBoost - Amount to boost confidence (default: 0.1, max result: 1.0)
   * @param ctx - Trace context
   */
  async reinforceObservation(
    observationId: string,
    messageId: string,
    conversationId: string,
    confidenceBoost: number = 0.1,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jKnowledgeStore.reinforceObservation', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        component: 'Neo4jKnowledgeStore',
        operation: 'reinforceObservation',
        observationId,
        messageId,
        conversationId,
        confidenceBoost,
        requestId: ctx.requestId,
      })

      logger.debug('Reinforcing observation - boosting confidence and adding to sourceHistory')

      await this.ensureSchemaInitialized(ctx)
      const session = this.getSession(ctx)

      try {
        const now = Date.now()

        // Update observation: boost confidence and add sourceHistory entry
        const result = await session.run(
          `
          MATCH (o:Observation {id: $id})
          SET o.confidence = CASE
            WHEN o.confidence + $boost > 1.0 THEN 1.0
            ELSE o.confidence + $boost
          END,
          o.lastReinforced = $now,
          o.reinforcementCount = coalesce(o.reinforcementCount, 0) + 1
          RETURN o.confidence as newConfidence, o.reinforcementCount as count
          `,
          {
            id: observationId,
            boost: confidenceBoost,
            now,
          }
        )

        if (result.records.length === 0) {
          logger.warn('Observation not found for reinforcement')
          return err({
            kind: 'NotFoundError' as const,
            message: `Observation ${observationId} not found`,
            context: { observationId },
          })
        }

        const newConfidence = result.records[0].get('newConfidence')
        const count = result.records[0].get('count')

        // Also update the parent entity's sourceHistory if we can find it
        await session.run(
          `
          MATCH (e:Entity)-[:HAS_OBSERVATION]->(o:Observation {id: $obsId})
          WITH e, coalesce(e.sourceHistory, '[]') as historyJson
          WITH e, apoc.convert.fromJsonList(historyJson) as history
          SET e.sourceHistory = apoc.convert.toJson(
            history + [{
              messageId: $messageId,
              conversationId: $conversationId,
              action: 'reinforced',
              timestamp: $now
            }]
          ),
          e.lastSeen = $now
          `,
          {
            obsId: observationId,
            messageId,
            conversationId,
            now,
          }
        ).catch(() => {
          // APOC might not be available, try fallback
          logger.debug('APOC not available for sourceHistory update, skipping')
        })

        const durationMs = Date.now() - startTime
        logger.info(
          { newConfidence, reinforcementCount: count, durationMs },
          'Observation reinforced'
        )
        pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_reinforce_observation' })

        return ok(undefined)
      } catch (error) {
        const durationMs = Date.now() - startTime
        logger.error({ error, durationMs }, 'Failed to reinforce observation')
        pipelineMetrics.errors.add(1, { kind: 'l3_reinforce_observation_error' })
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to reinforce observation',
          context: { observationId },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }
}
