/**
 * Users table schema
 *
 * Core identity table for all users in the system.
 * Other tables reference this via foreign keys.
 */

import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').default({}),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
