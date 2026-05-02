# Memory Tiers

Siri uses a 4-tier memory architecture, each optimized for different access patterns and use cases.

## The Problem

How do you give an AI companion *memory*?

A naive approach stores every message in a database and retrieves it all for each request. This fails catastrophically as conversations grow - context windows overflow, latency spikes, costs explode, and the agent drowns in irrelevant history.

The opposite extreme - stateless responses with no memory - makes conversations feel hollow. The agent forgets your name, your struggles, your progress. Every conversation starts from zero.

Neither approach creates the feeling of talking to someone who *knows* you.

## The Idea

Different types of memory serve different purposes. Human memory works this way too - we have immediate working memory, episodic recall of specific events, semantic understanding of concepts, and intuitive pattern recognition.

Siri mirrors this with four tiers, each optimized for a specific retrieval pattern:

- **L1 (Redis)** - Working memory. What did we *just* talk about? Sub-10ms access to the active conversation.
- **L2 (PostgreSQL)** - Episodic memory. The full history of every conversation, searchable and permanent.
- **L3 (Neo4j)** - Semantic memory. Who are the people in your life? What concepts matter to you? A knowledge graph of entities and their relationships.
- **L4 (Qdrant)** - Associative memory. What past conversations are *similar* to this one? Vector similarity search across all history.

The key insight: we don't need *all* memory for every request. We need the *right* memory, fast. L1 handles 90% of requests. L2 catches the rest. L3 and L4 enrich responses with relevant context without overwhelming the agent with irrelevant history.

## Why This Matters

This architecture enables conversations that feel continuous across days, weeks, months. Siri remembers that you mentioned John last week. She knows your therapy appointments are on Thursdays. She recalls that work stress triggers your anxiety.

The tiered approach keeps response times snappy (<200ms to first token) while maintaining this deep contextual awareness. It's the difference between a stateless chatbot and a companion who actually *knows* you.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      User Message                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  L1: Redis Cache                                            │
│  ├─ Active session messages                                 │
│  ├─ <10ms latency                                          │
│  └─ 4-hour TTL                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │ miss
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  L2: PostgreSQL                                             │
│  ├─ Full conversation history                               │
│  ├─ User profiles                                          │
│  ├─ 10-50ms latency                                        │
│  └─ Warms L1 on retrieval                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │ parallel
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  L3: Neo4j Knowledge Graph                                  │
│  ├─ Entities (people, places, concepts)                     │
│  ├─ Relationships between entities                          │
│  ├─ Observations about entities                             │
│  ├─ 20-100ms latency                                       │
│  └─ Graph-local semantic search (MiniLM)                   │
└─────────────────────────────────────────────────────────────┘
                          │ parallel
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  L4: Qdrant Vector Store                                    │
│  ├─ Semantic similarity search                              │
│  ├─ High-precision OpenAI embeddings (1536-dim)            │
│  ├─ 5-20ms latency                                         │
│  └─ BM25 hybrid search                                     │
└─────────────────────────────────────────────────────────────┘
```

## Tier Details

### L1: Redis (Session Cache)

**Purpose:** Hot cache for active conversations.

| Property | Value |
|----------|-------|
| Store | Redis |
| Latency | <10ms |
| TTL | 4 hours |
| Data | Recent messages for active session |

**When accessed:**
- Every incoming message (first lookup)
- Warmed automatically when L2 is queried

**Source:** [`packages/memory/src/redis/`](../packages/memory/src/redis/)

---

### L2: PostgreSQL (Persistent History)

**Purpose:** Ground truth for all conversations and user data.

| Property | Value |
|----------|-------|
| Store | PostgreSQL + pgvector |
| Latency | 10-50ms |
| TTL | Permanent |
| Data | Messages, sessions, user profiles |

**When accessed:**
- L1 cache miss
- User profile retrieval
- Session metadata queries
- Deep Memory context lookups

**Source:** [`packages/db/src/stores/PostgresSessionStore.ts`](../packages/db/src/stores/PostgresSessionStore.ts)

---

### L3: Neo4j (Knowledge Graph)

**Purpose:** Long-term semantic memory about entities and their relationships.

| Property | Value |
|----------|-------|
| Store | Neo4j |
| Latency | 20-100ms |
| TTL | Permanent |
| Data | Entities, relationships, observations |

**When accessed:**
- Query mentions known entities
- Semantic search for related concepts
- Relationship traversal
- Entity context injection into prompts

**Features:**
- Graph-local semantic search with MiniLM (384-dim embeddings)
- Entity extraction from conversations
- Deep Memory enrichment with conversation context

**Source:** [`packages/memory/src/stores/Neo4jKnowledgeStore.ts`](../packages/memory/src/stores/Neo4jKnowledgeStore.ts)

**See also:** [L3_KNOWLEDGE_GRAPH.md](L3_KNOWLEDGE_GRAPH.md)

---

### L4: Qdrant (Vector Search)

**Purpose:** High-precision semantic similarity search.

| Property | Value |
|----------|-------|
| Store | Qdrant |
| Latency | 5-20ms |
| TTL | Permanent |
| Data | Message embeddings (OpenAI 1536-dim) |

**When accessed:**
- Semantic search for similar past conversations
- Finding relevant context beyond recent history
- RAG-style retrieval

**Features:**
- OpenAI text-embedding-3-small (1536-dim)
- BM25 hybrid search
- Configurable similarity thresholds

**Source:** [`packages/memory/src/qdrant/`](../packages/memory/src/qdrant/)

**See also:** [QDRANT.md](QDRANT.md)

## Retrieval Flow

```typescript
// Simplified retrieval logic
async function retrieveContext(userId, message) {
  // 1. Try L1 (Redis) - fastest
  let context = await redis.getSessionMessages(userId)

  if (!context) {
    // 2. Fall back to L2 (PostgreSQL)
    context = await postgres.getConversationHistory(userId)
    await redis.warmCache(userId, context)  // Warm L1
  }

  // 3. Parallel: L3 + L4 for semantic context
  const [entities, semanticMatches] = await Promise.all([
    neo4j.findRelevantEntities(message),      // L3
    qdrant.semanticSearch(message)             // L4
  ])

  return { context, entities, semanticMatches }
}
```

**Source:** [`packages/memory/src/MemoryOrchestrator.ts`](../packages/memory/src/MemoryOrchestrator.ts)

## Design Decisions

### Why Four Tiers?

Each tier exists because a single store can't optimize for all access patterns:

- **Redis** excels at sub-millisecond key-value lookups but loses data on restart and can't handle complex queries.
- **PostgreSQL** provides ACID guarantees and SQL flexibility but can't match Redis speed for hot data.
- **Neo4j** represents relationships naturally (who knows whom, what relates to what) but isn't designed for bulk text search.
- **Qdrant** finds semantically similar content but doesn't understand structure or relationships.

Combining them gives us the best of each world.

### Why Not Just Use PostgreSQL + pgvector?

We could consolidate L2 and L4 into PostgreSQL with pgvector. The trade-off:

- **Simpler**: One less service to deploy and maintain.
- **Slower**: pgvector is good, but Qdrant is purpose-built for vector search with better indexing (HNSW).
- **Coupling**: Mixing vector workloads with transactional workloads can cause resource contention.

For Siri's scale, Qdrant's performance advantage and dedicated resource isolation justify the operational complexity.

### Why Redis Instead of Application Memory?

Application memory would be faster, but:

- Doesn't survive restarts
- Can't be shared across multiple API instances
- Memory limits are harder to manage

Redis provides nearly the same speed with persistence, clustering, and proper eviction policies.

## Trade-offs

### Consistency vs. Performance

The tiers are eventually consistent. A message stored in L2 doesn't immediately appear in L1 or propagate to L3/L4 embeddings. For conversational AI, this is acceptable - a few hundred milliseconds of lag is imperceptible.

### Complexity vs. Capability

Four databases means four things that can fail, four schemas to maintain, four sets of credentials. This complexity is the cost of the capability. Simpler systems exist, but they can't provide the same depth of contextual awareness.

### Cost vs. Latency

We could reduce L4 latency further with more vector index shards or GPU acceleration. We could reduce L3 latency with more Neo4j replicas. Each optimization costs money. The current balance prioritizes reasonable cost over minimal latency.

## Stub Mode

For development and testing, all tiers have in-memory stub implementations:

```bash
USE_STUBS=true pnpm dev   # Uses stubs (default)
USE_STUBS=false pnpm dev  # Uses real services (requires docker-compose)
```

Stubs are exported from `@siri/memory/stubs`.
