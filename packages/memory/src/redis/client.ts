/**
 * Redis Client Factory
 *
 * Creates and manages Redis connections for L1 context caching.
 */

import { Redis, type RedisOptions } from 'ioredis'
import { getLogger } from '@recoverysky/observability'

export interface RedisClientConfig {
  /** Redis connection URL (e.g., redis://localhost:6379 or redis://:password@localhost:6379) */
  url?: string
  /** Redis password (alternative to including in URL) */
  password?: string
  /** Redis username for ACL auth (Redis 6+) */
  username?: string
  /** Redis database number (0-15) */
  db?: number
  /** Command timeout in milliseconds */
  commandTimeout?: number
  /** Maximum retry attempts for commands */
  maxRetriesPerRequest?: number
  /** Enable ready check on connect */
  enableReadyCheck?: boolean
  /** Lazy connect - don't connect until first command */
  lazyConnect?: boolean
  /** TLS/SSL options */
  tls?: boolean
}

const DEFAULT_CONFIG: Required<Omit<RedisClientConfig, 'url' | 'password' | 'username' | 'db' | 'tls'>> = {
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

  // Get auth from config or environment variables
  const password = config.password ?? process.env.REDIS_PASSWORD
  const username = config.username ?? process.env.REDIS_USERNAME
  const db = config.db ?? (process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : undefined)
  const tls = config.tls ?? process.env.REDIS_TLS === 'true'

  // Mask credentials in logs
  const safeUrl = url.replace(/\/\/.*@/, '//***@')
  logger.info({ url: safeUrl, hasPassword: !!password, hasUsername: !!username, db, tls }, 'Creating Redis client')

  const options: RedisOptions = {
    maxRetriesPerRequest: mergedConfig.maxRetriesPerRequest,
    enableReadyCheck: mergedConfig.enableReadyCheck,
    lazyConnect: mergedConfig.lazyConnect,
    commandTimeout: mergedConfig.commandTimeout,
    // Auth options (only set if provided, URL credentials take precedence)
    ...(password && { password }),
    ...(username && { username }),
    ...(db !== undefined && { db }),
    ...(tls && { tls: {} }), // Empty object enables TLS with defaults
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
