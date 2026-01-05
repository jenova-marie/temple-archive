# Phase-Shifted Memory Architecture

## Overview

The phase-shifted memory architecture moves all heavy memory retrieval work from **preflight** (before agent response) to **postflight** (after agent response). Memory prompts generated in postflight are stored in Redis L1 with per-key TTL and become available on the **next request**.

This gives the agent a 1-exchange latency to "remember" things — a negligible tradeoff for dramatically faster response times.

## The Problem

Traditional preflight memory retrieval is slow:

```
Request arrives
├── Preflight (~500-1000ms) ❌ SLOW
│   ├── Embed user query (OpenAI API)
│   ├── L4 semantic search (Qdrant)
│   ├── L3 entity lookup (Neo4j)
│   └── Haiku narrativization (Anthropic API)
├── Agent responds
└── Postflight (async)
```

The user waits 500-1000ms before the agent even starts thinking.

## The Solution

Move memory work to postflight where it doesn't block the response:

```
Request N arrives
├── Preflight (~10-20ms) ✓ FAST
│   └── Read memory_prompts from Redis L1
├── Agent responds (with memory context from previous exchange)
└── Postflight (async, fire-and-forget)
    ├── Entity extraction
    ├── Embeddings
    └── NEW: MemoryPromptGenerator
        ├── Haiku generates L4 search queries
        ├── L4 semantic search
        ├── L3 entity lookup
        ├── Haiku narrativizes results
        ├── Haiku scores TTL (0-60 min)
        └── Store in Redis L1 with TTL

Request N+1 arrives
├── Preflight: memory_prompts now available ✓
└── Agent has full memory context
```

## Benefits

1. **Preflight drops from ~500-1000ms to ~10-20ms** — just a Redis read
2. **Better query quality** — Haiku sees the full exchange (user + assistant), not just the user's message
3. **Natural topic decay** — Redis TTL automatically expires stale memories
4. **No blocking** — postflight runs fire-and-forget

## How It Works

### 1. Preflight (Read)

When a request arrives, the pipeline reads all non-expired memory prompts from Redis:

```typescript
// Pipeline.ts preflight
const promptsResult = await memoryPromptStore.getAll(userId, conversationId)
// Returns: ["User mentioned their dog Max...", "They're working on Step 4..."]
```

These are injected into the system prompt under "## Remembered Context".

### 2. Postflight (Generate)

After the agent responds, the pipeline fires off memory prompt generation:

```typescript
// Pipeline.ts postflight (fire-and-forget)
this.generateAndStoreMemoryPrompt(
  [userMessage, assistantMessage],
  userId,
  conversationId,
  ctx
).catch(err => logger.warn({ err }, 'Memory prompt generation failed'))
```

### 3. MemoryPromptGenerator

The generator performs these steps:

1. **Query Generation** — Haiku analyzes the exchange and generates 1-3 semantic search queries
2. **L4 Search** — Embed queries and search Qdrant for relevant past messages
3. **L3 Search** — Extract entity names from the exchange and look them up in Neo4j
4. **Narrativization** — Haiku combines L4/L3 results into a brief memory context
5. **TTL Scoring** — Haiku assigns a TTL based on topic relevance

### 4. TTL Scoring

Haiku scores each memory prompt 0-60 minutes based on topic weight:

| TTL | Topic Type |
|-----|------------|
| 0 min | Don't store (ephemeral greetings, tangents) |
| 5-15 min | Quick topics (simple questions) |
| 20-40 min | Substantive discussions |
| 45-60 min | Deep emotional/recovery topics |

A TTL of 0 means the memory prompt is discarded.

### 5. Redis Storage

Memory prompts are stored with individual TTLs:

```
Key: memory_prompt:{userId}:{conversationId}:{nanoid}
Value: "User mentioned their sponsor John is helping with Step 4..."
TTL: 1800 seconds (30 minutes)
```

Multiple prompts can exist simultaneously, each with its own expiration.

## Configuration

```bash
# Enable phase-shifted memory (recommended)
MEMORY_PROMPT_ENABLED=true

# Number of recent messages to analyze (1 = current exchange only)
MEMORY_PROMPT_RECENT_MESSAGES=1

# Maximum TTL in minutes (Haiku scores 0 to this value)
MEMORY_PROMPT_MAX_TTL_MINUTES=60
```

## System Prompt Integration

Memory prompts appear in the system prompt as:

```markdown
## Remembered Context

*These are things you remember from past conversations with this user:*

User mentioned their dog Max who helps them stay calm during cravings.

They're currently working on Step 4 with their sponsor John.
```

## Components

### MemoryPromptStore

Redis-based storage with per-key TTL.

```typescript
// packages/memory/src/prompts/MemoryPromptStore.ts

interface MemoryPromptStore {
  store(userId, conversationId, content, ttlMinutes): Promise<Result<string, Error>>
  getAll(userId, conversationId): Promise<Result<string[], Error>>
  deleteAll(userId, conversationId): Promise<Result<number, Error>>
  count(userId, conversationId): Promise<number>
}
```

### MemoryPromptGenerator

Generates memory prompts using Haiku + L4/L3 search.

```typescript
// packages/memory/src/prompts/MemoryPromptGenerator.ts

interface MemoryPromptResult {
  content: string      // Narrativized memory text
  ttlMinutes: number   // 0-60, scored by Haiku
  reasoning?: string   // Debug: why this TTL
  queries?: string[]   // Debug: generated queries
  l4Matches?: number   // Debug: L4 results count
  l3Entities?: number  // Debug: L3 entities count
}

interface MemoryPromptGenerator {
  generate(messages, userId, ctx): Promise<MemoryPromptResult | null>
}
```

## Legacy Mode

When `MEMORY_PROMPT_ENABLED=false`, the system falls back to legacy preflight memory:

- `MEMORY_CONTEXT_MODE` controls MemoryContextBuilder
- `QUERY_PREPROCESSING_MODE` controls query preprocessing
- `ENABLE_PREFLIGHT_EMBEDDINGS` enables query embedding

These are automatically skipped when phase-shifted memory is enabled.

## Error Handling

All errors are non-fatal:

- **Haiku failure** → Skip memory prompt for this exchange
- **L4/L3 failure** → Continue with partial results
- **Redis failure** → Log error, continue without memory prompts
- **Never blocks** the response pipeline

## Observability

The generator logs:

```json
{
  "msg": "Memory prompt generated",
  "queries": 2,
  "l4Matches": 5,
  "l3Entities": 3,
  "ttlMinutes": 30,
  "durationMs": 850
}
```

## File Locations

| File | Purpose |
|------|---------|
| `packages/memory/src/prompts/MemoryPromptStore.ts` | Redis storage |
| `packages/memory/src/prompts/MemoryPromptGenerator.ts` | Generation logic |
| `packages/pipeline/src/Pipeline.ts` | Preflight read, postflight generate |
| `packages/agent/src/systemPrompt.ts` | "Remembered Context" section |
| `apps/agent-api/src/container.ts` | Dependency wiring |
