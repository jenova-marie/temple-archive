/**
 * Message turns table schema
 *
 * Links user/assistant message pairs with sequential ordering
 * for easy traversal of conversation history.
 */

import { pgTable, text, timestamp, integer, index, foreignKey } from 'drizzle-orm/pg-core'
import { conversations } from './conversations.js'
import { messages } from './messages.js'

export const messageTurns = pgTable(
  'message_turns',
  {
    turnId: text('turn_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    userMessageId: text('user_message_id').notNull(),
    assistantMessageId: text('assistant_message_id').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'turns_conversation_id_fk',
      columns: [table.conversationId],
      foreignColumns: [conversations.conversationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'turns_user_message_id_fk',
      columns: [table.userMessageId],
      foreignColumns: [messages.messageId],
    }),
    foreignKey({
      name: 'turns_assistant_message_id_fk',
      columns: [table.assistantMessageId],
      foreignColumns: [messages.messageId],
    }),
    index('idx_turns_conversation').on(table.conversationId, table.sequenceNumber),
    index('idx_turns_user_msg').on(table.userMessageId),
    index('idx_turns_assistant_msg').on(table.assistantMessageId),
  ]
)

export type DbMessageTurn = typeof messageTurns.$inferSelect
export type NewDbMessageTurn = typeof messageTurns.$inferInsert
