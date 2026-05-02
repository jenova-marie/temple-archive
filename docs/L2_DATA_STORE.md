# L2 Data Store (PostgreSQL)

The L2 tier provides durable, queryable storage for all conversation history, user profiles, and system configuration.

## The Problem

Conversations need to persist. When a user returns after days, weeks, or months, Siri should remember everything - every message, every insight, every milestone.

L1 (Redis) provides speed but not durability. Its 4-hour TTL means old conversations vanish. Its limited query capability can't answer questions like "find messages where the user mentioned their therapist" or "what crisis events happened last month?"

We need a store that's:
- **Permanent** - Data survives restarts, cache expiration, server failures
- **Queryable** - Complex filters, joins, full-text search
- **Consistent** - ACID guarantees for critical operations
- **Scalable** - Handles months/years of conversation history

## The Idea

Use PostgreSQL as the source of truth for all persistent data. Every message, every user profile, every system prompt lives in Postgres. L1 is just a cache on top.

PostgreSQL brings:
- ACID transactions for data integrity
- Rich query language (SQL) for complex lookups
- pgvector extension for semantic search
- Battle-tested reliability at any scale
- Drizzle ORM for type-safe queries

The architecture is simple:
1. L1 (Redis) handles hot reads (<10ms)
2. L2 (PostgreSQL) handles cold reads (10-50ms) and all writes
3. Writes go to L2 first, then optionally warm L1
4. L1 misses fall through to L2

## Why This Matters

L2 is the ground truth. If L1 disagrees, L2 wins. If we need to rebuild L1, we query L2. If we need to analyze patterns across months of conversations, we query L2.

PostgreSQL also enables features that a cache can't:
- Semantic search with pgvector embeddings
- User profile persistence across sessions
- System prompt versioning
- Crisis event audit logs
- Session summaries for context compaction

## Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL Schema                                    │
│                                                                             │
│   ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐         │
│   │   users     │────▶│  conversations   │────▶│   messages      │         │
│   │             │     │                  │     │                 │         │
│   │ id (PK)     │     │ id (PK)          │     │ id (PK)         │         │
│   │ email       │     │ userId (FK)      │     │ conversationId  │         │
│   │ displayName │     │ status           │     │ role            │         │
│   │ metadata    │     │ summary          │     │ content         │         │
│   └──────┬──────┘     │ metadata         │     │ embedding (1536)│         │
│          │            └────────┬─────────┘     │ metadata        │         │
│          │                     │               └─────────────────┘         │
│          ▼                     │                                           │
│   ┌─────────────┐              │         ┌─────────────────────┐           │
│   │userProfiles │              │         │ session_summaries   │           │
│   │             │              └────────▶│                     │           │
│   │ userId (PK) │                        │ id (PK)             │           │
│   │ recoveryPhase│                       │ conversationId (FK) │           │
│   │ recoveryDate │                       │ summary             │           │
│   │ triggers[]   │                       │ embedding (1536)    │           │
│   │ copingStrategies[]│                  │ keyTopics[]         │           │
│   │ preferences  │                       └─────────────────────┘           │
│   │ milestones[] │                                                         │
│   └─────────────┘                                                          │
│                                                                             │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │ crisis_events   │    │ system_prompts  │    │  memory_cache   │        │
│   │                 │    │                 │    │                 │        │
│   │ id (PK)         │    │ id (PK)         │    │ conversationId  │        │
│   │ userId          │    │ name            │    │ memories[]      │        │
│   │ conversationId  │    │ content         │    │ topicSummary    │        │
│   │ crisisLevel     │    │ variables       │    │ createdAt       │        │
│   │ patterns        │    │ active          │    │ updatedAt       │        │
│   │ actionTaken     │    │                 │    │                 │        │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Tables

### messages

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              messages                                       │
│                                                                            │
│  Column          │ Type           │ Notes                                  │
│  ────────────────┼────────────────┼──────────────────────────────────────  │
│  id              │ uuid (PK)      │ Message identifier                     │
│  conversationId  │ uuid (FK)      │ Parent conversation                    │
│  userId          │ text           │ Message author                         │
│  role            │ text           │ "user" | "assistant" | "system"        │
│  content         │ text           │ Message text                           │
│  embedding       │ vector(1536)   │ OpenAI embedding for semantic search   │
│  metadata        │ jsonb          │ tokens, model, latency, etc.           │
│  createdAt       │ timestamptz    │ Message timestamp                      │
│                                                                            │
│  Indexes:                                                                  │
│  • idx_messages_conversation (conversationId, createdAt)                  │
│  • idx_messages_user (userId, createdAt)                                  │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### conversations

```
┌────────────────────────────────────────────────────────────────────────────┐
│                            conversations                                    │
│                                                                            │
│  Column          │ Type           │ Notes                                  │
│  ────────────────┼────────────────┼──────────────────────────────────────  │
│  id              │ uuid (PK)      │ Conversation identifier                │
│  userId          │ text (FK)      │ Conversation owner                     │
│  status          │ text           │ "active" | "archived" | "ended"        │
│  summary         │ text           │ LLM-generated summary                  │
│  metadata        │ jsonb          │ Conversation metadata                  │
│  createdAt       │ timestamptz    │ Start time                             │
│  updatedAt       │ timestamptz    │ Last activity                          │
│                                                                            │
│  Indexes:                                                                  │
│  • idx_conversations_user_updated (userId, updatedAt)                     │
│  • idx_conversations_status (status)                                       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### user_profiles

```
┌────────────────────────────────────────────────────────────────────────────┐
│                            user_profiles                                    │
│                                                                            │
│  Column            │ Type           │ Notes                                │
│  ──────────────────┼────────────────┼────────────────────────────────────  │
│  userId            │ text (PK)      │ User identifier                      │
│  recoveryPhase     │ text           │ Current recovery phase               │
│  recoveryDate      │ date           │ Sobriety start date                  │
│  triggers          │ text[]         │ Known trigger patterns               │
│  copingStrategies  │ text[]         │ Effective coping methods             │
│  preferences       │ jsonb          │ Communication preferences            │
│  milestones        │ jsonb[]        │ Recovery milestones                  │
│  createdAt         │ timestamptz    │ Profile creation                     │
│  updatedAt         │ timestamptz    │ Last update                          │
│                                                                            │
│  Note: One profile per user (userId is PK, not FK)                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### session_summaries

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          session_summaries                                  │
│                                                                            │
│  Column              │ Type           │ Notes                              │
│  ────────────────────┼────────────────┼──────────────────────────────────  │
│  id                  │ uuid (PK)      │ Summary identifier                 │
│  conversationId      │ uuid (FK)      │ Parent conversation                │
│  summary             │ text           │ Compressed context                 │
│  summaryEmbedding    │ vector(1536)   │ For similarity search              │
│  keyTopics           │ text[]         │ Extracted topics                   │
│  entitiesMentioned   │ jsonb          │ Entities from L3                   │
│  timeWindowStart     │ timestamptz    │ Summary window start               │
│  timeWindowEnd       │ timestamptz    │ Summary window end                 │
│  createdAt           │ timestamptz    │ Summary creation time              │
│                                                                            │
│  Purpose: Context compaction for long conversations                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## pgvector Integration

PostgreSQL extended with pgvector for semantic search:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       pgvector Usage                                      │
│                                                                          │
│   Enabled via:                                                           │
│   CREATE EXTENSION IF NOT EXISTS vector;                                 │
│                                                                          │
│   Tables with embeddings:                                                │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │  Table              │ Column            │ Dimensions              │ │
│   │  ──────────────────────────────────────────────────────────────── │ │
│   │  messages           │ embedding         │ 1536 (OpenAI)           │ │
│   │  session_summaries  │ summaryEmbedding  │ 1536 (OpenAI)           │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│   Similarity Query:                                                      │
│   ┌───────────────────────────────────────────────────────────────────┐ │
│   │  SELECT content,                                                   │ │
│   │         1 - (embedding <=> $queryEmbedding) as similarity         │ │
│   │  FROM messages                                                     │ │
│   │  WHERE userId = $userId                                            │ │
│   │    AND createdAt > NOW() - INTERVAL '90 days'                     │ │
│   │  ORDER BY embedding <=> $queryEmbedding                           │ │
│   │  LIMIT 20;                                                         │ │
│   └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│   <=> operator: cosine distance (0 = identical, 2 = opposite)           │
│   Similarity = 1 - distance (1 = identical, -1 = opposite)              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Store Implementation

### PostgresSessionStore

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     PostgresSessionStore Methods                          │
│                                                                          │
│   Conversation History                                                   │
│   ──────────────────────────────────────────────────────────────────────  │
│   getConversationHistory(userId, conversationId, limit, ctx)             │
│     → Fetches messages in chronological order                            │
│                                                                          │
│   storeMessage(message, embedding?, ctx)                                 │
│     → Inserts message, upserts conversation, validates user              │
│     → Optional embedding stored for semantic search                      │
│                                                                          │
│   Semantic Search                                                        │
│   ──────────────────────────────────────────────────────────────────────  │
│   semanticSearch(queryEmbedding, userId, options, ctx)                   │
│     → pgvector cosine similarity search                                  │
│     → Time-bounded (default 90 days)                                     │
│     → Returns scored matches                                             │
│                                                                          │
│   User Profile                                                           │
│   ──────────────────────────────────────────────────────────────────────  │
│   getUserProfile(userId, ctx)                                            │
│     → Cache-through: checks Redis first, then Postgres                   │
│                                                                          │
│   updateUserProfile(userId, updates, ctx)                                │
│     → Upsert with selective field updates                                │
│     → Invalidates Redis cache                                            │
│                                                                          │
│   Deep Memory Support                                                    │
│   ──────────────────────────────────────────────────────────────────────  │
│   getMessagesAroundId(messageId, beforeCount, afterCount, ctx)           │
│     → Asymmetric window: default 5 before, 2.5 after                     │
│     → Used for sourceHistory context retrieval                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Query Patterns

### Conversation Retrieval

```sql
-- Get recent messages for a conversation
SELECT id, role, content, metadata, created_at
FROM messages
WHERE conversation_id = $1
ORDER BY created_at ASC
LIMIT $2;
```

### Semantic Search

```sql
-- Find semantically similar messages
SELECT
  id,
  content,
  1 - (embedding <=> $queryEmbedding) as similarity
FROM messages
WHERE user_id = $userId
  AND created_at > NOW() - INTERVAL '90 days'
  AND embedding IS NOT NULL
ORDER BY embedding <=> $queryEmbedding
LIMIT 20;
```

### User Profile with Cache

```typescript
// Cache-through pattern
async getUserProfile(userId: string): Promise<Result<UserProfile | null>> {
  // 1. Check Redis cache first
  const cached = await this.cache.getUserProfile(userId)
  if (cached) return ok(cached)

  // 2. Query PostgreSQL
  const profile = await db.select().from(userProfiles).where(eq(userId))

  // 3. Populate cache for next time
  if (profile) await this.cache.setUserProfile(userId, profile)

  return ok(profile)
}
```

## Migrations

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          Migration History                                  │
│                                                                            │
│  Migration                      │ Description                              │
│  ───────────────────────────────┼────────────────────────────────────────  │
│  0000_curious_quicksilver.sql   │ Initial schema: users, conversations,   │
│                                 │ messages, summaries, prompts, profiles   │
│                                 │ Creates pgvector extension               │
│                                                                            │
│  0001_thankful_vindicator.sql   │ Literature & literature_blocks tables   │
│                                                                            │
│  0002_solid_nocturne.sql        │ Adds fellowship column to literature    │
│                                                                            │
│  0003_siri_prompt.sql          │ Seeds initial system prompts            │
│                                                                            │
│  0004_smart_justice.sql         │ Adds transcriptions table               │
│                                                                            │
│  Commands:                                                                 │
│  • pnpm --filter @siri/db db:generate  → Generate from schema            │
│  • pnpm --filter @siri/db db:migrate:local → Apply migrations            │
│  • pnpm --filter @siri/db db:studio:local → Open Drizzle Studio          │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why PostgreSQL?

The classic question: Postgres vs. MySQL vs. NoSQL?

**PostgreSQL wins because:**
- **pgvector** - Native vector similarity search. No separate vector DB needed for basic semantic search.
- **JSONB** - Flexible schema for metadata without losing relational benefits.
- **Arrays** - Native array types for triggers[], copingStrategies[], etc.
- **Full-text search** - Built-in text search when vectors are overkill.
- **Reliability** - Decades of battle-testing at massive scale.

**Considered alternatives:**
- **MySQL** - No pgvector equivalent. Less flexible types.
- **MongoDB** - Would work, but we benefit from relational joins.
- **DynamoDB** - Query patterns too constrained for our access patterns.

### Why Drizzle ORM?

We use Drizzle for database access instead of raw SQL or other ORMs:

1. **Type safety** - Schema generates TypeScript types. `$inferSelect` and `$inferInsert`.
2. **Migration generation** - `drizzle-kit` auto-generates migrations from schema changes.
3. **Query builder** - SQL-like but type-safe. Falls back to raw SQL when needed.
4. **Lightweight** - No heavy abstractions. Close to SQL.

### Why Cache-Through for Profiles?

User profiles are read frequently but updated rarely. Cache-through pattern:
1. Check Redis cache on read
2. If miss, query Postgres, populate cache
3. On update, write to Postgres, invalidate cache

This keeps profile lookups at <10ms while maintaining Postgres as source of truth.

### Why pgvector Instead of Just Qdrant?

We have both pgvector (L2) and Qdrant (L4). Why?

- **pgvector (L2)** - Embeddings stored with messages. Simple similarity queries. No extra infrastructure.
- **Qdrant (L4)** - Dedicated vector DB. Hybrid search (BM25 + dense). Better for high-volume semantic search.

For many queries, pgvector suffices. L4 handles the heavy lifting when precision matters or volume is high.

## Trade-offs

### Latency vs. Durability

PostgreSQL is slower than Redis (10-50ms vs <10ms). We accept this because:
- L1 cache handles 90%+ of reads
- Durability matters more than speed for persistence
- Write latency is acceptable for async operations

### Schema vs. Flexibility

We use a relational schema with JSONB for flexibility. Trade-off:
- Relational columns: Fast queries, indexes, constraints
- JSONB: Flexible but harder to query/index

We put well-defined data in columns (role, content, timestamps) and variable data in JSONB (metadata, preferences).

### Embedding Storage

Storing 1536-dimension embeddings in every row uses significant space. Trade-off:
- **Pro**: Semantic search without external service
- **Con**: Storage costs, backup sizes

We accept this for the query capability. Old embeddings can be pruned if storage becomes an issue.

## Source Files

- [`packages/db/src/schema/`](../packages/db/src/schema/) - All table definitions
- [`packages/db/src/stores/PostgresSessionStore.ts`](../packages/db/src/stores/PostgresSessionStore.ts) - Main L2 store
- [`packages/db/src/stores/SystemPromptRepository.ts`](../packages/db/src/stores/SystemPromptRepository.ts) - Prompt management
- [`packages/db/src/stores/UserRepository.ts`](../packages/db/src/stores/UserRepository.ts) - User CRUD
- [`packages/db/src/client.ts`](../packages/db/src/client.ts) - Connection management
- [`packages/db/drizzle.config.local.ts`](../packages/db/drizzle.config.local.ts) - Migration config
