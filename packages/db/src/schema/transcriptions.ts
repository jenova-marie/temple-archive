/**
 * Transcriptions table schema
 *
 * Audio transcription records from web-api service.
 * Each transcription belongs to a user.
 */

import { pgTable, uuid, text, real, varchar, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const transcriptions = pgTable('transcriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.userId, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  duration: real('duration'),
  source: varchar('source', { length: 20 }).notNull().$type<'microphone' | 'file'>(),
  filename: varchar('filename', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('transcriptions_user_id_idx').on(table.userId),
  index('transcriptions_created_at_idx').on(table.createdAt),
])

export type Transcription = typeof transcriptions.$inferSelect
export type NewTranscription = typeof transcriptions.$inferInsert
