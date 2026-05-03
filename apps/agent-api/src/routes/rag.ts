/**
 * RAG (Retrieval-Augmented Generation) routes.
 *
 * Read-only client over ninshubur's wisdom archive (Qdrant + Postgres).
 * Auth-required — wraps the same `IRagStore` instance the agent tool
 * uses so HTTP and tool-call results are identical.
 */

import { Router, type Request, type Response } from 'express'
import { getLogger } from '@siri/observability'
import type { IRagStore, RagQueryOptions } from '@siri/rag'

export interface RagRouterDeps {
  ragStore: IRagStore
}

interface RawRagQueryBody {
  query?: unknown
  scope?: unknown
  limit?: unknown
  category?: unknown
  channelId?: unknown
}

function parseBody(body: RawRagQueryBody): { ok: true; opts: RagQueryOptions } | { ok: false; error: string } {
  if (typeof body.query !== 'string' || body.query.trim().length === 0) {
    return { ok: false, error: 'query (string) is required' }
  }
  const opts: RagQueryOptions = { query: body.query }

  if (body.scope !== undefined) {
    if (body.scope !== 'messages' && body.scope !== 'groups') {
      return { ok: false, error: "scope must be 'messages' or 'groups'" }
    }
    opts.scope = body.scope
  }

  if (body.limit !== undefined) {
    const n = Number(body.limit)
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      return { ok: false, error: 'limit must be a number between 1 and 100' }
    }
    opts.limit = Math.floor(n)
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string') {
      return { ok: false, error: 'category must be a string' }
    }
    opts.category = body.category
  }

  if (body.channelId !== undefined) {
    if (typeof body.channelId !== 'string') {
      return { ok: false, error: 'channelId must be a string' }
    }
    opts.channelId = body.channelId
  }

  return { ok: true, opts }
}

export function createRagRouter(deps: RagRouterDeps): Router {
  const router = Router()

  /**
   * POST /api/v1/rag/query
   *
   * Body: { query, scope?, limit?, category?, channelId? }
   * Returns: { results: RagResult[] }
   */
  router.post('/query', async (req: Request, res: Response) => {
    const tracing = req.tracing
    const logger = getLogger().child({
      route: 'rag.query',
      requestId: tracing?.requestId,
    })

    const parsed = parseBody(req.body as RawRagQueryBody)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }

    const ctx = {
      traceId: tracing?.traceId ?? '',
      spanId: tracing?.spanId ?? '',
      requestId: tracing?.requestId ?? '',
      userId: req.user?.id,
      startTime: Date.now(),
    }

    const result = await deps.ragStore.query(parsed.opts, ctx)
    if (!result.ok) {
      logger.warn({ error: result.error }, 'rag query failed')
      const status = result.error.kind === 'ValidationError' ? 400 : 500
      res.status(status).json({
        error: result.error.message,
        kind: result.error.kind,
      })
      return
    }

    res.json({ results: result.value })
  })

  /**
   * GET /api/v1/rag/stats
   *
   * Returns Qdrant point counts for both collections.
   */
  router.get('/stats', async (req: Request, res: Response) => {
    const tracing = req.tracing
    const logger = getLogger().child({
      route: 'rag.stats',
      requestId: tracing?.requestId,
    })

    const ctx = {
      traceId: tracing?.traceId ?? '',
      spanId: tracing?.spanId ?? '',
      requestId: tracing?.requestId ?? '',
      userId: req.user?.id,
      startTime: Date.now(),
    }

    const result = await deps.ragStore.getStats(ctx)
    if (!result.ok) {
      logger.warn({ error: result.error }, 'rag stats failed')
      res.status(500).json({
        error: result.error.message,
        kind: result.error.kind,
      })
      return
    }

    res.json(result.value)
  })

  return router
}
