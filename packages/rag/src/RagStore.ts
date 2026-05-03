/**
 * RagStore — read-only client over ninshubur's Qdrant + Postgres.
 *
 * Wraps `queryRag` core with:
 *   - Result<T, RagError> error handling
 *   - withSpan tracing
 *   - Pino structured logging
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import { getLogger, withSpan } from '@siri/observability'
import { ok, err, type Result, type TraceContext } from '@siri/types'

import { queryRag, type QueryRagDeps } from './core.js'
import type { NinshuburDb } from './ninshuburDb.js'
import { withQdrantRetry } from './qdrant/retry.js'
import type {
  IRagStore,
  RagError,
  RagQueryOptions,
  RagResult,
  RagStats,
} from './types.js'
import type { VoyageClient } from './voyage.js'

export interface RagStoreConfig {
  db: NinshuburDb
  qdrant: QdrantClient
  voyage: VoyageClient
  collectionMessages: string
  collectionGroups: string
  /** Default scope for queries that don't specify one. */
  defaultScope?: 'messages' | 'groups'
  /** Default limit for queries that don't specify one. */
  defaultLimit?: number
}

function toRagError(
  kind: RagError['kind'],
  cause: unknown,
  context: Record<string, unknown> = {},
): RagError {
  return {
    kind,
    message: cause instanceof Error ? cause.message : String(cause),
    context,
    cause,
  }
}

export class RagStore implements IRagStore {
  private readonly deps: QueryRagDeps
  private readonly defaultScope: 'messages' | 'groups'
  private readonly defaultLimit: number

  constructor(config: RagStoreConfig) {
    this.deps = {
      db: config.db,
      qdrant: config.qdrant,
      voyage: config.voyage,
      collectionMessages: config.collectionMessages,
      collectionGroups: config.collectionGroups,
    }
    this.defaultScope = config.defaultScope ?? 'groups'
    this.defaultLimit = config.defaultLimit ?? 10
  }

  async query(
    opts: RagQueryOptions,
    ctx: TraceContext,
  ): Promise<Result<RagResult[], RagError>> {
    return withSpan('RagStore.query', async () => {
      const logger = getLogger().child({
        component: 'rag-store',
        requestId: ctx.requestId,
        scope: opts.scope ?? this.defaultScope,
      })

      if (!opts.query || opts.query.trim().length === 0) {
        return err(toRagError('ValidationError', new Error('query is required'), {}))
      }

      try {
        const results = await queryRag(this.deps, {
          ...opts,
          scope: opts.scope ?? this.defaultScope,
          limit: opts.limit ?? this.defaultLimit,
        })
        logger.debug({ hits: results.length }, 'rag query complete')
        return ok(results)
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message.toLowerCase() : ''
        const kind: RagError['kind'] = msg.includes('voyage')
          ? 'EmbeddingError'
          : msg.includes('qdrant') || msg.includes('collection')
            ? 'QdrantError'
            : 'UnexpectedError'
        logger.error({ error: cause, kind }, 'rag query failed')
        return err(toRagError(kind, cause, { query: opts.query }))
      }
    })
  }

  async getStats(ctx: TraceContext): Promise<Result<RagStats, RagError>> {
    return withSpan('RagStore.getStats', async () => {
      const logger = getLogger().child({
        component: 'rag-store',
        requestId: ctx.requestId,
      })

      try {
        const messagesCollectionCount = await this.qdrantPointCount(this.deps.collectionMessages)
        const groupsCollectionCount = await this.qdrantPointCount(this.deps.collectionGroups)

        const stats: RagStats = {
          qdrant: {
            messagesCollection: messagesCollectionCount,
            groupsCollection: groupsCollectionCount,
          },
        }
        logger.debug({ stats }, 'rag stats')
        return ok(stats)
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message.toLowerCase() : ''
        const kind: RagError['kind'] = msg.includes('qdrant')
          ? 'QdrantError'
          : 'UnexpectedError'
        logger.error({ error: cause, kind }, 'rag stats failed')
        return err(toRagError(kind, cause))
      }
    })
  }

  private async qdrantPointCount(collection: string): Promise<number> {
    try {
      const exists = await withQdrantRetry(`collectionExists(${collection})`, () =>
        this.deps.qdrant.collectionExists(collection),
      )
      if (!exists.exists) return 0
      const info = await withQdrantRetry(`getCollection(${collection})`, () =>
        this.deps.qdrant.getCollection(collection),
      )
      return Number(info.points_count ?? 0)
    } catch {
      return 0
    }
  }
}
