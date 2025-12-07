/**
 * Memory Tools for the RecoverySky Agent
 *
 * These tools allow Claude to interact with the Neo4j knowledge graph:
 * - Query entities and relationships (read)
 * - Save notes and observations (write)
 * - Manage entities and relationships (full)
 *
 * Access is controlled via MEMORY_TOOL_ACCESS env var:
 * - off: No memory tools available
 * - read: Query-only tools
 * - write: Query + save/log tools
 * - full: All tools including update/delete
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@recoverysky/observability'
import type { IKnowledgeStore, Entity, TraceContext } from '@recoverysky/types'

export type MemoryToolAccessLevel = 'off' | 'read' | 'write' | 'full'

/**
 * Context providers for memory tools
 * Must be set before tools are used
 */
let knowledgeStoreInstance: IKnowledgeStore | null = null
let currentTraceContext: TraceContext | null = null

/**
 * Set the knowledge store instance for memory tools
 * Called once during container initialization
 */
export function setMemoryToolKnowledgeStore(store: IKnowledgeStore): void {
  knowledgeStoreInstance = store
}

/**
 * Set the current trace context for memory tools
 * Must be called at the start of each request/pipeline run
 */
export function setMemoryToolTraceContext(ctx: TraceContext): void {
  currentTraceContext = ctx
}

/**
 * Clear the current trace context
 * Should be called after each request completes
 */
export function clearMemoryToolTraceContext(): void {
  currentTraceContext = null
}

/**
 * Legacy provider-based setup (deprecated, use setMemoryToolKnowledgeStore instead)
 */
export function setMemoryToolProviders(
  ksProvider: () => IKnowledgeStore | null,
  _tcProvider: () => TraceContext
): void {
  // For backwards compatibility, call the provider immediately
  const store = ksProvider()
  if (store) {
    knowledgeStoreInstance = store
  }
}

function getKnowledgeStore(): IKnowledgeStore {
  if (!knowledgeStoreInstance) {
    throw new Error('Memory tools not initialized - call setMemoryToolKnowledgeStore first')
  }
  return knowledgeStoreInstance
}

function getTraceContext(): TraceContext {
  if (!currentTraceContext) {
    throw new Error('TraceContext not set - call setMemoryToolTraceContext before using memory tools')
  }
  return currentTraceContext
}

// ============================================================================
// READ Tools (access level: read, write, full)
// ============================================================================

/**
 * Recall memories by searching for keywords or topics
 */
export const recallMemory = tool({
  description: `Search your memory for information about the user. Use this to recall:
- People they've mentioned (sponsor, family, therapist)
- Places significant to their recovery
- Past events or experiences they've shared
- Triggers and coping strategies discussed
- Milestones and achievements`,
  parameters: z.object({
    query: z.string().describe('What to search for (name, topic, keyword)'),
    type: z.enum(['person', 'place', 'event', 'emotion', 'trigger', 'coping_strategy', 'milestone', 'medication', 'any'])
      .default('any')
      .describe('Optional: filter by entity type'),
    limit: z.number().min(1).max(20).default(10).describe('Maximum results to return'),
  }),
  execute: async ({ query, type, limit }) => {
    return withSpan('tool.recallMemory', async () => {
      const logger = getLogger().child({ tool: 'recallMemory' })
      logger.info({ query, type, limit }, 'Searching memory')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        const result = await store.searchEntities(query, ctx)

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Memory search failed')
          return {
            success: false,
            memories: [],
            message: 'Unable to search memories right now.',
          }
        }

        let entities = result.value

        // Filter by type if specified
        if (type !== 'any') {
          entities = entities.filter(e => e.type === type)
        }

        // Limit results
        entities = entities.slice(0, limit)

        // Format for Claude
        const memories = entities.map(e => ({
          name: e.name,
          type: e.type,
          lastMentioned: new Date(e.lastMentioned).toLocaleDateString(),
          context: e.properties?.context || null,
          importance: e.properties?.importance || null,
        }))

        logger.info({ count: memories.length }, 'Memories recalled')

        return {
          success: true,
          memories,
          count: memories.length,
          message: memories.length > 0
            ? `Found ${memories.length} relevant memories.`
            : `No memories found for "${query}".`,
        }
      } catch (error) {
        logger.error({ error }, 'Memory recall failed')
        return {
          success: false,
          memories: [],
          message: 'Memory search encountered an error.',
        }
      }
    })
  },
})

/**
 * Search for specific entities by name or pattern
 */
export const searchEntities = tool({
  description: `Search for specific people, places, or things the user has mentioned.
Use when you need to find exact entities rather than general memories.`,
  parameters: z.object({
    name: z.string().describe('Name or partial name to search for'),
    type: z.enum(['person', 'place', 'event', 'emotion', 'trigger', 'coping_strategy', 'milestone', 'medication'])
      .optional()
      .describe('Filter by entity type'),
  }),
  execute: async ({ name, type }) => {
    return withSpan('tool.searchEntities', async () => {
      const logger = getLogger().child({ tool: 'searchEntities' })
      logger.info({ name, type }, 'Searching entities')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        const result = await store.searchEntities(name, ctx)

        if (!result.ok) {
          return { success: false, entities: [], message: 'Search failed.' }
        }

        let entities = result.value

        if (type) {
          entities = entities.filter(e => e.type === type)
        }

        const formatted = entities.slice(0, 10).map(e => ({
          id: e.entityId,
          name: e.name,
          type: e.type,
          firstMentioned: new Date(e.firstMentioned).toLocaleDateString(),
          lastMentioned: new Date(e.lastMentioned).toLocaleDateString(),
          properties: e.properties,
        }))

        logger.info({ count: formatted.length }, 'Entities found')

        return {
          success: true,
          entities: formatted,
          count: formatted.length,
        }
      } catch (error) {
        logger.error({ error }, 'Entity search failed')
        return { success: false, entities: [], message: 'Search error.' }
      }
    })
  },
})

/**
 * Get entities related to a given entity (graph traversal)
 */
export const getRelatedEntities = tool({
  description: `Find entities connected to a specific person, place, or thing.
Use this to understand relationships, like:
- Who is connected to a person
- What triggers are related to a place
- What coping strategies are linked to certain triggers`,
  parameters: z.object({
    entityName: z.string().describe('Name of the entity to find connections for'),
    depth: z.number().min(1).max(3).default(1).describe('How many relationship hops to traverse (1-3)'),
  }),
  execute: async ({ entityName, depth }) => {
    return withSpan('tool.getRelatedEntities', async () => {
      const logger = getLogger().child({ tool: 'getRelatedEntities' })
      logger.info({ entityName, depth }, 'Getting related entities')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        const result = await store.getRelatedEntities(entityName, depth, ctx)

        if (!result.ok) {
          return { success: false, related: [], message: 'Query failed.' }
        }

        const related = result.value.slice(0, 15).map(e => ({
          name: e.name,
          type: e.type,
          lastMentioned: new Date(e.lastMentioned).toLocaleDateString(),
        }))

        logger.info({ count: related.length }, 'Related entities found')

        return {
          success: true,
          related,
          count: related.length,
          message: related.length > 0
            ? `Found ${related.length} entities related to "${entityName}".`
            : `No entities connected to "${entityName}".`,
        }
      } catch (error) {
        logger.error({ error }, 'Related entity query failed')
        return { success: false, related: [], message: 'Query error.' }
      }
    })
  },
})

// ============================================================================
// WRITE Tools (access level: write, full)
// ============================================================================

/**
 * Save an important note or observation about the user
 */
export const saveNote = tool({
  description: `Save an important observation or note about the user to remember later.
Use this when you learn something significant that should be remembered, like:
- A new person in their life
- A trigger they identified
- A coping strategy that worked
- A milestone they achieved
- An important life event`,
  parameters: z.object({
    name: z.string().describe('Short name/title for this memory'),
    type: z.enum(['person', 'place', 'event', 'emotion', 'trigger', 'coping_strategy', 'milestone', 'medication', 'note'])
      .describe('Category of information'),
    context: z.string().describe('Details about this information and why it matters'),
    importance: z.number().min(0).max(1).default(0.7).describe('How important is this? 0-1 scale'),
  }),
  execute: async ({ name, type, context, importance }) => {
    return withSpan('tool.saveNote', async () => {
      const logger = getLogger().child({ tool: 'saveNote' })
      logger.info({ name, type, importance }, 'Saving note')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        const entity: Entity = {
          entityId: `note_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: name.toLowerCase(),
          type,
          firstMentioned: Date.now(),
          lastMentioned: Date.now(),
          properties: {
            context,
            importance,
            userId: ctx.userId,
            source: 'agent_observation',
          },
        }

        const result = await store.upsertEntity(entity, ctx)

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Failed to save note')
          return { success: false, message: 'Could not save note.' }
        }

        logger.info({ entityId: entity.entityId }, 'Note saved')

        return {
          success: true,
          id: entity.entityId,
          message: `Noted: "${name}" (${type})`,
        }
      } catch (error) {
        logger.error({ error }, 'Save note failed')
        return { success: false, message: 'Error saving note.' }
      }
    })
  },
})

/**
 * Log an observation about a relationship between entities
 */
export const logObservation = tool({
  description: `Record a relationship or connection you've noticed between things the user mentioned.
For example:
- "work" triggers "stress"
- "sponsor John" helps with "cravings"
- "morning routine" includes "meditation"`,
  parameters: z.object({
    from: z.string().describe('The source entity name'),
    to: z.string().describe('The target entity name'),
    relationship: z.string().describe('Type of relationship (e.g., "triggers", "helps_with", "related_to")'),
    notes: z.string().optional().describe('Additional context about this relationship'),
  }),
  execute: async ({ from, to, relationship, notes }) => {
    return withSpan('tool.logObservation', async () => {
      const logger = getLogger().child({ tool: 'logObservation' })
      logger.info({ from, to, relationship }, 'Logging observation')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        const result = await store.createRelationship(
          from,
          to,
          relationship,
          { notes, observedAt: Date.now(), source: 'agent_observation' },
          ctx
        )

        if (!result.ok) {
          logger.warn({ error: result.error }, 'Failed to log observation')
          return { success: false, message: 'Could not log observation.' }
        }

        logger.info('Observation logged')

        return {
          success: true,
          message: `Noted: "${from}" ${relationship} "${to}"`,
        }
      } catch (error) {
        logger.error({ error }, 'Log observation failed')
        return { success: false, message: 'Error logging observation.' }
      }
    })
  },
})

// ============================================================================
// FULL Tools (access level: full only)
// ============================================================================

/**
 * Update an existing entity's properties
 */
export const updateEntity = tool({
  description: `Update information about an existing entity.
Use when you need to correct or add information about something already in memory.`,
  parameters: z.object({
    entityId: z.string().describe('ID of the entity to update'),
    updates: z.object({
      name: z.string().optional().describe('New name'),
      context: z.string().optional().describe('Updated context'),
      importance: z.number().min(0).max(1).optional().describe('Updated importance'),
    }).describe('Fields to update'),
  }),
  execute: async ({ entityId, updates }) => {
    return withSpan('tool.updateEntity', async () => {
      const logger = getLogger().child({ tool: 'updateEntity' })
      logger.info({ entityId, updates }, 'Updating entity')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        // First, search for the entity to get current values
        const searchResult = await store.searchEntities(entityId, ctx)
        if (!searchResult.ok || searchResult.value.length === 0) {
          return { success: false, message: 'Entity not found.' }
        }

        const existing = searchResult.value.find(e => e.entityId === entityId)
        if (!existing) {
          return { success: false, message: 'Entity not found.' }
        }

        // Update the entity
        const updated: Entity = {
          ...existing,
          name: updates.name || existing.name,
          lastMentioned: Date.now(),
          properties: {
            ...existing.properties,
            context: updates.context || existing.properties?.context,
            importance: updates.importance ?? existing.properties?.importance,
          },
        }

        const result = await store.upsertEntity(updated, ctx)

        if (!result.ok) {
          return { success: false, message: 'Update failed.' }
        }

        logger.info({ entityId }, 'Entity updated')

        return {
          success: true,
          message: `Updated "${updated.name}"`,
        }
      } catch (error) {
        logger.error({ error }, 'Update entity failed')
        return { success: false, message: 'Error updating entity.' }
      }
    })
  },
})

/**
 * Delete an entity from memory
 */
export const deleteEntity = tool({
  description: `Remove an entity from memory. Use sparingly and only when:
- The information is incorrect
- The user explicitly asks to forget something
- The entity was created by mistake`,
  parameters: z.object({
    entityId: z.string().describe('ID of the entity to delete'),
    reason: z.string().describe('Why this entity should be deleted'),
  }),
  execute: async ({ entityId, reason }) => {
    return withSpan('tool.deleteEntity', async () => {
      const logger = getLogger().child({ tool: 'deleteEntity' })
      logger.info({ entityId, reason }, 'Deleting entity')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        // Check if store has deleteEntity method
        if ('deleteEntity' in store && typeof store.deleteEntity === 'function') {
          const result = await (store as { deleteEntity: (id: string, ctx: TraceContext) => Promise<{ ok: boolean }> }).deleteEntity(entityId, ctx)

          if (!result.ok) {
            return { success: false, message: 'Delete failed.' }
          }

          logger.info({ entityId, reason }, 'Entity deleted')

          return {
            success: true,
            message: `Removed entity ${entityId}`,
          }
        } else {
          return { success: false, message: 'Delete not supported.' }
        }
      } catch (error) {
        logger.error({ error }, 'Delete entity failed')
        return { success: false, message: 'Error deleting entity.' }
      }
    })
  },
})

/**
 * Create a relationship between two entities
 */
export const createRelationship = tool({
  description: `Create a specific relationship between two entities in memory.
Different from logObservation in that this is for explicit relationship creation.`,
  parameters: z.object({
    fromEntity: z.string().describe('Source entity name'),
    toEntity: z.string().describe('Target entity name'),
    relationshipType: z.string().describe('Type of relationship'),
    strength: z.number().min(0).max(1).default(0.5).describe('Relationship strength 0-1'),
    properties: z.record(z.unknown()).optional().describe('Additional properties'),
  }),
  execute: async ({ fromEntity, toEntity, relationshipType, strength, properties }) => {
    return withSpan('tool.createRelationship', async () => {
      const logger = getLogger().child({ tool: 'createRelationship' })
      logger.info({ fromEntity, toEntity, relationshipType }, 'Creating relationship')

      try {
        const store = getKnowledgeStore()
        const ctx = getTraceContext()

        const result = await store.createRelationship(
          fromEntity,
          toEntity,
          relationshipType,
          { strength, ...properties, createdAt: Date.now() },
          ctx
        )

        if (!result.ok) {
          return { success: false, message: 'Failed to create relationship.' }
        }

        logger.info('Relationship created')

        return {
          success: true,
          message: `Created: ${fromEntity} --[${relationshipType}]--> ${toEntity}`,
        }
      } catch (error) {
        logger.error({ error }, 'Create relationship failed')
        return { success: false, message: 'Error creating relationship.' }
      }
    })
  },
})

// ============================================================================
// Tool Collections by Access Level
// ============================================================================

export const readOnlyMemoryTools = {
  recallMemory,
  searchEntities,
  getRelatedEntities,
}

export const writeMemoryTools = {
  ...readOnlyMemoryTools,
  saveNote,
  logObservation,
}

export const fullMemoryTools = {
  ...writeMemoryTools,
  updateEntity,
  deleteEntity,
  createRelationship,
}

/**
 * Get memory tools based on access level
 */
export function getMemoryTools(accessLevel: MemoryToolAccessLevel): Record<string, unknown> {
  switch (accessLevel) {
    case 'off':
      return {}
    case 'read':
      return readOnlyMemoryTools
    case 'write':
      return writeMemoryTools
    case 'full':
      return fullMemoryTools
    default:
      return {}
  }
}
