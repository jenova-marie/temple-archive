/**
 * In-memory stub implementation of L3 Knowledge Store (Neo4j)
 */

import type {
  IKnowledgeStore,
  Entity,
  StoreError,
  TraceContext,
  Result,
} from '@recoverysky/types'
import { ok } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

interface Relationship {
  from: string
  to: string
  type: string
  properties: Record<string, unknown>
}

export class InMemoryKnowledgeStore implements IKnowledgeStore {
  private entities: Map<string, Entity> = new Map()
  private relationships: Relationship[] = []

  async upsertEntity(entity: Entity, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryKnowledgeStore.upsertEntity', async () => {
      const logger = getLogger().child({
        entityId: entity.entityId,
        entityName: entity.name,
        requestId: ctx.requestId,
      })

      const existing = this.entities.get(entity.name.toLowerCase())

      if (existing) {
        // Update existing entity
        this.entities.set(entity.name.toLowerCase(), {
          ...existing,
          lastMentioned: entity.lastMentioned,
          properties: { ...existing.properties, ...entity.properties },
        })
        logger.debug('Entity updated in L3')
      } else {
        // Create new entity
        this.entities.set(entity.name.toLowerCase(), entity)
        logger.debug('Entity created in L3')
      }

      return ok(undefined)
    })
  }

  async createRelationship(
    fromEntity: string,
    toEntity: string,
    relationshipType: string,
    properties: Record<string, unknown>,
    ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    return withSpan('InMemoryKnowledgeStore.createRelationship', async () => {
      const logger = getLogger().child({
        fromEntity,
        toEntity,
        relationshipType,
        requestId: ctx.requestId,
      })

      // Check if relationship already exists
      const existing = this.relationships.find(
        (r) =>
          r.from.toLowerCase() === fromEntity.toLowerCase() &&
          r.to.toLowerCase() === toEntity.toLowerCase() &&
          r.type === relationshipType
      )

      if (existing) {
        // Update strength if it exists
        const strength = (existing.properties.strength as number) || 0
        existing.properties = { ...existing.properties, ...properties, strength: strength + 1 }
        logger.debug({ strength: strength + 1 }, 'Relationship strength increased in L3')
      } else {
        // Create new relationship
        this.relationships.push({
          from: fromEntity.toLowerCase(),
          to: toEntity.toLowerCase(),
          type: relationshipType,
          properties: { ...properties, strength: 1 },
        })
        logger.debug('Relationship created in L3')
      }

      return ok(undefined)
    })
  }

  async getRelatedEntities(
    entityName: string,
    hops: number,
    ctx: TraceContext
  ): Promise<Result<Entity[], StoreError>> {
    return withSpan('InMemoryKnowledgeStore.getRelatedEntities', async () => {
      const logger = getLogger().child({
        entityName,
        hops,
        requestId: ctx.requestId,
      })

      const visited = new Set<string>()
      const results: Entity[] = []
      let frontier = [entityName.toLowerCase()]

      for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
        const nextFrontier: string[] = []

        for (const current of frontier) {
          if (visited.has(current)) continue
          visited.add(current)

          // Find all relationships involving this entity
          for (const rel of this.relationships) {
            if (rel.from === current && !visited.has(rel.to)) {
              nextFrontier.push(rel.to)
            }
            if (rel.to === current && !visited.has(rel.from)) {
              nextFrontier.push(rel.from)
            }
          }
        }

        frontier = nextFrontier
      }

      // Get entity objects for all visited nodes (except the starting entity)
      for (const name of visited) {
        if (name !== entityName.toLowerCase()) {
          const entity = this.entities.get(name)
          if (entity) {
            results.push(entity)
          }
        }
      }

      logger.debug({ count: results.length }, 'Related entities found in L3')
      return ok(results)
    })
  }

  async searchEntities(
    pattern: string,
    ctx: TraceContext
  ): Promise<Result<Entity[], StoreError>> {
    return withSpan('InMemoryKnowledgeStore.searchEntities', async () => {
      const logger = getLogger().child({ pattern, requestId: ctx.requestId })

      const lowerPattern = pattern.toLowerCase()
      const results: Entity[] = []

      for (const entity of this.entities.values()) {
        if (
          entity.name.toLowerCase().includes(lowerPattern) ||
          entity.type.toLowerCase().includes(lowerPattern)
        ) {
          results.push(entity)
        }
      }

      logger.debug({ count: results.length }, 'Entity search completed in L3')
      return ok(results)
    })
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.entities.clear()
    this.relationships = []
  }

  /**
   * Get entity count (for monitoring)
   */
  entityCount(): number {
    return this.entities.size
  }

  /**
   * Get relationship count (for monitoring)
   */
  relationshipCount(): number {
    return this.relationships.length
  }
}
