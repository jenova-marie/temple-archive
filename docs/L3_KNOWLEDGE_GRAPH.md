# L3 Knowledge Graph (Neo4j "Cadillac")

The L3 tier stores semantic knowledge as a graph of entities, relationships, and observations. We call it "The Cadillac" because it's the luxury tier - rich, structured, relationship-aware memory that transforms Siri from a chatbot into a companion who understands your world.

## The Problem

Conversation history alone isn't enough. You can store every message ever exchanged, but when someone mentions "John," how does the agent know which John? The therapist? The friend? The coworker? And what does the agent actually *know* about John beyond the raw text?

Traditional approaches have two options:

1. **Keyword matching** - Search history for "John." Returns everything containing "John," most of it irrelevant.
2. **Vector similarity** - Find messages semantically similar to the query. Better, but still returns chunks of text without structure.

Neither approach captures *understanding*. Neither knows that John is a person, that he's supportive, that he's connected to therapy, that anxiety comes up when you talk about work.

## The Idea

Model knowledge the way humans think about it - as a graph of entities and their relationships.

When you talk about your life, you're describing a world of interconnected things: people, places, concepts, events. John is a *person* who *supports* your *recovery*. Work is a *place* that *triggers* your *anxiety*. Therapy is a *concept* that *helps with* anxiety.

This isn't just text - it's structured knowledge. A graph.

By storing entities as nodes and relationships as edges, we can:

- **Find entities by name** (exact or alias match)
- **Find entities by meaning** (semantic similarity via embeddings)
- **Traverse relationships** (who helps with what? what triggers what?)
- **Attach observations** (facts about entities that can themselves be searched)

The graph grows as conversations happen. Every mention of John enriches his node. Every new relationship adds an edge. The agent's understanding of your world deepens over time.

## Why "The Cadillac"

We call L3 "The Cadillac" for several reasons:

1. **Rich schema** - Unlike L4's simple vector points, L3 entities have types, aliases, labels, relationships, and observations.
2. **Relationship-aware** - Graph traversal enables queries that vector search can't answer ("who helps me with anxiety?").
3. **Lifetime persistence** - This is meant to be *permanent* memory. Not a cache, not a summary - the actual knowledge.
4. **Expensive to build** - Entity extraction requires LLM calls. Embeddings require inference. Graph queries require Neo4j. It's the premium tier.

The investment pays off in conversational quality. An agent with L3 knowledge doesn't just remember - it *understands*.

## Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Neo4j Graph                                    │
│                                                                             │
│   ┌──────────────┐          RELATES_TO           ┌──────────────┐          │
│   │   Entity     │ ───────────────────────────── │   Entity     │          │
│   │              │         (type, since)         │              │          │
│   │  "John"      │                               │  "Therapy"   │          │
│   │  (person)    │                               │  (concept)   │          │
│   └──────┬───────┘                               └──────────────┘          │
│          │                                                                  │
│          │ ABOUT                                                           │
│          │                                                                  │
│          ▼                                                                  │
│   ┌──────────────┐                                                         │
│   │ Observation  │                                                         │
│   │              │                                                         │
│   │ "John is     │                                                         │
│   │  supportive" │                                                         │
│   └──────────────┘                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Node Types

### Entity

The core node type. Represents people, places, organizations, concepts, events, or things.

```
┌─────────────────────────────────────────┐
│              Entity Node                │
├─────────────────────────────────────────┤
│ id: string           (UUID)             │
│ userId: string       (owner)            │
│ name: string         (canonical name)   │
│ displayName: string  (pretty name)      │
│ canonicalType: enum  (see below)        │
│ aliases: string[]    (alternate names)  │
│ labels: string[]     (semantic tags)    │
│ embedding: float[]   (384-dim MiniLM)   │
│ confidence: float    (0.0-1.0)          │
│ sourceHistory: []    (Deep Memory refs) │
│ createdAt: datetime                     │
│ updatedAt: datetime                     │
└─────────────────────────────────────────┘
```

**Canonical Types (fixed set):**
```
┌────────────┬────────────────────────────────────┐
│ Type       │ Examples                           │
├────────────┼────────────────────────────────────┤
│ person     │ John, therapist, friend            │
│ place      │ home, office, park                 │
│ org        │ work, AA group, hospital           │
│ concept    │ anxiety, recovery, stress          │
│ event      │ relapse, birthday, meeting         │
│ thing      │ medication, journal, pet           │
└────────────┴────────────────────────────────────┘
```

### Observation

First-class nodes containing facts about entities. Enables semantic search on observations themselves.

```
┌─────────────────────────────────────────┐
│           Observation Node              │
├─────────────────────────────────────────┤
│ id: string           (UUID)             │
│ content: string      (the observation)  │
│ embedding: float[]   (384-dim MiniLM)   │
│ confidence: float    (0.0-1.0)          │
│ timestamp: datetime                     │
│ sourceHistory: []    (Deep Memory refs) │
└─────────────────────────────────────────┘
```

## Relationship Types

### RELATES_TO

Generic relationship between entities with typed metadata.

```
(Entity) ─[RELATES_TO]─> (Entity)
           │
           ├─ type: string     ("supports", "triggers", "helps_with")
           ├─ since: datetime  (when relationship was established)
           └─ confidence: float
```

### ABOUT

Links observations to their subject entity.

```
(Observation) ─[ABOUT]─> (Entity)
```

## Example Graph

```
                    ┌───────────────┐
                    │    Therapy    │
                    │   (concept)   │
                    └───────┬───────┘
                            │
                   RELATES_TO (helps_with)
                            │
                            ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│     John      │───▶│    Anxiety    │◀───│    Work       │
│   (person)    │    │   (concept)   │    │   (place)     │
└───────┬───────┘    └───────────────┘    └───────────────┘
        │                    ▲
        │ ABOUT              │ ABOUT
        ▼                    │
┌───────────────┐    ┌───────────────┐
│ "John is very │    │ "Anxiety gets │
│  supportive"  │    │  worse at     │
│               │    │  work"        │
└───────────────┘    └───────────────┘
   Observation          Observation
```

## Querying

### By Name (exact + aliases)

```cypher
MATCH (e:Entity {userId: $userId})
WHERE e.name = $name OR $name IN e.aliases
RETURN e
```

### By Semantic Similarity (MiniLM)

```cypher
MATCH (e:Entity {userId: $userId})
WHERE e.embedding IS NOT NULL
WITH e, gds.similarity.cosine(e.embedding, $queryEmbedding) AS score
WHERE score > 0.7
RETURN e, score
ORDER BY score DESC
LIMIT 10
```

### Traversing Relationships

```cypher
MATCH (e:Entity {name: "John"})-[r:RELATES_TO]->(related)
WHERE e.userId = $userId
RETURN related, r.type
```

### With Observations

```cypher
MATCH (e:Entity {name: "John"})<-[:ABOUT]-(obs:Observation)
WHERE e.userId = $userId
RETURN e, collect(obs) as observations
```

## Deep Memory Integration

Entities and observations carry `sourceHistory` - references back to the L2 messages where they were extracted:

```
┌────────────────────────────────────────────────────────────┐
│                      Entity                                │
│                                                            │
│  sourceHistory: [                                          │
│    { messageId: "msg_123", action: "created" },            │
│    { messageId: "msg_456", action: "updated" }             │
│  ]                                                         │
└────────────────────────────────────────────────────────────┘
                              │
                              │ Deep Memory follows these refs
                              ▼
┌────────────────────────────────────────────────────────────┐
│                   L2 PostgreSQL                            │
│                                                            │
│  msg_123: "I've been talking to John about my recovery..." │
│  msg_456: "John reminded me to take my medication..."      │
└────────────────────────────────────────────────────────────┘
```

**See also:** [DEEPMEMORY.md](DEEPMEMORY.md)

## Embeddings Strategy

L3 uses **MiniLM** (384-dim, local) for graph-local semantic search:

```
┌────────────────────┐        ┌────────────────────┐
│  L3: Neo4j         │        │  L4: Qdrant        │
│                    │        │                    │
│  MiniLM (384-dim)  │        │  OpenAI (1536-dim) │
│  Local inference   │        │  API calls         │
│  ~50ms/embedding   │        │  Higher precision  │
│  Free              │        │  Costs money       │
└────────────────────┘        └────────────────────┘
```

**See also:** [L3_EMBEDDINGS.md](../packages/memory/src/embeddings/L3_EMBEDDINGS.md)

## Design Decisions

### Why Neo4j?

Graph databases excel at relationship queries. Finding "all people who help with anxiety" is a single traversal in Neo4j but a complex join in SQL. As the graph grows, these queries remain fast because graph traversal is O(relationships) not O(nodes).

Alternatives considered:
- **PostgreSQL with recursive CTEs** - Possible but awkward. Graph queries in SQL are verbose and often slower.
- **In-memory graph** - Faster but doesn't persist. We need lifetime memory.
- **Property graph in Qdrant** - Qdrant supports payload filtering but not true graph traversal.

### Why Observations as Separate Nodes?

We could store observations as properties on entities (an array of strings). Instead, we make them first-class nodes because:

1. **Searchable** - Observations have their own embeddings. We can find "supportive behavior" without knowing which entity.
2. **Attributable** - Each observation has its own sourceHistory. We know exactly when and where we learned it.
3. **Evolving** - Observations can be updated, invalidated, or contradicted without touching the entity.

The trade-off is more nodes and relationships, but the query flexibility is worth it.

### Why Six Canonical Types?

The type system (person, place, org, concept, event, thing) is intentionally constrained. Open-ended typing leads to inconsistency ("person" vs "human" vs "individual"). Fixed types ensure:

- Consistent queries ("find all people")
- Predictable behavior
- Cleaner UI presentation

The `labels` array provides open-ended tagging for nuance ("supportive", "stressful") without polluting the type system.

### Why MiniLM Instead of OpenAI?

L3 embeddings use MiniLM (384-dim, local) instead of OpenAI (1536-dim, API):

- **Zero cost** - No API calls means unlimited embeddings.
- **No latency** - Local inference avoids network round trips.
- **Privacy** - Entity data never leaves the server.
- **Good enough** - For graph-local search (finding related entities), 384 dimensions suffices. L4 handles precision-critical search.

## Trade-offs

### Extraction Cost

Every entity requires an LLM call to extract. For high-volume conversations, this adds up. We mitigate by:

- Only extracting from substantive messages
- Running extraction asynchronously
- Using Haiku (cheap, fast) for extraction

### Query Complexity

Neo4j's Cypher query language is powerful but different from SQL. There's a learning curve, and complex traversals can be hard to optimize.

### Eventual Consistency

Entities extracted from a message aren't immediately available for retrieval. Background embedding generation adds latency. For conversational AI, this is acceptable - the next message will have updated context.

## Source Files

- [`packages/memory/src/stores/Neo4jKnowledgeStore.ts`](../packages/memory/src/stores/Neo4jKnowledgeStore.ts) - Main store implementation
- [`packages/types/src/memory.ts`](../packages/types/src/memory.ts) - L3Entity, L3Observation types
- [`packages/memory/src/extraction/EntityExtractor.ts`](../packages/memory/src/extraction/EntityExtractor.ts) - Entity extraction
