# Feature Flags

Comprehensive reference for all Siri feature flags. Feature flags provide runtime control over system behavior without code changes.

## The Problem

A complex system like Siri has many moving parts:
- Multiple memory tiers (L1-L4)
- Crisis detection at multiple levels
- Entity extraction and reflection
- Various tools and integrations
- Observability systems

Without feature flags, you can only enable/disable features by:
- Removing environment variables (presence-based)
- Changing code and redeploying
- Using stub mode (all-or-nothing)

This makes debugging difficult, gradual rollouts impossible, and cost control reactive rather than proactive.

## The Idea

Every significant feature has an explicit `ENABLE_*` or `*_ENABLED` flag:
- `true` (default) - Feature runs when dependencies are available
- `false` - Feature is completely disabled regardless of dependencies

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Feature Flag Architecture                             │
│                                                                              │
│   Environment Variables                                                      │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  ENABLE_SAFETY_VALIDATION=true                                          │ │
│   │  ENABLE_CRISIS_DETECTION=true                                           │ │
│   │  ENABLE_ENTITY_EXTRACTION=true                                          │ │
│   │  DEEP_MEMORY_ENABLED=true                                               │ │
│   │  ...                                                                    │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │                        Container (DI)                                   │ │
│   │                                                                         │ │
│   │   if (ENABLE_SAFETY_VALIDATION !== 'false') {                          │ │
│   │     return new SafetyValidator(...)                                    │ │
│   │   } else {                                                              │ │
│   │     return new NoOpSafetyValidator()                                   │ │
│   │   }                                                                     │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │                         Pipeline                                        │ │
│   │                                                                         │ │
│   │   Uses injected implementations - no feature flag checks needed        │ │
│   │   NoOp implementations skip work but maintain interface                │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Feature Flag Reference

### Pipeline Processing

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      Pipeline Processing Flags                                │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_SAFETY_VALIDATION=true                                       │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: PII detection, medical advice filtering, enabling language │   │
│   │  Default: true                                                       │   │
│   │  When false: Safety checks skipped, all content passes through       │   │
│   │  Cost impact: Saves ~50ms per request                               │   │
│   │  Risk: Production should always have this enabled                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_RESPONSE_EVALUATION=true                                     │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: LLM-based quality scoring of agent responses               │   │
│   │  Default: true                                                       │   │
│   │  When false: No quality metrics collected                           │   │
│   │  Cost impact: Saves ~$0.001 per evaluated response                  │   │
│   │  Fine-tuning: Use EVALUATION_MODE for sampling                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_STREAMING=true                                               │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Stream responses as they generate                          │   │
│   │  Default: true                                                       │   │
│   │  When false: Wait for full response before returning                 │   │
│   │  Use case: Disable for testing or debugging response content        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_AGENT_TOOLS=true                                             │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Allow Claude to call tools (agentic loop)                  │   │
│   │  Default: true                                                       │   │
│   │  When false: Claude responds without any tool access                 │   │
│   │  Use case: Disable for simple Q&A without tool overhead             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Crisis Detection

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Crisis Detection Flags                                  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_CRISIS_DETECTION=true                                        │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Fast keyword-based pattern matching (<10ms)                │   │
│   │  Default: true                                                       │   │
│   │  When false: All messages return crisis level 1 (safe)              │   │
│   │  Implementation: NoOpCrisisDetector when disabled                   │   │
│   │  Risk: Disabling bypasses all crisis safety nets                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_DEEP_CRISIS_EVAL=true                                        │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: LLM-based secondary analysis (parallel with agent)        │   │
│   │  Default: true                                                       │   │
│   │  When false: Only fast detection runs (keyword-based)               │   │
│   │  Requires: ANTHROPIC_API_KEY                                        │   │
│   │  Cost impact: Saves ~$0.0005 per message                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   Crisis Detection Flow:                                                     │
│                                                                              │
│   Message → Fast Detection ─────────────────────────────────────→ Score     │
│                │                                                             │
│                └─── (if ENABLE_DEEP_CRISIS_EVAL) ──→ Deep Eval ──→ Score    │
│                                                                              │
│   Final score = max(fast_score, deep_score)                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Memory System

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Memory System Flags                                    │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_ENTITY_EXTRACTION=true                                       │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Extract people, places, events from conversations          │   │
│   │  Default: true                                                       │   │
│   │  When false: No entities stored in Neo4j                            │   │
│   │  Requires: NEO4J_URI, ANTHROPIC_API_KEY                             │   │
│   │  Cost impact: Saves ~$0.0003 per message (Haiku extraction)         │   │
│   │  Fine-tuning: Use ENTITY_EXTRACTION_MODE for sampling               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  USE_L3_EXTRACTION=true                                              │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Use rich Cadillac schema with observations                 │   │
│   │  Default: true                                                       │   │
│   │  When false: Uses legacy entity storage (simpler schema)            │   │
│   │  Use case: Disable during migration or for compatibility            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  USE_L3_RETRIEVAL=false                                              │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Use new MemoryRetrievalService with Deep Memory            │   │
│   │  Default: false (legacy MemoryContextBuilder is default)            │   │
│   │  When true: Uses Cadillac retrieval with observations               │   │
│   │  Use case: Enable to test new retrieval system                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  DEEP_MEMORY_ENABLED=true                                            │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Enrich entities with original conversation context         │   │
│   │  Default: true                                                       │   │
│   │  When false: Entities have no sourceHistory context                 │   │
│   │  Use case: Disable to reduce L2 queries during retrieval            │   │
│   │  Fine-tuning: DEEP_MEMORY_STRATEGY, DEEP_MEMORY_WINDOW              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  MEMORY_BOOTSTRAP_ENABLED=false                                      │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Prime conversations with related past memories             │   │
│   │  Default: false (experimental feature)                              │   │
│   │  When true: Searches L4 for similar past conversations              │   │
│   │  Use case: Enable for returning users who benefit from context      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  COMPACTION_ENABLED=true                                             │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Summarize old messages to reduce context size              │   │
│   │  Default: true                                                       │   │
│   │  When false: Full message history always used                       │   │
│   │  Requires: REDIS_URL, ANTHROPIC_API_KEY                             │   │
│   │  Cost impact: Saves tokens but costs ~$0.0002 per compaction        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  MEMORY_REFLECTOR_ENABLED=true                                       │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Automatic insight extraction after each exchange           │   │
│   │  Default: true                                                       │   │
│   │  When false: No automatic observations created                      │   │
│   │  Requires: NEO4J_URI, ANTHROPIC_API_KEY                             │   │
│   │  Cost impact: Saves ~$0.0003 per exchange                           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  EMBEDDING_BATCH_ENABLED=true                                        │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: Background generation of L3/L4 embeddings                  │   │
│   │  Default: true                                                       │   │
│   │  When false: No background embedding processing                     │   │
│   │  Requires: NEO4J_URI, QDRANT_URL, OPENAI_API_KEY                    │   │
│   │  Use case: Disable to reduce OpenAI embedding costs                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Tool Features

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Tool Feature Flags                                   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_MEETING_TOOLS=true                                           │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: findMeetings tool for recovery meeting discovery           │   │
│   │  Default: true                                                       │   │
│   │  When false: Meeting search tool not available to Claude            │   │
│   │  Requires: MEETING_API_URL                                          │   │
│   │  Use case: Disable if meeting API is down or not needed             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_LITERATURE_TOOLS=true                                        │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: searchLiterature tool for recovery text search             │   │
│   │  Default: true                                                       │   │
│   │  When false: Literature search tool not available to Claude         │   │
│   │  Requires: QDRANT_URL, OPENAI_API_KEY                               │   │
│   │  Use case: Disable if literature collection not populated           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   Note: Memory tools are controlled by MEMORY_TOOL_ACCESS (off/read/write/full) │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Observability

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Observability Flags                                    │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENABLE_TRACING=true                                                 │   │
│   │  ─────────────────────────────────────────────────────────────────   │   │
│   │  Purpose: OpenTelemetry distributed tracing                          │   │
│   │  Default: true                                                       │   │
│   │  When false: No traces exported (spans still created locally)       │   │
│   │  Requires: OTEL_EXPORTER_OTLP_ENDPOINT                              │   │
│   │  Use case: Disable to reduce observability infrastructure costs     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Configuration Presets

### Minimal (Low Cost)

Disable all optional processing to minimize API costs:

```bash
# Disable LLM-based features
ENABLE_DEEP_CRISIS_EVAL=false
ENABLE_RESPONSE_EVALUATION=false
ENABLE_ENTITY_EXTRACTION=false
MEMORY_REFLECTOR_ENABLED=false
COMPACTION_ENABLED=false
EMBEDDING_BATCH_ENABLED=false

# Keep fast features
ENABLE_SAFETY_VALIDATION=true
ENABLE_CRISIS_DETECTION=true
ENABLE_AGENT_TOOLS=true
```

**Cost savings**: ~$0.002 per message

### Full (All Features)

Enable all features for maximum capability:

```bash
# All processing enabled
ENABLE_SAFETY_VALIDATION=true
ENABLE_RESPONSE_EVALUATION=true
ENABLE_STREAMING=true
ENABLE_AGENT_TOOLS=true
ENABLE_CRISIS_DETECTION=true
ENABLE_DEEP_CRISIS_EVAL=true
ENABLE_ENTITY_EXTRACTION=true
USE_L3_EXTRACTION=true
USE_L3_RETRIEVAL=true
DEEP_MEMORY_ENABLED=true
MEMORY_BOOTSTRAP_ENABLED=true
COMPACTION_ENABLED=true
MEMORY_REFLECTOR_ENABLED=true
EMBEDDING_BATCH_ENABLED=true
ENABLE_MEETING_TOOLS=true
ENABLE_LITERATURE_TOOLS=true
ENABLE_TRACING=true
```

### Debug (Simplified)

Disable async processing for easier debugging:

```bash
# Disable background processing
MEMORY_REFLECTOR_ENABLED=false
COMPACTION_ENABLED=false
EMBEDDING_BATCH_ENABLED=false
ENABLE_STREAMING=false

# Keep core features
ENABLE_SAFETY_VALIDATION=true
ENABLE_CRISIS_DETECTION=true
ENABLE_ENTITY_EXTRACTION=true
```

## Feature Dependencies

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Feature Dependency Graph                              │
│                                                                              │
│   Infrastructure Dependencies:                                               │
│                                                                              │
│   ANTHROPIC_API_KEY                                                          │
│       │                                                                      │
│       ├──▶ ENABLE_DEEP_CRISIS_EVAL                                          │
│       ├──▶ ENABLE_ENTITY_EXTRACTION                                         │
│       ├──▶ MEMORY_REFLECTOR_ENABLED                                         │
│       └──▶ COMPACTION_ENABLED                                               │
│                                                                              │
│   OPENAI_API_KEY                                                             │
│       │                                                                      │
│       ├──▶ EMBEDDING_BATCH_ENABLED                                          │
│       └──▶ ENABLE_LITERATURE_TOOLS                                          │
│                                                                              │
│   NEO4J_URI                                                                  │
│       │                                                                      │
│       ├──▶ ENABLE_ENTITY_EXTRACTION                                         │
│       ├──▶ USE_L3_EXTRACTION                                                │
│       ├──▶ USE_L3_RETRIEVAL                                                 │
│       ├──▶ DEEP_MEMORY_ENABLED                                              │
│       ├──▶ MEMORY_REFLECTOR_ENABLED                                         │
│       └──▶ EMBEDDING_BATCH_ENABLED                                          │
│                                                                              │
│   QDRANT_URL                                                                 │
│       │                                                                      │
│       ├──▶ EMBEDDING_BATCH_ENABLED                                          │
│       ├──▶ ENABLE_LITERATURE_TOOLS                                          │
│       └──▶ MEMORY_BOOTSTRAP_ENABLED                                         │
│                                                                              │
│   REDIS_URL                                                                  │
│       │                                                                      │
│       └──▶ COMPACTION_ENABLED                                               │
│                                                                              │
│   MEETING_API_URL                                                            │
│       │                                                                      │
│       └──▶ ENABLE_MEETING_TOOLS                                             │
│                                                                              │
│   OTEL_EXPORTER_OTLP_ENDPOINT                                               │
│       │                                                                      │
│       └──▶ ENABLE_TRACING                                                   │
│                                                                              │
│   Feature Interdependencies:                                                 │
│                                                                              │
│   ENABLE_ENTITY_EXTRACTION                                                   │
│       │                                                                      │
│       ├──▶ USE_L3_EXTRACTION (only meaningful if extraction enabled)        │
│       ├──▶ DEEP_MEMORY_ENABLED (entities need sourceHistory)               │
│       └──▶ MEMORY_REFLECTOR_ENABLED (reflects on extracted entities)       │
│                                                                              │
│   USE_L3_RETRIEVAL                                                          │
│       │                                                                      │
│       └──▶ DEEP_MEMORY_ENABLED (L3 retrieval uses Deep Memory)             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Why This Matters

### Operational Control

Feature flags let you respond to issues without deployment:
- Disable costly features during budget constraints
- Turn off problematic features during incidents
- Gradually enable features for testing

### Debugging

When something breaks, disable features to isolate the issue:
- Turn off async processing to see synchronous behavior
- Disable individual features to find the culprit
- Reduce noise by disabling observability temporarily

### Cost Management

LLM features have API costs. Feature flags let you:
- Disable expensive features for low-priority users
- Sample evaluations instead of running on every request
- Turn off background embedding during cost spikes

### Gradual Rollouts

New features can be dangerous. Feature flags let you:
- Enable for testing in production before full rollout
- A/B test feature impact on user experience
- Roll back instantly if issues arise

## Source Files

- [`apps/agent-api/src/container.ts`](../apps/agent-api/src/container.ts) - Feature flag checks in DI container
- [`packages/config/src/loader.ts`](../packages/config/src/loader.ts) - Environment variable mappings
- [`.env.example`](../.env.example) - Complete feature flag reference
- [`CONFIG.md`](../CONFIG.md) - Feature Selection section
