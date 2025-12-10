/**
 * Neo4j Memory Store - L3 Memory Tier (MCP-Compatible)
 *
 * Implements IMemoryStore using Neo4j graph database for
 * memory storage following the MCP Memory schema structure.
 *
 * ## Schema Design
 *
 * This implementation uses an MCP-compatible schema:
 * - (:Memory) nodes with observations as separate (:Observation) nodes
 * - [:HAS_OBSERVATION] relationships connect memories to observations
 * - [:RELATES_TO] relationships connect memories with typed connections
 *
 * ## Neo4j Version Compatibility
 *
 * Uses standard Cypher without APOC dependencies for broad compatibility.
 * See Neo4jKnowledgeStore.ts header for detailed rationale.
 */

import type { Driver, Session } from 'neo4j-driver'
import { nanoid } from 'nanoid'
import type {
  IMemoryStore,
  Memory,
  Observation,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryRelation,
  MemoryRelationType,
  MemorySearchOptions,
  MemoryWithRelations,
  StoreError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

export interface Neo4jMemoryStoreConfig {
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

export class Neo4jMemoryStore implements IMemoryStore {
  private readonly config: Neo4jMemoryStoreConfig
  /** Track which databases have been initialized (schema created) */
  private readonly initializedDatabases: Set<string> = new Set()

  constructor(
    private readonly driver: Driver,
    config?: Neo4jMemoryStoreConfig
  ) {
    this.config = {
      databasePerUser: false,
      defaultDatabase: 'neo4j',
      ...config,
    }

    const logger = getLogger().child({ component: 'Neo4jMemoryStore' })
    if (this.config.databasePerUser) {
      logger.info('Neo4j Memory Store: database-per-user mode enabled')
    } else {
      logger.info({ database: this.config.defaultDatabase }, 'Neo4j Memory Store: using shared database')
    }
  }

  /**
   * Create a session for a query.
   * In database-per-user mode, uses userId as the database name.
   */
  private getSession(ctx: TraceContext): Session {
    if (this.config.databasePerUser && ctx.userId) {
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
   * Schema statements for Memory nodes (bootstrap/MCP schema)
   */
  private static readonly SCHEMA_STATEMENTS = [
    'CREATE INDEX memory_id IF NOT EXISTS FOR (m:Memory) ON (m.id)',
    'CREATE INDEX memory_name IF NOT EXISTS FOR (m:Memory) ON (m.name)',
    'CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memoryType)',
    'CREATE INDEX memory_last_accessed IF NOT EXISTS FOR (m:Memory) ON (m.lastAccessed)',
    'CREATE INDEX observation_id IF NOT EXISTS FOR (o:Observation) ON (o.id)',
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
   */
  private async createDatabase(databaseName: string): Promise<void> {
    const logger = getLogger().child({
      component: 'Neo4jMemoryStore',
      database: databaseName,
    })

    const systemSession = this.driver.session({ database: 'system' })
    try {
      logger.info('Creating database')
      await systemSession.run('CREATE DATABASE $name IF NOT EXISTS', { name: databaseName })
      // Wait for database to be ready (Neo4j needs time to initialize new databases)
      await new Promise(resolve => setTimeout(resolve, 1000))
      logger.info('Database created successfully')
    } catch (error) {
      // Log but continue - might fail due to permissions or already exists
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn({ error: errorMessage }, 'Database creation attempt completed')
    } finally {
      await systemSession.close()
    }
  }

  /**
   * Ensure database exists and schema (indexes) is initialized.
   * In database-per-user mode, each user's database needs to be created first,
   * then schema must be set up.
   *
   * This method is idempotent and tracks which databases have been initialized
   * to avoid redundant creation/schema setup on every request.
   */
  private async ensureSchemaInitialized(ctx: TraceContext): Promise<void> {
    const databaseName = this.getDatabaseName(ctx)

    // Skip if already initialized this session
    if (this.initializedDatabases.has(databaseName)) {
      return
    }

    const logger = getLogger().child({
      component: 'Neo4jMemoryStore',
      database: databaseName,
    })

    // Step 1: Check if database exists and create if needed (per-user mode only)
    if (this.config.databasePerUser && databaseName !== 'neo4j' && databaseName !== 'system') {
      const exists = await this.databaseExists(databaseName)
      logger.debug({ exists }, 'Database existence check')

      if (!exists) {
        await this.createDatabase(databaseName)
      }
    }

    // Step 2: Initialize schema in the user's database
    const session = this.driver.session({ database: databaseName })

    try {
      logger.debug('Initializing Memory schema for database')

      for (const statement of Neo4jMemoryStore.SCHEMA_STATEMENTS) {
        try {
          await session.run(statement)
        } catch (error) {
          // Ignore "already exists" errors - these are expected
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (!errorMessage.includes('already exists')) {
            logger.warn({ error, statement: statement.slice(0, 50) }, 'Schema statement failed')
          }
        }
      }

      // Mark as initialized
      this.initializedDatabases.add(databaseName)
      logger.info('Database and Memory schema initialized')
    } finally {
      await session.close()
    }
  }

  // ============================================================================
  // Core CRUD Operations
  // ============================================================================

  /**
   * Create a new memory
   */
  async createMemory(
    input: CreateMemoryInput,
    ctx: TraceContext
  ): Promise<Result<Memory, StoreError>> {
    return withSpan('Neo4jMemoryStore.createMemory', async () => {
      const logger = getLogger().child({
        name: input.name,
        memoryType: input.memoryType,
        requestId: ctx.requestId,
      })

      // Ensure schema exists for this database (lazy initialization for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)
      const now = Date.now()
      const memoryId = nanoid()

      try {
        // Create memory node
        await session.run(
          `
          CREATE (m:Memory {
            id: $id,
            name: $name,
            memoryType: $memoryType,
            metadata: $metadata,
            createdAt: $createdAt,
            modifiedAt: $modifiedAt,
            lastAccessed: $lastAccessed
          })
          `,
          {
            id: memoryId,
            name: input.name,
            memoryType: input.memoryType,
            metadata: JSON.stringify(input.metadata ?? {}),
            createdAt: now,
            modifiedAt: now,
            lastAccessed: now,
          }
        )

        // Create initial observations if provided
        const observations: Observation[] = []
        if (input.observations && input.observations.length > 0) {
          for (const content of input.observations) {
            const obsId = nanoid()
            const obsCreatedAt = now
            await session.run(
              `
              MATCH (m:Memory {id: $memoryId})
              CREATE (o:Observation {id: $obsId, content: $content, createdAt: $createdAt})
              CREATE (m)-[:HAS_OBSERVATION]->(o)
              `,
              {
                memoryId,
                obsId,
                content,
                createdAt: obsCreatedAt,
              }
            )
            observations.push({ id: obsId, content, createdAt: obsCreatedAt })
          }
        }

        const memory: Memory = {
          id: memoryId,
          name: input.name,
          memoryType: input.memoryType,
          metadata: input.metadata ?? {},
          observations,
          createdAt: now,
          modifiedAt: now,
          lastAccessed: now,
        }

        logger.debug({ memoryId }, 'Memory created in Neo4j')
        return ok(memory)
      } catch (error) {
        logger.error({ error }, 'Failed to create memory in Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to create memory',
          context: { name: input.name },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get a memory by ID
   */
  async getMemory(
    id: string,
    ctx: TraceContext
  ): Promise<Result<Memory | null, StoreError>> {
    return withSpan('Neo4jMemoryStore.getMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        // Update lastAccessed
        await session.run(
          `MATCH (m:Memory {id: $id}) SET m.lastAccessed = $now`,
          { id, now: Date.now() }
        )

        // Get memory with observations
        const result = await session.run(
          `
          MATCH (m:Memory {id: $id})
          OPTIONAL MATCH (m)-[:HAS_OBSERVATION]->(o:Observation)
          RETURN m, collect(o) as observations
          `,
          { id }
        )

        if (result.records.length === 0) {
          return ok(null)
        }

        const record = result.records[0]
        const node = record.get('m')
        const obsNodes = record.get('observations') as Array<{ properties: Record<string, unknown> }>

        const memory = this.nodeToMemory(node, obsNodes)
        logger.debug('Memory retrieved from Neo4j')
        return ok(memory)
      } catch (error) {
        logger.error({ error }, 'Failed to get memory from Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get memory',
          context: { id },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Update an existing memory
   */
  async updateMemory(
    id: string,
    updates: UpdateMemoryInput,
    ctx: TraceContext
  ): Promise<Result<Memory, StoreError>> {
    return withSpan('Neo4jMemoryStore.updateMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      const session = this.getSession(ctx)
      const now = Date.now()

      try {
        // Build dynamic SET clause
        const setClauses: string[] = ['m.modifiedAt = $now', 'm.lastAccessed = $now']
        const params: Record<string, unknown> = { id, now }

        if (updates.name !== undefined) {
          setClauses.push('m.name = $name')
          params.name = updates.name
        }
        if (updates.memoryType !== undefined) {
          setClauses.push('m.memoryType = $memoryType')
          params.memoryType = updates.memoryType
        }
        if (updates.metadata !== undefined) {
          // Merge metadata: get existing, merge with updates
          const existingResult = await session.run(
            `MATCH (m:Memory {id: $id}) RETURN m.metadata as metadata`,
            { id }
          )
          const existingMetadata = existingResult.records[0]?.get('metadata')
          const merged = {
            ...(existingMetadata ? JSON.parse(existingMetadata) : {}),
            ...updates.metadata,
          }
          setClauses.push('m.metadata = $metadata')
          params.metadata = JSON.stringify(merged)
        }

        await session.run(
          `MATCH (m:Memory {id: $id}) SET ${setClauses.join(', ')}`,
          params
        )

        // Fetch updated memory
        const getResult = await this.getMemory(id, ctx)
        if (!getResult.ok) {
          return getResult as Result<Memory, StoreError>
        }
        if (!getResult.value) {
          return err({
            kind: 'NotFoundError',
            message: 'Memory not found after update',
            context: { id },
          })
        }

        logger.debug('Memory updated in Neo4j')
        return ok(getResult.value)
      } catch (error) {
        logger.error({ error }, 'Failed to update memory in Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to update memory',
          context: { id },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Delete a memory and its observations
   */
  async deleteMemory(
    id: string,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jMemoryStore.deleteMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      const session = this.getSession(ctx)

      try {
        // Delete observations first, then memory
        await session.run(
          `
          MATCH (m:Memory {id: $id})
          OPTIONAL MATCH (m)-[:HAS_OBSERVATION]->(o:Observation)
          DETACH DELETE o, m
          `,
          { id }
        )

        logger.debug('Memory deleted from Neo4j')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to delete memory from Neo4j')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to delete memory',
          context: { id },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  // ============================================================================
  // Observation Operations
  // ============================================================================

  /**
   * Add an observation to a memory
   */
  async addObservation(
    memoryId: string,
    content: string,
    ctx: TraceContext
  ): Promise<Result<Observation, StoreError>> {
    return withSpan('Neo4jMemoryStore.addObservation', async () => {
      const logger = getLogger().child({
        memoryId,
        requestId: ctx.requestId,
      })

      // Ensure schema exists for this database (lazy initialization for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)
      const obsId = nanoid()
      const now = Date.now()

      try {
        await session.run(
          `
          MATCH (m:Memory {id: $memoryId})
          CREATE (o:Observation {id: $obsId, content: $content, createdAt: $createdAt})
          CREATE (m)-[:HAS_OBSERVATION]->(o)
          SET m.modifiedAt = $now
          `,
          {
            memoryId,
            obsId,
            content,
            createdAt: now,
            now,
          }
        )

        const observation: Observation = { id: obsId, content, createdAt: now }
        logger.debug({ obsId }, 'Observation added to memory')
        return ok(observation)
      } catch (error) {
        logger.error({ error }, 'Failed to add observation')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to add observation',
          context: { memoryId },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get observations for a memory
   */
  async getObservations(
    memoryId: string,
    ctx: TraceContext
  ): Promise<Result<Observation[], StoreError>> {
    return withSpan('Neo4jMemoryStore.getObservations', async () => {
      const logger = getLogger().child({
        memoryId,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        const result = await session.run(
          `
          MATCH (m:Memory {id: $memoryId})-[:HAS_OBSERVATION]->(o:Observation)
          RETURN o
          ORDER BY o.createdAt ASC
          `,
          { memoryId }
        )

        const observations: Observation[] = result.records.map((record) => {
          const node = record.get('o')
          return {
            id: node.properties.id,
            content: node.properties.content,
            createdAt: this.toNumber(node.properties.createdAt),
          }
        })

        logger.debug({ count: observations.length }, 'Observations retrieved')
        return ok(observations)
      } catch (error) {
        logger.error({ error }, 'Failed to get observations')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get observations',
          context: { memoryId },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  // ============================================================================
  // Relation Operations
  // ============================================================================

  /**
   * Create a relation between two memories
   */
  async createRelation(
    from: string,
    to: string,
    type: MemoryRelationType | string,
    strength: number,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('Neo4jMemoryStore.createRelation', async () => {
      const logger = getLogger().child({
        from,
        to,
        type,
        requestId: ctx.requestId,
      })

      // Ensure schema exists for this database (lazy initialization for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        await session.run(
          `
          MATCH (f:Memory {id: $from})
          MATCH (t:Memory {id: $to})
          MERGE (f)-[r:RELATES_TO {type: $type}]->(t)
          ON CREATE SET
            r.strength = $strength,
            r.source = $source,
            r.createdAt = $now
          ON MATCH SET
            r.strength = CASE WHEN r.strength < $strength THEN $strength ELSE r.strength END
          `,
          {
            from,
            to,
            type,
            strength: Math.max(0.1, Math.min(1.0, strength)),
            source: 'agent',
            now: Date.now(),
          }
        )

        logger.debug('Relation created between memories')
        return ok(undefined)
      } catch (error) {
        logger.error({ error }, 'Failed to create relation')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to create relation',
          context: { from, to, type },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get relations for a memory
   */
  async getRelations(
    memoryId: string,
    direction: 'outbound' | 'inbound' | 'both',
    ctx: TraceContext
  ): Promise<Result<MemoryRelation[], StoreError>> {
    return withSpan('Neo4jMemoryStore.getRelations', async () => {
      const logger = getLogger().child({
        memoryId,
        direction,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        let query: string
        if (direction === 'outbound') {
          query = `
            MATCH (m:Memory {id: $memoryId})-[r:RELATES_TO]->(other:Memory)
            RETURN m.id as from, other.id as to, r.type as type, r.strength as strength, r.source as source, r.createdAt as createdAt
          `
        } else if (direction === 'inbound') {
          query = `
            MATCH (other:Memory)-[r:RELATES_TO]->(m:Memory {id: $memoryId})
            RETURN other.id as from, m.id as to, r.type as type, r.strength as strength, r.source as source, r.createdAt as createdAt
          `
        } else {
          query = `
            MATCH (m:Memory {id: $memoryId})-[r:RELATES_TO]-(other:Memory)
            RETURN
              CASE WHEN startNode(r).id = $memoryId THEN m.id ELSE other.id END as from,
              CASE WHEN endNode(r).id = $memoryId THEN m.id ELSE other.id END as to,
              r.type as type, r.strength as strength, r.source as source, r.createdAt as createdAt
          `
        }

        const result = await session.run(query, { memoryId })

        const relations: MemoryRelation[] = result.records.map((record) => ({
          from: record.get('from'),
          to: record.get('to'),
          type: record.get('type'),
          strength: this.toNumber(record.get('strength')),
          source: record.get('source') ?? 'agent',
          createdAt: this.toNumber(record.get('createdAt')),
        }))

        logger.debug({ count: relations.length }, 'Relations retrieved')
        return ok(relations)
      } catch (error) {
        logger.error({ error }, 'Failed to get relations')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get relations',
          context: { memoryId, direction },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  /**
   * Search memories by text query
   */
  async searchMemories(
    query: string,
    options: MemorySearchOptions,
    ctx: TraceContext
  ): Promise<Result<Memory[], StoreError>> {
    return withSpan('Neo4jMemoryStore.searchMemories', async () => {
      const logger = getLogger().child({
        query,
        options,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        // Build WHERE clauses
        const whereClauses: string[] = []
        const params: Record<string, unknown> = {
          query: query.toLowerCase(),
          limit: options.limit ?? 50,
        }

        // Text search on name and observations
        whereClauses.push('(toLower(m.name) CONTAINS $query OR ANY(o IN observations WHERE toLower(o.content) CONTAINS $query))')

        // Memory type filter
        if (options.memoryTypes && options.memoryTypes.length > 0) {
          whereClauses.push('m.memoryType IN $memoryTypes')
          params.memoryTypes = options.memoryTypes
        }

        // Temporal filters
        if (options.createdAfter !== undefined) {
          whereClauses.push('m.createdAt >= $createdAfter')
          params.createdAfter = options.createdAfter
        }
        if (options.createdBefore !== undefined) {
          whereClauses.push('m.createdAt <= $createdBefore')
          params.createdBefore = options.createdBefore
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

        const result = await session.run(
          `
          MATCH (m:Memory)
          OPTIONAL MATCH (m)-[:HAS_OBSERVATION]->(o:Observation)
          WITH m, collect(o) as observations
          ${whereClause}
          RETURN m, observations
          ORDER BY m.lastAccessed DESC
          LIMIT $limit
          `,
          params
        )

        const memories: Memory[] = result.records.map((record) => {
          const node = record.get('m')
          const obsNodes = record.get('observations') as Array<{ properties: Record<string, unknown> }>
          return this.nodeToMemory(node, obsNodes)
        })

        logger.debug({ count: memories.length }, 'Memory search completed')
        return ok(memories)
      } catch (error) {
        logger.error({ error }, 'Failed to search memories')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to search memories',
          context: { query },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Get related memories by graph traversal
   */
  async getRelatedMemories(
    memoryId: string,
    depth: number,
    ctx: TraceContext
  ): Promise<Result<MemoryWithRelations, StoreError>> {
    return withSpan('Neo4jMemoryStore.getRelatedMemories', async () => {
      const logger = getLogger().child({
        memoryId,
        depth,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        // First get the main memory
        const mainResult = await this.getMemory(memoryId, ctx)
        if (!mainResult.ok) return mainResult as Result<MemoryWithRelations, StoreError>
        if (!mainResult.value) {
          return err({
            kind: 'NotFoundError',
            message: 'Memory not found',
            context: { memoryId },
          })
        }

        const maxDepth = Math.min(depth, 5)

        // Get descendants (memories this one points to)
        const descendantsResult = await session.run(
          `
          MATCH (start:Memory {id: $memoryId})
          MATCH path = (start)-[r:RELATES_TO*1..${maxDepth}]->(related:Memory)
          OPTIONAL MATCH (related)-[:HAS_OBSERVATION]->(o:Observation)
          WITH related, r, length(path) as distance, collect(o) as observations
          RETURN DISTINCT related, observations, distance,
                 head(r).type as relType, head(r).strength as relStrength,
                 head(r).source as relSource, head(r).createdAt as relCreatedAt,
                 $memoryId as from, related.id as to
          ORDER BY distance, related.lastAccessed DESC
          LIMIT 50
          `,
          { memoryId }
        )

        // Get ancestors (memories that point to this one)
        const ancestorsResult = await session.run(
          `
          MATCH (start:Memory {id: $memoryId})
          MATCH path = (related:Memory)-[r:RELATES_TO*1..${maxDepth}]->(start)
          OPTIONAL MATCH (related)-[:HAS_OBSERVATION]->(o:Observation)
          WITH related, r, length(path) as distance, collect(o) as observations
          RETURN DISTINCT related, observations, distance,
                 last(r).type as relType, last(r).strength as relStrength,
                 last(r).source as relSource, last(r).createdAt as relCreatedAt,
                 related.id as from, $memoryId as to
          ORDER BY distance, related.lastAccessed DESC
          LIMIT 50
          `,
          { memoryId }
        )

        const descendants = descendantsResult.records.map((record) => {
          const node = record.get('related')
          const obsNodes = record.get('observations') as Array<{ properties: Record<string, unknown> }>
          const memory = this.nodeToMemory(node, obsNodes)
          return {
            ...memory,
            relation: {
              from: record.get('from'),
              to: record.get('to'),
              type: record.get('relType') ?? 'RELATES_TO',
              strength: this.toNumber(record.get('relStrength')) || 0.5,
              source: record.get('relSource') ?? 'agent',
              createdAt: this.toNumber(record.get('relCreatedAt')),
            } as MemoryRelation,
            distance: this.toNumber(record.get('distance')),
          }
        })

        const ancestors = ancestorsResult.records.map((record) => {
          const node = record.get('related')
          const obsNodes = record.get('observations') as Array<{ properties: Record<string, unknown> }>
          const memory = this.nodeToMemory(node, obsNodes)
          return {
            ...memory,
            relation: {
              from: record.get('from'),
              to: record.get('to'),
              type: record.get('relType') ?? 'RELATES_TO',
              strength: this.toNumber(record.get('relStrength')) || 0.5,
              source: record.get('relSource') ?? 'agent',
              createdAt: this.toNumber(record.get('relCreatedAt')),
            } as MemoryRelation,
            distance: this.toNumber(record.get('distance')),
          }
        })

        const memoryWithRelations: MemoryWithRelations = {
          ...mainResult.value,
          related: {
            descendants,
            ancestors,
          },
        }

        logger.debug(
          { descendants: descendants.length, ancestors: ancestors.length },
          'Related memories retrieved'
        )
        return ok(memoryWithRelations)
      } catch (error) {
        logger.error({ error }, 'Failed to get related memories')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to get related memories',
          context: { memoryId, depth },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  /**
   * Find memories by name (exact or pattern match)
   */
  async findByName(
    name: string,
    ctx: TraceContext
  ): Promise<Result<Memory[], StoreError>> {
    return withSpan('Neo4jMemoryStore.findByName', async () => {
      const logger = getLogger().child({
        name,
        requestId: ctx.requestId,
      })

      // Ensure database exists (for per-user mode)
      await this.ensureSchemaInitialized(ctx)

      const session = this.getSession(ctx)

      try {
        const result = await session.run(
          `
          MATCH (m:Memory)
          WHERE toLower(m.name) CONTAINS toLower($name)
          OPTIONAL MATCH (m)-[:HAS_OBSERVATION]->(o:Observation)
          WITH m, collect(o) as observations
          RETURN m, observations
          ORDER BY m.lastAccessed DESC
          LIMIT 50
          `,
          { name }
        )

        const memories: Memory[] = result.records.map((record) => {
          const node = record.get('m')
          const obsNodes = record.get('observations') as Array<{ properties: Record<string, unknown> }>
          return this.nodeToMemory(node, obsNodes)
        })

        logger.debug({ count: memories.length }, 'Memories found by name')
        return ok(memories)
      } catch (error) {
        logger.error({ error }, 'Failed to find memories by name')
        return err({
          kind: 'UnexpectedError',
          message: 'Failed to find memories by name',
          context: { name },
          cause: error,
        })
      } finally {
        await session.close()
      }
    })
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Convert Neo4j node to Memory object
   */
  private nodeToMemory(
    node: { properties: Record<string, unknown> },
    obsNodes: Array<{ properties: Record<string, unknown> }> | null
  ): Memory {
    const props = node.properties
    const observations: Observation[] = (obsNodes ?? [])
      .filter((o) => o !== null)
      .map((o) => ({
        id: o.properties.id as string,
        content: o.properties.content as string,
        createdAt: this.toNumber(o.properties.createdAt),
      }))

    return {
      id: props.id as string,
      name: props.name as string,
      memoryType: props.memoryType as Memory['memoryType'],
      metadata: props.metadata ? JSON.parse(props.metadata as string) : {},
      observations,
      createdAt: this.toNumber(props.createdAt),
      modifiedAt: this.toNumber(props.modifiedAt),
      lastAccessed: this.toNumber(props.lastAccessed),
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
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
      return (value as { toNumber: () => number }).toNumber()
    }
    return Number(value)
  }

  // ============================================================================
  // Utility Methods (for monitoring/admin)
  // ============================================================================

  /**
   * Get memory count
   */
  async getMemoryCount(ctx: TraceContext): Promise<Result<number, StoreError>> {
    const session = this.getSession(ctx)
    try {
      const result = await session.run('MATCH (m:Memory) RETURN count(m) as count')
      const count = result.records[0]?.get('count')?.toNumber() ?? 0
      return ok(count)
    } catch (error) {
      return err({
        kind: 'UnexpectedError',
        message: 'Failed to get memory count',
        context: {},
        cause: error,
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Get relation count
   */
  async getRelationCount(ctx: TraceContext): Promise<Result<number, StoreError>> {
    const session = this.getSession(ctx)
    try {
      const result = await session.run('MATCH ()-[r:RELATES_TO]->() RETURN count(r) as count')
      const count = result.records[0]?.get('count')?.toNumber() ?? 0
      return ok(count)
    } catch (error) {
      return err({
        kind: 'UnexpectedError',
        message: 'Failed to get relation count',
        context: {},
        cause: error,
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Initialize schema (create indexes)
   */
  async initializeSchema(ctx: TraceContext): Promise<Result<void, StoreError>> {
    const session = this.getSession(ctx)
    const logger = getLogger().child({ component: 'Neo4jMemoryStore' })

    try {
      // Memory indexes
      await session.run('CREATE INDEX memory_id IF NOT EXISTS FOR (m:Memory) ON (m.id)')
      await session.run('CREATE INDEX memory_name IF NOT EXISTS FOR (m:Memory) ON (m.name)')
      await session.run('CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memoryType)')
      await session.run('CREATE INDEX memory_last_accessed IF NOT EXISTS FOR (m:Memory) ON (m.lastAccessed)')

      // Observation indexes
      await session.run('CREATE INDEX observation_id IF NOT EXISTS FOR (o:Observation) ON (o.id)')

      logger.info('Neo4j Memory schema initialized')
      return ok(undefined)
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Neo4j Memory schema')
      return err({
        kind: 'UnexpectedError',
        message: 'Failed to initialize schema',
        context: {},
        cause: error,
      })
    } finally {
      await session.close()
    }
  }
}
