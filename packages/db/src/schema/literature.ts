/**
 * Literature table schema
 *
 * Stores recovery literature and associated text blocks
 * for reference and semantic search.
 */

import { pgTable, text, timestamp, date, integer, uuid, index, foreignKey } from 'drizzle-orm/pg-core'

// ============================================================================
// Literature
// ============================================================================

export const literature = pgTable('literature', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  fellowship: text('fellowship'),
  isbn: text('isbn'),
  datePublished: date('date_published'),
  edition: text('edition'),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Literature = typeof literature.$inferSelect
export type NewLiterature = typeof literature.$inferInsert

// ============================================================================
// Literature Blocks
// ============================================================================

export const literatureBlocks = pgTable(
  'literature_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    literatureId: uuid('literature_id').notNull(),
    page: integer('page'),
    lineStart: integer('line_start'),
    lineEnd: integer('line_end'),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'literature_blocks_literature_id_fk',
      columns: [table.literatureId],
      foreignColumns: [literature.id],
    }).onDelete('cascade'),
    index('idx_literature_blocks_literature_id').on(table.literatureId),
  ]
)

export type LiteratureBlock = typeof literatureBlocks.$inferSelect
export type NewLiteratureBlock = typeof literatureBlocks.$inferInsert
