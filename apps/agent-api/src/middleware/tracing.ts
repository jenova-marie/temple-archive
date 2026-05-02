/**
 * Tracing Middleware
 *
 * Injects trace context into requests
 */

import type { Request, Response, NextFunction } from 'express'
import { getLogger } from '@siri/observability'

export interface TracingContext {
  traceId: string
  spanId: string
  requestId: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tracing?: TracingContext
    }
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

/**
 * Tracing middleware - adds trace context to requests
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers['x-trace-id'] as string) || generateId()
  const spanId = generateId()
  const requestId = (req.headers['x-request-id'] as string) || generateId()

  // Attach to request
  req.tracing = {
    traceId,
    spanId,
    requestId,
  }

  // Add to response headers
  res.setHeader('X-Trace-Id', traceId)
  res.setHeader('X-Request-Id', requestId)

  // Log request
  const logger = getLogger().child({
    traceId,
    requestId,
    method: req.method,
    path: req.path,
  })

  const startTime = Date.now()

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime

    logger.info(
      {
        statusCode: res.statusCode,
        duration,
      },
      'Request completed'
    )
  })

  next()
}
