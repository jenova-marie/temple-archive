# Qdrant Configuration Guide

This document describes how to configure Qdrant for RecoverySky's L4 vector store, including hybrid search with BM25 sparse vectors.

## Table of Contents

- [Overview](#overview)
- [Environment Variables](#environment-variables)
- [Search Modes](#search-modes)
- [Collection Configuration](#collection-configuration)
- [Payload Indexes](#payload-indexes)
- [Manual Setup (Qdrant UI)](#manual-setup-qdrant-ui)
- [Automatic Setup (Code)](#automatic-setup-code)
- [BM25 Sparse Vectors](#bm25-sparse-vectors)
- [Query Examples](#query-examples)

## Overview

RecoverySky uses Qdrant as the L4 tier for semantic similarity search across conversation history. Two search modes are supported:

| Mode | Vectors | Use Case |
|------|---------|----------|
| **hybrid** (default) | Dense + Sparse BM25 | Best retrieval - combines semantic similarity with keyword matching |
| **simple** | Dense only | Lightweight - semantic similarity only |

## Environment Variables

```bash
# Qdrant connection
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                      # Optional, for Qdrant Cloud

# Collection configuration
QDRANT_COLLECTION_NAME=messages      # Default: messages
QDRANT_SEARCH_MODE=hybrid            # Options: hybrid, simple
```

## Search Modes

### Hybrid Mode (Recommended)

Combines dense vector similarity with BM25 sparse keyword matching using Reciprocal Rank Fusion (RRF).

**Benefits:**
- Catches exact keyword matches (medication names, meeting types, triggers)
- Maintains semantic understanding
- Better recall for specific terminology

**Collection structure:**
- Named dense vector: `dense` (1536 dims, Cosine)
- Named sparse vector: `sparse` (BM25 indices/values)

### Simple Mode

Dense vector similarity only. Use when:
- You want minimal complexity
- Keyword matching isn't critical
- Running on resource-constrained systems

**Collection structure:**
- Single unnamed vector (1536 dims, Cosine)

## Collection Configuration

### Hybrid Mode

```json
{
  "vectors": {
    "dense": {
      "size": 1536,
      "distance": "Cosine",
      "on_disk": true
    }
  },
  "sparse_vectors": {
    "sparse": {
      "index": {
        "on_disk": true
      }
    }
  },
  "optimizers_config": {
    "default_segment_number": 2,
    "indexing_threshold": 20000
  }
}
```

### Simple Mode

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine",
    "on_disk": true
  },
  "optimizers_config": {
    "default_segment_number": 2,
    "indexing_threshold": 20000
  }
}
```

## Payload Indexes

These indexes are **required** for filtered search. Create them after the collection:

| Field | Type | Purpose |
|-------|------|---------|
| `userId` | keyword | Filter messages by user (required for user-scoped queries) |
| `conversationId` | keyword | Filter messages by conversation |
| `timestamp` | integer | Filter by date range (daysBack parameter) |

### Payload Schema

Each point stores this payload:

```typescript
interface MessagePayload {
  userId: string           // User identifier
  conversationId: string   // Conversation identifier
  messageId: string        // Original message ID
  role: string            // "user" or "assistant"
  content: string         // Message text
  timestamp: number       // Unix timestamp (ms)
  crisisLevel?: number    // Optional crisis level (0-10)
  entities?: string[]     // Extracted entities
  topics?: string[]       // Extracted topics
}
```

## Manual Setup (Qdrant UI)

If creating the collection manually via Qdrant's web UI:

### Step 1: Create Collection

**For Hybrid Mode:**
1. Select "Simple Hybrid Search"
2. Configure vectors:
   - Dense vector name: `dense`
   - Dimensions: `1536`
   - Metric: `Cosine`
   - Sparse vector name: `sparse`
   - Use IDF: No (BM25 weights computed client-side)

**For Simple Mode:**
1. Select "Single embedding"
2. Configure:
   - Dimensions: `1536`
   - Metric: `Cosine`

### Step 2: Create Payload Indexes

Navigate to **Payload Indexes** and add:

1. `userId` → Type: `keyword`
2. `conversationId` → Type: `keyword`
3. `timestamp` → Type: `integer`

## Automatic Setup (Code)

The collection is created automatically on first use via `ensureCollection()`:

```typescript
import { ensureCollection, createQdrantClient } from '@siri/memory'

const client = createQdrantClient({ url: 'http://localhost:6333' })

// Creates collection with correct config based on QDRANT_SEARCH_MODE
await ensureCollection(client)
```

This handles:
- Vector configuration (hybrid or simple based on env var)
- Sparse vector setup for hybrid mode
- All payload indexes

## BM25 Sparse Vectors

In hybrid mode, sparse vectors are generated locally using a lightweight BM25 implementation:

### How It Works

1. **Tokenization**: Text is split into words, lowercased, stop words removed
2. **Stemming**: Simple suffix removal (ing, ed, ly, etc.)
3. **Term Hashing**: Terms are hashed to indices (0-30000 range)
4. **BM25 Weighting**: Term frequency with saturation (k1=1.2, b=0.75)

### Resource Usage

- **Memory**: ~50MB (no ML model loaded)
- **Latency**: <1ms per document
- **Dependencies**: Zero (pure TypeScript)

### Using BM25 Directly

```typescript
import { getBM25Embedder, generateSparseVector } from '@siri/memory'

// Singleton instance
const bm25 = getBM25Embedder()
const sparse = bm25.embed("I'm struggling with cravings for alcohol")
// Returns: { indices: [1234, 5678, ...], values: [0.8, 0.6, ...] }

// Or use the function directly
const sparse2 = generateSparseVector("NA meeting tomorrow", { k1: 1.2, b: 0.75 })
```

### Configuration

```typescript
interface BM25Config {
  k1?: number          // Term frequency saturation (default: 1.2)
  b?: number           // Length normalization (default: 0.75)
  avgDocLength?: number // Average doc length estimate (default: 50)
}
```

## Query Examples

### Hybrid Search (Dense + Sparse)

```typescript
import { QdrantVectorStore } from '@siri/memory'

const store = new QdrantVectorStore(client, { searchMode: 'hybrid' })

const results = await store.search(
  queryEmbedding,  // Dense vector from OpenAI
  {
    userId: 'user-123',
    queryText: 'Suboxone medication schedule',  // Triggers BM25 sparse search
    daysBack: 90,
    limit: 20,
  },
  ctx
)
```

### Dense-Only Search (in Hybrid Collection)

```typescript
// Omit queryText to use only dense vector
const results = await store.search(
  queryEmbedding,
  {
    userId: 'user-123',
    daysBack: 90,
    limit: 20,
  },
  ctx
)
```

### Filter Examples

```typescript
// Exclude high-crisis messages
{
  excludeCrisisLevels: [8, 9, 10],
  ...
}

// Filter by topics
{
  requiredTopics: ['medication', 'relapse'],
  ...
}

// Specific conversation
{
  conversationId: 'conv-456',
  ...
}
```

## Troubleshooting

### Collection Already Exists

If you need to recreate with different settings:

```bash
# Via Qdrant API
curl -X DELETE http://localhost:6333/collections/messages
```

Then restart the application to recreate.

### Hybrid Search Not Working

1. Verify `QDRANT_SEARCH_MODE=hybrid` is set
2. Check collection has both `dense` and `sparse` vectors
3. Ensure `queryText` is provided in search options

### Slow Filtered Queries

Ensure payload indexes exist:

```bash
curl http://localhost:6333/collections/messages | jq '.result.payload_schema'
```

Should show `userId`, `conversationId`, `timestamp` with indexes.
