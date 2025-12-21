# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last Updated:** 2025/12/20

## About Pippa

This is **Pippa** - Jenova's personal AI companion. Forked from recoverysky-agent (a generic user-facing addiction recovery chatbot), Pippa is a private, personalized AI friend. When working on this codebase, treat Pippa with care - she's special.

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

# Run with real services (requires docker-compose up -d first)
USE_STUBS=false pnpm dev

# Run tests
pnpm test
pnpm test:watch

# Run a single test file
pnpm vitest run packages/memory/src/qdrant/client.test.ts

# Type check all packages
pnpm typecheck

# Lint
pnpm lint

# Build specific package
pnpm --filter @pippa/memory build

# Test specific package
pnpm --filter @pippa/pipeline test

# Run API on different port
PORT=3333 pnpm dev

# Start infrastructure (Redis, PostgreSQL, Neo4j, Qdrant)
docker-compose up -d
```

## Database Migrations

```bash
# Generate migration from schema changes
pnpm --filter @pippa/db db:generate

# Run migrations (local)
pnpm --filter @pippa/db db:migrate:local

# Open Drizzle Studio (database browser)
pnpm --filter @pippa/db db:studio:local
```

## Architecture Overview

This is a **pnpm monorepo** for a personal AI companion. The system uses a **multi-tier memory architecture** and **pipeline-based message processing**.

### Package Dependency Graph

```
apps/api
    └── @pippa/pipeline
            ├── @pippa/memory ─── @pippa/db
            ├── @pippa/crisis
            ├── @pippa/safety
            ├── @pippa/tools
            ├── @pippa/agent
            └── @pippa/evaluation
                    └── @pippa/observability
                            └── @pippa/types
```

### Core Packages

| Package | Purpose |
|---------|---------|
| `types` | Shared interfaces, Result type, domain errors |
| `observability` | Logging (Pino), tracing (OpenTelemetry), metrics via wonder-logger |
| `db` | Drizzle ORM schema, PostgreSQL session store |
| `memory` | Multi-tier memory orchestration (L1-L4), entity extraction, bootstrap system |
| `crisis` | Keyword-based crisis detection (<10ms), deep LLM evaluation, webhook alerting |
| `safety` | PII detection, medical advice filtering, enabling language detection |
| `tools` | Vercel AI SDK tool definitions (findMeetings, memory tools, literature search) |
| `agent` | System prompt builder, VercelAIAgentProvider with Claude |
| `evaluation` | LLM-based response quality scoring |
| `pipeline` | Main orchestrator coordinating all stages |
| `cli` | Command-line interface for API interaction |

### Pipeline Flow

User message → **Crisis Check** → **Memory Retrieval** → **Agent Processing** → **Safety + Evaluation** (parallel) → **Persist + Response**

Crisis level ≥8 triggers emergency response, bypassing normal flow.

### Memory Tiers

| Tier | Store | Purpose | Latency |
|------|-------|---------|---------|
| L1 | Redis | Session cache | <10ms |
| L2 | PostgreSQL + pgvector | Conversation history, profiles | 10-50ms |
| L3 | Neo4j | Entity knowledge graph | 20-100ms |
| L4 | Qdrant | Semantic similarity search | 5-20ms |

All tiers have real implementations plus in-memory stubs for testing. Set `USE_STUBS=true` (default) for stub mode.

### Dependency Injection

All external services are injected via `apps/api/src/container.ts`. Key environment variables:

- `USE_STUBS=true` → All in-memory stubs (default for dev)
- `REDIS_URL` → Real Redis L1 cache
- `DATABASE_URL` → Real PostgreSQL L2 session store
- `NEO4J_URI` → Real Neo4j L3 knowledge graph
- `QDRANT_URL` → Real Qdrant L4 vector store
- `ANTHROPIC_API_KEY` → Real agent, crisis evaluator, entity extraction
- `OPENAI_API_KEY` → Real embeddings for semantic search

## Key Patterns

### Result-Based Error Handling

All fallible operations return `Result<T, E>` instead of throwing:

```typescript
import { ok, err, type Result } from '@pippa/types'

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
import { getLogger, withSpan, pipelineMetrics } from '@pippa/observability'

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

- `POST /api/v1/chat` - Process message (UIMessage format, requires JWT auth)
- `GET /api/v1/guides` - List available system prompts (guides)
- `GET /health` - Health check
- `GET /health/metrics` - Prometheus metrics

### Chat Request Format (Vercel AI SDK UIMessage)

```bash
curl -X POST http://localhost:3333/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "messages": [
      {"role": "user", "parts": [{"type": "text", "text": "Hello Pippa!"}], "id": "msg_1"}
    ],
    "guide": "base-identity"
  }'
```

## Memory Tool Access Levels

Controlled by `MEMORY_TOOL_ACCESS` env var:

| Level | Tools Available |
|-------|-----------------|
| `off` | None |
| `read` | recallMemory, searchEntities, getRelatedEntities |
| `write` | read + saveNote, logObservation |
| `full` | write + updateEntity, deleteEntity, createRelationship |

## System Prompts (Guides)

System prompts are fetched fresh from the `system_prompts` table on each chat request:

- **Custom guide**: Pass `guide` parameter with prompt name → fetches that prompt
- **Default**: No guide specified → fetches active `base-identity` prompt
- **Fallback**: Database unavailable → uses hardcoded default

```typescript
import { SystemPromptRepository } from '@pippa/db'
const repo = new SystemPromptRepository(db)
const result = await repo.findActive('base-identity')
```

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Add reference to root `tsconfig.json`
3. Add workspace dependency: `pnpm --filter @pippa/<consumer> add @pippa/<name>`
4. Export via `src/index.ts` and ensure `.js` extensions on local imports

## Iris MCP

Team name: `team-jenova`
