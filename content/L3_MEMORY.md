# L3 Memory: The Cadillac Neo4j Knowledge Graph

**Status:** Design
**Created:** 2025-12-21

## Vision

A memory system for a lifetime of personal thoughts and experiences that:

- **Remembers like a human** - associations, context, emotional salience
- **Retrieves like magic** - finds what's relevant without exact queries
- **Grows gracefully** - works with 100 memories or 100,000
- **Preserves provenance** - every memory traces back to its source conversation

---

## Schema

### Entity Node

The core unit of memory - people, places, concepts, events, things.

```
(:Entity)
├── id              (UNIQUE)   18-char BASE85 time-sortable
├── name            (INDEXED)  canonical name (lowercased)
├── displayName                original casing for display
├── aliases[]                  alternate names: ["Alex", "Alexandra", "Lexi"]
├── canonicalType   (INDEXED)  normalized: person|place|org|concept|event|thing
├── labels[]                   freeform LLM tags: ["friend", "engineer", "mentor"]
├── embedding                  384-dim vector (MiniLM, for graph-local ranking)
├── importance                 0-1 salience score
├── firstSeen                  timestamp of first extraction
├── lastSeen        (INDEXED)  timestamp of most recent mention
├── mentionCount               how often referenced
├── summary                    LLM-generated entity summary
├── sourceHistory[]            Deep Memory provenance array
└── metadata                   JSON - flexible properties
```

> **Note:** Full 1536-dim OpenAI embeddings stored in L4 (Qdrant) for primary semantic search.
> L3 embeddings are for graph-local operations only.

**Indexes:**
- Unique constraint on `id`
- Single indexes: `name`, `canonicalType`, `lastSeen`
- Composite index: `(canonicalType, lastSeen)`
- Vector index on `embedding`
- Fulltext index on `metadata`

### Observation Node

Facts and observations about entities. Separate nodes enable:
- Individual embeddings for granular semantic search
- Temporal tracking of how knowledge evolves
- Superseding outdated observations without deletion

```
(:Observation)
├── id              (UNIQUE)   18-char BASE85 time-sortable
├── content                    "Alex got promoted to senior engineer"
├── embedding                  384-dim vector (MiniLM, for graph-local ranking)
├── createdAt       (INDEXED)  extraction timestamp
├── conversationId             link to L2 conversation
├── messageId                  specific source message
├── confidence                 0-1 extraction confidence
└── supersedes                 optional: ID of observation this updates
```

> **Note:** Full 1536-dim embeddings also stored in L4 (Qdrant).

**Indexes:**
- Unique constraint on `id`
- Single index: `createdAt`
- Vector index on `embedding`
- Fulltext index on `content`

### Relationships

#### Entity → Observation

```
(:Entity)-[:HAS_OBSERVATION]->(:Observation)
```

No properties. Simple ownership link.

#### Entity → Entity

Single relationship type with semantic properties:

```
(:Entity)-[:RELATES_TO {
  type,            // semantic: "works_with", "parent_of", "located_in"
  strength,        // 0-1 relationship strength
  context,         // "met at Google in 2019"
  since,           // when relationship started (if known)
  until,           // when relationship ended (if known)
  source,          // agent|user|system
  conversationId,  // where we learned this
  messageId,       // specific source message
  createdAt        // extraction timestamp
}]->(:Entity)
```

**Why single type with property?**
- Dynamic relationship types without schema changes
- Still queryable: `WHERE r.type = "works_with"`
- Indexable: `CREATE INDEX rel_type FOR ()-[r:RELATES_TO]-() ON (r.type)`
- All relationship metadata in one place

---

## Design Decisions

### 1. Observations as First-Class Nodes

**Problem:** Facts about entities change. Alex's job, location, mood.

**Solution:** Accumulate observations rather than overwrite:

```
(Alex:Entity)
  ├──[:HAS_OBSERVATION]──>(Obs1: "Works at Google", 2023-01)
  ├──[:HAS_OBSERVATION]──>(Obs2: "Got promoted to senior", 2024-03)
  └──[:HAS_OBSERVATION]──>(Obs3: "Considering leaving Google", 2024-12)
```

**Benefits:**
- Each observation has own embedding → semantic search finds relevant facts
- Temporal queries: "What changed with Alex recently?"
- Supersedes chain: Track how understanding evolved
- No data loss: Old observations preserved

### 2. Aliases for Name Resolution

**Problem:** LLM might say "Alex", "Alexandra", or "Lexi" - all same person.

**Solution:** Store aliases on entity:

```typescript
entity: {
  name: "alexandra",
  displayName: "Alexandra Chen",
  aliases: ["alex", "lexi", "alexandra chen", "chen"]
}
```

**Matching logic:**
```cypher
MATCH (e:Entity)
WHERE e.name = $query
   OR $query IN e.aliases
RETURN e
```

### 3. Canonical Type + Freeform Labels

**Problem:** Rigid ontology loses nuance; pure freeform loses structure.

**Solution:** Both.

```typescript
entity: {
  canonicalType: "person",  // 6 fixed types for filtering/grouping
  labels: ["friend", "mentor", "engineer", "coffee lover"]  // unlimited
}
```

**Canonical Types (fixed set):**
| Type | Examples |
|------|----------|
| `person` | friends, family, colleagues, historical figures |
| `place` | cities, restaurants, parks, home |
| `organization` | companies, schools, teams |
| `concept` | ideas, beliefs, preferences, skills |
| `event` | meetings, trips, milestones |
| `thing` | objects, products, possessions |

**Labels (freeform):**
- Assigned by LLM during extraction
- Flow into entity embedding for semantic matching
- Displayed to agent for rich context
- No predefined vocabulary

### 4. Single Relationship Type

**Problem:** Dynamic Neo4j relationship types (`:KNOWS`, `:WORKS_AT`) require knowing types upfront for queries.

**Solution:** Single `:RELATES_TO` with semantic `type` property.

```cypher
-- Create relationship
MERGE (a)-[r:RELATES_TO]->(b)
ON CREATE SET r.type = "works_with", r.strength = 0.8, ...

-- Query all types (for discovery)
MATCH ()-[r:RELATES_TO]->()
RETURN DISTINCT r.type, count(*) as count
ORDER BY count DESC

-- Query specific type
MATCH (a:Entity)-[r:RELATES_TO {type: "works_with"}]->(b:Entity)
RETURN a, r, b

-- Fuzzy type matching
MATCH (a)-[r:RELATES_TO]->(b)
WHERE r.type CONTAINS "work"
RETURN a, r, b
```

### 5. Dual-Store Embeddings (L3 + L4)

We maintain embeddings in both stores for different purposes:

| Store | Model | Dimensions | Purpose |
|-------|-------|------------|---------|
| L4 (Qdrant) | OpenAI text-embedding-3-small | 1536 | Primary semantic search, max accuracy |
| L3 (Neo4j) | all-MiniLM-L6-v2 | 384 | Graph-local ranking, avoid L4 round-trip |

**What gets embedded:**

| Level | What's Embedded | L3 (384) | L4 (1536) |
|-------|-----------------|----------|-----------|
| Entity | name + labels + summary | ✓ | ✓ |
| Observation | content | ✓ | ✓ |
| (Future) Relationship | context | ✓ | - |

**Why two models?**
- **L4 (OpenAI 1536)**: Best quality for discovery - "find memories I didn't know to ask about"
- **L3 (MiniLM 384)**: Fast, local, free - "of these 10 observations, which are most relevant?"
- Different embedding spaces is fine - they serve different purposes
- MiniLM runs locally, reduces API costs for L3-only operations

**L3 use cases:**
- Graph-local ranking: When traversing relationships, score by L3 embedding similarity
- Scoped queries: "Of Alex's observations, which match this topic?"
- Avoid round-trip: Already in Neo4j, no need to call L4

**L4 use cases:**
- Primary semantic search across all memories
- Cross-entity discovery
- High-precision matching

### 6. Deep Memory Integration

Every entity and observation links back to source conversations.

**On Entity - sourceHistory array:**
```typescript
sourceHistory: [
  {
    messageId: "msg_001",
    conversationId: "conv_abc",
    action: "created",  // created | updated | extracted
    timestamp: 1734567890
  },
  {
    messageId: "msg_045",
    conversationId: "conv_abc",
    action: "updated",
    timestamp: 1734567999
  }
]
```

**On Observation - direct links:**
```typescript
observation: {
  conversationId: "conv_abc",
  messageId: "msg_045"
}
```

**Retrieval enrichment:**
1. Get entity/observation from L3
2. Extract messageId from sourceHistory or direct link
3. Query L2 for ±N messages around that messageId
4. Present original conversation context to agent

---

## Retrieval Strategy

### Multi-Channel Search

```
User: "How's Alex doing with that job situation?"
                    │
                    ▼
    ┌───────────────────────────────────┐
    │  1. SEMANTIC SEARCH (Primary)     │
    │  ─────────────────────────────    │
    │  Embed query with same model      │
    │  Search Entity.embedding          │
    │  Search Observation.embedding     │
    │  Threshold: 0.7 similarity        │
    │                                   │
    │  → Alex entity (0.85)             │
    │  → "Got promoted" obs (0.82)      │
    │  → "Considering leaving" obs (0.91)│
    └───────────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────┐
    │  2. GRAPH EXPANSION (Secondary)   │
    │  ─────────────────────────────    │
    │  From matched entities:           │
    │  - 1-hop RELATES_TO traversal     │
    │  - Filter by relevance to query   │
    │  - Include relationship context   │
    │                                   │
    │  → Sam (works_with Alex)          │
    │  → Google (employer)              │
    └───────────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────┐
    │  3. DEEP MEMORY (Enrichment)      │
    │  ─────────────────────────────    │
    │  For high-relevance matches:      │
    │  - Get sourceHistory entries      │
    │  - Fetch ±N messages from L2      │
    │  - Attach original context        │
    │                                   │
    │  → "Dec 10: Jenova said..."       │
    └───────────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────┐
    │  4. RANKING & ASSEMBLY            │
    │  ─────────────────────────────    │
    │  Score = weighted combination:    │
    │  - Semantic similarity (0.4)      │
    │  - Recency/lastSeen (0.2)         │
    │  - Importance score (0.2)         │
    │  - Mention frequency (0.1)        │
    │  - Graph distance (0.1)           │
    │                                   │
    │  Token budget: ~2000 tokens       │
    │  Format for agent consumption     │
    └───────────────────────────────────┘
                    │
                    ▼
            Agent Context
```

### Query Patterns

| Query | Strategy |
|-------|----------|
| "Tell me about Alex" | Entity lookup + all observations + graph neighbors |
| "What did I say about jobs last month?" | Semantic search observations + date filter |
| "Who works with Alex?" | Graph traversal: `(Alex)-[:RELATES_TO {type: "works_with"}]->()` |
| "When did I first mention Alex?" | `sourceHistory[0]` → fetch L2 conversation |
| "What's changed with Alex recently?" | Observations sorted by `createdAt DESC` |
| "People I haven't talked about lately" | Entities sorted by `lastSeen ASC`, type=person |
| "Everything about Google" | Entity + observations + inbound relationships |

---

## APOC Integration

With APOC Core installed, we gain:

### Map Merging for Updates
```cypher
// Merge sourceHistory without replacing
MATCH (e:Entity {id: $id})
SET e.sourceHistory = apoc.coll.union(
  coalesce(e.sourceHistory, []),
  [$newEntry]
)
```

### Collection Operations
```cypher
// Add alias if not present
MATCH (e:Entity {id: $id})
SET e.aliases = apoc.coll.union(
  coalesce(e.aliases, []),
  [$newAlias]
)
```

### Batch Operations
```cypher
// Process observations in batches
CALL apoc.periodic.iterate(
  'MATCH (o:Observation) WHERE o.embedding IS NULL RETURN o',
  'SET o.needsEmbedding = true',
  {batchSize: 1000}
)
```

---

## Migration Path

### From Current Schema

Current:
```
(:Entity {entityId, name, type, firstMentioned, lastMentioned, properties})
(from)-[:DYNAMIC_TYPE]->(to)
```

Target:
```
(:Entity {id, name, displayName, aliases, canonicalType, labels, embedding, ...})
(:Observation {id, content, embedding, ...})
(entity)-[:HAS_OBSERVATION]->(observation)
(entity)-[:RELATES_TO {type, ...}]->(entity)
```

**Migration steps:**
1. Add new fields to Entity (backwards compatible)
2. Migrate `type` → `canonicalType`, extract `labels` from properties
3. Create Observation nodes from existing entity context
4. Convert dynamic relationship types to RELATES_TO with type property
5. Backfill embeddings
6. Add Deep Memory sourceHistory (new extractions only)

---

## Implementation Phases

### Phase 1: Schema Evolution
- Add Observation nodes
- Convert to single RELATES_TO type
- Add aliases, canonicalType, labels fields
- Install APOC Core + Extended

### Phase 2: Extraction Updates
- Update EntityExtractor to emit Observations
- Implement alias detection/resolution
- Assign canonicalType + labels
- Track sourceHistory on all extractions

### Phase 3: Embeddings
- Add embeddings to Entity and Observation
- Create vector indexes
- Implement semantic search in retrieval

### Phase 4: Deep Memory
- Implement L2 context fetch for sourceHistory
- Add ±N message window retrieval
- Integrate into agent context builder

### Phase 5: Advanced Retrieval
- Multi-channel search orchestration
- Ranking/scoring algorithm
- Token budget management
- Graph expansion strategies

---

## Decisions

| Question | Decision | Notes |
|----------|----------|-------|
| Embedding dimensions | L4: 1536, L3: 384 | Best quality in L4, compact in L3 |
| Embedding models | L4: OpenAI, L3: MiniLM | Two models for different purposes |
| L4 vs L3 vectors | Both | L4 for discovery, L3 for local ranking |
| Observation retention | Keep all (for now) | Tiered retention is future work |
| Embedding timing | Batch (30s interval) | Configurable via `EMBEDDING_BATCH_INTERVAL_MS` |
| Multi-user | Single user, one database | Simplifies everything |

### Embedding Batch Job

```typescript
// Configuration
EMBEDDING_BATCH_INTERVAL_MS=30000  // 30 seconds default

// Job runs every interval
async function processEmbeddingQueue() {
  // Find items needing embeddings
  const pending = await neo4j.query(`
    MATCH (n) WHERE n:Entity OR n:Observation
    AND n.embedding IS NULL
    RETURN n ORDER BY n.createdAt DESC LIMIT 100
  `)

  // Generate L3 embeddings (MiniLM, local)
  const l3Embeddings = await miniLM.embed(pending.map(textOf))

  // Generate L4 embeddings (OpenAI, batched API call)
  const l4Embeddings = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: pending.map(textOf)
  })

  // Update both stores
  await neo4j.batchUpdate(pending, l3Embeddings)
  await qdrant.batchUpsert(pending, l4Embeddings)
}
```

**Fallback during 30s window:**
- New items without embeddings are still findable via:
  - Fulltext search on content/metadata
  - Exact name matching
  - Recent entities by timestamp
- Semantic search gracefully degrades, doesn't fail

### Future: Tiered Observation Retention

When observation volume becomes a concern:

```
Hot (< 90 days):     Full access, embedded in both L3 + L4
Warm (90d - 1yr):    Searchable, L4 only, L3 embedding removed
Cold (> 1yr):        Archived, explicit retrieval, summarization candidate
```

Not implementing now - keep all observations until scale requires it.

---

## Related Documents

- [DEEP_MEMORY.md](./DEEP_MEMORY.md) - Source conversation context retrieval
- mcp-neo4j-memory-server - Reference implementation analysis
