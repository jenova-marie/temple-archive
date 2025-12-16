/**
 * System Prompts table schema
 *
 * Stores versioned system prompts with variable templating support.
 * Only one prompt per name can be active at a time (enforced by unique index).
 */

import { pgTable, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const systemPrompts = pgTable('system_prompts', {
  id: text('id').notNull().primaryKey(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  variables: jsonb('variables').notNull().default({}),
  active: boolean('active').notNull().default(false),
  created: timestamp('created', { withTimezone: true, mode: 'string' }).notNull(),
  updated: timestamp('updated', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  nameIdx: index('idx_system_prompts_name').on(table.name),
  activeUniqueIdx: uniqueIndex('idx_system_prompts_active_unique')
    .on(table.name)
    .where(sql`active = true`),
}))

export type SystemPrompt = typeof systemPrompts.$inferSelect
export type NewSystemPrompt = typeof systemPrompts.$inferInsert
