# Deep Memory: Conversation-Anchored Entity Context

**Status:** Design
**Created:** 2025-12-20

## Overview

When Pippa retrieves memories from Neo4j, she currently gets compressed entity data: "Alex works at Google", "Jenova likes coffee". But the original conversation that created or updated these memories contains valuable context—tone, qualifiers, surrounding topics—that gets lost in compression.

Deep Memory anchors every entity extraction event to its source conversation, enabling retrieval of the original message context alongside the entity data.

## Core Concept

Every entity in Neo4j tracks a `sourceHistory` array—a chronological log of every extraction event with references back to L2 conversations:

```typescript
properties: {
  userId: "jenova",
  importance: 0.8,
  context: "Works at Google on AI projects",
  sourceHistory: [
    { messageId: "msg_001", conversationId: "conv_abc", timestamp: 1734567890, action: "created" },
    { messageId: "msg_045", conversationId: "conv_abc", timestamp: 1734567999, action: "updated" },
    { messageId: "msg_102", conversationId: "conv_def", timestamp: 1734568100, action: "extracted" }
  ]
}
```

At retrieval time, these references allow fetching ±N messages around each source, giving the agent the full conversational context that shaped the memory.

## Action Types

| Action | Trigger | Meaning |
|--------|---------|---------|
| `created` | Entity doesn't exist | First extraction of this entity |
| `updated` | Entity exists, properties changed | Importance, context, or relationships modified |
| `extracted` | Entity exists, no changes | Entity mentioned but nothing new learned |

All three are valuable:
- `created` shows origin story
- `updated` shows evolution over time
- `extracted` shows frequency/recency of mentions

## Data Flow

### Write Path (Entity Extraction)

```
Pipeline Stage 6 (Persist)
    │
    ▼
EntityExtractor.extract(userMessage, assistantMessage, ctx)
    │
    ├── LLM extracts entities from conversation
    │
    ├── For each entity:
    │   ├── Fetch existing entity from Neo4j (if any)
    │   ├── Determine action: created | updated | extracted
    │   ├── Append to sourceHistory array
    │   └── Upsert entity with updated properties
    │
    └── Store relationships with source references
```

**Available context during extraction:**
- `userMessage.id` - Source message ID
- `userMessage.conversationId` - Conversation ID
- `userMessage.timestamp` - Message timestamp
- `assistantMessage.id` - Response message ID

### Read Path (Memory Retrieval)

```
Memory Context Builder
    │
    ▼
Retrieve entities from Neo4j (L3)
    │
    ├── For each entity with sourceHistory:
    │   ├── Get sourceHistory entries
    │   ├── For relevant entries (most recent? all?):
    │   │   ├── Look up message timestamp in L2
    │   │   └── Query ±N messages around that timestamp
    │   └── Attach conversation context to entity
    │
    └── Return enriched entities to agent
```

## Retrieval Configuration

```typescript
interface DeepMemoryConfig {
  // Message window (not time-based)
  messageWindow: number  // Default: 5 (±5 messages = up to 11 total)

  // Which sourceHistory entries to fetch context for
  contextStrategy: 'latest' | 'all' | 'created_and_latest'

  // Maximum entries to process (performance guard)
  maxSourceEntries: number  // Default: 3
}
```

### L2 Query Strategy

PostgreSQL has composite index `(conversation_id, created_at)` making this efficient:

```typescript
async getMessagesAroundMessageId(
  conversationId: string,
  messageId: string,
  window: number = 5
): Promise<Message[]> {
  // 1. Get target message timestamp
  const target = await db.select().from(messages)
    .where(eq(messages.messageId, messageId)).limit(1)

  // 2. Get N messages before
  const before = await db.select().from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      lte(messages.createdAt, target.createdAt)
    ))
    .orderBy(desc(messages.createdAt))
    .limit(window)

  // 3. Get N messages after
  const after = await db.select().from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      gt(messages.createdAt, target.createdAt)
    ))
    .orderBy(asc(messages.createdAt))
    .limit(window)

  return [...before.reverse(), ...after]
}
```

## Implementation Phases

### Phase 1: Source Tracking (L3)

Modify `EntityExtractor.ts` to track sourceHistory:

1. Read existing entity properties before upsert
2. Determine action type (created/updated/extracted)
3. Append source entry to history array
4. Write updated properties

**Files:**
- `packages/memory/src/extraction/EntityExtractor.ts`

### Phase 2: Context Retrieval

Add method to fetch conversation context around source messages:

1. New method in `PostgresSessionStore` for ±N message queries
2. Integration in memory context builder
3. Configuration for window size and strategy

**Files:**
- `packages/db/src/repositories/PostgresSessionStore.ts`
- `packages/memory/src/context/MemoryContextBuilder.ts`

### Phase 3: Agent Integration

Format and inject conversation context into agent prompts:

1. Decide presentation format (inline? separate section?)
2. Token budget management
3. Relevance filtering (which entities get deep context?)

**Files:**
- `packages/agent/src/prompts/SystemPromptBuilder.ts`

## Future: L2 Entity Sources Table

For analytics and conversation-centric queries, mirror source tracking in PostgreSQL:

```sql
CREATE TABLE entity_sources (
  id SERIAL PRIMARY KEY,
  entity_id TEXT NOT NULL,        -- Neo4j entityId
  message_id TEXT NOT NULL,       -- FK to messages
  conversation_id TEXT NOT NULL,  -- FK to conversations
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- created | updated | extracted
  extracted_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT fk_message FOREIGN KEY (message_id) REFERENCES messages(message_id),
  CONSTRAINT fk_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
);

CREATE INDEX idx_entity_sources_entity ON entity_sources(entity_id);
CREATE INDEX idx_entity_sources_conversation ON entity_sources(conversation_id);
CREATE INDEX idx_entity_sources_time ON entity_sources(extracted_at);
```

**Enables queries L3 can't do efficiently:**
- "All entities from conversation X"
- "Entities most active in last 24 hours"
- "Conversations where entity Y appears"
- "Entity extraction frequency over time"

**Example views:**
```sql
-- Active entities with conversation count
CREATE VIEW active_entities AS
SELECT
  entity_id,
  COUNT(DISTINCT conversation_id) as conversations,
  COUNT(*) as total_mentions,
  MAX(extracted_at) as last_seen
FROM entity_sources
WHERE extracted_at > NOW() - INTERVAL '7 days'
GROUP BY entity_id
ORDER BY total_mentions DESC;

-- Entity timeline for a conversation
CREATE VIEW conversation_entities AS
SELECT
  es.conversation_id,
  es.entity_id,
  es.action,
  es.extracted_at,
  m.content as source_message
FROM entity_sources es
JOIN messages m ON es.message_id = m.message_id
ORDER BY es.extracted_at;
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Window type | Message count, not time | Conversation pace varies; ±N messages is consistent |
| Primary source store | L3 (Neo4j) | Entity-centric retrieval, single query |
| Secondary store | L2 (PostgreSQL) | Analytics, views, reverse lookups |
| Action granularity | 3 types | Simple but meaningful distinction |
| Store both timestamp + messageId | Yes | Storage is cheap, flexibility is valuable |

## Open Questions

- [ ] Token budget per entity's deep context?
- [ ] How to handle very long sourceHistory arrays? (Trim oldest `extracted` entries?)
- [ ] Should relationships also track sourceHistory?
- [ ] Presentation format in agent prompt?

---

## Related: Entity Name Resolution Fix (2025-12-20)

### Problem

Relationships were silently failing to be created in Neo4j. The root cause was LLM name inconsistency:

- Entity extracted: `{ name: "John Smith", type: "person" }`
- Relationship extracted: `{ from: "John", to: "work stress", type: "HELPS_WITH" }`

The entity was stored as `"john smith"` but the relationship looked for `"john"` which didn't exist. Neo4j's `MATCH` clause silently returned 0 rows.

### Solution

Added name resolution logic in `EntityExtractor.ts`:

1. **Build resolution map** from extracted entities:
   - Full name: `"john smith"` → `"john smith"`
   - Word parts: `"john"` → `"john smith"`, `"smith"` → `"john smith"`

2. **Filter relationships** using resolvable names (not exact matches)

3. **Resolve names** before calling `createRelationship()`

4. **Log warnings** when relationships can't be resolved (instead of silent failure)

### Files Modified

- `packages/memory/src/extraction/EntityExtractor.ts`
  - Added `buildNameResolutionMap()` - creates word-to-entity lookup
  - Added `resolveEntityName()` - resolves partial names to stored names
  - Added `canResolveEntityName()` - check for relationship filtering
  - Updated `filterByImportance()` - uses resolution instead of exact match
  - Updated `persist()` - resolves names before relationship creation

### Tests Added

- `packages/memory/tests/extraction/EntityExtractor.test.ts`
  - "should resolve partial entity names in relationships"
  - "should skip relationships when entity cannot be resolved"
  - "should handle case-insensitive name matching"

- `packages/memory/tests/stores/Neo4jKnowledgeStore.integration.test.ts`
  - Integration tests demonstrating the issue and fix
