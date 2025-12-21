import { pgTable, uuid, text, real, varchar, timestamp } from 'drizzle-orm/pg-core';

export const transcriptions = pgTable('transcriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  duration: real('duration'),
  source: varchar('source', { length: 20 }).notNull().$type<'microphone' | 'file'>(),
  filename: varchar('filename', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
