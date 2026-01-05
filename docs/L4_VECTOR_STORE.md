# L4 Vector Store (Qdrant)

The L4 tier provides high-precision semantic similarity search using Qdrant, with hybrid dense + sparse retrieval for optimal relevance.

## The Problem

Finding *relevant* context is harder than finding *recent* context.

L1 gives us the last 100 messages - fast, but blunt. L2 gives us full history - complete, but overwhelming. Neither answers the question: "What past conversations are *similar* to what we're discussing now?"

When a user mentions anxiety, we want to surface past conversations about anxiety - even if they happened weeks ago and used different words. "Feeling stressed at work" should match "work anxiety" and "job pressure" and "overwhelmed by deadlines."

This requires semantic understanding, not keyword matching. It requires embeddings - numerical representations of meaning that allow mathematical similarity comparisons.

## The Idea

Store message embeddings in Qdrant - a purpose-built vector database optimized for similarity search.

Every message gets embedded via OpenAI's text-embedding-3-small (1536 dimensions). These embeddings capture semantic meaning - similar meanings produce similar vectors. We store these vectors in Qdrant with metadata (userId, conversationId, timestamp).

When the user sends a message, we:
1. Embed the query (OpenAI, ~50ms)
2. Search Qdrant for similar vectors (5-20ms)
3. Return matching messages as additional context

This surfaces relevant past conversations regardless of exact wording.

But pure vector search has a weakness: it can miss exact keyword matches that are obviously relevant. A user asking about "John" should definitely see past mentions of "John" - but vector search might prioritize semantically similar but different content.

So we use **hybrid search**: combine dense vectors (semantic) with sparse vectors (BM25 keyword) using Reciprocal Rank Fusion. Best of both worlds.

## Why This Matters

L4 enables *associative memory* - the ability to connect current context with relevant past experiences.

Without L4, Pippa only knows what's in the current conversation window. She can't say "Last time you mentioned this, you found meditation helpful" because she can't find "last time."

With L4, Pippa can:
- Surface relevant past conversations
- Connect recurring themes across sessions
- Find specific people/topics even if not recently mentioned
- Provide truly personalized context

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           L4: Qdrant                                         │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │                    Hybrid Search Architecture                          │ │
│   │                                                                        │ │
│   │   Query: "feeling anxious about work"                                  │ │
│   │                                                                        │ │
│   │   ┌─────────────────────┐    ┌─────────────────────┐                  │ │
│   │   │   Dense Vector      │    │   Sparse Vector     │                  │ │
│   │   │   (OpenAI 1536)     │    │   (BM25 local)      │                  │ │
│   │   │                     │    │                     │                  │ │
│   │   │   Semantic meaning  │    │   Keyword matching  │                  │ │
│   │   │   "work stress"     │    │   "anxious", "work" │                  │ │
│   │   │   "job anxiety"     │    │                     │                  │ │
│   │   └──────────┬──────────┘    └──────────┬──────────┘                  │ │
│   │              │                          │                              │ │
│   │              └──────────┬───────────────┘                              │ │
│   │                         │                                              │ │
│   │                         ▼                                              │ │
│   │              ┌────────────────────┐                                    │ │
│   │              │  Reciprocal Rank   │                                    │ │
│   │              │  Fusion (RRF)      │                                    │ │
│   │              │                    │                                    │ │
│   │              │  Combines rankings │                                    │ │
│   │              │  from both sources │                                    │ │
│   │              └──────────┬─────────┘                                    │ │
│   │                         │                                              │ │
│   │                         ▼                                              │ │
│   │              ┌────────────────────┐                                    │ │
│   │              │  Top K Results     │                                    │ │
│   │              │                    │                                    │ │
│   │              │  Relevant messages │                                    │ │
│   │              │  with scores       │                                    │ │
│   │              └────────────────────┘                                    │ │
│   │                                                                        │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Point Structure

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          Qdrant Point                                       │
│                                                                            │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  ID: UUID (SHA256 hash of messageId)                                │   │
│   │                                                                     │   │
│   │  Vectors:                                                           │   │
│   │  ┌───────────────────────────────────────────────────────────────┐ │   │
│   │  │  "dense": float[1536]     OpenAI text-embedding-3-small      │ │   │
│   │  │  "sparse": {indices, values}   BM25 term weights             │ │   │
│   │  └───────────────────────────────────────────────────────────────┘ │   │
│   │                                                                     │   │
│   │  Payload:                                                           │   │
│   │  ┌───────────────────────────────────────────────────────────────┐ │   │
│   │  │  userId: string           Owner (for filtering)               │ │   │
│   │  │  conversationId: string   Parent conversation                 │ │   │
│   │  │  messageId: string        Original message ID                 │ │   │
│   │  │  role: string             "user" | "assistant"                │ │   │
│   │  │  content: string          Message text                        │ │   │
│   │  │  timestamp: number        Epoch milliseconds                  │ │   │
│   │  │  crisisLevel?: number     Optional crisis severity            │ │   │
│   │  │  entities?: string[]      Extracted entities                  │ │   │
│   │  │  topics?: string[]        Extracted topics                    │ │   │
│   │  └───────────────────────────────────────────────────────────────┘ │   │
│   │                                                                     │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Collection Schema

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       Collection Configuration                              │
│                                                                            │
│   Collection name: "messages" (configurable via QDRANT_COLLECTION_NAME)   │
│                                                                            │
│   Vector Configuration (Hybrid Mode):                                      │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  "dense": {                                                         │   │
│   │    size: 1536,                                                      │   │
│   │    distance: "Cosine"                                               │   │
│   │  },                                                                 │   │
│   │  "sparse": {                                                        │   │
│   │    modifier: "idf"   // Inverse document frequency weighting        │   │
│   │  }                                                                  │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   Payload Indexes:                                                         │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  userId: keyword         Fast user scoping                         │   │
│   │  conversationId: keyword Fast conversation scoping                  │   │
│   │  timestamp: integer      Time range queries                        │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## BM25 Sparse Vectors

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      BM25 Implementation                                  │
│                                                                          │
│   Local implementation (no ML, no API):                                  │
│   • Performance: <1ms per query                                          │
│   • Memory: ~50MB for vocabulary                                         │
│   • No external dependencies                                             │
│                                                                          │
│   Tokenization Pipeline:                                                 │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  1. Lowercase text                                                │  │
│   │     "Feeling ANXIOUS about Work" → "feeling anxious about work"  │  │
│   │                                                                   │  │
│   │  2. Remove non-alphanumeric (except hyphens)                      │  │
│   │     "work-life balance!" → "work-life balance"                   │  │
│   │                                                                   │  │
│   │  3. Filter stop words (82+ common English words)                  │  │
│   │     "feeling anxious about work" → ["feeling", "anxious", "work"]│  │
│   │                                                                   │  │
│   │  4. Simple stemming (remove suffixes)                             │  │
│   │     -ing, -ed, -ly, -ness, -ment, -tion, -sion, -ies, -es, -s   │  │
│   │     "feelings" → "feel"                                          │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   Term Hashing:                                                          │
│   • FNV-1a hash to index range 0-30000                                  │
│   • Compact sparse vector representation                                 │
│                                                                          │
│   BM25 Weighting:                                                        │
│   • k1 = 1.2 (term frequency saturation)                                │
│   • b = 0.75 (length normalization)                                      │
│   • avgDocLength = 50 (assumed average)                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Search Operations

### Semantic Search

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       search() Operation                                  │
│                                                                          │
│   Input:                                                                 │
│   • queryEmbedding: float[1536]  (OpenAI embedding of query)            │
│   • options: {                                                           │
│       userId: string         Required - scope to user                   │
│       conversationId?: string    Optional - scope to conversation       │
│       limit?: number         Default 20                                  │
│       scoreThreshold?: number    Default 0.7                             │
│       daysBack?: number      Default 90                                  │
│       excludeCrisisLevels?: number[]  Optional                          │
│       requiredTopics?: string[]   Optional - any match                  │
│     }                                                                    │
│                                                                          │
│   Hybrid Search Flow:                                                    │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  1. Generate sparse vector from query text (BM25)                 │  │
│   │                                                                   │  │
│   │  2. Build filter conditions:                                      │  │
│   │     • must: [userId, timestamp > cutoff]                         │  │
│   │     • must_not: [excludeCrisisLevels]                            │  │
│   │     • should: [requiredTopics]                                   │  │
│   │                                                                   │  │
│   │  3. Execute prefetch queries (parallel):                          │  │
│   │     • Dense search: 2x limit results                              │  │
│   │     • Sparse search: 2x limit results                             │  │
│   │                                                                   │  │
│   │  4. Apply RRF fusion:                                             │  │
│   │     score = Σ 1/(k + rank) for each source                       │  │
│   │                                                                   │  │
│   │  5. Return top limit results                                      │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   Output: VectorSearchHit[]                                              │
│   • messageId, conversationId, content, score, metadata                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Indexing

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      indexMessage() Operation                             │
│                                                                          │
│   Input:                                                                 │
│   • message: { id, conversationId, userId, role, content, ... }         │
│   • embedding: float[1536]  (pre-computed OpenAI embedding)             │
│                                                                          │
│   Process:                                                               │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  1. Generate point ID (SHA256 hash of messageId → UUID)           │  │
│   │                                                                   │  │
│   │  2. In hybrid mode: generate BM25 sparse vector from content      │  │
│   │                                                                   │  │
│   │  3. Build payload from message metadata                           │  │
│   │                                                                   │  │
│   │  4. Upsert to Qdrant with wait: true                              │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   Latency: 5-15ms                                                       │
│                                                                          │
│   Batch indexing available via batchIndex() for bulk operations         │
│   • Processes in batches of 100                                         │
│   • Generates sparse vectors in parallel                                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Filter Examples

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Filter Composition                                  │
│                                                                            │
│   User Scoping (required):                                                 │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  { key: "userId", match: { value: "user_123" } }                    │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   Conversation Scoping (optional):                                         │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  { key: "conversationId", match: { value: "conv_456" } }            │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   Time Range (default 90 days):                                            │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  { key: "timestamp", range: { gte: cutoffTimestamp } }              │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   Exclude Crisis Levels:                                                   │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  must_not: [                                                        │   │
│   │    { key: "crisisLevel", match: { value: 8 } },                     │   │
│   │    { key: "crisisLevel", match: { value: 9 } },                     │   │
│   │    { key: "crisisLevel", match: { value: 10 } }                     │   │
│   │  ]                                                                  │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   Topic Filter (any match):                                                │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  should: [                                                          │   │
│   │    { key: "topics", match: { any: ["anxiety", "stress"] } }         │   │
│   │  ]                                                                  │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Configuration

```
┌────────────────────────────────────────────────────────────────────────────┐
│                      Environment Variables                                  │
│                                                                            │
│   Variable                │ Default              │ Purpose                 │
│   ────────────────────────┼──────────────────────┼───────────────────────  │
│   QDRANT_URL              │ http://localhost:6333│ Server endpoint         │
│   QDRANT_API_KEY          │ (none)               │ Cloud authentication    │
│   QDRANT_COLLECTION_NAME  │ "messages"           │ Collection name         │
│   QDRANT_SEARCH_MODE      │ "hybrid"             │ "hybrid" or "simple"    │
│                                                                            │
│   Search Defaults:                                                         │
│   ────────────────────────────────────────────────────────────────────────  │
│   Score threshold         │ 0.7                  │ Minimum similarity      │
│   Result limit            │ 20                   │ Max results returned    │
│   Days back               │ 90                   │ Time window             │
│   Batch size              │ 100                  │ Upsert/delete batching  │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Qdrant?

We needed a vector database that supports:
- High-performance similarity search
- Hybrid (dense + sparse) retrieval
- Payload filtering
- Horizontal scaling

**Qdrant provides:**
- Purpose-built for vectors (faster than pgvector at scale)
- Native hybrid search with RRF fusion
- Sophisticated filtering on payloads
- Easy to self-host, cloud option available

**Alternatives considered:**
- **pgvector** - Good for simple cases, but less performant at scale. We use it for L2.
- **Pinecone** - Excellent, but SaaS-only with vendor lock-in concerns.
- **Milvus** - Powerful but complex to operate.
- **Weaviate** - Good, but Qdrant's hybrid search is more mature.

### Why Hybrid Search?

Pure dense vector search misses exact matches. Pure keyword search misses semantic similarity.

Example: User asks about "John"
- **Dense only** might return semantically similar content about relationships but miss exact "John" mentions
- **Sparse only** finds "John" but misses related context
- **Hybrid** finds both - exact mentions AND related content

RRF fusion combines rankings without bias - no need to tune weights.

### Why Local BM25?

We could use a dedicated sparse encoder (SPLADE, etc.) but:
- **Latency** - Local BM25 is <1ms vs 50-100ms for API
- **Cost** - No API calls needed
- **Simplicity** - No additional model to deploy
- **Good enough** - BM25 handles exact matches well

For our use case (finding exact keyword matches to complement dense search), BM25 suffices.

### Why Deterministic Point IDs?

Point IDs are SHA256(messageId) → UUID. This ensures:
- Same message always gets same ID (idempotent upserts)
- No collisions across users
- Reproducible for debugging

### Why 1536 Dimensions?

OpenAI's text-embedding-3-small produces 1536-dimensional vectors. This is our dense embedding model because:
- High quality embeddings
- Good balance of precision and efficiency
- Widely used, well-understood

L3 uses MiniLM (384-dim) for cost savings. L4 uses OpenAI for precision.

## Trade-offs

### Storage Costs

1536 dimensions × 4 bytes × millions of messages = significant storage. Mitigations:
- Prune old messages (configurable retention)
- Only index substantive messages
- Qdrant's efficient storage format

### API Costs

Every indexed message requires an OpenAI embedding call (~$0.02 per 1M tokens). Mitigations:
- Batch embedding during low-traffic periods
- Skip short/trivial messages
- Cache embeddings in L2

### Consistency

Qdrant is eventually consistent. A message indexed now might not appear in search for a few milliseconds. For conversational AI, this is acceptable - we're searching historical context, not real-time data.

### Cold Start

Qdrant client connects on first use. First search might be slower (~100ms). Subsequent searches: 5-20ms.

## Source Files

- [`packages/memory/src/qdrant/client.ts`](../packages/memory/src/qdrant/client.ts) - Client factory
- [`packages/memory/src/qdrant/schema.ts`](../packages/memory/src/qdrant/schema.ts) - Collection schema
- [`packages/memory/src/qdrant/bm25.ts`](../packages/memory/src/qdrant/bm25.ts) - BM25 implementation
- [`packages/memory/src/stores/QdrantVectorStore.ts`](../packages/memory/src/stores/QdrantVectorStore.ts) - L4 store
- [`docs/QDRANT.md`](QDRANT.md) - Qdrant setup guide
