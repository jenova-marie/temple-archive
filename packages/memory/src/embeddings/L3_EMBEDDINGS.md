# L3 Embeddings (Graph-Local Semantic Search)

L3 embeddings enable semantic search directly within the Neo4j knowledge graph, without external API calls.

## The Problem

The knowledge graph stores entities and observations, but finding relevant ones requires either:
- **Exact matching** - Limited to known names/keywords
- **OpenAI embeddings** - API calls add latency and cost

We want to find entities semantically ("things related to stress") without leaving the graph or calling external services.

## The Idea

Store compact embeddings directly on entities and observations in Neo4j. Use a local model (MiniLM) to generate 384-dimensional embeddings that can be compared within graph queries.

```
Query: "feeling anxious about work"
  → Generate MiniLM embedding locally (~50ms)
  → Neo4j: Find entities where cosine_similarity(embedding, query) > threshold
  → Return: [anxiety, work stress, coping strategies, ...]
```

## Two-Tier Embedding Strategy

| Tier | Store | Model | Dimensions | Purpose |
|------|-------|-------|------------|---------|
| L3 | Neo4j | MiniLM (local) | 384 | Fast graph-local search |
| L4 | Qdrant | OpenAI | 1536 | High-precision semantic search |

L3 embeddings are for quick, free lookups within the graph. When higher precision matters, fall back to L4 (Qdrant) with OpenAI embeddings.

## MiniLM

We use `all-MiniLM-L6-v2` via `@xenova/transformers`:
- Runs entirely in Node.js (no Python, no API)
- ~80MB model, cached after first download
- ~50ms per embedding on modern hardware
- 384 dimensions (compact, fast to compare)

## When L3 Search Happens

```
User message arrives
  → Generate query embedding (MiniLM, ~50ms)
  → Search Neo4j for semantically similar entities
  → Enrich with Deep Memory context
  → Inject into agent prompt
```

## Trade-offs

**Pros:**
- Zero API costs for graph search
- No network latency (local inference)
- Works offline

**Cons:**
- Lower precision than OpenAI embeddings
- Initial ~50ms latency per query
- Model download on first run

## Background Embedding Job

Entities and observations don't need embeddings immediately. A background job (`EmbeddingBatchJob`) periodically:
1. Finds unembedded entities/observations
2. Generates MiniLM embeddings (L3)
3. Generates OpenAI embeddings (L4)
4. Updates both stores

This keeps the request path fast while ensuring all content eventually becomes searchable.
