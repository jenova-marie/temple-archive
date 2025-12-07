/**
 * Memory Cache table schema
 *
 * Persists L1 conversation memory cache entries to L2 (PostgreSQL).
 * Enables loading memories from past conversations during bootstrap.
 */

import { pgTable, text, timestamp, jsonb, index, uuid } from 'drizzle-orm/pg-core'

export const memoryCache = pgTable(
  'memory_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: text('conversation_id').notNull().unique(),
    userId: text('user_id').notNull(),
    /** Array of pre-formatted memory strings */
    memories: jsonb('memories').notNull().$type<string[]>(),
    /** Topic summary for L4 search */
    topicSummary: text('topic_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_cache_user').on(table.userId),
    index('idx_memory_cache_updated').on(table.updatedAt),
  ]
)

export type DbMemoryCache = typeof memoryCache.$inferSelect
export type NewDbMemoryCache = typeof memoryCache.$inferInsert
