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
import type {
  IKnowledgeStore,
  Entity,
  StoreError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

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
    if (this.config.databasePerUser) {
      logger.info('Neo4j database-per-user mode enabled')
    } else {
      logger.info({ database: this.config.defaultDatabase }, 'Neo4j using shared database')
    }
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
   * Neo4j database names must be lowercase and can contain: a-z, 0-9, dots, dashes, underscores.
   * Must start with a letter.
   */
  private sanitizeDatabaseName(userId: string): string {
    // Convert to lowercase, replace invalid chars with underscore
    let name = userId.toLowerCase().replace(/[^a-z0-9._-]/g, '_')

    // Ensure starts with a letter (prefix with 'u' if starts with number)
    if (/^[0-9]/.test(name)) {
      name = `u${name}`
    }

    // Ensure not empty
    if (!name || name === '_') {
      name = 'default_user'
    }

    return name
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

        logger.debug('Entity upserted in Neo4j')
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

        logger.debug('Relationship created/updated in Neo4j')
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

      const session = this.getSession(ctx)

      try {
        const typeFilter = options.type ? 'AND e.type = $type' : ''
        const limit = options.limit ?? 100

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
}
