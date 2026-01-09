/**
 * Consolidated Schema for Drizzle Kit
 *
 * This file contains all table definitions in a single file
 * to work with drizzle-kit's module resolution.
 *
 * For runtime code, use the individual schema files in ./schema/
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  date,
  foreignKey,
  boolean,
  uniqueIndex,
  uuid,
  real,
  varchar,
  vector,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ============================================================================
// Users
// ============================================================================

export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').default({}),
})

// ============================================================================
// Conversations
// ============================================================================

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

// ============================================================================
// Messages
// ============================================================================

export const messages = pgTable(
  'messages',
  {
    messageId: text('message_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
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

// ============================================================================
// Message Turns
// ============================================================================

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

// ============================================================================
// Session Summaries
// ============================================================================

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

// ============================================================================
// User Profiles
// ============================================================================

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

// ============================================================================
// Crisis Events
// ============================================================================

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

// ============================================================================
// System Prompts
// ============================================================================

export const systemPrompts = pgTable(
  'system_prompts',
  {
    id: text('id').notNull().primaryKey(),
    name: text('name').notNull(),
    content: text('content').notNull(),
    variables: jsonb('variables').notNull().default({}),
    active: boolean('active').notNull().default(false),
    created: timestamp('created', { withTimezone: true, mode: 'string' }).notNull(),
    updated: timestamp('updated', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_system_prompts_name').on(table.name),
    uniqueIndex('idx_system_prompts_active_unique')
      .on(table.name)
      .where(sql`active = true`),
  ]
)

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

// ============================================================================
// Transcriptions
// ============================================================================

export const transcriptions = pgTable(
  'transcriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    text: text('text').notNull(),
    duration: real('duration'),
    source: varchar('source', { length: 20 }).notNull().$type<'microphone' | 'file'>(),
    filename: varchar('filename', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'transcriptions_user_id_fk',
      columns: [table.userId],
      foreignColumns: [users.userId],
    }).onDelete('cascade'),
    index('transcriptions_user_id_idx').on(table.userId),
    index('transcriptions_created_at_idx').on(table.createdAt),
  ]
)
