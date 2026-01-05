# Deep Memory

Deep Memory is a context enrichment system that bridges the knowledge graph (L3) with conversation history (L2).

## The Problem

When we extract entities from conversations and store them in the knowledge graph, we lose the conversational context that gave those entities meaning. An entity like "John - person" tells us nothing about *why* John matters or what was discussed.

The knowledge graph knows that John exists. It knows he's a person. It might even know he "helps with anxiety." But it doesn't know *how* we learned this. What was the conversation? What did the user actually say about John? What nuance is lost in the abstraction?

Without this context, entity retrieval feels hollow. The agent might inject "John is supportive" into its prompt, but it can't reference the actual discussion. It can't say "Last time you mentioned John, you said he helped you through a tough week." The entity is just a label, disconnected from its origin.

## The Idea

Every entity in the knowledge graph carries a `sourceHistory` - a breadcrumb trail of message IDs from when the entity was created or updated. Deep Memory follows these breadcrumbs back to L2 (PostgreSQL) to retrieve the original conversations.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Deep Memory Architecture                              │
│                                                                             │
│   L3 (Neo4j)                         L2 (PostgreSQL)                        │
│   ┌───────────────────────┐          ┌───────────────────────────────────┐  │
│   │       Entity          │          │            Messages               │  │
│   │                       │          │                                   │  │
│   │  name: "John"         │          │  msg_123: "I talked to John..."   │  │
│   │  type: person         │          │  msg_124: "John sounds helpful"   │  │
│   │  labels: [supportive] │          │  msg_456: "John reminded me..."   │  │
│   │                       │          │  msg_457: "That's great support"  │  │
│   │  sourceHistory: [     │──────────│                                   │  │
│   │    {msg: "msg_123"},  │          │                                   │  │
│   │    {msg: "msg_456"}   │          │                                   │  │
│   │  ]                    │          │                                   │  │
│   └───────────────────────┘          └───────────────────────────────────┘  │
│              │                                        │                     │
│              │         Deep Memory Service            │                     │
│              │                                        │                     │
│              └──────────────────┬─────────────────────┘                     │
│                                 │                                           │
│                                 ▼                                           │
│                    ┌────────────────────────┐                               │
│                    │    Enriched Entity     │                               │
│                    │                        │                               │
│                    │  name: "John"          │                               │
│                    │  type: person          │                               │
│                    │                        │                               │
│                    │  context: [            │                               │
│                    │    "User: I talked to  │                               │
│                    │     John about my      │                               │
│                    │     anxiety..."        │                               │
│                    │    "Assistant: John    │                               │
│                    │     sounds like a      │                               │
│                    │     supportive..."     │                               │
│                    │  ]                     │                               │
│                    └────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

When the agent retrieves entities for context, Deep Memory enriches them with the actual messages surrounding their extraction. The agent doesn't just see "John - person", it sees:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Enriched Entity Output                               │
│                                                                             │
│   John (person)                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Labels: supportive, friend                                          │   │
│   │                                                                      │   │
│   │  Context from Dec 15:                                                │   │
│   │  ┌───────────────────────────────────────────────────────────────┐  │   │
│   │  │  User: "I've been talking to John about my recovery. He's     │  │   │
│   │  │        been really understanding about everything."            │  │   │
│   │  │                                                                │  │   │
│   │  │  Assistant: "It sounds like John is someone who provides      │  │   │
│   │  │             real support for you. Having people who           │  │   │
│   │  │             understand your journey is so important."         │  │   │
│   │  └───────────────────────────────────────────────────────────────┘  │   │
│   │                                                                      │   │
│   │  Context from Dec 20:                                                │   │
│   │  ┌───────────────────────────────────────────────────────────────┐  │   │
│   │  │  User: "John reminded me to take my medication today.         │  │   │
│   │  │        He's been checking in more often lately."              │  │   │
│   │  │                                                                │  │   │
│   │  │  Assistant: "That's wonderful that John is actively           │  │   │
│   │  │             supporting your health routines."                 │  │   │
│   │  └───────────────────────────────────────────────────────────────┘  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## How It Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Deep Memory Flow                                   │
│                                                                          │
│   Phase 1: Extraction (During Conversation)                              │
│   ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│   User says: "I talked to John about my anxiety"                         │
│      │                                                                   │
│      ▼                                                                   │
│   EntityExtractor runs                                                   │
│      │                                                                   │
│      ├──▶ Extract entity: John (person)                                  │
│      │                                                                   │
│      └──▶ Store sourceHistory entry:                                     │
│           {                                                              │
│             messageId: "msg_123",                                        │
│             sessionId: "sess_abc",                                       │
│             action: "created",                                           │
│             timestamp: "2024-12-15T..."                                  │
│           }                                                              │
│                                                                          │
│   ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│   Phase 2: Retrieval (Later Conversation)                                │
│   ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│   User asks something that triggers John retrieval                       │
│      │                                                                   │
│      ▼                                                                   │
│   MemoryRetrievalService finds John entity                               │
│      │                                                                   │
│      ▼                                                                   │
│   DeepMemoryService.enrichEntity(john)                                   │
│      │                                                                   │
│      ├──▶ Read sourceHistory entries                                     │
│      │                                                                   │
│      ├──▶ Apply context strategy (latest, created_and_latest, all)       │
│      │                                                                   │
│      ├──▶ For each selected entry:                                       │
│      │       │                                                           │
│      │       └──▶ PostgresSessionStore.getMessagesAroundId()             │
│      │             (5 before, 2 after - asymmetric window)               │
│      │                                                                   │
│      └──▶ Attach conversation snippets to entity                         │
│                                                                          │
│   ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│   Phase 3: Injection (Prompt Building)                                   │
│   ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│   SystemPromptBuilder receives enriched entities                         │
│      │                                                                   │
│      ▼                                                                   │
│   Agent sees entity + original conversation context                      │
│      │                                                                   │
│      ▼                                                                   │
│   Response can reference actual discussions                              │
│   "Last time you mentioned John, you said he helped with your anxiety"  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Source History Structure

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        sourceHistory Entry                                  │
│                                                                            │
│   {                                                                        │
│     messageId: string      // The message where entity was mentioned      │
│     sessionId: string      // Conversation session ID                     │
│     action: string         // "created" | "updated" | "extracted"         │
│     timestamp: string      // ISO timestamp                               │
│   }                                                                        │
│                                                                            │
│   Action Types:                                                            │
│   ┌────────────┬──────────────────────────────────────────────────────┐   │
│   │ created    │ Entity was first extracted from this message         │   │
│   │ updated    │ Entity properties were modified based on this message│   │
│   │ extracted  │ Entity was mentioned but not modified                │   │
│   └────────────┴──────────────────────────────────────────────────────┘   │
│                                                                            │
│   Example sourceHistory array:                                             │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │  [                                                                  │   │
│   │    { messageId: "msg_001", action: "created", ... },   ← First     │   │
│   │    { messageId: "msg_045", action: "updated", ... },   ← Modified  │   │
│   │    { messageId: "msg_089", action: "extracted", ... }, ← Mentioned │   │
│   │    { messageId: "msg_123", action: "updated", ... }    ← Latest    │   │
│   │  ]                                                                  │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Context Strategies

Not all sourceHistory entries are equally valuable. Deep Memory supports different retrieval strategies:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Context Strategies                                   │
│                                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Strategy: "latest"                                                  │  │
│   │  ─────────────────────────────────────────────────────────────────   │  │
│   │                                                                      │  │
│   │  sourceHistory: [entry1, entry2, entry3, entry4]                     │  │
│   │                                           ▲                          │  │
│   │                                           │                          │  │
│   │                                      Fetch this                      │  │
│   │                                                                      │  │
│   │  Use case: Current state matters most, history is noise             │  │
│   │  Cost: 1 L2 query                                                    │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Strategy: "created_and_latest"  (DEFAULT)                           │  │
│   │  ─────────────────────────────────────────────────────────────────   │  │
│   │                                                                      │  │
│   │  sourceHistory: [entry1, entry2, entry3, entry4]                     │  │
│   │                   ▲                       ▲                          │  │
│   │                   │                       │                          │  │
│   │              Fetch this              Fetch this                      │  │
│   │              (origin)                (current)                       │  │
│   │                                                                      │  │
│   │  Use case: Know where it started AND where it is now                │  │
│   │  Cost: 2 L2 queries                                                  │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Strategy: "all"                                                     │  │
│   │  ─────────────────────────────────────────────────────────────────   │  │
│   │                                                                      │  │
│   │  sourceHistory: [entry1, entry2, entry3, entry4]                     │  │
│   │                   ▲       ▲       ▲       ▲                          │  │
│   │                   │       │       │       │                          │  │
│   │                   └───────┴───────┴───────┘                          │  │
│   │                      Fetch all of them                               │  │
│   │                                                                      │  │
│   │  Use case: Complete history of entity evolution                      │  │
│   │  Cost: N L2 queries (expensive for frequently-mentioned entities)   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Asymmetric Windows

When retrieving messages around an extraction point, Deep Memory fetches more messages *before* than *after*:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     Asymmetric Context Window                               │
│                                                                            │
│   Message timeline:                                                        │
│                                                                            │
│   ─────────────────────────────────────────────────────────────────────    │
│   msg   msg   msg   msg   msg   [TARGET]   msg   msg   msg   msg           │
│   -7    -6    -5    -4    -3      msg      +1    +2    +3    +4            │
│                                                                            │
│         └──────────────────┘               └────────┘                      │
│            5 messages BEFORE               2 messages AFTER                │
│                                                                            │
│   Why asymmetric?                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  The LEAD-UP to an extraction is usually more informative:          │  │
│   │                                                                      │  │
│   │  • Context that caused the entity mention                           │  │
│   │  • User's emotional state leading to disclosure                     │  │
│   │  • Background information establishing relevance                    │  │
│   │                                                                      │  │
│   │  The FOLLOW-UP is often just acknowledgment:                        │  │
│   │                                                                      │  │
│   │  • "That sounds supportive"                                         │  │
│   │  • "I'm glad you have John"                                         │  │
│   │  • Topic transitions to something else                              │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│   Default: 5 before, 2 after (configurable)                               │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Enrichment Process

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     DeepMemoryService.enrichEntity()                      │
│                                                                          │
│   Input: L3Entity with sourceHistory                                     │
│   Output: L3Entity with conversationContext attached                     │
│                                                                          │
│   1. Validate sourceHistory exists and has entries                       │
│      │                                                                   │
│      ├── Empty? → Return entity unchanged                                │
│      │                                                                   │
│      ▼                                                                   │
│   2. Apply context strategy                                              │
│      │                                                                   │
│      ├── latest → Select last entry                                      │
│      ├── created_and_latest → Select first + last                        │
│      └── all → Select all entries                                        │
│      │                                                                   │
│      ▼                                                                   │
│   3. For each selected entry:                                            │
│      │                                                                   │
│      ├── Call PostgresSessionStore.getMessagesAroundId()                 │
│      │     Parameters:                                                   │
│      │     • messageId: entry.messageId                                  │
│      │     • beforeCount: 5                                              │
│      │     • afterCount: 2                                               │
│      │                                                                   │
│      └── Collect returned messages                                       │
│      │                                                                   │
│      ▼                                                                   │
│   4. Format context snippets                                             │
│      │                                                                   │
│      ├── Group by source entry                                           │
│      ├── Format as readable conversation                                 │
│      └── Add timestamps for reference                                    │
│      │                                                                   │
│      ▼                                                                   │
│   5. Attach to entity                                                    │
│      │                                                                   │
│      └── entity.conversationContext = formatted snippets                 │
│                                                                          │
│   Return: Enriched entity                                                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Why This Matters

Deep Memory transforms the knowledge graph from a dry database of facts into a living memory system. Entities carry their conversational origins, allowing the agent to understand not just *what* it knows, but *how* it came to know it.

Without Deep Memory:
- "John is supportive" (bare fact, no context)
- Agent can't reference when/how this was discussed
- Responses feel generic, disconnected from history

With Deep Memory:
- "John is supportive" + original conversation
- Agent can say "When you told me about John on December 15th..."
- Responses feel personal, grounded in shared history

This is the difference between *knowing facts* and *remembering experiences*.

## Design Decisions

### Why Store Message IDs, Not Content?

We could store the actual conversation snippets in L3 alongside entities. Instead, we store only message IDs and fetch content on demand. Why?

1. **Single source of truth** - L2 (PostgreSQL) owns message content. No sync issues.
2. **Storage efficiency** - Message IDs are tiny. Content is large.
3. **Freshness** - If a message is edited/deleted in L2, we see the update.
4. **Privacy** - Content stays in the more secure L2 tier.

The trade-off: extra L2 queries during enrichment. This is acceptable because:
- Enrichment happens during retrieval, not response generation
- We batch queries where possible
- L2 is fast (10-50ms)

### Why Asymmetric Windows?

We fetch 5 messages before but only 2 after. Why not symmetric?

Empirically, the lead-up to an entity mention contains more relevant context:
- The user builds up to disclosure
- Previous messages establish the topic
- Emotional context appears before the mention

After the mention, conversation often moves on. The assistant acknowledges, then pivots. Fetching more "after" messages adds bulk without insight.

### Why created_and_latest as Default?

Three strategies exist, but we default to `created_and_latest` because:

- **Origin matters** - How an entity was first introduced often explains its significance
- **Current state matters** - The most recent mention shows current relevance
- **Middle is noise** - Intermediate mentions are often redundant

For entities mentioned 50+ times, fetching all context would be overwhelming. First + last captures the arc.

## Trade-offs

### Latency Cost

Enrichment adds L2 queries to the retrieval path:
- 1 query per `latest` entry
- 2 queries per `created_and_latest` entity
- N queries per `all` entity

We mitigate by:
- Running enrichment in parallel across entities
- Caching frequently-accessed messages
- Limiting entities enriched per request

### Storage of sourceHistory

Every entity update appends to sourceHistory. For frequently-mentioned entities (like a spouse or therapist), this array grows large.

Mitigations:
- Compress old entries (keep first + last + sampled middle)
- Limit array size with sliding window
- Prune entries older than retention period

### Context Relevance

Not all sourceHistory entries are equally relevant. A mention from 6 months ago might be stale. Deep Memory doesn't currently score relevance - it trusts recency (via strategy selection).

Future improvement: semantic similarity scoring between current query and sourceHistory entries.

## Source Files

- [`packages/memory/src/deepmemory/DeepMemoryService.ts`](../packages/memory/src/deepmemory/DeepMemoryService.ts) - Main service
- [`packages/db/src/stores/PostgresSessionStore.ts`](../packages/db/src/stores/PostgresSessionStore.ts) - `getMessagesAroundId()`
- [`packages/memory/src/retrieval/MemoryRetrievalService.ts`](../packages/memory/src/retrieval/MemoryRetrievalService.ts) - Calls enrichment
- [`packages/types/src/memory.ts`](../packages/types/src/memory.ts) - SourceEntry, ContextStrategy types
