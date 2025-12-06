# RecoverySky Agent - Implementation Plan

## Overview

This document outlines the complete implementation plan for the RecoverySky AI chatbot agent with a multi-tier memory system. The architecture prioritizes:

- **Debuggability**: Each layer isolated and inspectable
- **Testability**: Stub implementations, dependency injection, unit/integration/e2e tests
- **Observability**: OpenTelemetry traces on every operation

---

## Architecture Decision: Monorepo with pnpm Workspaces

### Why Monorepo
- Single repository = atomic commits across components
- Clear package boundaries enforce separation
- Each package independently testable with its own stubs
- Shared types via internal packages
- pnpm workspaces handle internal dependency linking

### Why NOT Separate Repos
- This is a tightly coupled pipeline - changes often span multiple components
- Integration testing becomes external and fragile
- Version coordination nightmare

### Why NOT Single Project
- Harder to stub out entire subsystems
- Module boundaries are informal (requires discipline)
- Cannot test layers in true isolation

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Node.js 20+ | LTS, native ESM support |
| **Language** | TypeScript 5.x | Type safety, better DX |
| **Package Manager** | pnpm 9+ | Fast, efficient disk space |
| **API Framework** | Express | Battle-tested, largest ecosystem |
| **AI SDK** | Vercel AI SDK | Built-in streaming, tool support |
| **LLM** | Claude (Anthropic) | Best for empathetic conversations |
| **Embeddings** | OpenAI | text-embedding-3-small, reliable |
| **Deployment** | Traditional Server | Docker/K8s, long-running process |
| **Observability** | @jenova-marie/wonder-logger | Unified Pino logging + OpenTelemetry tracing/metrics |
| **Error Handling** | @jenova-marie/ts-rust-result | Type-safe Result types, domain errors, observability converters |

### Core Libraries

#### @jenova-marie/wonder-logger

Production-ready observability toolkit combining OpenTelemetry instrumentation with structured Pino logging:

- **YAML-based configuration** for environment-specific setups
- **Multiple transports**: Console, File, OTLP, Memory (for testing)
- **Trace context injection** via `withTraceContext()` for log-trace correlation
- **Auto-instrumentation** for HTTP, Express, databases
- **Prometheus metrics** (pull) and OTLP metrics (push)

#### @jenova-marie/ts-rust-result

Type-safe error handling with Rust's Result pattern:

- **Result<T, E>** for operations that can fail (no exceptions)
- **Domain errors** with `kind` discriminator for pattern matching
- **Observability converters**: `toLogContext()`, `toSpanAttributes()`, `toMetricLabels()`
- **Zero dependencies**, fully tree-shakeable

---

## Project Structure

```
recoverysky-agent/
├── package.json                    # Root workspace config
├── pnpm-workspace.yaml             # Workspace definitions
├── tsconfig.base.json              # Shared TypeScript config
├── tsconfig.json                   # Project references
├── vitest.workspace.ts             # Unified test runner
├── docker-compose.yml              # Local dev services
├── .env.example                    # Environment template
├── .gitignore
├── README.md
├── PLAN.md                         # This file
│
├── packages/
│   ├── types/                      # @recoverysky/types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # Re-exports all types
│   │       ├── context.ts          # TraceContext, PipelineContext
│   │       ├── messages.ts         # Message, StreamChunk, PipelineInput/Result
│   │       ├── memory.ts           # UserProfile, SessionContext, Entity
│   │       ├── crisis.ts           # CrisisLevel, CrisisCheckResult
│   │       ├── pipeline.ts         # StageResult, PipelineConfig
│   │       └── providers.ts        # All provider interfaces (I*Store, I*Provider)
│   │
│   ├── observability/              # @recoverysky/observability
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wonder-logger.yaml      # YAML config for wonder-logger
│   │   └── src/
│   │       ├── index.ts            # Re-exports configured logger, tracer, metrics
│   │       └── config.ts           # Environment-specific overrides
│   │
│   ├── memory/                     # @recoverysky/memory
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── MemoryOrchestrator.ts   # Multi-tier retrieval coordinator
│   │       └── stubs/
│   │           ├── index.ts
│   │           ├── InMemoryContextStore.ts    # L1 stub (Redis)
│   │           ├── InMemorySessionStore.ts    # L2 stub (PostgreSQL)
│   │           ├── InMemoryKnowledgeStore.ts  # L3 stub (Neo4j)
│   │           ├── InMemoryVectorStore.ts     # L4 stub (Qdrant)
│   │           └── InMemoryArchiveStore.ts    # S3 stub
│   │
│   ├── crisis/                     # @recoverysky/crisis
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── patterns.ts               # Crisis keyword patterns
│   │       ├── KeywordCrisisDetector.ts  # Fast pre-flight detection (<10ms)
│   │       └── stubs/
│   │           ├── StubCrisisDetector.ts
│   │           └── StubCrisisHandler.ts
│   │
│   ├── safety/                     # @recoverysky/safety
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── StubSafetyValidator.ts
│   │
│   ├── tools/                      # @recoverysky/tools
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── definitions.ts      # Vercel AI SDK tool definitions
│   │                               # - findMeetings
│   │                               # - logMood
│   │                               # - getCrisisResources
│   │                               # - getResources
│   │
│   ├── agent/                      # @recoverysky/agent
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── systemPrompt.ts     # Dynamic system prompt builder
│   │       └── MockAgentProvider.ts # Mock for testing
│   │
│   ├── evaluation/                 # @recoverysky/evaluation
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── StubEvaluator.ts
│   │
│   └── pipeline/                   # @recoverysky/pipeline
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts
│           └── Pipeline.ts         # Main orchestrator
│
├── apps/
│   └── api/                        # Express API application
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts            # Entry point
│           ├── container.ts        # DI container setup
│           ├── routes/
│           │   ├── chat.ts         # POST /api/chat
│           │   └── health.ts       # GET /health, /health/metrics
│           └── middleware/
│               ├── tracing.ts      # Inject trace context
│               └── errorHandler.ts
│
├── scripts/
│   └── init-db.sql                 # PostgreSQL schema
│
└── tests/
    ├── fixtures/
    └── factories/
```

---

## Pipeline Flow Architecture

```
[User Message]
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                     │
│                                                              │
│  ┌──────────────┐                                           │
│  │ 1. Preflight │──── CRISIS DETECTED (level >= 8) ────┐   │
│  │   CrisisCheck│      (< 10ms target)                  │   │
│  └──────┬───────┘                                       ▼   │
│         │ NORMAL                            ┌──────────────┐│
│         ▼                                   │ Emergency    ││
│  ┌──────────────┐                           │ Response     ││
│  │ 2. Memory    │                           │ (immediate)  ││
│  │   Retrieval  │                           └──────────────┘│
│  │   (L1→L2→L3→L4)                                         │
│  └──────┬───────┘                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │ 3. Agent     │                                           │
│  │   Processing │ <── Tools: findMeetings, logMood, etc.   │
│  │   (Claude)   │                                           │
│  └──────┬───────┘                                           │
│         │                                                    │
│         ├──────────────────────────────┐                    │
│         │                              │ PARALLEL            │
│         ▼                              ▼                     │
│  ┌──────────────┐              ┌──────────────┐             │
│  │ 4. Safety    │              │ 5. Deep      │             │
│  │   Validation │              │    Evaluation│             │
│  └──────┬───────┘              └──────┬───────┘             │
│         │                              │                     │
│         ▼                              │                     │
│  ┌──────────────┐                      │                     │
│  │ 6. Persist   │◄─────────────────────┘                    │
│  │   + Response │                                           │
│  └──────────────┘                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
[Stream Response to User]
```

---

## Memory Tier Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MemoryOrchestrator                        │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ L1: Redis (Active Context) - <10ms                    │  │
│  │   • Last 20 messages in session                       │  │
│  │   • Current session state (crisis level, topic)       │  │
│  │   • User preferences cache                            │  │
│  │   TTL: 4 hours                                        │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │ MISS                          │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ L2: PostgreSQL + pgvector - 10-50ms                   │  │
│  │   • Full conversation history (90 days)               │  │
│  │   • Session summaries                                 │  │
│  │   • User profile (recovery phase, triggers)           │  │
│  │   • Vector search on message embeddings               │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │ ENRICH                        │
│                              ▼                               │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ L3: Neo4j - 20-100ms│  │ L4: Qdrant - 5-20ms         │  │
│  │   • Entity graph    │  │   • Semantic similarity     │  │
│  │   • Relationships   │  │   • Full vector corpus      │  │
│  │   • Temporal data   │  │   • Hybrid search           │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                              │
│  Result: AssembledContext                                    │
│    { messages, userProfile, sessionState, semanticMatches } │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

| Tier | Store | Purpose | Latency | Stub Implementation |
|------|-------|---------|---------|---------------------|
| L1 | Redis | Active session cache | <10ms | InMemoryContextStore |
| L2 | PostgreSQL + pgvector | Session history, profiles | 10-50ms | InMemorySessionStore |
| L3 | Neo4j | Entity relationships, graph | 20-100ms | InMemoryKnowledgeStore |
| L4 | Qdrant | Semantic similarity search | 5-20ms | InMemoryVectorStore |
| S3 | AWS S3 | Cold storage archives | N/A | InMemoryArchiveStore |

---

## Core Design Patterns

### 1. Interface-First Design

Every provider implements an interface, enabling:
- Swapping Redis for InMemory in tests
- Swapping Claude for a mock in tests
- Gradual implementation (stubs first, real later)

```typescript
// Example: IContextStore interface
interface IContextStore {
  get(sessionId: string, ctx: TraceContext): Promise<SessionContext | null>;
  set(sessionId: string, context: SessionContext, ctx: TraceContext): Promise<void>;
  delete(sessionId: string, ctx: TraceContext): Promise<void>;
}
```

### 2. Pipeline Stage Pattern

Each processing step is a discrete stage:

```typescript
interface IPipelineStage<TInput, TOutput> {
  readonly name: string;
  execute(input: TInput, ctx: PipelineContext): Promise<StageResult<TOutput>>;
}
```

### 3. Trace Context Propagation

Every operation receives a `TraceContext`:

```typescript
interface TraceContext {
  traceId: string;
  spanId: string;
  requestId: string;
  userId?: string;
  sessionId?: string;
  startTime: number;
}
```

### 4. Dependency Injection Container

```typescript
// Production
container.register('IContextStore', RedisContextStore);
container.register('IAgentProvider', VercelAIAgentProvider);

// Testing
container.register('IContextStore', InMemoryContextStore);
container.register('IAgentProvider', MockAgentProvider);
```

### 5. Result-Based Error Handling

All fallible operations return `Result<T, E>` instead of throwing exceptions:

```typescript
import { ok, err, type Result } from '@jenova-marie/ts-rust-result'
import { fileNotFound, type FileNotFoundError } from '@jenova-marie/ts-rust-result/errors'

// Every provider method returns Result
interface IContextStore {
  get(sessionId: string, ctx: TraceContext): Promise<Result<SessionContext | null, StoreError>>;
  set(sessionId: string, context: SessionContext, ctx: TraceContext): Promise<Result<void, StoreError>>;
}

// Domain-specific error types
type StoreError =
  | { kind: 'ConnectionError'; message: string; context: { store: string } }
  | { kind: 'TimeoutError'; message: string; context: { operation: string; timeoutMs: number } }
  | { kind: 'SerializationError'; message: string; context: { key: string } }

// Pattern matching on errors
const result = await contextStore.get(sessionId, ctx)
if (!result.ok) {
  switch (result.error.kind) {
    case 'ConnectionError':
      logger.error(toLogContext(result.error), 'Store connection failed')
      break
    case 'TimeoutError':
      logger.warn(toLogContext(result.error), 'Store timeout')
      break
  }
  return err(result.error)
}
return ok(result.value)
```

### 6. Observability Integration Pattern

All errors integrate with logging, tracing, and metrics:

```typescript
import { toLogContext, toSpanAttributes, toMetricLabels } from '@jenova-marie/ts-rust-result/observability'
import { logger, metrics } from '@recoverysky/observability'
import { trace } from '@opentelemetry/api'

function handleStageError<E extends DomainError>(error: E, stageName: string): void {
  // 1. Structured logging with trace correlation
  logger.error(toLogContext(error), `Stage ${stageName} failed`)

  // 2. Span attributes for distributed tracing
  const span = trace.getActiveSpan()
  span?.setAttributes(toSpanAttributes(error))
  span?.setStatus({ code: SpanStatusCode.ERROR, message: error.message })

  // 3. Metrics for alerting
  metrics.stageErrors.add(1, {
    stage: stageName,
    ...toMetricLabels(error)
  })
}
```

---

## Crisis Detection

### Two-Stage Detection

1. **Pre-flight check** (<10ms): Keyword pattern matching
2. **Deep evaluation**: LLM-based analysis (runs in parallel with response)

### Crisis Levels

| Level | Severity | Action |
|-------|----------|--------|
| 1-3 | Normal | No action |
| 4-6 | Elevated stress | Monitor, log for analysis |
| 7-8 | High risk | Inject crisis resources, flag for review |
| 9-10 | Immediate danger | Alert on-call team, emergency protocols |

### Crisis Patterns

The system detects patterns including:
- Suicidal ideation
- Self-harm
- Active/imminent relapse
- Overdose risk
- Violence risk
- Severe distress
- Hopelessness
- Isolation

---

## Implementation Phases

### Phase 0: Foundation (Completed)

**Goal**: Full project structure with stub implementations

**Deliverables**:
- [x] Monorepo with pnpm workspaces
- [x] All packages scaffolded with interfaces
- [x] Stub implementations for all providers
- [x] Pipeline orchestrator
- [x] Express API with routes
- [x] Docker Compose for local services
- [x] Build system working

### Phase 1: Real Crisis Detection

**Goal**: Production-ready crisis detection

**Tasks**:
- [ ] Expand crisis keyword patterns
- [ ] Add LLM-based deep evaluation
- [ ] Implement crisis handler with alerting
- [ ] Add comprehensive unit tests
- [ ] Red team testing with adversarial inputs

### Phase 2: L1 Memory (Redis)

**Goal**: Replace InMemoryContextStore with Redis

**Tasks**:
- [ ] Implement RedisContextStore
- [ ] Configure Redis connection pooling
- [ ] Add TTL management
- [ ] Integration tests with Docker Redis

### Phase 3: L2 Memory (PostgreSQL)

**Goal**: Replace InMemorySessionStore with PostgreSQL + pgvector

**Tasks**:
- [ ] Implement PostgresSessionStore
- [ ] Set up migrations (using Drizzle or similar)
- [ ] Implement vector search for messages
- [ ] Add user profile management

### Phase 4: Real Agent Integration

**Goal**: Replace MockAgentProvider with Claude

**Tasks**:
- [ ] Implement VercelAIAgentProvider
- [ ] Connect tools to real backends
- [ ] Implement streaming responses
- [ ] Add token usage tracking

### Phase 5: L3/L4 Memory (Neo4j + Qdrant)

**Goal**: Full memory system

**Tasks**:
- [ ] Implement Neo4jKnowledgeStore
- [ ] Implement QdrantVectorStore
- [ ] Entity extraction pipeline
- [ ] Semantic search integration

### Phase 6: Safety & Evaluation

**Goal**: Production safety validators

**Tasks**:
- [ ] Implement PII detection
- [ ] Implement medical advice detection
- [ ] Implement enabling language detection
- [ ] Add LLM-based evaluation metrics

### Phase 7: Production Hardening

**Goal**: Production-ready deployment

**Tasks**:
- [ ] Add comprehensive monitoring
- [ ] Set up alerting (PagerDuty)
- [ ] Load testing
- [ ] Security audit
- [ ] Documentation

---

## Testing Strategy

### Unit Tests (per package)

```bash
pnpm --filter @recoverysky/memory test
```

- Test each provider in isolation
- Use stubs for dependencies
- Target: >80% coverage

### Integration Tests

```bash
pnpm --filter @recoverysky/pipeline test:integration
```

- Test pipeline with stubs
- Test pipeline with docker services

### E2E Tests

```bash
pnpm --filter api test:e2e
```

- Full HTTP request/response testing
- Uses docker-compose services

---

## Observability

Powered by `@jenova-marie/wonder-logger` with YAML-based configuration.

### wonder-logger.yaml Configuration

```yaml
service:
  name: ${SERVICE_NAME:-recoverysky-agent}
  version: ${SERVICE_VERSION:-1.0.0}
  environment: ${NODE_ENV:-development}

logger:
  enabled: true
  level: ${LOG_LEVEL:-info}
  redact:
    - password
    - token
    - apiKey
  transports:
    - type: console
      pretty: false
    - type: file
      dir: ./logs
      fileName: agent.log
      sync: false
    - type: memory
      name: recoverysky-agent
      maxSize: 10000
      level: debug
    - type: otel
      endpoint: ${OTEL_LOGS_ENDPOINT:-http://localhost:4318/v1/logs}
  plugins:
    traceContext: true  # Inject trace_id, span_id into logs

otel:
  enabled: true
  tracing:
    enabled: true
    exporter: otlp
    endpoint: ${OTEL_TRACES_ENDPOINT:-http://localhost:4318/v1/traces}
    sampleRate: 1.0
  metrics:
    enabled: true
    exporters:
      - type: prometheus
        port: 9464
      - type: otlp
        endpoint: ${OTEL_METRICS_ENDPOINT:-http://localhost:4318/v1/metrics}
        exportIntervalMillis: 60000
  instrumentation:
    auto: true
    http: true
```

### Every Stage Produces

- **Span**: Named trace span with timing (via `withSpan()`)
- **Attributes**: Key metrics (e.g., `crisis.level=4`, `memory.tier=L1`)
- **Events**: Significant occurrences within the span
- **Logs**: Structured logs with automatic trace correlation

### Metrics Collected

- `pipeline_stage_duration_ms` (histogram, per stage)
- `memory_cache_hits_total` / `memory_cache_misses_total` (counter, per tier)
- `crisis_detections_total` (counter, by level)
- `agent_tokens_total` (counter, by direction)
- `safety_violations_total` (counter, by type)
- `errors_total` (counter, by error.kind)

---

## Local Development

### Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start development server
pnpm dev

# Or with real services
docker-compose up -d
USE_STUBS=false pnpm dev
```

### Testing the API

```bash
# Health check
curl http://localhost:3333/health

# Send a message
curl -X POST http://localhost:3333/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I am feeling anxious today"}'

# View metrics
curl http://localhost:3333/health/metrics
```

---

## Environment Variables

```bash
# Application
NODE_ENV=development
PORT=3333
LOG_LEVEL=debug
USE_STUBS=true

# AI Providers
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# L1: Redis
REDIS_URL=redis://localhost:6379

# L2: PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/recoverysky

# L3: Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123

# L4: Qdrant
QDRANT_URL=http://localhost:6333

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=recoverysky-agent

# Crisis Response
CRISIS_ALERT_WEBHOOK_URL=
CRISIS_THRESHOLD_HIGH=7
CRISIS_THRESHOLD_CRITICAL=9
```

---

## File Count Summary

| Location | Files | Description |
|----------|-------|-------------|
| Root | 10 | Config files, docker-compose, README |
| packages/types | 7 | Type definitions |
| packages/observability | 3 | wonder-logger config + re-exports |
| packages/memory | 7 | Memory orchestrator + 5 stubs |
| packages/crisis | 5 | Detector, patterns, stubs |
| packages/safety | 2 | Safety validator stub |
| packages/tools | 2 | Tool definitions |
| packages/agent | 3 | Agent provider, prompts |
| packages/evaluation | 2 | Evaluator stub |
| packages/pipeline | 2 | Pipeline orchestrator |
| apps/api | 6 | Express app, routes, middleware |
| scripts | 1 | Database init |
| **Total** | ~50 | Core implementation files |

---

## Next Steps

1. **Verify the build**: `pnpm build`
2. **Start the server**: `pnpm dev`
3. **Test the endpoint**: Send a chat message
4. **Begin Phase 1**: Implement real crisis detection with expanded patterns

---

## References

### Core Libraries
- [@jenova-marie/wonder-logger](https://github.com/jenova-marie/wonder-logger) - Observability toolkit (Pino + OpenTelemetry)
- [@jenova-marie/ts-rust-result](https://github.com/jenova-marie/ts-rust-result) - Type-safe Result error handling

### AI & Infrastructure
- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Neo4j Documentation](https://neo4j.com/docs/)
