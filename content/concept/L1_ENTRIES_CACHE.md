# L1 Memory Cache & Bootstrap System

## Goal

Build an async memory system that "primes" conversations with relevant memories from past conversations, running in parallel to the main pipeline without blocking user responses.

## Overview

```
Exchange 1-2:  Cold start, no bootstrap
Exchange 3-8:  Bootstrap window - search L4 for related conversations, load memories
Exchange 9+:   Primed - bootstrap complete, memories loaded

After each exchange:
  Haiku extracts memories → L3 (permanent) + L1 cache (conversation)

On conversation end/TTL:
  L1 cache → L2 (persist)
  Topic summary → embed → L4 (searchable)
```

## Tier Responsibilities

| Tier | Store | Purpose | TTL |
|------|-------|---------|-----|
| L1 | Redis | Hot conversation memory cache | 4 hours |
| L2 | PostgreSQL | Persisted memory cache | Permanent |
| L3 | Neo4j | User's knowledge graph | Permanent |
| L4 | Qdrant | Conversation topic vectors | 90 days |

## Configuration

```env
# Feature flag - disabled by default
MEMORY_BOOTSTRAP_ENABLED=false

# Bootstrap window (exchange count)
MEMORY_BOOTSTRAP_START=3
MEMORY_BOOTSTRAP_END=8

# Cache settings
MEMORY_CACHE_LIMIT=50          # Max entries in L1 (number | "all" | "none")
MEMORY_CACHE_TTL_HOURS=4
MEMORY_CACHE_DEDUP_THRESHOLD=10  # Deduplicate after this many new entries

# Extraction model
MEMORY_EXTRACTION_MODEL=haiku
```

---

## What is the L1 Memory Cache?

**L1 is a list of pre-formatted strings** ready for LLM consumption:

```typescript
// L1 stores simple strings, NOT Memory objects
type MemoryCacheEntry = string

// Example L1 cache contents:
[
  "- Mike:person -> User's sponsor, met yesterday, described as 'really helpful'",
  "- Tuesday:event -> AA meeting day, meets with Mike",
  "- Stress:trigger -> Work deadlines cause cravings"
]
```

**Key principles:**
1. Formatted once when added, never reprocessed
2. Sent directly to LLM with each request
3. Passed to Haiku during extraction so he doesn't duplicate
4. Deduplicated by Haiku every X new memories

---

## Data Flow

### Per-Exchange Flow (async, after response sent)

```
Response sent to user
        ↓
[Haiku] receives:
  - The exchange (user + assistant messages)
  - Current L1 cache (so he knows what's already remembered)
        ↓
"Here's what's new and worth remembering (not already in cache):"
        ↓
   Returns: formatted strings + structured data
        ↓
   ┌────────────────┴────────────────┐
   ↓                                 ↓
  L1 cache                          L3 (Neo4j)
  (formatted strings)               (structured Memory objects)
  For THIS conversation             Permanent storage
```

### L1 Cache Deduplication (every X new memories)

```
L1 cache grows past threshold (e.g., 10 new entries)
        ↓
[Haiku] "Here's the current cache. Consolidate duplicates and remove redundant entries:"
        ↓
Returns: cleaned cache
        ↓
L1 cache updated
```

---

## Haiku Prompts

### Memory Extraction Prompt

```
You are extracting memories from a conversation for a recovery support agent.

CURRENT MEMORIES (already remembered - do not duplicate):
${currentCache.join('\n')}

EXCHANGE:
User: ${userMessage}
Assistant: ${assistantResponse}

Extract any NEW facts worth remembering. For each memory:
1. Format as: "- Name:type -> description"
2. Types: person, place, event, trigger, emotion, coping_strategy, medication, milestone
3. Only extract if NOT already in current memories
4. Be concise but include key context

Return JSON:
{
  "cacheEntries": ["- Mike:person -> User's sponsor, very supportive"],
  "memories": [
    {
      "name": "Mike",
      "memoryType": "knowledge",
      "subtype": "person",
      "observation": "User's sponsor, described as very supportive"
    }
  ]
}

If nothing new to remember, return null.
```

### Cache Deduplication Prompt

```
Consolidate and deduplicate these memory entries.
Merge related entries, remove redundant info, keep the most recent/relevant details.

ENTRIES:
${entries.join('\n')}

Return a cleaned list (same format, fewer entries):
```

### Bootstrap Merge Prompt

```
You are merging memories for a recovery support conversation.

CURRENT CONVERSATION MEMORIES (from this session):
${currentL1Cache.join('\n')}

RELATED MEMORIES FROM PAST CONVERSATIONS:
${l2Memories.join('\n')}

Merge these into a single clean list:
1. Keep all current conversation memories (they're most relevant)
2. Add past memories that provide useful context
3. Remove duplicates - if same person/topic exists, keep the richer entry
4. Prioritize recent/relevant over old/tangential
5. Limit to ${cacheLimit} entries max

Return the merged list (same format):
```

---

## Bootstrap Flow (exchanges 3-8)

```
Exchange N (where 3 ≤ N ≤ 8)
        ↓
[Haiku] Generate topic search phrases from recent exchanges
        ↓
Search L4 for similar conversation topics
        ↓
Load matching memories from L2 (could be many entries)
        ↓
[Haiku] receives:
  - Current L1 cache (accumulated from exchanges 1 to N-1)
  - New L2 memories (from related past conversations)
        ↓
"Merge these into a clean, consolidated list - no duplicates"
        ↓
REPLACE L1 cache with merged result
```

**Each bootstrap exchange builds upon the previous:**
- Exchange 3: L1 (from 1-2) + L2 finds → merged → new L1
- Exchange 4: L1 (from 3) + more L2 finds → merged → new L1
- ...
- Exchange 8: L1 (from 7) + final L2 finds → merged → final L1

After exchange 8, bootstrap stops. L1 is now "primed" with relevant cross-conversation context.

---

## Conversation End Flow

```
Conversation ends (explicit or TTL)
        ↓
L1 cache → L2 (persist)
        ↓
[Haiku] Generate topic summary from last N exchanges + memories
        ↓
Embed topic summary → L4 as conversation_memories
```

---

## File Structure

```
packages/memory/src/
  bootstrap/
    index.ts                      # Exports
    types.ts                      # Interfaces & config types
    ConversationMemoryCache.ts    # L1 Redis cache (string[] storage)
    MemoryExtractor.ts            # Haiku: extract from exchange → L1 strings + L3 objects
    MemoryCacheDeduplicator.ts    # Haiku: consolidate cache entries
    TopicGenerator.ts             # Haiku: generate topic phrases for L4 search
    MemoryCachePersistence.ts     # L1 → L2 movement on conversation end
    BootstrapOrchestrator.ts      # Coordinates the full flow

  stores/
    PostgresMemoryCache.ts        # NEW: L2 memory_cache table
```

---

## Interfaces

### IConversationMemoryCache (L1)

```typescript
interface IConversationMemoryCache {
  get(conversationId: string): Promise<string[]>           // Get formatted strings
  add(conversationId: string, entries: string[]): Promise<void>  // Add new entries
  replace(conversationId: string, entries: string[]): Promise<void>  // After dedup
  clear(conversationId: string): Promise<void>
  getMetadata(conversationId: string): Promise<CacheMetadata | null>
}

interface CacheMetadata {
  conversationId: string
  userId: string
  entryCount: number
  exchangeCount: number
  lastUpdated: number
}
```

### IMemoryCachePersistence (L1 → L2)

```typescript
interface IMemoryCachePersistence {
  persist(conversationId: string): Promise<void>   // L1 → L2
  load(conversationId: string): Promise<string[]>  // L2 → formatted strings
}
```

### IMemoryExtractor

```typescript
interface IMemoryExtractor {
  /**
   * Extract memories from an exchange.
   * Receives current cache so Haiku doesn't duplicate.
   * Returns both formatted strings (for L1) and structured data (for L3).
   */
  extract(
    exchange: { userMessage: string; assistantResponse: string },
    currentCache: string[],  // What's already remembered
    ctx: TraceContext
  ): Promise<ExtractionResult | null>  // null = nothing new
}

interface ExtractionResult {
  // Pre-formatted for L1 cache (ready for LLM)
  cacheEntries: string[]

  // Structured for L3 storage (Neo4j Memory objects)
  memories: Memory[]
}
```

### IMemoryCacheDeduplicator

```typescript
interface IMemoryCacheDeduplicator {
  /**
   * Consolidate and deduplicate cache entries.
   * Called when cache grows past threshold.
   */
  deduplicate(entries: string[]): Promise<string[]>

  /**
   * Merge current L1 cache with L2 memories from related conversations.
   * Called during bootstrap window (exchanges X-Y).
   * Returns merged list that REPLACES current L1.
   */
  merge(currentL1: string[], l2Memories: string[]): Promise<string[]>
}
```

### ITopicGenerator

```typescript
interface ITopicGenerator {
  generateSearchPhrases(
    exchanges: Exchange[],
    memories: Memory[]
  ): Promise<string[]>

  generateSummary(
    exchanges: Exchange[],
    memories: Memory[]
  ): Promise<string>
}
```

### IBootstrapOrchestrator

```typescript
interface IBootstrapOrchestrator {
  // Called after each exchange (fire-and-forget)
  processExchange(
    exchange: Exchange,
    conversationId: string,
    userId: string,
    exchangeCount: number,
    ctx: TraceContext
  ): Promise<void>

  // Called on conversation end
  finalize(conversationId: string, ctx: TraceContext): Promise<void>
}
```

### BootstrapConfig

```typescript
interface BootstrapConfig {
  enabled: boolean
  bootstrapStart: number      // X - start searching
  bootstrapEnd: number        // Y - stop searching
  cacheLimit: number | 'all' | 'none'
  cacheTTLHours: number
  dedupThreshold: number      // Deduplicate after this many new entries
  extractionModel: 'haiku' | 'sonnet'
}
```

---

## PostgreSQL Schema (L2)

```sql
CREATE TABLE memory_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  memories JSONB NOT NULL,        -- Array of formatted strings
  topic_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_conversation UNIQUE (conversation_id)
);

CREATE INDEX idx_memory_cache_user ON memory_cache(user_id);
CREATE INDEX idx_memory_cache_updated ON memory_cache(updated_at);
```

---

## L4 Conversation Topic Schema

New `conversation_topics` collection in Qdrant:

```typescript
interface ConversationTopicPayload {
  conversationId: string
  userId: string
  topicSummary: string
  memoryCount: number
  exchangeCount: number
  createdAt: number
}

// Collection config
const CONVERSATION_TOPICS_COLLECTION = 'conversation_topics'
const TOPIC_VECTOR_SIZE = 1536  // OpenAI text-embedding-3-small
```

---

## Pipeline Integration

Hook into `Pipeline.persistMessages()` (fire-and-forget pattern already exists):

```typescript
// In Pipeline.ts persistMessages() method
if (this.deps.bootstrapOrchestrator && config.memoryBootstrapEnabled) {
  this.deps.bootstrapOrchestrator
    .processExchange(exchange, conversationId, userId, exchangeCount, ctx)
    .catch(err => logger.warn({ err }, 'Bootstrap processing failed'))
}
```

---

## Agent Tools

Add to `packages/tools/src/memoryTools.ts`:

```typescript
// For testing/debugging
clearConversationMemoryCache: {
  description: "Clear memory cache for current conversation (L1, L2, L4)"
  parameters: { levels: ['L1' | 'L2' | 'L4'][] }
}
```

---

## Implementation Order

### Phase 1: Types & Config
1. Create `packages/memory/src/bootstrap/types.ts` with interfaces
2. Add config loading from env vars
3. Add to container.ts with feature flag check

### Phase 2: L1 Cache
4. Create `ConversationMemoryCache.ts` - Redis operations
5. Create in-memory stub for testing

### Phase 3: Memory Extraction
6. Create `MemoryExtractor.ts` - Haiku prompt for memory extraction
7. Create `MemoryCacheDeduplicator.ts` - Haiku dedup and merge

### Phase 4: Bootstrap Window
8. Create `TopicGenerator.ts` - Haiku prompt for topic phrases
9. Create `BootstrapOrchestrator.ts` - coordinate bootstrap flow
10. Add L4 search for related conversations

### Phase 5: Persistence
11. Create Drizzle schema for `memory_cache` table
12. Create `PostgresMemoryCache.ts` - L2 table operations
13. Create `MemoryCachePersistence.ts` - L1 → L2 movement
14. Add conversation finalization (topic → L4)

### Phase 6: Integration
15. Wire into Pipeline.ts
16. Add agent tools for cache management
17. Update exports in index.ts
18. Add tests

---

## Files to Create

```
packages/memory/src/bootstrap/
  index.ts                      # Public exports
  types.ts                      # BootstrapConfig, interfaces
  ConversationMemoryCache.ts    # L1 Redis: get/add/replace/clear string[]
  MemoryExtractor.ts            # Haiku prompt → ExtractionResult
  MemoryCacheDeduplicator.ts    # Haiku prompt → deduplicated/merged string[]
  TopicGenerator.ts             # Haiku prompt → search phrases / summary
  MemoryCachePersistence.ts     # L1 → L2 persistence
  BootstrapOrchestrator.ts      # Main coordinator

packages/memory/src/stores/
  PostgresMemoryCache.ts        # L2 memory_cache CRUD

packages/db/src/schema/
  memoryCache.ts                # Drizzle table definition
```

## Files to Modify

```
packages/pipeline/src/Pipeline.ts          # Add bootstrapOrchestrator.processExchange() call
packages/tools/src/memoryTools.ts          # Add clearMemoryCache tool
apps/api/src/container.ts                  # Wire BootstrapOrchestrator + deps
.env.example                               # Add MEMORY_BOOTSTRAP_* vars
packages/memory/src/index.ts               # Export bootstrap module
```

---

## Success Criteria

1. Feature completely disabled by default (`MEMORY_BOOTSTRAP_ENABLED=false`)
2. Existing pipeline unaffected when disabled
3. Haiku extracts memories after each exchange (async)
4. Bootstrap window (X-Y) searches for related conversations
5. L1 cache persists to L2 on conversation end
6. Topic summaries searchable in L4
7. Agent can clear cache for testing
8. All operations async - never blocks user response
