# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (except api)
pnpm build

# Build everything including api
pnpm build:all

# Start dev server (uses tsx watch)
pnpm dev

# Run tests
pnpm test
pnpm test:watch

# Type check all packages
pnpm typecheck

# Lint
pnpm lint

# Build specific package
pnpm --filter @recoverysky/memory build

# Test specific package
pnpm --filter @recoverysky/pipeline test

# Run API on different port
PORT=3333 pnpm dev

# Start infrastructure (Redis, PostgreSQL, Neo4j, Qdrant)
docker-compose up -d
```

## Architecture Overview

This is a **pnpm monorepo** for an AI chatbot agent supporting addiction recovery. The system uses a **multi-tier memory architecture** and **pipeline-based message processing**.

### Package Dependency Graph

```
apps/api
    └── @recoverysky/pipeline
            ├── @recoverysky/memory
            ├── @recoverysky/crisis
            ├── @recoverysky/safety
            ├── @recoverysky/agent
            └── @recoverysky/evaluation
                    └── @recoverysky/observability
                            └── @recoverysky/types
```

### Core Packages

| Package | Purpose |
|---------|---------|
| `types` | Shared interfaces, Result type, domain errors |
| `observability` | Logging (Pino), tracing (OpenTelemetry), metrics via wonder-logger |
| `memory` | Multi-tier memory orchestration (L1-L4) with in-memory stubs |
| `crisis` | Keyword-based crisis detection (<10ms), 9 pattern types |
| `pipeline` | Main orchestrator coordinating all stages |
| `agent` | System prompt builder, agent provider interface |
| `cli` | Command-line interface for API interaction |

### Pipeline Flow

User message → **Crisis Check** → **Memory Retrieval** → **Agent Processing** → **Safety + Evaluation** (parallel) → **Persist + Response**

Crisis level ≥8 triggers emergency response, bypassing normal flow.

### Memory Tiers

- **L1 (Redis)**: Session cache, <10ms, 4hr TTL
- **L2 (PostgreSQL + pgvector)**: Conversation history, profiles
- **L3 (Neo4j)**: Entity graph (reserved for future)
- **L4 (Qdrant)**: Semantic similarity search

Currently all tiers use in-memory stub implementations.

## Key Patterns

### Result-Based Error Handling

All fallible operations return `Result<T, E>` instead of throwing:

```typescript
import { ok, err, type Result } from '@recoverysky/types'

async function operation(): Promise<Result<Data, MyError>> {
  if (failed) return err({ kind: 'NotFound', message: '...', context: {} })
  return ok(data)
}

const result = await operation()
if (!result.ok) {
  // Handle error via result.error
}
```

### Provider Interfaces

All external dependencies use interfaces for testability:

- `ICrisisDetector`, `ICrisisHandler`
- `IAgentProvider`, `IEmbeddingProvider`
- `ISafetyValidator`, `IEvaluator`
- `IContextStore`, `ISessionStore`, `IKnowledgeStore`, `IVectorStore`

Swap implementations via `apps/api/src/container.ts`.

### Observability

All operations use `withSpan()` for tracing and `getLogger()` for structured logging:

```typescript
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'

async function myOperation(ctx: TraceContext) {
  return withSpan('MyClass.myOperation', async () => {
    const logger = getLogger().child({ requestId: ctx.requestId })
    logger.info('Processing...')
    pipelineMetrics.stageDuration.record(duration, { stage: 'my_stage' })
  })
}
```

## TypeScript Configuration

- **ESM only** (`"type": "module"`)
- **NodeNext** module resolution
- **verbatimModuleSyntax**: Use `import type` for type-only imports
- **Strict mode** with `noUnusedLocals`, `noUnusedParameters`

All imports must include `.js` extension for local files.

## API Endpoints

- `POST /api/chat` - Process message (requires `message`, `conversationId`, `userId`)
- `GET /health` - Health check
- `GET /health/metrics` - Prometheus metrics
