# Deep Memory

Deep Memory is a context enrichment system that bridges the knowledge graph (L3) with conversation history (L2).

## The Problem

When we extract entities from conversations and store them in the knowledge graph, we lose the conversational context that gave those entities meaning. An entity like "John - person" tells us nothing about *why* John matters or what was discussed.

## The Idea

Every entity in the knowledge graph carries a `sourceHistory` - a breadcrumb trail of message IDs from when the entity was created or updated. Deep Memory follows these breadcrumbs back to L2 (PostgreSQL) to retrieve the original conversations.

When the agent retrieves entities for context, Deep Memory enriches them with the actual messages surrounding their extraction. The agent doesn't just see "John - person", it sees:

```
John (person)
  Context from Dec 15:
    User: "I've been talking to John about my recovery..."
    Assistant: "It sounds like John is someone supportive..."
```

## How It Works

```
1. Entity extracted from conversation
   → Store message ID in entity.sourceHistory

2. Entity retrieved for new query
   → Deep Memory finds sourceHistory entries
   → Fetches messages around each entry from L2
   → Attaches conversation snippets to entity

3. Agent receives enriched entity
   → Sees both the entity AND the context where it was discussed
```

## Context Strategy

Not all sourceHistory entries are equally valuable. Deep Memory supports different retrieval strategies:

- **latest** - Only fetch context from the most recent mention
- **created_and_latest** - Fetch from when entity was created AND most recent
- **all** - Fetch context from all sourceHistory entries (expensive)

## Asymmetric Windows

When retrieving messages around an extraction point, Deep Memory fetches more messages *before* than *after*. The lead-up to an extraction is usually more informative than what followed.

Default: 5 messages before, 2 messages after.

## Why This Matters

Deep Memory transforms the knowledge graph from a dry database of facts into a living memory system. Entities carry their conversational origins, allowing the agent to understand not just *what* it knows, but *how* it came to know it.
