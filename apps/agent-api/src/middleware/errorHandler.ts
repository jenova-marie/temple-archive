/**
 * Error Handler Middleware
 */

import type { Request, Response, NextFunction } from 'express'
import { getLogger, pipelineMetrics } from '@pippa/observability'

/**
 * Custom error class with status code
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * Error handler middleware
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const logger = getLogger().child({
    requestId: req.tracing?.requestId,
    traceId: req.tracing?.traceId,
    path: req.path,
  })

  // Record error metric
  pipelineMetrics.errors.add(1, {
    error_kind: err.name,
  })

  if (err instanceof HttpError) {
    logger.warn(
      {
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
      },
      'HTTP error'
    )

    res.status(err.statusCode).json({
      error: err.code || 'Error',
      message: err.message,
    })
    return
  }

  // Log unexpected errors with full context
  logger.error(
    {
      message: err.message,
      stack: err.stack,
      name: err.name,
      cause: (err as any).cause,
    },
    'Unexpected error'
  )

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred'
    : err.message

  res.status(500).json({
    error: 'Internal Server Error',
    message,
  })
}

/**
 * Not found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  })
}
