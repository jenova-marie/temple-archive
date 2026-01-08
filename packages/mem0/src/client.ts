/**
 * Mem0 Client Factory
 *
 * Provides client creation and management for the Mem0 FastAPI service.
 * Follows the same patterns as the Qdrant and Redis client modules.
 */

import { getLogger } from '@pippa/observability'
import type { Mem0ClientConfig } from './types.js'

const DEFAULT_URL = 'http://localhost:8000'
const DEFAULT_TIMEOUT = 30000

/**
 * HTTP client wrapper for Mem0 API
 */
export class Mem0HttpClient {
  readonly baseUrl: string
  readonly timeout: number
  readonly apiKey?: string

  constructor(config: Mem0ClientConfig = {}) {
    this.baseUrl = config.url ?? process.env.MEM0_API_URL ?? DEFAULT_URL
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.apiKey = config.apiKey ?? process.env.MEM0_API_KEY
  }

  /**
   * Make an HTTP request to the Mem0 API
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: {
      body?: unknown
      params?: Record<string, string | number | boolean | undefined>
    }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    // Add query parameters
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error')
        throw new Mem0ApiError(response.status, errorBody, path)
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T
      }

      return (await response.json()) as T
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Custom error for Mem0 API errors
 */
export class Mem0ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string
  ) {
    super(`Mem0 API error (${status}): ${body}`)
    this.name = 'Mem0ApiError'
  }
}

// Singleton instance
let _client: Mem0HttpClient | null = null

/**
 * Create a new Mem0 client instance
 */
export function createMem0Client(config: Mem0ClientConfig = {}): Mem0HttpClient {
  const logger = getLogger().child({ component: 'mem0-client' })

  const url = config.url ?? process.env.MEM0_API_URL ?? DEFAULT_URL
  logger.info(
    { url, hasApiKey: !!config.apiKey, timeout: config.timeout ?? DEFAULT_TIMEOUT },
    'Creating Mem0 client'
  )

  const client = new Mem0HttpClient(config)
  _client = client
  return client
}

/**
 * Get the singleton Mem0 client instance
 * Creates one with default config if not already created
 */
export function getMem0Client(): Mem0HttpClient {
  if (!_client) {
    _client = createMem0Client()
  }
  return _client
}

/**
 * Close the Mem0 client (clear singleton)
 */
export function closeMem0Client(): void {
  const logger = getLogger().child({ component: 'mem0-client' })
  logger.info('Closing Mem0 client')
  _client = null
}

/**
 * Check if Mem0 API is healthy and reachable
 */
export async function checkMem0Health(): Promise<boolean> {
  const logger = getLogger().child({ component: 'mem0-client' })

  try {
    const client = getMem0Client()
    await client.request('GET', '/health')
    logger.debug('Mem0 health check passed')
    return true
  } catch (error) {
    logger.warn({ error }, 'Mem0 health check failed')
    return false
  }
}
