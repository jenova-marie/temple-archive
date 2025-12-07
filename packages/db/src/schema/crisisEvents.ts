/**
 * Crisis events table schema
 *
 * Logs crisis detection events for monitoring, review,
 * and safety auditing purposes.
 */

import { pgTable, text, integer, timestamp, jsonb, index, foreignKey } from 'drizzle-orm/pg-core'
import { conversations } from './conversations.js'
import { users } from './users.js'

export const crisisEvents = pgTable(
  'crisis_events',
  {
    eventId: text('event_id').primaryKey(),
    conversationId: text('conversation_id'),
    userId: text('user_id').notNull(),
    crisisLevel: integer('crisis_level').notNull(),
    patterns: jsonb('patterns').notNull(),
    actionTaken: text('action_taken').notNull(),
    handledAt: timestamp('handled_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (table) => [
    foreignKey({
      name: 'crisis_conversation_id_fk',
      columns: [table.conversationId],
      foreignColumns: [conversations.conversationId],
    }).onDelete('set null'),
    foreignKey({
      name: 'crisis_user_id_fk',
      columns: [table.userId],
      foreignColumns: [users.userId],
    }),
    index('idx_crisis_events_user').on(table.userId, table.handledAt),
    index('idx_crisis_events_level').on(table.crisisLevel),
  ]
)

export type DbCrisisEvent = typeof crisisEvents.$inferSelect
export type NewDbCrisisEvent = typeof crisisEvents.$inferInsert
