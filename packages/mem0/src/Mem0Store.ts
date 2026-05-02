/**
 * Mem0 Store Implementation
 *
 * L5 memory store backed by Mem0 FastAPI service.
 * Implements IMem0Store interface with full error mapping.
 */

import type { Result, StoreError, TraceContext } from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'
import type { Mem0HttpClient } from './client.js'
import { Mem0ApiError } from './client.js'
import type {
  IMem0Store,
  Mem0Message,
  AddMemoryOptions,
  AddMemoryResponse,
  SearchMemoryOptions,
  Mem0SearchResult,
  Mem0Memory,
  GetMemoriesOptions,
} from './types.js'
import {
  transformMemory,
  transformSearchResults,
  transformAddResults,
  transformMemories,
} from './transform.js'
import type { Mem0AddResult } from './types.js'

/**
 * Map Mem0 API errors to StoreError types
 */
function mapMem0Error(error: unknown): StoreError {
  if (error instanceof Mem0ApiError) {
    const { status, body, path } = error

    // Connection errors (fetch failed)
    if (status === 0 || body.includes('ECONNREFUSED') || body.includes('fetch failed')) {
      return {
        kind: 'ConnectionError',
        message: `Mem0 connection failed: ${body}`,
        context: { path, status },
        cause: error,
      }
    }

    // Timeout
    if (body.includes('timeout') || body.includes('aborted')) {
      return {
        kind: 'TimeoutError',
        message: `Mem0 operation timed out: ${body}`,
        context: { path, status },
        cause: error,
      }
    }

    // Validation errors (400)
    if (status === 400 || status === 422) {
      return {
        kind: 'ValidationError',
        message: `Mem0 validation error: ${body}`,
        context: { path, status },
        cause: error,
      }
    }

    // Not found (404)
    if (status === 404) {
      return {
        kind: 'NotFoundError',
        message: `Mem0 resource not found: ${body}`,
        context: { path, status },
        cause: error,
      }
    }

    return {
      kind: 'UnexpectedError',
      message: `Mem0 error: ${body}`,
      context: { path, status },
      cause: error,
    }
  }

  // Handle AbortError (timeout via AbortController)
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      kind: 'TimeoutError',
      message: 'Mem0 request timed out',
      context: {},
      cause: error,
    }
  }

  // Handle network errors
  if (error instanceof Error) {
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      return {
        kind: 'ConnectionError',
        message: `Mem0 connection failed: ${error.message}`,
        context: {},
        cause: error,
      }
    }
  }

  return {
    kind: 'UnexpectedError',
    message: error instanceof Error ? error.message : 'Unknown Mem0 error',
    context: {},
    cause: error,
  }
}

/**
 * Mem0 Store - L5 memory implementation
 */
export class Mem0Store implements IMem0Store {
  constructor(private readonly client: Mem0HttpClient) {}

  async addMemory(
    messages: Mem0Message[],
    options: AddMemoryOptions,
    ctx: TraceContext
  ): Promise<Result<AddMemoryResponse, StoreError>> {
    return withSpan('Mem0Store.addMemory', async () => {
      const logger = getLogger().child({
        userId: options.userId,
        messageCount: messages.length,
        requestId: ctx.requestId,
      })

      try {
        // API returns { results: [...], relations?: [...] } with snake_case fields
        const rawResponse = await this.client.request<{ results: Record<string, unknown>[]; relations?: unknown[] }>('POST', '/memories', {
          body: {
            messages,
            user_id: options.userId,
            agent_id: options.agentId,
            run_id: options.runId,
            metadata: options.metadata,
            // Note: 'infer' is not a valid API parameter - Mem0 always infers
          },
        })

        // Transform snake_case to camelCase
        const transformedResults = transformAddResults<Mem0AddResult>(rawResponse.results || [])

        // Build normalized response
        const response: AddMemoryResponse = {
          memoryIds: transformedResults.map((r) => r.id),
          results: transformedResults,
        }

        logger.debug(
          { memoryCount: response.memoryIds.length, resultCount: response.results.length },
          'Memories added to Mem0'
        )

        return ok(response)
      } catch (error) {
        logger.error({ error }, 'Failed to add memories to Mem0')
        pipelineMetrics.errors.add(1, { error_kind: 'mem0_add' })
        return err(mapMem0Error(error))
      }
    })
  }

  async searchMemory(
    query: string,
    options: SearchMemoryOptions,
    ctx: TraceContext
  ): Promise<Result<Mem0SearchResult[], StoreError>> {
    return withSpan('Mem0Store.searchMemory', async () => {
      const logger = getLogger().child({
        userId: options.userId,
        queryLength: query.length,
        requestId: ctx.requestId,
      })

      try {
        // API returns { results: [...] } with snake_case fields
        const rawResponse = await this.client.request<{ results: Record<string, unknown>[] }>('GET', '/memories/search', {
          params: {
            user_id: options.userId,
            q: query, // API expects 'q' not 'query'
            agent_id: options.agentId,
            run_id: options.runId,
            limit: options.limit,
            threshold: options.threshold,
          },
        })

        // Transform snake_case to camelCase
        const results = transformSearchResults<Mem0SearchResult>(rawResponse.results || [])
        logger.debug({ resultCount: results.length }, 'Mem0 search completed')
        pipelineMetrics.memoryCacheHits.add(results.length > 0 ? 1 : 0, { tier: 'L5' })

        return ok(results)
      } catch (error) {
        logger.error({ error }, 'Mem0 search failed')
        pipelineMetrics.errors.add(1, { error_kind: 'mem0_search' })
        return err(mapMem0Error(error))
      }
    })
  }

  async updateMemory(
    id: string,
    text: string,
    _metadata: Record<string, unknown> | undefined, // Not used by API
    ctx: TraceContext
  ): Promise<Result<Mem0Memory, StoreError>> {
    return withSpan('Mem0Store.updateMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      try {
        // API returns snake_case fields
        const rawResponse = await this.client.request<Record<string, unknown>>('PUT', `/memories/${id}`, {
          body: {
            data: text, // API expects 'data' not 'text'
            // Note: metadata is not supported by the update endpoint
          },
        })

        // Transform snake_case to camelCase
        const response = transformMemory<Mem0Memory>(rawResponse)
        logger.debug({ memoryId: id }, 'Memory updated in Mem0')
        return ok(response)
      } catch (error) {
        logger.error({ error, memoryId: id }, 'Failed to update memory in Mem0')
        pipelineMetrics.errors.add(1, { error_kind: 'mem0_update' })
        return err(mapMem0Error(error))
      }
    })
  }

  async deleteMemory(id: string, ctx: TraceContext): Promise<Result<void, StoreError>> {
    return withSpan('Mem0Store.deleteMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      try {
        await this.client.request<void>('DELETE', `/memories/${id}`)

        logger.debug({ memoryId: id }, 'Memory deleted from Mem0')
        return ok(undefined)
      } catch (error) {
        logger.error({ error, memoryId: id }, 'Failed to delete memory from Mem0')
        pipelineMetrics.errors.add(1, { error_kind: 'mem0_delete' })
        return err(mapMem0Error(error))
      }
    })
  }

  async getMemories(
    userId: string,
    options: GetMemoriesOptions | undefined,
    ctx: TraceContext
  ): Promise<Result<Mem0Memory[], StoreError>> {
    return withSpan('Mem0Store.getMemories', async () => {
      const logger = getLogger().child({
        userId,
        requestId: ctx.requestId,
      })

      try {
        // API returns { results: [...] } with snake_case fields
        const rawResponse = await this.client.request<{ results: Record<string, unknown>[] }>('GET', '/memories', {
          params: {
            user_id: userId,
            agent_id: options?.agentId,
            run_id: options?.runId,
          },
        })

        // Transform snake_case to camelCase
        const results = transformMemories<Mem0Memory>(rawResponse.results || [])
        logger.debug({ memoryCount: results.length }, 'Retrieved memories from Mem0')
        return ok(results)
      } catch (error) {
        logger.error({ error, userId }, 'Failed to get memories from Mem0')
        pipelineMetrics.errors.add(1, { error_kind: 'mem0_get_all' })
        return err(mapMem0Error(error))
      }
    })
  }

  async getMemory(id: string, ctx: TraceContext): Promise<Result<Mem0Memory | null, StoreError>> {
    return withSpan('Mem0Store.getMemory', async () => {
      const logger = getLogger().child({
        memoryId: id,
        requestId: ctx.requestId,
      })

      try {
        // API returns snake_case fields
        const rawResponse = await this.client.request<Record<string, unknown>>('GET', `/memories/${id}`)

        // Transform snake_case to camelCase
        const response = transformMemory<Mem0Memory>(rawResponse)
        logger.debug({ memoryId: id }, 'Retrieved memory from Mem0')
        return ok(response)
      } catch (error) {
        // Handle 404 as null (not found is not an error for get)
        if (error instanceof Mem0ApiError && error.status === 404) {
          logger.debug({ memoryId: id }, 'Memory not found in Mem0')
          return ok(null)
        }

        logger.error({ error, memoryId: id }, 'Failed to get memory from Mem0')
        pipelineMetrics.errors.add(1, { error_kind: 'mem0_get' })
        return err(mapMem0Error(error))
      }
    })
  }
}
