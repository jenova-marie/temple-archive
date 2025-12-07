/**
 * Session summaries table schema
 *
 * Stores compressed summaries of conversation sessions
 * for efficient long-term context retrieval.
 */

import { pgTable, text, timestamp, jsonb, index, foreignKey } from 'drizzle-orm/pg-core'
import { vector } from 'drizzle-orm/pg-core'
import { conversations } from './conversations.js'

export const sessionSummaries = pgTable(
  'session_summaries',
  {
    summaryId: text('summary_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    timeWindowStart: timestamp('time_window_start', { withTimezone: true }).notNull(),
    timeWindowEnd: timestamp('time_window_end', { withTimezone: true }).notNull(),
    summaryText: text('summary_text').notNull(),
    summaryEmbedding: vector('summary_embedding', { dimensions: 1536 }),
    keyTopics: text('key_topics').array().default([]),
    entitiesMentioned: jsonb('entities_mentioned').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'summaries_conversation_id_fk',
      columns: [table.conversationId],
      foreignColumns: [conversations.conversationId],
    }).onDelete('cascade'),
    index('idx_summaries_conversation').on(table.conversationId, table.createdAt),
  ]
)

export type DbSessionSummary = typeof sessionSummaries.$inferSelect
export type NewDbSessionSummary = typeof sessionSummaries.$inferInsert
