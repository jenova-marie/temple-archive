/**
 * TranscriptionRepository
 *
 * Handles transcription record management in PostgreSQL.
 * All operations are scoped to a specific user.
 */

import type { Result, TraceContext } from '@siri/types'
import { ok, err } from '@siri/types'
import { getLogger, withSpan } from '@siri/observability'
import { eq, desc, and } from 'drizzle-orm'
import type { DatabaseClient } from '../client.js'
import { transcriptions, type Transcription, type NewTranscription } from '../schema/index.js'

export interface TranscriptionError {
  kind: 'NotFound' | 'DatabaseError' | 'Unauthorized'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

export class TranscriptionRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Create a new transcription
   */
  async create(
    data: Omit<NewTranscription, 'id' | 'createdAt'>,
    ctx: TraceContext
  ): Promise<Result<Transcription, TranscriptionError>> {
    return withSpan('TranscriptionRepository.create', async () => {
      const logger = getLogger().child({ userId: data.userId, requestId: ctx.requestId })

      try {
        const [inserted] = await this.db
          .insert(transcriptions)
          .values(data)
          .returning()

        logger.debug({ transcriptionId: inserted.id }, 'Transcription created')
        return ok(inserted)
      } catch (error) {
        logger.error({ error }, 'Failed to create transcription')
        return err({
          kind: 'DatabaseError',
          message: 'Failed to create transcription',
          context: { userId: data.userId },
          cause: error,
        })
      }
    })
  }

  /**
   * Get transcription history for a user
   */
  async getHistory(
    userId: string,
    limit: number = 100,
    ctx: TraceContext
  ): Promise<Result<Transcription[], TranscriptionError>> {
    return withSpan('TranscriptionRepository.getHistory', async () => {
      const logger = getLogger().child({ userId, requestId: ctx.requestId })

      try {
        const results = await this.db
          .select()
          .from(transcriptions)
          .where(eq(transcriptions.userId, userId))
          .orderBy(desc(transcriptions.createdAt))
          .limit(limit)

        logger.debug({ count: results.length }, 'Fetched transcription history')
        return ok(results)
      } catch (error) {
        logger.error({ error }, 'Failed to fetch history')
        return err({
          kind: 'DatabaseError',
          message: 'Failed to fetch transcription history',
          context: { userId },
          cause: error,
        })
      }
    })
  }

  /**
   * Get a single transcription by ID (user-scoped)
   */
  async getById(
    id: string,
    userId: string,
    ctx: TraceContext
  ): Promise<Result<Transcription | null, TranscriptionError>> {
    return withSpan('TranscriptionRepository.getById', async () => {
      const logger = getLogger().child({ transcriptionId: id, userId, requestId: ctx.requestId })

      try {
        const results = await this.db
          .select()
          .from(transcriptions)
          .where(and(
            eq(transcriptions.id, id),
            eq(transcriptions.userId, userId)
          ))
          .limit(1)

        if (results.length === 0) {
          logger.debug('Transcription not found')
          return ok(null)
        }

        return ok(results[0])
      } catch (error) {
        logger.error({ error }, 'Failed to get transcription')
        return err({
          kind: 'DatabaseError',
          message: 'Failed to get transcription',
          context: { id, userId },
          cause: error,
        })
      }
    })
  }

  /**
   * Delete a transcription (user-scoped)
   */
  async delete(
    id: string,
    userId: string,
    ctx: TraceContext
  ): Promise<Result<boolean, TranscriptionError>> {
    return withSpan('TranscriptionRepository.delete', async () => {
      const logger = getLogger().child({ transcriptionId: id, userId, requestId: ctx.requestId })

      try {
        const result = await this.db
          .delete(transcriptions)
          .where(and(
            eq(transcriptions.id, id),
            eq(transcriptions.userId, userId)
          ))
          .returning({ id: transcriptions.id })

        if (result.length === 0) {
          return err({
            kind: 'NotFound',
            message: 'Transcription not found',
            context: { id, userId },
          })
        }

        logger.debug('Transcription deleted')
        return ok(true)
      } catch (error) {
        logger.error({ error }, 'Failed to delete transcription')
        return err({
          kind: 'DatabaseError',
          message: 'Failed to delete transcription',
          context: { id, userId },
          cause: error,
        })
      }
    })
  }
}
