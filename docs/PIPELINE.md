# Pipeline

The message processing pipeline orchestrates all stages from user input to agent response.

## The Problem

Building an AI companion isn't just about calling an LLM. A message arrives and *many things* need to happen:

- Is this a crisis? Should we bypass normal processing?
- What does the agent know about this user?
- What context should be injected into the prompt?
- How should we build the system prompt?
- What tools should be available?
- Is the response safe? Does it contain PII?
- Should we persist this conversation?
- Should we extract entities? Run reflection?

Each concern has its own logic, its own dependencies, its own failure modes. Without structure, this becomes spaghetti - a tangled mess of conditionals, try-catches, and implicit ordering.

## The Idea

Organize message processing as a pipeline of discrete stages, each with clear inputs, outputs, and responsibilities.

The pipeline pattern brings order to complexity:

1. **Sequential where necessary** - Crisis check must happen before agent processing. Memory must be retrieved before prompt assembly.
2. **Parallel where possible** - L3 and L4 retrieval run concurrently. Safety and evaluation run concurrently.
3. **Fail-fast where critical** - Crisis detection failures shouldn't crash the pipeline. Agent failures should.
4. **Async where latency matters** - Persistence and extraction happen after the response starts streaming.

Each stage is a separate function with a defined interface. Testing is straightforward - mock the dependencies, verify the outputs. Debugging is clear - which stage failed? What were its inputs?

The pipeline is also the natural place for cross-cutting concerns: logging, tracing, metrics. Every stage can be instrumented uniformly.

## Why This Matters

The pipeline is the backbone of Siri. Every conversation flows through it. Its design determines:

- **Latency** - How fast does the first token appear?
- **Reliability** - What happens when a stage fails?
- **Observability** - Can we diagnose problems in production?
- **Extensibility** - Can we add new stages without rewriting everything?

A well-designed pipeline is invisible to users but essential to developers. It's the foundation that makes everything else possible.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Request Flow                                       │
│                                                                             │
│   User Message ───▶ Crisis ───▶ Memory ───▶ Agent ───▶ Safety ───▶ Response │
│                     Check      Retrieval    Process    Check                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Full Pipeline

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Message Pipeline                                   │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  1. REQUEST RECEIVED                                                  │  │
│   │                                                                       │  │
│   │     POST /api/v1/chat                                                │  │
│   │     { messages: [...], guide: "siri" }                              │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  2. AUTH MIDDLEWARE                                                   │  │
│   │                                                                       │  │
│   │     ┌─────────────────┐    ┌─────────────────┐                       │  │
│   │     │ DISABLE_AUTH=   │    │ DISABLE_AUTH=   │                       │  │
│   │     │ true            │    │ false           │                       │  │
│   │     │                 │    │                 │                       │  │
│   │     │ Mock user:      │    │ Verify JWT      │                       │  │
│   │     │ id: "dev-user"  │    │ from Auth0      │                       │  │
│   │     └─────────────────┘    └─────────────────┘                       │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  3. CRISIS DETECTION (fast path)                                      │  │
│   │                                                                       │  │
│   │     ┌─────────────────────────────────────────────────────────────┐  │  │
│   │     │  Keyword Detection (<10ms)                                   │  │  │
│   │     │                                                              │  │  │
│   │     │  Message contains crisis keywords?                           │  │  │
│   │     │  • "want to die", "suicide", "end it all"                   │  │  │
│   │     │                                                              │  │  │
│   │     │  If crisis level >= 8:                                       │  │  │
│   │     │    → Bypass normal flow                                      │  │  │
│   │     │    → Return crisis resources immediately                     │  │  │
│   │     │    → Trigger webhook alert                                   │  │  │
│   │     └─────────────────────────────────────────────────────────────┘  │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │ no crisis                              │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  4. MEMORY RETRIEVAL                                                  │  │
│   │                                                                       │  │
│   │     ┌─────────────────────────────────────────────────────────────┐  │  │
│   │     │                    MemoryOrchestrator                        │  │  │
│   │     │                                                              │  │  │
│   │     │  ┌───────────┐                                               │  │  │
│   │     │  │ L1: Redis │ ─▶ Session cache (recent messages)           │  │  │
│   │     │  └─────┬─────┘                                               │  │  │
│   │     │        │ miss                                                │  │  │
│   │     │        ▼                                                     │  │  │
│   │     │  ┌───────────┐                                               │  │  │
│   │     │  │ L2: Postgres│ ─▶ Full history + user profile             │  │  │
│   │     │  └───────────┘                                               │  │  │
│   │     │        │                                                     │  │  │
│   │     │        │ parallel                                            │  │  │
│   │     │        ▼                                                     │  │  │
│   │     │  ┌───────────┐  ┌───────────┐                                │  │  │
│   │     │  │ L3: Neo4j │  │ L4: Qdrant│                                │  │  │
│   │     │  │ Entities  │  │ Semantic  │                                │  │  │
│   │     │  └───────────┘  └───────────┘                                │  │  │
│   │     │                                                              │  │  │
│   │     │  Returns: AssembledContext                                   │  │  │
│   │     │  { messages, userProfile, entities, semanticMatches }        │  │  │
│   │     └─────────────────────────────────────────────────────────────┘  │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  5. SYSTEM PROMPT ASSEMBLY                                            │  │
│   │                                                                       │  │
│   │     ┌─────────────────────────────────────────────────────────────┐  │  │
│   │     │  SystemPromptBuilder                                         │  │  │
│   │     │                                                              │  │  │
│   │     │  ┌─────────────────────────────────────────────────────┐    │  │  │
│   │     │  │ Base Identity (from DB or fallback)                  │    │  │  │
│   │     │  │ + User Profile context                               │    │  │  │
│   │     │  │ + Relevant entities from L3                          │    │  │  │
│   │     │  │ + Available tools                                    │    │  │  │
│   │     │  │ + Current date/time                                  │    │  │  │
│   │     │  └─────────────────────────────────────────────────────┘    │  │  │
│   │     └─────────────────────────────────────────────────────────────┘  │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  6. AGENT PROCESSING                                                  │  │
│   │                                                                       │  │
│   │     ┌─────────────────────────────────────────────────────────────┐  │  │
│   │     │  VercelAIAgentProvider                                       │  │  │
│   │     │                                                              │  │  │
│   │     │  ┌─────────────────────────────────────────────────────┐    │  │  │
│   │     │  │ Claude Sonnet (anthropic/claude-sonnet-4)            │    │  │  │
│   │     │  │                                                      │    │  │  │
│   │     │  │ • System prompt                                      │    │  │  │
│   │     │  │ • Conversation history                               │    │  │  │
│   │     │  │ • User's latest message                              │    │  │  │
│   │     │  │ • Available tools (if enabled)                       │    │  │  │
│   │     │  └─────────────────────────────────────────────────────┘    │  │  │
│   │     │                                                              │  │  │
│   │     │  Streaming response via SSE                                  │  │  │
│   │     └─────────────────────────────────────────────────────────────┘  │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  7. PARALLEL POST-PROCESSING                                          │  │
│   │                                                                       │  │
│   │     ┌─────────────────────┐  ┌─────────────────────┐                 │  │
│   │     │ Safety Validation   │  │ Response Evaluation │                 │  │
│   │     │                     │  │                     │                 │  │
│   │     │ • PII detection     │  │ • Quality scoring   │                 │  │
│   │     │ • Medical advice    │  │ • Metrics logging   │                 │  │
│   │     │ • Enabling language │  │                     │                 │  │
│   │     └─────────────────────┘  └─────────────────────┘                 │  │
│   │                                                                       │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  8. PERSIST & RESPOND                                                 │  │
│   │                                                                       │  │
│   │     ┌─────────────────────────────────────────────────────────────┐  │  │
│   │     │ • Save message + response to L2 (PostgreSQL)                 │  │  │
│   │     │ • Update L1 cache (Redis)                                    │  │  │
│   │     │ • Trigger entity extraction (async)                          │  │  │
│   │     │ • Trigger reflection (async, if conditions met)              │  │  │
│   │     │ • Stream response to client                                  │  │  │
│   │     └─────────────────────────────────────────────────────────────┘  │  │
│   │                                                                       │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Stage Timing

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Typical Latencies                                   │
│                                                                            │
│  Stage                │ Latency    │ Notes                                 │
│  ─────────────────────┼────────────┼─────────────────────────────────────  │
│  Auth middleware      │ <5ms       │ JWT validation                        │
│  Crisis detection     │ <10ms      │ Keyword matching only                 │
│  L1 cache lookup      │ <10ms      │ Redis                                 │
│  L2 history fetch     │ 10-50ms    │ PostgreSQL (if L1 miss)               │
│  L3 entity retrieval  │ 20-100ms   │ Neo4j (parallel with L4)              │
│  L4 semantic search   │ 5-20ms     │ Qdrant (parallel with L3)             │
│  System prompt build  │ <5ms       │ String assembly                       │
│  Agent processing     │ 500-3000ms │ Claude API (streaming)                │
│  Safety validation    │ <50ms      │ Parallel with evaluation              │
│  Persist              │ 10-50ms    │ Async, doesn't block response         │
│                                                                            │
│  Total TTFB: ~100-200ms (until first stream chunk)                         │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Crisis Fast Path

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Crisis Detection Flow                              │
│                                                                          │
│   Message arrives                                                        │
│      │                                                                   │
│      ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  KeywordCrisisDetector (<10ms)                                   │   │
│   │                                                                  │   │
│   │  Matches against crisis keyword list:                            │   │
│   │  • Direct: "suicide", "kill myself", "want to die"              │   │
│   │  • Indirect: "no point", "give up", "can't go on"               │   │
│   │                                                                  │   │
│   │  Returns: { detected: bool, level: 0-10, keywords: [...] }      │   │
│   └────────────────────────────────┬────────────────────────────────┘   │
│                                    │                                     │
│                                    ▼                                     │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  If level >= 8 (HIGH)                                            │   │
│   │                                                                  │   │
│   │  ┌───────────────────────────────────────────────────────────┐  │   │
│   │  │ 1. BYPASS normal pipeline                                  │  │   │
│   │  │ 2. Return crisis resources immediately                     │  │   │
│   │  │ 3. Trigger webhook alert (if configured)                   │  │   │
│   │  │ 4. Log incident                                            │  │   │
│   │  └───────────────────────────────────────────────────────────┘  │   │
│   │                                                                  │   │
│   │  Response includes:                                              │   │
│   │  • Hotline numbers (988 Suicide & Crisis Lifeline)              │   │
│   │  • Crisis text line                                              │   │
│   │  • Encouragement to seek help                                    │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Dependency Injection

All components are wired in `apps/agent-api/src/container.ts`:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Container                                       │
│                                                                          │
│   Environment                   Injected Component                       │
│   ─────────────────────────────────────────────────────────────────────  │
│   USE_STUBS=true               InMemory stubs for all stores            │
│   USE_STUBS=false              Real Redis, Postgres, Neo4j, Qdrant      │
│   ANTHROPIC_API_KEY set        Real agent, crisis evaluator             │
│   OPENAI_API_KEY set           Real embeddings                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Crisis First?

Crisis detection runs before everything else. Why not parallel with memory retrieval?

1. **Safety** - If someone is in crisis, every millisecond matters. We don't wait for database queries.
2. **Bypass** - Crisis responses skip the normal pipeline entirely. No point retrieving context we won't use.
3. **Fast path** - Keyword matching is <10ms. It doesn't meaningfully delay normal requests.

The crisis stage is a fast, synchronous gate. Most messages pass through untouched.

### Why Streaming?

The agent returns a streaming response (Server-Sent Events), not a complete response. Why?

1. **Perceived latency** - Users see words appearing immediately, not a blank screen for 2+ seconds.
2. **Early abort** - Users can stop generation mid-stream if the response is going wrong.
3. **Token efficiency** - We can start post-processing before generation completes.

The trade-off: streaming complicates error handling. An error mid-stream can't change the already-sent content.

### Why Parallel Post-Processing?

Safety validation and response evaluation run concurrently after agent processing. Why not sequential?

1. **Independence** - Neither depends on the other's output.
2. **Latency** - Running in parallel reduces total time.
3. **Isolation** - A failure in evaluation shouldn't block safety checks.

We use `Promise.all` with careful error handling to ensure both complete.

### Why Async Persistence?

Message persistence, entity extraction, and reflection happen *after* the response starts streaming. Why?

1. **Latency** - Users don't wait for database writes.
2. **Decoupling** - Persistence failures don't break responses.
3. **Batching** - We can batch multiple operations efficiently.

The trade-off: if persistence fails, we might lose data. We mitigate with retry logic and dead-letter queues.

## Trade-offs

### Complexity vs. Flexibility

The pipeline has many stages, many interfaces, many injection points. This enables testing and extensibility but increases cognitive load.

We could simplify by hardcoding more, but we'd lose the ability to swap implementations (real vs. stub), add new stages, or test in isolation.

### Latency vs. Completeness

We prioritize time-to-first-token over complete context. The agent might start generating before all memory retrieval completes.

We could wait for all context to be assembled, but users would see longer delays. The current approach accepts slightly less context for much better perceived performance.

### Safety vs. Speed

The safety stage adds latency. We could skip it for trusted users or low-risk messages.

We currently run safety on every response. The latency cost (~50ms) is acceptable, and the risk of skipping is too high.

### Observability vs. Performance

Every stage logs, traces, and emits metrics. This creates overhead - more allocations, more I/O.

We could reduce instrumentation in production, but diagnosing issues would be much harder. The current balance prioritizes observability.

## Source Files

- [`packages/pipeline/src/pipeline.ts`](../packages/pipeline/src/pipeline.ts) - Main orchestrator
- [`packages/crisis/src/`](../packages/crisis/src/) - Crisis detection
- [`packages/memory/src/MemoryOrchestrator.ts`](../packages/memory/src/MemoryOrchestrator.ts) - Memory retrieval
- [`packages/agent/src/VercelAIAgentProvider.ts`](../packages/agent/src/VercelAIAgentProvider.ts) - Agent processing
- [`packages/safety/src/`](../packages/safety/src/) - Safety validation
- [`packages/evaluation/src/`](../packages/evaluation/src/) - Response scoring
- [`apps/agent-api/src/container.ts`](../apps/agent-api/src/container.ts) - DI wiring
