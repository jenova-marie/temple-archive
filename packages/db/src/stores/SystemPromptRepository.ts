/**
 * SystemPromptRepository - Data access layer for system_prompts table
 *
 * Provides operations for versioned system prompts with variable templating.
 * Only one prompt per name can be active at a time (enforced by unique index).
 */

import { eq, and } from 'drizzle-orm'
import { ok, err, type Result, type DomainError } from '@pippa/types'
import { systemPrompts, type SystemPrompt } from '../schema/systemPrompts.js'
import type { DatabaseClient } from '../client.js'

/**
 * Error type for SystemPromptRepository operations
 */
export interface SystemPromptError extends DomainError {
  kind: 'DatabaseError' | 'NotFound'
}

function createError(kind: SystemPromptError['kind'], message: string, cause?: unknown): SystemPromptError {
  return {
    kind,
    message,
    context: { cause: cause instanceof Error ? cause.message : String(cause) },
    cause,
    timestamp: Date.now(),
  }
}

export class SystemPromptRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Find the active prompt for a given name
   *
   * Only one prompt per name can be active at a time.
   *
   * @example
   * const result = await repo.findActive('base-identity');
   * if (result.ok && result.value) {
   *   const content = result.value.content;
   * }
   */
  async findActive(name: string): Promise<Result<SystemPrompt | null, SystemPromptError>> {
    try {
      const rows = await this.db
        .select()
        .from(systemPrompts)
        .where(and(eq(systemPrompts.name, name), eq(systemPrompts.active, true)))
        .limit(1)

      return ok(rows[0] ?? null)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to find active prompt: ${name}`, error))
    }
  }

  /**
   * Find system prompt by ID
   */
  async findById(id: string): Promise<Result<SystemPrompt | null, SystemPromptError>> {
    try {
      const rows = await this.db
        .select()
        .from(systemPrompts)
        .where(eq(systemPrompts.id, id))
        .limit(1)

      return ok(rows[0] ?? null)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to find prompt by id: ${id}`, error))
    }
  }

  /**
   * Find all prompts with a given name (all versions)
   */
  async findByName(name: string): Promise<Result<SystemPrompt[], SystemPromptError>> {
    try {
      const rows = await this.db
        .select()
        .from(systemPrompts)
        .where(eq(systemPrompts.name, name))

      return ok(rows)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to find prompts by name: ${name}`, error))
    }
  }

  /**
   * Find all active prompts (one per name)
   */
  async findAllActive(): Promise<Result<SystemPrompt[], SystemPromptError>> {
    try {
      const rows = await this.db
        .select()
        .from(systemPrompts)
        .where(eq(systemPrompts.active, true))

      return ok(rows)
    } catch (error) {
      return err(createError('DatabaseError', 'Failed to find all active prompts', error))
    }
  }

  /**
   * Insert a new system prompt
   */
  async insert(data: Omit<SystemPrompt, 'created' | 'updated'> & { created?: string; updated?: string }): Promise<Result<SystemPrompt, SystemPromptError>> {
    try {
      const now = new Date().toISOString()
      const [row] = await this.db
        .insert(systemPrompts)
        .values({
          ...data,
          created: data.created ?? now,
          updated: data.updated ?? now,
        })
        .returning()

      return ok(row)
    } catch (error) {
      return err(createError('DatabaseError', 'Failed to insert prompt', error))
    }
  }

  /**
   * Update a system prompt by ID
   */
  async update(id: string, changes: Partial<Omit<SystemPrompt, 'id' | 'created'>>): Promise<Result<SystemPrompt | null, SystemPromptError>> {
    try {
      const [row] = await this.db
        .update(systemPrompts)
        .set({
          ...changes,
          updated: new Date().toISOString(),
        })
        .where(eq(systemPrompts.id, id))
        .returning()

      return ok(row ?? null)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to update prompt: ${id}`, error))
    }
  }

  /**
   * Set a prompt as active (deactivates other prompts with same name)
   */
  async setActive(id: string): Promise<Result<SystemPrompt, SystemPromptError>> {
    try {
      // First get the prompt to find its name
      const promptResult = await this.findById(id)
      if (!promptResult.ok) {
        return promptResult
      }
      if (!promptResult.value) {
        return err(createError('NotFound', `Prompt not found: ${id}`))
      }

      const { name } = promptResult.value
      const now = new Date().toISOString()

      // Transaction: deactivate all with same name, then activate this one
      const result = await this.db.transaction(async (tx) => {
        // Deactivate all prompts with this name
        await tx
          .update(systemPrompts)
          .set({ active: false, updated: now })
          .where(eq(systemPrompts.name, name))

        // Activate the specified prompt
        const [activated] = await tx
          .update(systemPrompts)
          .set({ active: true, updated: now })
          .where(eq(systemPrompts.id, id))
          .returning()

        return activated
      })

      return ok(result)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to set active prompt: ${id}`, error))
    }
  }

  /**
   * Delete a system prompt by ID
   */
  async delete(id: string): Promise<Result<SystemPrompt | null, SystemPromptError>> {
    try {
      const [row] = await this.db
        .delete(systemPrompts)
        .where(eq(systemPrompts.id, id))
        .returning()

      return ok(row ?? null)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to delete prompt: ${id}`, error))
    }
  }
}
