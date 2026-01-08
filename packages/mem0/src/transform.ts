/**
 * Snake_case to camelCase transformation utilities
 *
 * The Mem0 FastAPI returns snake_case fields (Python convention),
 * but our TypeScript types use camelCase (JavaScript convention).
 */

/**
 * Convert a snake_case string to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Convert object keys from snake_case to camelCase (shallow)
 */
export function transformKeys<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[snakeToCamel(key)] = value
  }
  return result
}

/**
 * Transform a raw API memory response to our Mem0Memory type
 */
export function transformMemory<T>(raw: Record<string, unknown>): T {
  return {
    id: raw.id,
    memory: raw.memory,
    hash: raw.hash,
    userId: raw.user_id ?? raw.userId,
    agentId: raw.agent_id ?? raw.agentId,
    runId: raw.run_id ?? raw.runId,
    metadata: raw.metadata ?? {},
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  } as T
}

/**
 * Transform a raw API search result to our Mem0SearchResult type
 */
export function transformSearchResult<T>(raw: Record<string, unknown>): T {
  return {
    ...transformMemory(raw),
    score: raw.score,
  } as T
}

/**
 * Transform a raw API add result to our Mem0AddResult type
 */
export function transformAddResult<T>(raw: Record<string, unknown>): T {
  return {
    id: raw.id,
    memory: raw.memory,
    event: raw.event,
    metadata: raw.metadata,
  } as T
}

/**
 * Transform an array of raw memories
 */
export function transformMemories<T>(rawArray: Record<string, unknown>[]): T[] {
  return rawArray.map((raw) => transformMemory<T>(raw))
}

/**
 * Transform an array of raw search results
 */
export function transformSearchResults<T>(rawArray: Record<string, unknown>[]): T[] {
  return rawArray.map((raw) => transformSearchResult<T>(raw))
}

/**
 * Transform an array of raw add results
 */
export function transformAddResults<T>(rawArray: Record<string, unknown>[]): T[] {
  return rawArray.map((raw) => transformAddResult<T>(raw))
}
