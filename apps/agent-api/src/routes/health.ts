/**
 * Health Check Routes
 */

import { Router, type Request, type Response } from 'express'

export function createHealthRouter(): Router {
  const router = Router()

  /**
   * GET /health
   *
   * Basic health check
   */
  router.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  })

  /**
   * GET /health/ready
   *
   * Readiness check (for Kubernetes)
   */
  router.get('/ready', (_req: Request, res: Response) => {
    // In production, this would check:
    // - Database connections
    // - Redis connection
    // - External service availability

    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    })
  })

  /**
   * GET /health/live
   *
   * Liveness check (for Kubernetes)
   */
  router.get('/live', (_req: Request, res: Response) => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    })
  })

  /**
   * GET /health/metrics
   *
   * Prometheus metrics endpoint
   */
  router.get('/metrics', (_req: Request, res: Response) => {
    // In production, this would expose Prometheus metrics
    // For now, return basic stats

    res.set('Content-Type', 'text/plain')
    res.send(`
# HELP recoverysky_uptime_seconds Server uptime in seconds
# TYPE recoverysky_uptime_seconds gauge
recoverysky_uptime_seconds ${process.uptime()}

# HELP recoverysky_memory_heap_bytes Heap memory usage in bytes
# TYPE recoverysky_memory_heap_bytes gauge
recoverysky_memory_heap_bytes ${process.memoryUsage().heapUsed}

# HELP recoverysky_info Server information
# TYPE recoverysky_info gauge
recoverysky_info{version="0.1.0",node_version="${process.version}"} 1
    `.trim())
  })

  return router
}
