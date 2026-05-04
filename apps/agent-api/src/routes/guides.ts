/**
 * Guides route — exposes the active system prompts as guide options
 * for the web-app dropdown.
 *
 * Auth-required. Returns `[{ id, name, description }]` derived from
 * `system_prompts` rows where `active = true`. The `id` is the row's
 * `name` column (which is what gets sent back as the `guide`
 * parameter on chat requests).
 */

import { Router, type Request, type Response } from 'express'
import { getLogger } from '@siri/observability'
import type { SystemPromptRepository } from '@siri/db'
import type { Guide } from '@siri/shared'

export interface GuidesRouterDeps {
  systemPromptRepo: SystemPromptRepository
}

interface PromptVariables {
  displayName?: unknown
  description?: unknown
}

function titleCase(name: string): string {
  if (!name) return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function toGuide(row: {
  name: string
  variables: unknown
}): Guide {
  const vars = (row.variables ?? {}) as PromptVariables
  const displayName =
    typeof vars.displayName === 'string' && vars.displayName.trim().length > 0
      ? vars.displayName
      : titleCase(row.name)
  const description =
    typeof vars.description === 'string' ? vars.description : ''
  return {
    id: row.name,
    name: displayName,
    description,
  }
}

export function createGuidesRouter(deps: GuidesRouterDeps): Router {
  const router = Router()
  const logger = getLogger().child({ route: 'guides' })

  router.get('/', async (_req: Request, res: Response) => {
    const result = await deps.systemPromptRepo.findAllActive()

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to load guides')
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to load guides',
      })
      return
    }

    const guides = result.value
      .map(toGuide)
      // Stable, alphabetical-by-id ordering so the dropdown order is deterministic.
      .sort((a, b) => a.id.localeCompare(b.id))

    res.json({ guides })
  })

  return router
}
