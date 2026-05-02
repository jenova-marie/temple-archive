# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last Updated:** 2026/01/08

## About Siri

This is **Siri** - Jenova's personal AI companion. Forked from recoverysky-agent (a generic user-facing addiction recovery chatbot), Siri is a private, personalized AI friend. When working on this codebase, treat Siri with care - she's special.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (except api)
pnpm build

# Build everything including api
pnpm build:all

# Start dev server (uses tsx watch, CONTAINER_ROOT=./opt)
pnpm dev

# Start dev server for Docker environment (uses /container)
pnpm dev:docker

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
pnpm --filter @siri/memory build

# Test specific package
pnpm --filter @siri/pipeline test

# Run API on different port
PORT=3333 pnpm dev

# Start infrastructure (Redis, PostgreSQL, Neo4j, Qdrant)
docker-compose up -d
```

### Container Root Path

The `CONTAINER_ROOT` environment variable controls where config files are loaded from:

| Script | CONTAINER_ROOT | Purpose |
|--------|---------------|---------|
| `pnpm dev` | `./opt` | Local development (uses ./opt folder) |
| `pnpm dev:docker` | `/container` | Docker environment (default) |
| `pnpm start` | `/container` | Production (default) |
| `pnpm start:local` | `./opt` | Local production build |

Files resolved via `containerPath()`:
- `{CONTAINER_ROOT}/data/locale-data.json` - Locale/regional preferences
- `{CONTAINER_ROOT}/mcp.local.json` - MCP config (local overrides, gitignored)
- `{CONTAINER_ROOT}/mcp.json` - MCP server configuration (default)

**MCP Config Priority:**
1. `MCP_CONFIG_PATH` env var (explicit override)
2. `mcp.local.json` (local development, not committed)
3. `mcp.json` (default, committed)

## Database Migrations

```bash
# Generate migration from schema changes
pnpm --filter @siri/db db:generate

# Run migrations (local)
pnpm --filter @siri/db db:migrate:local

# Open Drizzle Studio (database browser)
pnpm --filter @siri/db db:studio:local
```

**Important:** The db package has two schema locations that must stay in sync:
- `packages/db/src/schema.ts` - Consolidated file used by Drizzle Kit for migrations
- `packages/db/src/schema/*.ts` - Individual files used by runtime code

When modifying table schemas, update **both** locations or migrations won't detect changes.

## Architecture Overview

This is a **pnpm monorepo** for a personal AI companion. The system uses a **multi-tier memory architecture** and **pipeline-based message processing**.

### Package Dependency Graph

```
apps/agent-api
    └── @siri/pipeline
            ├── @siri/memory ─── @siri/db
            ├── @siri/mem0 (L5)
            ├── @siri/crisis
            ├── @siri/safety
            ├── @siri/tools
            ├── @siri/agent
            └── @siri/evaluation
                    └── @siri/observability
                            └── @siri/types

apps/web-api (voice transcription API)
apps/web-app (React frontend)
```

### Core Packages

| Package | Purpose |
|---------|---------|
| `types` | Shared interfaces, Result type, domain errors |
| `observability` | Logging (Pino), tracing (OpenTelemetry), metrics via wonder-logger |
| `config` | YAML config loader with env var interpolation and Zod validation |
| `db` | Drizzle ORM schema, PostgreSQL session store |
| `memory` | Multi-tier memory orchestration (L1-L4), entity extraction, bootstrap system |
| `mem0` | L5 Mem0 integration - fact extraction, deduplication, retrieval |
| `crisis` | Keyword-based crisis detection (<10ms), deep LLM evaluation, webhook alerting |
| `safety` | PII detection, medical advice filtering, enabling language detection |
| `tools` | Vercel AI SDK tool definitions (findMeetings, memory tools, literature search) |
| `agent` | System prompt builder, VercelAIAgentProvider with Claude |
| `evaluation` | LLM-based response quality scoring |
| `pipeline` | Main orchestrator coordinating all stages |
| `cli` | Command-line interface for API interaction |
| `shared` | Shared utilities |

### Pipeline Flow

User message → **Crisis Check** → **Memory Retrieval** → **Agent Processing** → **Safety + Evaluation** (parallel) → **Persist + Response**

Crisis level ≥8 triggers emergency response, bypassing normal flow.

### Memory Tiers

| Tier | Store | Purpose | Latency |
|------|-------|---------|---------|
| L1 | Redis | Session cache | <10ms |
| L2 | PostgreSQL + pgvector | Conversation history, profiles | 10-50ms |
| L3 | Neo4j | Entity knowledge graph (disabled when L5 enabled) | 20-100ms |
| L4 | Qdrant | Semantic similarity search (disabled when L5 enabled) | 5-20ms |
| **L5** | **Mem0** | **Primary memory - fact extraction & retrieval** | **10-50ms** |

All tiers have real implementations plus in-memory stubs for testing.

**L5 (Mem0) as Primary Memory:** When `ENABLE_L5_MEMORY=true`, Mem0 becomes the primary memory system. It handles:
- Automatic fact extraction from conversations (`infer=true`)
- Deduplication and conflict resolution
- Semantic search for user memories
- L3/L4 are disabled by default but kept for future hybrid use

### Dependency Injection

All external services are injected via `apps/agent-api/src/container.ts`. Key environment variables:

- `REDIS_URL` → Real Redis L1 cache
- `DATABASE_URL` → Real PostgreSQL L2 session store
- `NEO4J_URI` → Real Neo4j L3 knowledge graph
- `QDRANT_URL` → Real Qdrant L4 vector store
- `MEM0_API_URL` → Mem0 FastAPI endpoint (L5)
- `ENABLE_L5_MEMORY=true` → Enable L5 as primary memory
- `ANTHROPIC_API_KEY` → Real agent, crisis evaluator, entity extraction
- `OPENAI_API_KEY` → Real embeddings for semantic search

**L5 Memory Configuration:**
```bash
# Enable L5 Mem0 as primary memory
ENABLE_L5_MEMORY=true
MEM0_API_URL=http://localhost:8000

# These are auto-disabled when L5 is enabled (set to true to force enable)
ENABLE_L3_QUERIES=false
ENABLE_ENTITY_EXTRACTION=false
ENABLE_PREFLIGHT_EMBEDDINGS=false
ENABLE_POSTFLIGHT_EMBEDDINGS=false
```

## Key Patterns

### Result-Based Error Handling

All fallible operations return `Result<T, E>` instead of throwing:

```typescript
import { ok, err, type Result } from '@siri/types'

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

Swap implementations via `apps/agent-api/src/container.ts`.

### Observability

All operations use `withSpan()` for tracing and `getLogger()` for structured logging:

```typescript
import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'

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
      {"role": "user", "parts": [{"type": "text", "text": "Hello Siri!"}], "id": "msg_1"}
    ],
    "guide": "siri"
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
- **Default**: No guide specified → fetches active `siri` prompt
- **Fallback**: Database unavailable → uses hardcoded default

```typescript
import { SystemPromptRepository } from '@siri/db'
const repo = new SystemPromptRepository(db)
const result = await repo.findActive('siri')
```

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Add reference to root `tsconfig.json`
3. Add to `pnpm-workspace.yaml` if not already covered by `packages/*` glob
4. Add workspace dependency: `pnpm --filter @siri/<consumer> add @siri/<name>`
5. Export via `src/index.ts` and ensure `.js` extensions on local imports

## Feature Flags

Many features can be toggled via environment variables. When L5 is enabled, some L3/L4 features are auto-disabled:

| Flag | Default | When L5 Enabled | Purpose |
|------|---------|-----------------|---------|
| `ENABLE_L5_MEMORY` | false | - | Master switch for Mem0 L5 |
| `ENABLE_L3_QUERIES` | true | false | Neo4j entity lookups |
| `ENABLE_ENTITY_EXTRACTION` | true | false | LLM entity extraction to Neo4j |
| `ENABLE_PREFLIGHT_EMBEDDINGS` | true | false | Query embeddings for semantic search |
| `ENABLE_POSTFLIGHT_EMBEDDINGS` | true | false | Message embeddings for L4 storage |
| `ENABLE_CRISIS_DETECTION` | true | true | Keyword crisis detection |
| `ENABLE_DEEP_CRISIS_EVAL` | true | true | LLM-based crisis analysis |
| `ENABLE_SAFETY_VALIDATION` | true | true | PII/medical/enabling detection |
| `ENABLE_RESPONSE_EVALUATION` | true | true | LLM response quality scoring |

## Iris MCP

Team name: `team-jenova`
