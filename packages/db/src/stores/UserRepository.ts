/**
 * UserRepository
 *
 * Handles user record management in PostgreSQL.
 * Users should be created/verified early in request lifecycle,
 * before any other database operations that depend on userId.
 *
 * Supports optional Redis caching via UserCacheStore for reduced DB hits.
 */

import type { Result, TraceContext } from '@pippa/types'
import { ok, err } from '@pippa/types'
import { getLogger, withSpan } from '@pippa/observability'
import { eq } from 'drizzle-orm'
import type { DatabaseClient } from '../client.js'
import { users, type User } from '../schema/index.js'
import type { UserCacheStore } from './UserCacheStore.js'

export interface UserError {
  kind: 'NotFound' | 'DatabaseError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

export interface UserData {
  userId: string
  email?: string
  displayName?: string
}

export class UserRepository {
  constructor(
    private readonly db: DatabaseClient,
    private readonly userCache?: UserCacheStore
  ) {}

  /**
   * Get user by ID
   * Checks cache first if available, falls back to database
   */
  async getUser(userId: string, ctx: TraceContext): Promise<Result<User | null, UserError>> {
    return withSpan('UserRepository.getUser', async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId })

      // Check cache first (UserCacheStore logs cache hit/miss)
      if (this.userCache) {
        const cached = await this.userCache.getUser(userId)
        if (cached.ok && cached.value) {
          return ok(cached.value)
        }
      }

      try {
        const rows = await this.db
          .select()
          .from(users)
          .where(eq(users.userId, userId))
          .limit(1)

        if (rows.length === 0) {
          logger.debug({ cacheHit: false }, 'User not found')
          return ok(null)
        }

        const user = rows[0]

        // Cache the result
        if (this.userCache) {
          await this.userCache.setUser(user)
        }

        logger.debug({ cacheHit: false }, 'User found in database')
        return ok(user)
      } catch (error) {
        logger.error({ error }, 'Failed to get user')
        return err({
          kind: 'DatabaseError',
          message: 'Failed to get user',
          context: { userId },
          cause: error,
        })
      }
    })
  }

  /**
   * Get or create user - ensures user record exists
   *
   * Call this early in request lifecycle after JWT validation.
   * Uses cache-through pattern: check cache first, update DB if needed, re-cache.
   */
  async getOrCreateUser(
    data: UserData,
    ctx: TraceContext
  ): Promise<Result<User, UserError>> {
    return withSpan('UserRepository.getOrCreateUser', async () => {
      const logger = getLogger().child({ userId: data.userId, requestId: ctx.requestId })

      // Check cache first (UserCacheStore logs cache hit/miss)
      if (this.userCache) {
        const cached = await this.userCache.getUser(data.userId)
        if (cached.ok && cached.value) {
          const cachedUser = cached.value
          // Check if email/displayName changed
          const needsUpdate = cachedUser.email !== (data.email ?? null) ||
                              cachedUser.displayName !== (data.displayName ?? null)

          if (!needsUpdate) {
            return ok(cachedUser)
          }

          // Data changed - need to update DB and re-cache
          logger.debug('User data changed, updating database')
        }
      }

      try {
        // Upsert user - insert if not exists, update email/displayName if changed
        const now = new Date()
        await this.db
          .insert(users)
          .values({
            userId: data.userId,
            email: data.email,
            displayName: data.displayName,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: users.userId,
            set: {
              email: data.email,
              displayName: data.displayName,
              updatedAt: now,
            },
          })

        // Fetch the user record
        const rows = await this.db
          .select()
          .from(users)
          .where(eq(users.userId, data.userId))
          .limit(1)

        if (rows.length === 0) {
          // Shouldn't happen after upsert, but handle gracefully
          return err({
            kind: 'DatabaseError',
            message: 'User not found after upsert',
            context: { userId: data.userId },
          })
        }

        const user = rows[0]

        // Cache the result
        if (this.userCache) {
          await this.userCache.setUser(user)
        }

        logger.debug({ cacheHit: false }, 'User ensured in database')
        return ok(user)
      } catch (error) {
        logger.error({ error }, 'Failed to get or create user')
        return err({
          kind: 'DatabaseError',
          message: 'Failed to get or create user',
          context: { userId: data.userId },
          cause: error,
        })
      }
    })
  }
}
