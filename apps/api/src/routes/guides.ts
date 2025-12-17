/**
 * Guides API Routes
 *
 * Provides endpoints for listing available system prompts (guides)
 * that can be used in chat sessions.
 */

import { Router, type Request, type Response } from 'express'
import { getLogger } from '@recoverysky/observability'
import type { Container } from '../container.js'

export function createGuidesRouter(container: Container): Router {
  const router = Router()
  const logger = getLogger().child({ route: 'guides' })

  /**
   * GET /api/v1/guides
   *
   * List all available system prompts (guides) for chat sessions.
   * Returns active prompts that can be selected via the system_prompt parameter.
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const guides = await container.listSystemPrompts()

      logger.debug({ count: guides.length }, 'Listed system prompts')

      res.json({
        guides,
      })
    } catch (error) {
      logger.error({ error }, 'Failed to list guides')
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list guides',
      })
    }
  })

  return router
}
