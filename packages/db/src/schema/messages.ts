/**
 * Messages table schema
 *
 * Stores all messages in conversations with optional embeddings
 * for semantic search via pgvector.
 */

import { pgTable, text, timestamp, jsonb, index, foreignKey } from 'drizzle-orm/pg-core'
import { vector } from 'drizzle-orm/pg-core'
import { conversations } from './conversations.js'
import { users } from './users.js'

export const messages = pgTable(
  'messages',
  {
    messageId: text('message_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').default({}),
  },
  (table) => [
    foreignKey({
      name: 'messages_conversation_id_fk',
      columns: [table.conversationId],
      foreignColumns: [conversations.conversationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'messages_user_id_fk',
      columns: [table.userId],
      foreignColumns: [users.userId],
    }),
    index('idx_messages_conversation').on(table.conversationId, table.createdAt),
    index('idx_messages_user').on(table.userId, table.createdAt),
  ]
)

export type DbMessage = typeof messages.$inferSelect
export type NewDbMessage = typeof messages.$inferInsert
