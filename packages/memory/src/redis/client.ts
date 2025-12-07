/**
 * Redis Client Factory
 *
 * Creates and manages Redis connections for L1 context caching.
 */

import { Redis, type RedisOptions } from 'ioredis'
import { getLogger } from '@recoverysky/observability'

export interface RedisClientConfig {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url?: string
  /** Command timeout in milliseconds */
  commandTimeout?: number
  /** Maximum retry attempts for commands */
  maxRetriesPerRequest?: number
  /** Enable ready check on connect */
  enableReadyCheck?: boolean
  /** Lazy connect - don't connect until first command */
  lazyConnect?: boolean
}

const DEFAULT_CONFIG: Required<Omit<RedisClientConfig, 'url'>> = {
  commandTimeout: 5000,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
}

let redisInstance: Redis | null = null

/**
 * Create a new Redis client instance
 */
export function createRedisClient(config: RedisClientConfig = {}): Redis {
  const logger = getLogger().child({ component: 'redis-client' })

  const url = config.url ?? process.env.REDIS_URL ?? 'redis://localhost:6379'
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  logger.info({ url: url.replace(/\/\/.*@/, '//***@') }, 'Creating Redis client')

  const options: RedisOptions = {
    maxRetriesPerRequest: mergedConfig.maxRetriesPerRequest,
    enableReadyCheck: mergedConfig.enableReadyCheck,
    lazyConnect: mergedConfig.lazyConnect,
    commandTimeout: mergedConfig.commandTimeout,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error({ attempts: times }, 'Redis connection failed after max retries')
        return null // Stop retrying
      }
      // Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms, 1600ms, ...
      const delay = Math.min(times * 50, 2000)
      logger.warn({ attempt: times, delay }, 'Retrying Redis connection')
      return delay
    },
  }

  const client = new Redis(url, options)

  // Connection event handlers
  client.on('connect', () => {
    logger.info('Redis client connected')
  })

  client.on('ready', () => {
    logger.info('Redis client ready')
  })

  client.on('error', (err: Error) => {
    logger.error({ error: err.message }, 'Redis client error')
  })

  client.on('close', () => {
    logger.info('Redis client connection closed')
  })

  client.on('reconnecting', () => {
    logger.info('Redis client reconnecting')
  })

  return client
}

/**
 * Get or create a singleton Redis client instance
 */
export function getRedisClient(config?: RedisClientConfig): Redis {
  if (!redisInstance) {
    redisInstance = createRedisClient(config)
  }
  return redisInstance
}

/**
 * Close the singleton Redis client
 */
export async function closeRedisClient(): Promise<void> {
  if (redisInstance) {
    const logger = getLogger().child({ component: 'redis-client' })
    logger.info('Closing Redis client')
    await redisInstance.quit()
    redisInstance = null
  }
}

/**
 * Check Redis health
 */
export async function checkRedisHealth(client: Redis): Promise<boolean> {
  try {
    const result = await client.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}

export type { Redis as RedisClient }
