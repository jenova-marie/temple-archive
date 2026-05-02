# Entity Extraction

How Siri extracts entities, observations, and relationships from conversations.

## The Problem

The knowledge graph (L3) needs data. But where does that data come from?

We can't ask users to manually catalog their relationships, categorize their concerns, or document their lives. That would be exhausting and unnatural. People don't talk to friends by filling out forms.

We need to automatically extract structured knowledge from unstructured conversation - to hear "I talked to John about my anxiety" and understand that John is a person, anxiety is a concept, and there's a relationship between them.

This is fundamentally hard. Natural language is ambiguous. "John" could be anyone. "Talked to" could mean many things. "Anxiety" could be the clinical condition, a casual feeling, or a band name. Traditional NLP approaches (named entity recognition, dependency parsing) produce noisy results that require extensive post-processing.

## The Idea

Use an LLM to do what LLMs do best: understand language in context.

Instead of brittle regex patterns or statistical models trained on generic datasets, we prompt Claude Haiku with the actual conversation and ask it to identify:

1. **Entities** - The nouns that matter. People, places, concepts, events, things.
2. **Observations** - Facts about those entities. "John is supportive." "Work is stressful."
3. **Relationships** - How entities connect. John helps with anxiety. Work triggers stress.

The LLM brings world knowledge and contextual understanding. It knows "John" is probably a person (not a toilet). It understands that "talked to" implies a relationship. It can infer that "my anxiety" refers to a mental health concept.

We guide the extraction with a structured prompt that requests JSON output, making parsing trivial. We provide existing entities as context to prevent duplicates. We run extraction asynchronously so it doesn't block the response.

## Why This Matters

Without entity extraction, L3 would be empty. The knowledge graph would have no nodes, no relationships, no observations. The agent would have conversation history but no *understanding* of what that history means.

Entity extraction is the bridge between raw conversation and semantic memory. It's how Siri learns that John exists, that you care about him, that he's connected to your recovery journey.

Over time, this builds a rich model of the user's world - not through explicit data entry, but through natural conversation. The graph grows organically as the relationship deepens.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           User Message                                      │
│                                                                             │
│  "I talked to John about my anxiety. He's been really supportive           │
│   since I started therapy last month."                                      │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EntityExtractor                                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Claude Haiku (LLM)                               │   │
│  │                                                                      │   │
│  │  Prompt: "Extract entities, observations, and relationships..."     │   │
│  │                                                                      │   │
│  │  Output (JSON):                                                      │   │
│  │  {                                                                   │   │
│  │    "entities": [...],                                                │   │
│  │    "observations": [...],                                            │   │
│  │    "relationships": [...]                                            │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Extracted Data                                       │
│                                                                             │
│  Entities:                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                                  │
│  │  John    │  │ Anxiety  │  │ Therapy  │                                  │
│  │ (person) │  │(concept) │  │(concept) │                                  │
│  └──────────┘  └──────────┘  └──────────┘                                  │
│                                                                             │
│  Observations:                                                              │
│  • "John is really supportive" (about: John)                               │
│  • "Started therapy last month" (about: Therapy)                           │
│                                                                             │
│  Relationships:                                                             │
│  • John ─[helps_with]─> Anxiety                                            │
│  • Therapy ─[addresses]─> Anxiety                                          │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Neo4j (L3)                                          │
│                                                                             │
│  Stored with sourceHistory pointing back to this message                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Extraction Pipeline

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Extraction Flow                                    │
│                                                                          │
│   1. Message arrives                                                     │
│      │                                                                   │
│      ▼                                                                   │
│   2. Check extraction threshold                                          │
│      │  (skip if message too short or trivial)                          │
│      │                                                                   │
│      ▼                                                                   │
│   3. Build extraction prompt                                             │
│      │  ┌─────────────────────────────────────────────┐                 │
│      │  │ Include:                                     │                 │
│      │  │ • Current message                            │                 │
│      │  │ • Recent conversation context                │                 │
│      │  │ • Existing entities (for deduplication)      │                 │
│      │  └─────────────────────────────────────────────┘                 │
│      │                                                                   │
│      ▼                                                                   │
│   4. Call Claude Haiku                                                   │
│      │  (fast, cheap LLM call)                                          │
│      │                                                                   │
│      ▼                                                                   │
│   5. Parse JSON response                                                 │
│      │                                                                   │
│      ▼                                                                   │
│   6. Name resolution                                                     │
│      │  ┌─────────────────────────────────────────────┐                 │
│      │  │ "John" in relationship →                     │                 │
│      │  │    resolve to existing "John Smith" entity   │                 │
│      │  └─────────────────────────────────────────────┘                 │
│      │                                                                   │
│      ▼                                                                   │
│   7. Persist to Neo4j                                                    │
│      │  • Upsert entities (merge by name)                               │
│      │  • Create observations                                           │
│      │  • Create relationships                                          │
│      │                                                                   │
│      ▼                                                                   │
│   8. Queue for background embedding                                      │
│      (MiniLM 384-dim generated async)                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Name Resolution

The LLM might use abbreviated names. Name resolution maps them to stored entities.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Name Resolution                                     │
│                                                                             │
│  Stored Entity:                                                             │
│  ┌─────────────────────────────────────────┐                               │
│  │  name: "john smith"                      │                               │
│  │  displayName: "John Smith"               │                               │
│  │  aliases: ["john", "johnny", "j"]        │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                             │
│  LLM Output:                                                                │
│  ┌─────────────────────────────────────────┐                               │
│  │  relationship: {                         │                               │
│  │    from: "John",  ◄─── partial name      │                               │
│  │    to: "Anxiety",                        │                               │
│  │    type: "helps_with"                    │                               │
│  │  }                                       │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                             │
│  Resolution:                                                                │
│  ┌─────────────────────────────────────────┐                               │
│  │  "John" (lowercased)                     │                               │
│  │     │                                    │                               │
│  │     ▼ check name map                     │                               │
│  │  { "john": "john smith",                 │                               │
│  │    "johnny": "john smith",               │                               │
│  │    "john smith": "john smith" }          │                               │
│  │     │                                    │                               │
│  │     ▼ resolved                           │                               │
│  │  "john smith" (canonical)                │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Entity Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Extracted Entity                                      │
│                                                                             │
│  {                                                                          │
│    name: "john smith",           // Canonical lowercase name                │
│    displayName: "John Smith",    // Pretty display name                     │
│    canonicalType: "person",      // person|place|org|concept|event|thing    │
│    aliases: ["john", "johnny"],  // Alternate names                         │
│    labels: ["supportive", "friend"], // Semantic tags                       │
│    confidence: 0.9,              // Extraction confidence                   │
│    sourceHistory: [              // Deep Memory references                  │
│      {                                                                      │
│        messageId: "msg_abc123",                                             │
│        sessionId: "sess_xyz",                                               │
│        action: "created",        // created|updated|extracted               │
│        timestamp: "2024-01-15T..."                                          │
│      }                                                                      │
│    ]                                                                        │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Observation Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Extracted Observation                                 │
│                                                                             │
│  {                                                                          │
│    content: "John is really supportive",                                    │
│    subjectEntity: "john smith",  // Who this is about                       │
│    confidence: 0.85,                                                        │
│    timestamp: "2024-01-15T...",                                             │
│    sourceHistory: [...]          // Same structure as entities              │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Deduplication

Entities are deduplicated by normalized name:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Deduplication                                       │
│                                                                             │
│  Incoming: "John Smith" (person)                                            │
│                                                                             │
│  1. Normalize: "john smith"                                                 │
│                                                                             │
│  2. Check existing entities:                                                │
│     ┌───────────────────────────────────────────┐                          │
│     │  MATCH (e:Entity)                          │                          │
│     │  WHERE e.userId = $userId                  │                          │
│     │  AND (e.name = "john smith"                │                          │
│     │       OR "john smith" IN e.aliases)        │                          │
│     └───────────────────────────────────────────┘                          │
│                                                                             │
│  3a. Found → MERGE (update labels, add to sourceHistory)                    │
│  3b. Not found → CREATE new entity                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Background Embedding

Embeddings are generated asynchronously to keep extraction fast:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Embedding Generation                                 │
│                                                                          │
│   Entity created/updated                                                 │
│      │                                                                   │
│      │  (no embedding yet)                                               │
│      │                                                                   │
│      ▼                                                                   │
│   EmbeddingBatchJob (runs periodically)                                  │
│      │                                                                   │
│      ├──▶ Find unembedded entities/observations                         │
│      │                                                                   │
│      ├──▶ Generate MiniLM embedding (384-dim, local)                     │
│      │                                                                   │
│      ├──▶ Generate OpenAI embedding (1536-dim, for L4)                   │
│      │                                                                   │
│      └──▶ Update entity with embeddings                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Claude Haiku?

We need an LLM for extraction, but which one?

- **Claude Haiku** - Fast (~300ms), cheap (~$0.25/1M input tokens), good enough for extraction.
- **Claude Sonnet** - Better quality but slower and more expensive. Overkill for extraction.
- **GPT-4o-mini** - Comparable to Haiku. We use Claude for consistency across the system.
- **Local models** - Would eliminate API costs but extraction quality suffers.

Haiku hits the sweet spot: fast enough to run on every substantive message, cheap enough to not worry about volume, smart enough to extract meaningful entities.

### Why Async Extraction?

Extraction runs after the response is sent, not before. This is intentional:

1. **Latency** - Users don't wait for extraction. Response time stays fast.
2. **Failure isolation** - Extraction failures don't break conversations.
3. **Batching** - We can batch multiple messages for more efficient API use.

The trade-off: entities aren't available until the next message. This is acceptable because the agent rarely needs to reference an entity mentioned *in the same message*.

### Why Name Resolution?

LLMs are inconsistent with names. In one response it might say "John", in another "John Smith", in another "your friend John." Without resolution, we'd create three separate entities.

Name resolution maps variations to canonical names using:
- Exact matches on stored names
- Alias lookups (configurable per entity)
- Case-insensitive comparison

This ensures "John" and "john" and "JOHN" all resolve to the same entity.

### Why Confidence Scores?

Not all extractions are equal. "John is a person" is high confidence. "John might be stressed" is lower. Confidence scores let us:

- Filter low-confidence extractions
- Weight entities in retrieval
- Track extraction quality over time

We don't discard low-confidence entities - sometimes uncertain knowledge is still valuable - but we treat them differently.

## Trade-offs

### Cost vs. Coverage

We could extract from every message, but that's expensive. Instead, we skip:
- Very short messages ("ok", "thanks")
- Highly repetitive content
- System messages

This misses some entities but dramatically reduces API costs.

### Quality vs. Speed

Haiku makes mistakes. It might miss entities, create duplicates, or misclassify types. We accept this because:
- Speed matters more than perfection
- Duplicate entities merge on next mention
- Type misclassification is rare and usually harmless

For production systems, periodic human review of the knowledge graph can catch systematic errors.

### Synchronous vs. Async

We chose async, but synchronous extraction would enable:
- Same-message entity references
- Immediate knowledge graph updates
- Simpler error handling

The latency cost was deemed too high. 300ms per message adds up in a flowing conversation.

## Source Files

- [`packages/memory/src/extraction/EntityExtractor.ts`](../packages/memory/src/extraction/EntityExtractor.ts) - Main extractor
- [`packages/memory/src/jobs/EmbeddingBatchJob.ts`](../packages/memory/src/jobs/EmbeddingBatchJob.ts) - Background embeddings
- [`packages/memory/src/stores/Neo4jKnowledgeStore.ts`](../packages/memory/src/stores/Neo4jKnowledgeStore.ts) - Persistence
