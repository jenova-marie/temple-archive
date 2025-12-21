# @pippa/memory

Multi-tier memory orchestration for the RecoverySky Agent system.

## Installation

```bash
pnpm add @pippa/memory
```

## Overview

This package implements a tiered memory system for contextual conversations:

| Tier | Store | Purpose | Latency Target |
|------|-------|---------|----------------|
| L1 | Redis | Active session cache | <10ms |
| L2 | PostgreSQL + pgvector | Session history, profiles | 10-50ms |
| L3 | Neo4j | Entity relationships, knowledge graph | 20-100ms |
| L4 | Qdrant | Semantic similarity search | 5-20ms |

## Quick Start

```typescript
import { MemoryOrchestrator } from '@pippa/memory'
import {
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
} from '@pippa/memory/stubs'

// Create with stub implementations (development/testing)
const memory = new MemoryOrchestrator(
  new InMemoryContextStore(),
  new InMemorySessionStore(),
  new InMemoryKnowledgeStore(),
  new InMemoryVectorStore(),
)

// Retrieve context for a conversation
const result = await memory.retrieveContext(
  'conv_123',
  'user_456',
  queryEmbedding, // number[] or null
  traceContext,
)

if (result.ok) {
  console.log('Source:', result.value.source) // 'L1_REDIS', 'L2_POSTGRESQL', etc.
  console.log('Messages:', result.value.context.messages)
  console.log('User Profile:', result.value.context.userProfile)
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MemoryOrchestrator                       │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ L1: Redis (Active Context) - <10ms                    │ │
│  │   - Last 20 messages in session                       │ │
│  │   - Current session state (crisis level, topic)       │ │
│  │   TTL: 4 hours                                        │ │
│  └───────────────────────────┬───────────────────────────┘ │
│                              │ MISS                         │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ L2: PostgreSQL + pgvector - 10-50ms                   │ │
│  │   - Full conversation history (90 days)               │ │
│  │   - Session summaries                                 │ │
│  │   - User profiles                                     │ │
│  └───────────────────────────┬───────────────────────────┘ │
│                              │ ENRICH                       │
│                              ▼                              │
│  ┌─────────────────────┐  ┌─────────────────────────────┐ │
│  │ L3: Neo4j           │  │ L4: Qdrant                  │ │
│  │   - Entity graph    │  │   - Semantic similarity     │ │
│  │   - Relationships   │  │   - Vector search           │ │
│  └─────────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### MemoryOrchestrator

```typescript
class MemoryOrchestrator {
  constructor(
    l1: IContextStore,
    l2: ISessionStore,
    l3: IKnowledgeStore,
    l4: IVectorStore,
    config?: Partial<MemoryOrchestratorConfig>,
  )

  // Retrieve assembled context for a conversation
  retrieveContext(
    conversationId: string,
    userId: string,
    queryEmbedding: number[] | null,
    ctx: TraceContext,
  ): Promise<Result<MemoryRetrievalResult, MemoryError>>

  // Store a message across all tiers
  storeMessage(
    message: Message,
    embedding: number[] | null,
    ctx: TraceContext,
  ): Promise<Result<void, MemoryError>>

  // Update session state in L1
  updateSessionState(
    conversationId: string,
    state: Partial<SessionState>,
    ctx: TraceContext,
  ): Promise<Result<void, MemoryError>>
}
```

### Configuration

```typescript
interface MemoryOrchestratorConfig {
  l1MessageLimit: number      // Max messages from L1 (default: 20)
  l2MessageLimit: number      // Max messages from L2 (default: 50)
  semanticSearchDays: number  // Days back for semantic search (default: 90)
  semanticScoreThreshold: number // Min similarity score (default: 0.7)
}
```

### Assembled Context

The orchestrator returns an `AssembledContext` containing:

```typescript
interface AssembledContext {
  messages: Message[]           // Recent conversation messages
  userProfile: UserProfile | null // User preferences, triggers, milestones
  sessionEntities: SessionEntities // Extracted entities (people, places, etc.)
  sessionState: SessionState    // Current session metadata
  previousSessions: SessionSummary[] // Past session summaries
  semanticMatches?: SemanticMatch[] // Relevant past messages by similarity
}
```

## Stub Implementations

For development and testing, use the in-memory stubs:

```typescript
import {
  InMemoryContextStore,    // L1 stub
  InMemorySessionStore,    // L2 stub
  InMemoryKnowledgeStore,  // L3 stub
  InMemoryVectorStore,     // L4 stub
  InMemoryArchiveStore,    // S3 stub
} from '@pippa/memory/stubs'
```

### InMemoryContextStore (L1)

```typescript
const store = new InMemoryContextStore({ ttlMs: 4 * 60 * 60 * 1000 })

await store.storeMessage(message, ctx)
await store.getRecentMessages(sessionId, 20, ctx)
await store.get(sessionId, ctx) // Get session state
await store.set(sessionId, state, ctx)
await store.delete(sessionId, ctx)

// Testing utilities
store.clear() // Clear all sessions
store.size()  // Get active session count
```

### InMemorySessionStore (L2)

```typescript
const store = new InMemorySessionStore()

await store.storeMessage(message, embedding, ctx)
await store.getConversationHistory(conversationId, 50, ctx)
await store.getUserProfile(userId, ctx)
await store.getSessionSummaries(conversationId, 5, ctx)
```

### InMemoryVectorStore (L4)

```typescript
const store = new InMemoryVectorStore()

await store.indexMessage(message, embedding, ctx)
await store.search(queryEmbedding, {
  userId: 'user_123',
  limit: 10,
  daysBack: 90,
  scoreThreshold: 0.7,
}, ctx)
```

## Retrieval Flow

1. **L1 Check**: Try Redis cache first (<10ms)
2. **L1 Hit**: Return cached messages + session state
3. **L1 Miss**: Fall through to L2
4. **L2 Check**: Query PostgreSQL for conversation history
5. **L2 Hit**: Warm L1 cache, return messages
6. **L2 Miss**: Fall through to L3/L4
7. **L4 Search**: Semantic search with query embedding
8. **Assemble**: Combine results into AssembledContext

## Metrics

The package records metrics via `@pippa/observability`:

- `memory_cache_hits_total{tier}` - Cache hits per tier
- `memory_cache_misses_total{tier}` - Cache misses per tier

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Type check
pnpm typecheck
```

## Future Implementations

- `RedisContextStore` - Real Redis implementation
- `PostgresSessionStore` - Real PostgreSQL + pgvector
- `Neo4jKnowledgeStore` - Real Neo4j graph database
- `QdrantVectorStore` - Real Qdrant vector search
