# Context Compaction System

## Overview

The Context Compaction System automatically summarizes older messages in long-running conversations to reduce context size while preserving semantic information. It runs **fire-and-forget** after memory retrieval, executing in parallel with agent processing to avoid impacting response latency.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CONTEXT COMPACTION SYSTEM                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         PIPELINE INTEGRATION                          │  │
│  │                                                                       │  │
│  │    Memory Retrieval                                                   │  │
│  │         │                                                             │  │
│  │         ▼                                                             │  │
│  │  ┌─────────────────┐                                                  │  │
│  │  │ messages loaded │                                                  │  │
│  │  │  (from L1/L2)   │                                                  │  │
│  │  └────────┬────────┘                                                  │  │
│  │           │                                                           │  │
│  │           ├────────────────────────────┐                              │  │
│  │           │                            │                              │  │
│  │           ▼                            ▼                              │  │
│  │  ┌─────────────────┐        ┌─────────────────────┐                   │  │
│  │  │ Agent Processing│        │ Context Compaction  │                   │  │
│  │  │   (blocking)    │        │  (fire-and-forget)  │                   │  │
│  │  └────────┬────────┘        └─────────────────────┘                   │  │
│  │           │                                                           │  │
│  │           ▼                                                           │  │
│  │     Response to User                                                  │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Key Properties:                                                            │
│  • Non-blocking: Never delays user response                                 │
│  • Parallel: Runs alongside agent processing                                │
│  • Eventual: Effects visible on next request                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Why Compaction?

Long conversations accumulate messages that consume context window space. Without compaction:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTEXT GROWTH PROBLEM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Exchange 1:   [user] [assistant]                          ~500 tokens      │
│  Exchange 5:   [u][a][u][a][u][a][u][a][u][a]              ~2,500 tokens    │
│  Exchange 15:  [u][a][u][a]...[u][a]                       ~7,500 tokens    │
│  Exchange 30:  [u][a][u][a]...[u][a][u][a]                 ~15,000 tokens   │
│                                                                             │
│  Problems:                                                                  │
│  • Increased latency (more tokens to process)                               │
│  • Higher cost (pay per token)                                              │
│  • Risk of hitting context limits                                           │
│  • Older context may be less relevant                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Compaction solves this by summarizing older messages:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WITH COMPACTION                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Before (30 messages):                                                      │
│  [m1][m2][m3]...[m15][m16][m17]...[m30]                    ~15,000 tokens   │
│       │                  │                                                  │
│       └──────┬───────────┘                                                  │
│              │ oldest 15                                                    │
│              ▼                                                              │
│  After (16 messages):                                                       │
│  [SUMMARY][m16][m17][m18]...[m30]                          ~8,000 tokens    │
│                                                                             │
│  Benefits:                                                                  │
│  • ~50% token reduction per compaction                                      │
│  • Preserves key facts, emotions, decisions                                 │
│  • Recent context remains intact                                            │
│  • Supports arbitrarily long conversations                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture

### Component Location

```
packages/memory/src/compaction/
├── types.ts              # CompactionConfig, IContextCompactor, errors
├── ContextCompactor.ts   # Main implementation + StubContextCompactor
└── index.ts              # Exports
```

### Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPONENT INTEGRATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │  apps/api/       │         │  packages/       │                          │
│  │  container.ts    │────────▶│  pipeline/       │                          │
│  │                  │         │  Pipeline.ts     │                          │
│  │  Initializes:    │         │                  │                          │
│  │  • ContextCompactor       │  Calls:          │                          │
│  │  • or StubContextCompactor│  • maybeCompact()│                          │
│  └──────────────────┘         └────────┬─────────┘                          │
│                                        │                                    │
│                                        ▼                                    │
│                               ┌──────────────────┐                          │
│                               │  packages/       │                          │
│                               │  memory/         │                          │
│                               │  compaction/     │                          │
│                               │                  │                          │
│                               │  Uses:           │                          │
│                               │  • Redis L1      │                          │
│                               │  • Anthropic SDK │                          │
│                               └──────────────────┘                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Algorithm

### Compaction Decision Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMPACTION DECISION ALGORITHM                        │
└─────────────────────────────────────────────────────────────────────────────┘

                    maybeCompact(conversationId, messages, ctx)
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │ config.enabled?     │
                          └──────────┬──────────┘
                                     │
                        ┌────────────┴────────────┐
                       NO                        YES
                        │                         │
                        ▼                         ▼
                     RETURN              ┌─────────────────────┐
                                         │ messages.length >   │
                                         │ config.threshold?   │
                                         └──────────┬──────────┘
                                                    │
                                       ┌────────────┴────────────┐
                                      NO                        YES
                                       │                         │
                                       ▼                         ▼
                                    RETURN              ┌─────────────────────┐
                                                        │ Any message has     │
                                                        │ type: 'summary'?    │
                                                        └──────────┬──────────┘
                                                                   │
                                                      ┌────────────┴────────────┐
                                                     YES                       NO
                                                      │                         │
                                                      ▼                         ▼
                                                   RETURN            ┌─────────────────────┐
                                                                     │ runCompaction()     │
                                                                     │ (fire-and-forget)   │
                                                                     └─────────────────────┘
```

### Compaction Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPACTION EXECUTION FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

                         runCompaction(conversationId, messages, ctx)
                                           │
                                           ▼
                              ┌───────────────────────────┐
                              │  1. SLICE OLDEST MESSAGES │
                              │                           │
                              │  toCompact = messages     │
                              │    .slice(0, batchSize)   │
                              │                           │
                              │  Example: 15 oldest msgs  │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  2. GENERATE SUMMARY      │
                              │                           │
                              │  Call Haiku with prompt:  │
                              │  "Summarize these msgs,   │
                              │   preserve key facts..."  │
                              │                           │
                              │  Returns ~200 word summary│
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  3. CREATE SUMMARY MSG    │
                              │                           │
                              │  {                        │
                              │    id: "summary_...",     │
                              │    role: "assistant",     │
                              │    content: "[Earlier...] │
                              │      {summary text}",     │
                              │    timestamp: FIRST_MSG,  │
                              │    metadata: {            │
                              │      type: "summary",     │
                              │      originalCount: 15    │
                              │    }                      │
                              │  }                        │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  4. ATOMIC REDIS UPDATE   │
                              │                           │
                              │  pipeline.zremrangebyscore│
                              │    (remove old messages)  │
                              │  pipeline.zadd            │
                              │    (add summary message)  │
                              │  pipeline.hincrby         │
                              │    (update message count) │
                              │  pipeline.exec()          │
                              └───────────────────────────┘
```

---

## Redis Storage Model

### Before Compaction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REDIS: session:{conversationId}:messages                 │
│                              (Sorted Set)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Score (timestamp)     │  Value (JSON)                                      │
│  ──────────────────────┼──────────────────────────────────────────────────  │
│  1702500000001         │  {"id":"m1","role":"user","content":"Hi..."}       │
│  1702500000002         │  {"id":"m2","role":"assistant","content":"..."}    │
│  1702500000003         │  {"id":"m3","role":"user","content":"..."}         │
│  ...                   │  ...                                               │
│  1702500000030         │  {"id":"m30","role":"assistant","content":"..."}   │
│                                                                             │
│  Total: 30 messages                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### After Compaction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REDIS: session:{conversationId}:messages                 │
│                              (Sorted Set)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Score (timestamp)     │  Value (JSON)                                      │
│  ──────────────────────┼──────────────────────────────────────────────────  │
│  1702500000001         │  {"id":"summary_...","role":"assistant",           │
│                        │   "content":"[Earlier in this conversation]...",  │
│                        │   "metadata":{"type":"summary","originalCount":15}}│
│  1702500000016         │  {"id":"m16","role":"user","content":"..."}        │
│  1702500000017         │  {"id":"m17","role":"assistant","content":"..."}   │
│  ...                   │  ...                                               │
│  1702500000030         │  {"id":"m30","role":"assistant","content":"..."}   │
│                                                                             │
│  Total: 16 messages (1 summary + 15 recent)                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Timestamp Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TIMESTAMP ASSIGNMENT                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  The summary message uses the FIRST compacted message's timestamp.          │
│  This ensures proper chronological ordering in the sorted set.              │
│                                                                             │
│  Timeline:                                                                  │
│                                                                             │
│  [m1]──[m2]──[m3]──...──[m15]──[m16]──[m17]──...──[m30]                     │
│   │                       │     │                                           │
│   │     compacted         │     │     preserved                             │
│   │◄─────────────────────►│     │◄──────────────────►                       │
│   │                       │     │                                           │
│   ▼                             │                                           │
│  [SUMMARY]─────────────────────[m16]──[m17]──...──[m30]                     │
│   │                             │                                           │
│   │                             │                                           │
│   └── timestamp = m1.timestamp  │                                           │
│       (preserves position)      │                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary Message Format

```typescript
interface SummaryMessage {
  id: string              // "summary_{timestamp}_{random}"
  conversationId: string  // Same as original messages
  userId: string          // Same as original messages
  role: 'assistant'       // Always assistant role
  content: string         // "[Earlier in this conversation] {summary text}"
  timestamp: number       // FIRST compacted message's timestamp
  metadata: {
    type: 'summary'           // Marker for summary messages
    originalMessageIds: string[]  // IDs of compacted messages
    compactedAt: number       // When compaction occurred
    originalCount: number     // How many messages were compacted
  }
}
```

### Example Summary Content

```
[Earlier in this conversation] The user shared they've been sober for 23 days
and mentioned feeling anxious about an upcoming family gathering. They
discussed their triggers (social situations, family stress) and we explored
coping strategies including deep breathing and calling their sponsor. They
committed to attending their AA meeting before the event and felt more
confident about handling potential challenges.
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPACTION_ENABLED` | `true` | Enable/disable compaction |
| `COMPACTION_THRESHOLD` | `30` | Message count to trigger compaction |
| `COMPACTION_BATCH_SIZE` | `15` | Messages to compact per batch |
| `COMPACTION_MODEL` | `claude-3-haiku-20240307` | LLM for summarization |
| `COMPACTION_MAX_TOKENS` | `512` | Max tokens in summary |
| `COMPACTION_TIMEOUT_MS` | `15000` | LLM call timeout |

### Prerequisites

Compaction requires:
- `REDIS_URL` - For L1 cache operations
- `ANTHROPIC_API_KEY` - For Haiku summarization

If either is missing, the `StubContextCompactor` is used (no-op).

### Configuration Interface

```typescript
interface CompactionConfig {
  enabled: boolean     // Feature flag
  threshold: number    // Message count trigger
  batchSize: number    // Messages per batch
  model: string        // Haiku model ID
  maxTokens: number    // Summary max length
  timeoutMs: number    // LLM timeout
}
```

---

## Error Handling

### Design Philosophy

Compaction uses **silent failure** - errors are logged but never propagate to the user. The original messages remain unchanged if compaction fails.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ERROR HANDLING STRATEGY                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐    │
│  │  LLM Error       │     │  Redis Error     │     │  Timeout Error   │    │
│  │  (rate limit,    │     │  (connection,    │     │  (Haiku slow)    │    │
│  │   API failure)   │     │   write fail)    │     │                  │    │
│  └────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘    │
│           │                        │                        │               │
│           └────────────────────────┼────────────────────────┘               │
│                                    │                                        │
│                                    ▼                                        │
│                         ┌──────────────────────┐                            │
│                         │  Log warning         │                            │
│                         │  (no user impact)    │                            │
│                         └──────────────────────┘                            │
│                                    │                                        │
│                                    ▼                                        │
│                         ┌──────────────────────┐                            │
│                         │  Original messages   │                            │
│                         │  remain unchanged    │                            │
│                         └──────────────────────┘                            │
│                                    │                                        │
│                                    ▼                                        │
│                         ┌──────────────────────┐                            │
│                         │  Next request may    │                            │
│                         │  retry compaction    │                            │
│                         └──────────────────────┘                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Error Types

```typescript
interface CompactionError {
  kind: 'LLMError' | 'RedisError' | 'ConfigError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}
```

---

## Concurrency Model

### Why No Locking?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONCURRENCY ANALYSIS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  COMPACTION operates on OLDEST messages:                                    │
│  • Removes messages with LOW timestamps                                     │
│  • Uses ZREMRANGEBYSCORE with timestamp range                               │
│                                                                             │
│  PIPELINE PERSIST operates on NEWEST messages:                              │
│  • Adds messages with HIGH timestamps                                       │
│  • Uses ZADD with current timestamp                                         │
│                                                                             │
│  Timeline showing non-overlapping operations:                               │
│                                                                             │
│  [m1]──[m2]──...──[m15]──[m16]──...──[m30]──[NEW_USER]──[NEW_ASSISTANT]    │
│   │                 │                  │         │                          │
│   │◄───────────────►│                  │         │◄────────────────────►    │
│   │   COMPACTION    │                  │         │   PIPELINE PERSIST       │
│   │   (removes)     │                  │         │   (adds)                 │
│   │                 │                  │         │                          │
│                                                                             │
│  These operations target DIFFERENT SCORE RANGES - no conflict possible.    │
│                                                                             │
│  Additionally:                                                              │
│  • Users don't send concurrent messages (sequential chat)                   │
│  • Each request processes one message at a time                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Observability

### Logging

```typescript
// On compaction completion
logger.info({
  compacted: 15,           // Messages compacted
  summaryLength: 487,      // Summary character count
  duration: 1234,          // Time in ms
}, 'Context compaction completed')

// On error
logger.warn({
  error: { ... },
  conversationId: 'conv_123',
}, 'Context compaction failed')
```

### Metrics

```typescript
// Stage duration metric
pipelineMetrics.stageDuration.record(duration, {
  stage: 'context_compaction'
})
```

### Tracing

```typescript
// OpenTelemetry span
withSpan('ContextCompactor.runCompaction', async () => {
  // ... compaction logic
})
```

---

## Cost Analysis

### Per-Compaction Cost

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HAIKU COST ESTIMATE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input (15 messages):                                                       │
│  • Average message: ~100 tokens                                             │
│  • 15 messages: ~1,500 tokens                                               │
│  • Prompt overhead: ~200 tokens                                             │
│  • Total input: ~1,700 tokens                                               │
│                                                                             │
│  Output (summary):                                                          │
│  • Summary: ~200-400 tokens                                                 │
│                                                                             │
│  Haiku Pricing (Dec 2024):                                                  │
│  • Input: $0.25 / 1M tokens = $0.000425 per compaction                      │
│  • Output: $1.25 / 1M tokens = $0.0005 per compaction                       │
│  • Total: ~$0.001 per compaction                                            │
│                                                                             │
│  For a 100-message conversation:                                            │
│  • Compactions needed: (100-30)/15 = ~4-5 compactions                       │
│  • Total cost: ~$0.005                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Token Savings

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TOKEN SAVINGS ANALYSIS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Without Compaction (30 messages):                                          │
│  • 30 messages × 100 tokens = 3,000 tokens per request                      │
│                                                                             │
│  With Compaction (after 1 cycle):                                           │
│  • 1 summary (~300 tokens) + 15 messages (1,500 tokens) = 1,800 tokens      │
│  • Savings: 1,200 tokens (40%)                                              │
│                                                                             │
│  Cost comparison for Claude Sonnet 4 ($3/1M input):                         │
│  • Without: 3,000 tokens = $0.009                                           │
│  • With: 1,800 tokens + compaction cost = $0.0054 + $0.001 = $0.0064        │
│  • Net savings: ~30% per request after compaction                           │
│                                                                             │
│  For very long conversations (100+ exchanges), savings compound:            │
│  • Multiple compaction cycles progressively reduce context                  │
│  • Summaries of summaries possible (future enhancement)                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - Overall system architecture
- [`concept/memory-system-architecture.md`](./concept/memory-system-architecture.md) - Memory tier design
- [`../CLAUDE.md`](../CLAUDE.md) - Development commands and patterns
