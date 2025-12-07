/**
 * User profiles table schema
 *
 * Stores long-term user profile information including
 * recovery phase, triggers, coping strategies, and milestones.
 */

import { pgTable, text, date, timestamp, jsonb, foreignKey } from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: text('user_id').primaryKey(),
    recoveryPhase: text('recovery_phase'),
    sobrietyDate: date('sobriety_date'),
    triggers: text('triggers').array().default([]),
    copingStrategies: text('coping_strategies').array().default([]),
    preferences: jsonb('preferences').default({}),
    milestones: jsonb('milestones').default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'user_profiles_user_id_fk',
      columns: [table.userId],
      foreignColumns: [users.userId],
    }),
  ]
)

export type DbUserProfile = typeof userProfiles.$inferSelect
export type NewDbUserProfile = typeof userProfiles.$inferInsert
