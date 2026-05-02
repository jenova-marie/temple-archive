/**
 * In-Memory Memory Store - Stub Implementation
 *
 * MCP-compatible memory store for testing and development.
 * Data is stored in memory and lost on restart.
 */

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
  MemoryRelationSource,
  StoreError,
  TraceContext,
  Result,
} from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger } from '@siri/observability'

interface StoredRelation {
  from: string
  to: string
  type: string
  strength: number
  source: MemoryRelationSource
  createdAt: number
}

export class InMemoryMemoryStore implements IMemoryStore {
  private memories: Map<string, Memory> = new Map()
  private relations: StoredRelation[] = []

  constructor() {
    const logger = getLogger().child({ component: 'InMemoryMemoryStore' })
    logger.info('In-memory Memory Store initialized (data will not persist)')
  }

  // ============================================================================
  // Core CRUD Operations
  // ============================================================================

  async createMemory(
    input: CreateMemoryInput,
    _ctx: TraceContext
  ): Promise<Result<Memory, StoreError>> {
    const now = Date.now()
    const id = nanoid()

    const observations: Observation[] = (input.observations ?? []).map((content) => ({
      id: nanoid(),
      content,
      createdAt: now,
    }))

    const memory: Memory = {
      id,
      name: input.name,
      memoryType: input.memoryType,
      metadata: input.metadata ?? {},
      observations,
      createdAt: now,
      modifiedAt: now,
      lastAccessed: now,
    }

    this.memories.set(id, memory)
    return ok(memory)
  }

  async getMemory(
    id: string,
    _ctx: TraceContext
  ): Promise<Result<Memory | null, StoreError>> {
    const memory = this.memories.get(id)
    if (memory) {
      memory.lastAccessed = Date.now()
    }
    return ok(memory ?? null)
  }

  async updateMemory(
    id: string,
    updates: UpdateMemoryInput,
    _ctx: TraceContext
  ): Promise<Result<Memory, StoreError>> {
    const existing = this.memories.get(id)
    if (!existing) {
      return err({
        kind: 'NotFoundError',
        message: 'Memory not found',
        context: { id },
      })
    }

    const now = Date.now()
    const updated: Memory = {
      ...existing,
      name: updates.name ?? existing.name,
      memoryType: updates.memoryType ?? existing.memoryType,
      metadata: updates.metadata
        ? { ...existing.metadata, ...updates.metadata }
        : existing.metadata,
      modifiedAt: now,
      lastAccessed: now,
    }

    this.memories.set(id, updated)
    return ok(updated)
  }

  async deleteMemory(
    id: string,
    _ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    this.memories.delete(id)
    // Remove related relations
    this.relations = this.relations.filter((r) => r.from !== id && r.to !== id)
    return ok(undefined)
  }

  // ============================================================================
  // Observation Operations
  // ============================================================================

  async addObservation(
    memoryId: string,
    content: string,
    _ctx: TraceContext
  ): Promise<Result<Observation, StoreError>> {
    const memory = this.memories.get(memoryId)
    if (!memory) {
      return err({
        kind: 'NotFoundError',
        message: 'Memory not found',
        context: { memoryId },
      })
    }

    const now = Date.now()
    const observation: Observation = {
      id: nanoid(),
      content,
      createdAt: now,
    }

    memory.observations.push(observation)
    memory.modifiedAt = now
    return ok(observation)
  }

  async getObservations(
    memoryId: string,
    _ctx: TraceContext
  ): Promise<Result<Observation[], StoreError>> {
    const memory = this.memories.get(memoryId)
    if (!memory) {
      return ok([])
    }
    return ok([...memory.observations])
  }

  // ============================================================================
  // Relation Operations
  // ============================================================================

  async createRelation(
    from: string,
    to: string,
    type: MemoryRelationType | string,
    strength: number,
    _ctx: TraceContext
  ): Promise<Result<void, StoreError>> {
    // Check if relation already exists
    const existing = this.relations.find(
      (r) => r.from === from && r.to === to && r.type === type
    )

    if (existing) {
      // Update strength if new is higher
      existing.strength = Math.max(existing.strength, strength)
    } else {
      this.relations.push({
        from,
        to,
        type,
        strength: Math.max(0.1, Math.min(1.0, strength)),
        source: 'agent',
        createdAt: Date.now(),
      })
    }

    return ok(undefined)
  }

  async getRelations(
    memoryId: string,
    direction: 'outbound' | 'inbound' | 'both',
    _ctx: TraceContext
  ): Promise<Result<MemoryRelation[], StoreError>> {
    let filtered: StoredRelation[]

    if (direction === 'outbound') {
      filtered = this.relations.filter((r) => r.from === memoryId)
    } else if (direction === 'inbound') {
      filtered = this.relations.filter((r) => r.to === memoryId)
    } else {
      filtered = this.relations.filter((r) => r.from === memoryId || r.to === memoryId)
    }

    return ok(filtered as MemoryRelation[])
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  async searchMemories(
    query: string,
    options: MemorySearchOptions,
    _ctx: TraceContext
  ): Promise<Result<Memory[], StoreError>> {
    const queryLower = query.toLowerCase()

    let results = Array.from(this.memories.values()).filter((m) => {
      // Text search in name and observations
      const nameMatch = m.name.toLowerCase().includes(queryLower)
      const obsMatch = m.observations.some((o) =>
        o.content.toLowerCase().includes(queryLower)
      )
      return nameMatch || obsMatch
    })

    // Apply filters
    if (options.memoryTypes && options.memoryTypes.length > 0) {
      results = results.filter((m) => options.memoryTypes!.includes(m.memoryType))
    }

    if (options.userId) {
      results = results.filter((m) => m.metadata.userId === options.userId)
    }

    if (options.subtype) {
      results = results.filter((m) => m.metadata.subtype === options.subtype)
    }

    if (options.createdAfter !== undefined) {
      results = results.filter((m) => m.createdAt >= options.createdAfter!)
    }

    if (options.createdBefore !== undefined) {
      results = results.filter((m) => m.createdAt <= options.createdBefore!)
    }

    // Sort by lastAccessed descending
    results.sort((a, b) => b.lastAccessed - a.lastAccessed)

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit)
    }

    return ok(results)
  }

  async getRelatedMemories(
    memoryId: string,
    depth: number,
    _ctx: TraceContext
  ): Promise<Result<MemoryWithRelations, StoreError>> {
    const memory = this.memories.get(memoryId)
    if (!memory) {
      return err({
        kind: 'NotFoundError',
        message: 'Memory not found',
        context: { memoryId },
      })
    }

    const visited = new Set<string>([memoryId])
    const descendants: Array<Memory & { relation: MemoryRelation; distance: number }> = []
    const ancestors: Array<Memory & { relation: MemoryRelation; distance: number }> = []

    // BFS for descendants
    const descendantQueue: Array<{ id: string; distance: number }> = [{ id: memoryId, distance: 0 }]
    while (descendantQueue.length > 0) {
      const { id, distance } = descendantQueue.shift()!
      if (distance >= depth) continue

      const outbound = this.relations.filter((r) => r.from === id)
      for (const rel of outbound) {
        if (!visited.has(rel.to)) {
          visited.add(rel.to)
          const relatedMemory = this.memories.get(rel.to)
          if (relatedMemory) {
            descendants.push({
              ...relatedMemory,
              relation: rel as MemoryRelation,
              distance: distance + 1,
            })
            descendantQueue.push({ id: rel.to, distance: distance + 1 })
          }
        }
      }
    }

    // BFS for ancestors
    visited.clear()
    visited.add(memoryId)
    const ancestorQueue: Array<{ id: string; distance: number }> = [{ id: memoryId, distance: 0 }]
    while (ancestorQueue.length > 0) {
      const { id, distance } = ancestorQueue.shift()!
      if (distance >= depth) continue

      const inbound = this.relations.filter((r) => r.to === id)
      for (const rel of inbound) {
        if (!visited.has(rel.from)) {
          visited.add(rel.from)
          const relatedMemory = this.memories.get(rel.from)
          if (relatedMemory) {
            ancestors.push({
              ...relatedMemory,
              relation: rel as MemoryRelation,
              distance: distance + 1,
            })
            ancestorQueue.push({ id: rel.from, distance: distance + 1 })
          }
        }
      }
    }

    const result: MemoryWithRelations = {
      ...memory,
      related: { descendants, ancestors },
    }

    return ok(result)
  }

  async findByName(
    name: string,
    _ctx: TraceContext
  ): Promise<Result<Memory[], StoreError>> {
    const nameLower = name.toLowerCase()
    const results = Array.from(this.memories.values())
      .filter((m) => m.name.toLowerCase().includes(nameLower))
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .slice(0, 50)

    return ok(results)
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.memories.clear()
    this.relations = []
  }

  /**
   * Get all memories (for testing)
   */
  getAllMemories(): Memory[] {
    return Array.from(this.memories.values())
  }

  /**
   * Get all relations (for testing)
   */
  getAllRelations(): StoredRelation[] {
    return [...this.relations]
  }
}
