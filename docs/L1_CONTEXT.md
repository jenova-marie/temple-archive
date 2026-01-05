# L1 Context (Redis Session Cache)

The L1 tier provides sub-10ms access to active conversation context, serving as the hot cache for session state and recent messages.

## The Problem

Every message needs context. The agent can't respond meaningfully without knowing what was just said, how the conversation started, and what emotional state the user is in.

But fetching this context from PostgreSQL on every request adds 10-50ms of latency. For a flowing conversation, this delay compounds - every exchange feels sluggish. And during high traffic, database queries become a bottleneck.

We need context retrieval that's *fast* - fast enough to be imperceptible. We need it available for every request without hammering the database. And we need it to expire naturally when conversations go idle.

## The Idea

Cache hot conversation data in Redis - the last 100 messages, session metadata, crisis levels, emotional trends. Redis provides sub-millisecond reads with automatic expiration.

The pattern is simple:
1. On each request, check Redis first
2. If hit, return immediately (<10ms)
3. If miss, fetch from PostgreSQL, populate Redis, return
4. Let Redis expire inactive sessions automatically

This gives us the best of both worlds: PostgreSQL durability with Redis speed. 90%+ of requests hit the cache. The database sees only cold starts and background writes.

## Why This Matters

L1 is the difference between a snappy conversation and a sluggish one. Users don't notice 10ms delays. They definitely notice 50ms+ delays, especially when they compound across multiple exchanges.

Beyond latency, L1 enables features that would be impractical otherwise:
- Real-time crisis level tracking (updated on every message)
- Emotional trend analysis across the conversation
- Message count limits without counting on every request
- Session state that persists across multiple API calls

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           L1: Redis Cache                                    │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │                     Per-Session Data                                   │ │
│   │                                                                        │ │
│   │   ┌─────────────────────────┐    ┌─────────────────────────┐         │ │
│   │   │ session:{id}:state      │    │ session:{id}:messages   │         │ │
│   │   │ (Hash)                  │    │ (Sorted Set)            │         │ │
│   │   │                         │    │                         │         │ │
│   │   │ • startTime             │    │ Score: timestamp        │         │ │
│   │   │ • lastActivity          │    │ Member: JSON message    │         │ │
│   │   │ • messageCount          │    │                         │         │ │
│   │   │ • crisisLevel           │    │ Ordered newest-first    │         │ │
│   │   │ • currentTopic          │    │ Trimmed to 100 max      │         │ │
│   │   │ • emotionalTrend        │    │                         │         │ │
│   │   └─────────────────────────┘    └─────────────────────────┘         │ │
│   │                                                                        │ │
│   │   TTL: 4 hours (refreshed on activity)                                │ │
│   │                                                                        │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Structures

### Session State (Hash)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          session:{conversationId}:state                      │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Field           │ Type     │ Description                           │   │
│   │  ─────────────────────────────────────────────────────────────────  │   │
│   │  startTime       │ number   │ Conversation start (epoch ms)         │   │
│   │  lastActivity    │ number   │ Last message time (epoch ms)          │   │
│   │  messageCount    │ number   │ Total messages in session             │   │
│   │  crisisLevel     │ number   │ Current crisis severity (1-10)        │   │
│   │  currentTopic    │ string   │ Active discussion topic               │   │
│   │  emotionalTrend  │ string   │ "improving" | "stable" | "declining"  │   │
│   │  conversationGoal│ string   │ User's stated objective               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Redis Type: HASH                                                          │
│   Commands: HGETALL, HSET, HINCRBY, HSETNX                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Messages (Sorted Set)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        session:{conversationId}:messages                     │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Score (timestamp)    │  Member (JSON)                              │   │
│   │  ─────────────────────────────────────────────────────────────────  │   │
│   │  1704067200000        │  {"role":"user","content":"Hi..."}          │   │
│   │  1704067205000        │  {"role":"assistant","content":"Hello!"}    │   │
│   │  1704067230000        │  {"role":"user","content":"I'm feeling..."}│   │
│   │  ...                  │  ...                                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Redis Type: SORTED SET                                                    │
│   Commands: ZADD, ZREVRANGE, ZREMRANGEBYRANK, ZCARD                        │
│                                                                             │
│   Properties:                                                               │
│   • Ordered by timestamp (newest first via ZREVRANGE)                      │
│   • Auto-trimmed to 100 messages max                                       │
│   • O(log N) insertions, O(log N + M) range queries                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Schema

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           Key Patterns                                      │
│                                                                            │
│   Pattern                              │ Purpose                           │
│   ─────────────────────────────────────┼──────────────────────────────────  │
│   session:{conversationId}:state       │ Session metadata hash             │
│   session:{conversationId}:messages    │ Recent messages sorted set        │
│   memory:cache:{conversationId}:entries│ Bootstrap memory strings (list)   │
│   memory:cache:{conversationId}:meta   │ Memory cache metadata (hash)      │
│   user:info:{userId}                   │ Cached user info (hash)           │
│   user:profile:{userId}                │ Cached user profile (hash)        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## TTL Configuration

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          TTL Settings                                       │
│                                                                            │
│   Constant              │ Value    │ Usage                                 │
│   ──────────────────────┼──────────┼──────────────────────────────────────  │
│   SESSION               │ 4 hours  │ Default session TTL                   │
│   SESSION_EXTENDED      │ 8 hours  │ Active/important sessions             │
│   MAX_MESSAGES          │ 100      │ Message count limit per session       │
│                                                                            │
│   Refresh Strategy:                                                        │
│   • TTL resets on every storeMessage() call                               │
│   • Both state and messages keys get same TTL                              │
│   • Inactive sessions expire automatically (no cleanup jobs)               │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Operations

### Store Message (Atomic Pipeline)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        storeMessage() Pipeline                            │
│                                                                          │
│   All operations execute atomically via MULTI/EXEC:                      │
│                                                                          │
│   1. ZADD messages, timestamp, JSON(message)                             │
│      │  Add message to sorted set with timestamp as score                │
│      │                                                                   │
│   2. ZREMRANGEBYRANK messages, 0, -(maxMessages + 1)                     │
│      │  Trim oldest messages if over limit                               │
│      │                                                                   │
│   3. EXPIRE messages, ttlSeconds                                         │
│      │  Refresh messages TTL                                             │
│      │                                                                   │
│   4. HINCRBY state, messageCount, 1                                      │
│      │  Increment message counter                                        │
│      │                                                                   │
│   5. HSET state, lastActivity, timestamp                                 │
│      │  Update last activity time                                        │
│      │                                                                   │
│   6. EXPIRE state, ttlSeconds                                            │
│      │  Refresh state TTL                                                │
│      │                                                                   │
│   7. HSETNX state, startTime, timestamp                                  │
│      │  Set start time if not exists                                     │
│      │                                                                   │
│   8. HSETNX state, crisisLevel, 1                                        │
│      │  Initialize crisis level if not exists                            │
│      │                                                                   │
│   All 8 commands: single round-trip, atomic execution                    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Retrieve Recent Messages

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      getRecentMessages() Flow                             │
│                                                                          │
│   Input: sessionId, limit (default 50)                                   │
│                                                                          │
│   1. ZREVRANGE messages, 0, limit-1                                      │
│      │  Fetch N newest messages (O(log N + limit))                       │
│      │                                                                   │
│   2. Parse JSON for each member                                          │
│      │  Skip malformed entries with warning                              │
│      │                                                                   │
│   3. Return Message[]                                                    │
│      │  Ordered newest-first                                             │
│                                                                          │
│   Latency: <10ms for 50 messages                                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Cache Warming

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Cache Warming Flow                                │
│                                                                          │
│   Request arrives                                                        │
│      │                                                                   │
│      ▼                                                                   │
│   Check L1 (Redis)                                                       │
│      │                                                                   │
│      ├── HIT (<10ms) ──────────────────────────▶ Return context         │
│      │                                                                   │
│      ▼                                                                   │
│   MISS                                                                   │
│      │                                                                   │
│      ▼                                                                   │
│   Fetch from L2 (PostgreSQL)                                             │
│      │  • getConversationHistory()                                       │
│      │  • getUserProfile()                                               │
│      │                                                                   │
│      ▼                                                                   │
│   Populate L1 (implicit)                                                 │
│      │  Next message store will create session keys                      │
│      │                                                                   │
│      ▼                                                                   │
│   Return context (10-50ms first time)                                    │
│                                                                          │
│   Subsequent requests: <10ms (L1 hit)                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Memory Bootstrap Cache

Beyond session state, L1 also stores the Memory Bootstrap cache - pre-formatted memory strings ready for LLM injection:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Memory Bootstrap Cache                                │
│                                                                          │
│   memory:cache:{conversationId}:entries (LIST)                           │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  "User mentioned struggling with anxiety at work"               │   │
│   │  "User's therapist is named Sarah"                              │   │
│   │  "User started new medication 2 weeks ago"                      │   │
│   │  ...                                                            │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   memory:cache:{conversationId}:meta (HASH)                              │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  entryCount: 15                                                  │   │
│   │  exchangeCount: 8                                                │   │
│   │  lastUpdated: 1704067200000                                      │   │
│   │  topicSummary: "Discussion about work stress and coping"        │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   Purpose:                                                               │
│   • Store LLM-extracted memory strings                                  │
│   • Deduplicate every N exchanges                                       │
│   • Persist to L2 on conversation end                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Redis?

We needed a cache that's:
- **Fast** - Sub-millisecond reads
- **Structured** - Hashes, sorted sets, not just key-value
- **Expiring** - Automatic TTL without cleanup jobs
- **Persistent** - Survives restarts (RDB/AOF)
- **Distributed** - Shareable across API instances

Redis checks all boxes. Alternatives considered:

- **In-memory (process)** - Doesn't survive restarts, can't share across instances
- **Memcached** - No data structures, just strings
- **Local disk cache** - Too slow, doesn't share
- **PostgreSQL cache table** - Defeats the purpose (still 10-50ms)

### Why Sorted Sets for Messages?

Messages need to be:
- Ordered by time
- Quickly retrievable (newest N)
- Efficiently trimmable (remove oldest)

Sorted sets provide O(log N) for all these operations. A list would require O(N) for trimming. A hash couldn't maintain order.

### Why Atomic Pipelines?

When storing a message, we update multiple keys:
- Add message to sorted set
- Increment counter in hash
- Update lastActivity in hash
- Refresh TTLs

Without atomicity, a crash mid-operation leaves inconsistent state. Pipelines ensure all-or-nothing execution.

### Why 4-Hour TTL?

We want sessions to:
- Persist through normal conversation gaps (bathroom breaks, distractions)
- Expire when truly abandoned
- Not consume memory indefinitely

4 hours balances these concerns. Extended to 8 hours for actively engaged sessions.

## Trade-offs

### Memory vs. Completeness

We cap messages at 100. Longer conversations lose early context in L1.

This is acceptable because:
- L2 (PostgreSQL) stores everything
- Most conversations don't exceed 100 messages
- The agent typically only needs recent context
- Semantic search (L4) can find relevant older content

### Eventual Consistency

L1 and L2 can temporarily diverge:
- A message might be in L1 but not yet persisted to L2
- A crash could lose L1 data not yet written to L2

Mitigations:
- Write-through to L2 happens quickly (async but prioritized)
- Critical data (crisis events) writes to L2 synchronously
- L1 is a *cache*, not the source of truth

### Cold Start Penalty

First request after session expires pays the L2 lookup cost (10-50ms). Subsequent requests are fast.

This is acceptable because:
- Cold starts are rare (most conversations are active)
- 10-50ms is still reasonable for a first message
- The alternative (no caching) would make *every* request slow

## Source Files

- [`packages/memory/src/redis/client.ts`](../packages/memory/src/redis/client.ts) - Redis client factory
- [`packages/memory/src/redis/keys.ts`](../packages/memory/src/redis/keys.ts) - Key schema and TTL constants
- [`packages/memory/src/stores/RedisContextStore.ts`](../packages/memory/src/stores/RedisContextStore.ts) - L1 store implementation
- [`packages/memory/src/bootstrap/ConversationMemoryCache.ts`](../packages/memory/src/bootstrap/ConversationMemoryCache.ts) - Memory bootstrap cache
