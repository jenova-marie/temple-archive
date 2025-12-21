/**
 * UserCacheStore
 *
 * Redis-backed cache for User and UserProfile data.
 * Reduces database hits by caching frequently accessed user data.
 */

import type { Redis } from 'ioredis'
import type { UserProfile, StoreError, Result } from '@pippa/types'
import { ok, err } from '@pippa/types'
import { getLogger } from '@pippa/observability'
import type { User } from '../schema/index.js'

/**
 * Redis key patterns for user caching
 */
const UserCacheKeys = {
  /** User record hash */
  user: (userId: string): string => `user:info:${userId}`,
  /** User profile hash */
  profile: (userId: string): string => `user:profile:${userId}`,
} as const

/**
 * Configuration for UserCacheStore
 */
export interface UserCacheConfig {
  /** TTL in seconds (default: 3600 = 1 hour) */
  ttlSeconds?: number
}

/**
 * Map Redis error codes to StoreError kinds
 */
function mapRedisError(error: unknown): StoreError {
  const err = error as Error & { code?: string }
  const message = err?.message ?? 'Unknown Redis error'
  const code = err?.code

  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || message.includes('ECONNRESET')) {
    return {
      kind: 'ConnectionError',
      message: `Redis connection failed: ${message}`,
      context: { code },
      cause: error,
    }
  }

  if (code === 'ETIMEDOUT' || message.includes('timeout')) {
    return {
      kind: 'TimeoutError',
      message: `Redis operation timed out: ${message}`,
      context: { code },
      cause: error,
    }
  }

  return {
    kind: 'UnexpectedError',
    message: `Redis error: ${message}`,
    context: { code },
    cause: error,
  }
}

/**
 * Serialize User to Redis hash fields
 */
function serializeUser(user: User): Record<string, string> {
  return {
    userId: user.userId,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    metadata: JSON.stringify(user.metadata ?? {}),
  }
}

/**
 * Deserialize Redis hash fields to User
 */
function deserializeUser(data: Record<string, string>): User {
  return {
    userId: data.userId,
    email: data.email || null,
    displayName: data.displayName || null,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
    metadata: data.metadata ? JSON.parse(data.metadata) : {},
  }
}

/**
 * Serialize UserProfile to Redis hash fields
 */
function serializeProfile(profile: UserProfile): Record<string, string> {
  return {
    userId: profile.userId,
    recoveryPhase: profile.recoveryPhase ?? '',
    sobrietyDate: profile.sobrietyDate ?? '',
    triggers: JSON.stringify(profile.triggers),
    copingStrategies: JSON.stringify(profile.copingStrategies),
    preferences: JSON.stringify(profile.preferences),
    milestones: JSON.stringify(profile.milestones),
    lastUpdated: String(profile.lastUpdated),
  }
}

/**
 * Deserialize Redis hash fields to UserProfile
 */
function deserializeProfile(data: Record<string, string>): UserProfile {
  return {
    userId: data.userId,
    recoveryPhase: data.recoveryPhase || undefined,
    sobrietyDate: data.sobrietyDate || undefined,
    triggers: data.triggers ? JSON.parse(data.triggers) : [],
    copingStrategies: data.copingStrategies ? JSON.parse(data.copingStrategies) : [],
    preferences: data.preferences ? JSON.parse(data.preferences) : {},
    milestones: data.milestones ? JSON.parse(data.milestones) : [],
    lastUpdated: parseInt(data.lastUpdated || '0', 10) || Date.now(),
  }
}

/**
 * Redis-backed cache for User and UserProfile data
 */
export class UserCacheStore {
  private readonly ttlSeconds: number

  constructor(
    private readonly redis: Redis,
    config: UserCacheConfig = {}
  ) {
    this.ttlSeconds = config.ttlSeconds ?? 3600 // 1 hour default
  }

  // ============================================================================
  // User Record Operations
  // ============================================================================

  /**
   * Get user from cache
   */
  async getUser(userId: string): Promise<Result<User | null, StoreError>> {
    const logger = getLogger().child({ userId, component: 'UserCacheStore' })

    try {
      const key = UserCacheKeys.user(userId)
      const data = await this.redis.hgetall(key)

      if (!data || Object.keys(data).length === 0) {
        logger.debug({ cacheHit: false }, 'User not found in cache')
        return ok(null)
      }

      const user = deserializeUser(data)
      logger.debug({ cacheHit: true }, 'User found in cache')
      return ok(user)
    } catch (error) {
      logger.error({ error }, 'Failed to get user from cache')
      // Return null on error - graceful degradation to database
      return ok(null)
    }
  }

  /**
   * Store user in cache
   */
  async setUser(user: User): Promise<Result<void, StoreError>> {
    const logger = getLogger().child({ userId: user.userId, component: 'UserCacheStore' })

    try {
      const key = UserCacheKeys.user(user.userId)
      const fields = serializeUser(user)

      const pipeline = this.redis.pipeline()
      pipeline.hset(key, fields)
      pipeline.expire(key, this.ttlSeconds)
      await pipeline.exec()

      logger.debug('User cached')
      return ok(undefined)
    } catch (error) {
      logger.error({ error }, 'Failed to cache user')
      return err(mapRedisError(error))
    }
  }

  /**
   * Invalidate user cache
   */
  async invalidateUser(userId: string): Promise<void> {
    const logger = getLogger().child({ userId, component: 'UserCacheStore' })

    try {
      const key = UserCacheKeys.user(userId)
      await this.redis.del(key)
      logger.debug('User cache invalidated')
    } catch (error) {
      logger.error({ error }, 'Failed to invalidate user cache')
    }
  }

  // ============================================================================
  // User Profile Operations
  // ============================================================================

  /**
   * Get user profile from cache
   */
  async getUserProfile(userId: string): Promise<Result<UserProfile | null, StoreError>> {
    const logger = getLogger().child({ userId, component: 'UserCacheStore' })

    try {
      const key = UserCacheKeys.profile(userId)
      const data = await this.redis.hgetall(key)

      if (!data || Object.keys(data).length === 0) {
        logger.debug({ cacheHit: false }, 'User profile not found in cache')
        return ok(null)
      }

      const profile = deserializeProfile(data)
      logger.debug({ cacheHit: true }, 'User profile found in cache')
      return ok(profile)
    } catch (error) {
      logger.error({ error }, 'Failed to get user profile from cache')
      // Return null on error - graceful degradation to database
      return ok(null)
    }
  }

  /**
   * Store user profile in cache
   */
  async setUserProfile(profile: UserProfile): Promise<Result<void, StoreError>> {
    const logger = getLogger().child({ userId: profile.userId, component: 'UserCacheStore' })

    try {
      const key = UserCacheKeys.profile(profile.userId)
      const fields = serializeProfile(profile)

      const pipeline = this.redis.pipeline()
      pipeline.hset(key, fields)
      pipeline.expire(key, this.ttlSeconds)
      await pipeline.exec()

      logger.debug('User profile cached')
      return ok(undefined)
    } catch (error) {
      logger.error({ error }, 'Failed to cache user profile')
      return err(mapRedisError(error))
    }
  }

  /**
   * Invalidate user profile cache
   */
  async invalidateUserProfile(userId: string): Promise<void> {
    const logger = getLogger().child({ userId, component: 'UserCacheStore' })

    try {
      const key = UserCacheKeys.profile(userId)
      await this.redis.del(key)
      logger.debug('User profile cache invalidated')
    } catch (error) {
      logger.error({ error }, 'Failed to invalidate user profile cache')
    }
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Invalidate all cached data for a user
   */
  async invalidateAll(userId: string): Promise<void> {
    const logger = getLogger().child({ userId, component: 'UserCacheStore' })

    try {
      const userKey = UserCacheKeys.user(userId)
      const profileKey = UserCacheKeys.profile(userId)
      await this.redis.del(userKey, profileKey)
      logger.debug('All user cache invalidated')
    } catch (error) {
      logger.error({ error }, 'Failed to invalidate all user cache')
    }
  }
}
