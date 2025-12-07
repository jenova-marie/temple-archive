/**
 * Conversations table schema
 *
 * Tracks conversation sessions between users and the agent.
 * Messages belong to conversations.
 */

import { pgTable, text, timestamp, jsonb, index, foreignKey } from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const conversations = pgTable(
  'conversations',
  {
    conversationId: text('conversation_id').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').default('active'),
    summary: text('summary'),
    metadata: jsonb('metadata').default({}),
  },
  (table) => [
    foreignKey({
      name: 'conversations_user_id_fk',
      columns: [table.userId],
      foreignColumns: [users.userId],
    }),
    index('idx_conversations_user_updated').on(table.userId, table.updatedAt),
    index('idx_conversations_status').on(table.status),
  ]
)

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
