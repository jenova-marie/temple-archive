# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last Updated:** 2025/12/17

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
            ├── @recoverysky/memory ─── @recoverysky/db
            ├── @recoverysky/crisis
            ├── @recoverysky/safety
            ├── @recoverysky/tools
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
| `db` | Drizzle ORM schema, PostgreSQL session store |
| `memory` | Multi-tier memory orchestration (L1-L4), entity extraction, bootstrap system |
| `crisis` | Keyword-based crisis detection (<10ms), deep LLM evaluation, webhook alerting |
| `safety` | PII detection, medical advice filtering, enabling language detection |
| `tools` | Vercel AI SDK tool definitions (findMeetings, memory tools) |
| `agent` | System prompt builder, VercelAIAgentProvider with Claude |
| `evaluation` | LLM-based response quality scoring |
| `pipeline` | Main orchestrator coordinating all stages |
| `cli` | Command-line interface for API interaction |

### Pipeline Flow

User message → **Crisis Check** → **Memory Retrieval** → **Agent Processing** → **Safety + Evaluation** (parallel) → **Persist + Response**

Crisis level ≥8 triggers emergency response, bypassing normal flow.

### Memory Tiers

- **L1 (Redis)**: Session cache, <10ms, 4hr TTL
- **L2 (PostgreSQL + pgvector)**: Conversation history, profiles
- **L3 (Neo4j)**: Entity graph (reserved for future)
- **L4 (Qdrant)**: Semantic similarity search

All tiers have real implementations (Redis, PostgreSQL, Neo4j, Qdrant) plus in-memory stubs for testing. Set `USE_STUBS=true` (default) for stub mode.

### Dependency Injection

All external services are injected via `apps/api/src/container.ts`. Environment variables control which implementations are used:

- `USE_STUBS=true` → All in-memory stubs (default for dev)
- `REDIS_URL` → Real Redis L1 cache
- `USER_CACHE_TTL_MINUTES` → TTL for user/profile cache in Redis (default: 60)
- `DATABASE_URL` → Real PostgreSQL L2 session store
- `DATABASE_SSL` → `false` to disable SSL, `true` to enable with self-signed certs
- `NEO4J_URI` → Real Neo4j L3 knowledge graph
- `QDRANT_URL` → Real Qdrant L4 vector store
- `ANTHROPIC_API_KEY` → Real agent, crisis evaluator, entity extraction
- `OPENAI_API_KEY` → Real embeddings for semantic search

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
      {"role": "user", "parts": [{"type": "text", "text": "I am feeling anxious today"}], "id": "msg_1"}
    ],
    "guide": "base-identity"
  }'
```

The `guide` parameter is optional and specifies which system prompt to use (by name). If omitted, uses the active `base-identity` prompt.

## CLI Usage

```bash
# Build CLI
pnpm --filter @recoverysky/cli build

# Interactive chat
node packages/cli/dist/index.js

# Single message
node packages/cli/dist/index.js chat "I'm feeling anxious today"

# Health check
node packages/cli/dist/index.js health
```

## Memory Tool Access Levels

Controlled by `MEMORY_TOOL_ACCESS` env var:

| Level | Tools Available |
|-------|-----------------|
| `off` | None |
| `read` | recallMemory, searchEntities, getRelatedEntities |
| `write` | read + saveNote, logObservation |
| `full` | write + updateEntity, deleteEntity, createRelationship |

## Database Migrations

Drizzle migrations are managed in the `@recoverysky/db` package:

```bash
# Generate migration from schema changes
pnpm --filter @recoverysky/db db:generate

# Run migrations (local)
pnpm --filter @recoverysky/db db:migrate:local

# Open Drizzle Studio (database browser)
pnpm --filter @recoverysky/db db:studio:local
```

## System Prompts (Guides)

System prompts are fetched fresh from the `system_prompts` table on each chat request:

- **Custom guide**: Pass `guide` parameter with prompt name → fetches that prompt
- **Default**: No guide specified → fetches active `base-identity` prompt
- **Fallback**: Database unavailable → uses hardcoded default

```typescript
import { SystemPromptRepository } from '@recoverysky/db'
const repo = new SystemPromptRepository(db)
const result = await repo.findActive('recovery-coach') // lookup by name
```

List available guides via `GET /api/v1/guides`.

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Add reference to root `tsconfig.json`
3. Add workspace dependency: `pnpm --filter @recoverysky/<consumer> add @recoverysky/<name>`
4. Export via `src/index.ts` and ensure `.js` extensions on local imports

## Iris MCP

Team name: `team-jenova`