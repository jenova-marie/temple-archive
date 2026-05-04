# Siri

Siri is a personal AI companion - forked from RecoverySky Agent but customized as Jenova's private AI friend. Built with a multi-tier memory system, real-time crisis detection, and safety-first design principles.

**Last Updated:** 2026/01/08

## Features

- **Vercel AI SDK Compatible**: Native support for `useChat` hooks with UIMessage format
- **Multi-Tier Memory System**: L1 (Redis) + L2 (PostgreSQL) + L3 (Neo4j) + L4 (Qdrant) + **L5 (Mem0)** for contextual conversations
- **L5 Mem0 Memory**: Intelligent fact extraction, deduplication, and semantic retrieval as primary memory system
- **Phase-Shifted Memory Prompts**: Pre-generated memory context from previous requests, injected into current request
- **Active Knowledge Graph**: Neo4j-powered entity extraction with memory tools Claude can use during conversations
- **Real-Time Crisis Detection**: Pre-flight keyword matching (<10ms) + LLM deep evaluation with webhook alerting
- **Safety Validation**: PII detection, medical advice filtering, enabling language detection
- **JWT Authentication**: Auth0-based authentication for API endpoints
- **Observable Pipeline**: OpenTelemetry tracing + Prometheus metrics + structured logging
- **Type-Safe Architecture**: Result-based error handling, no exceptions thrown
- **Meeting Discovery**: Integration with RecoverySky Meeting API for finding AA/NA meetings
- **Literature Search**: Semantic search through recovery literature (AA, NA, CMA, Refuge Recovery)
- **Context Compaction**: Automatic summarization of older messages to manage context length
- **CLI Tool**: Interactive command-line interface with streaming support and memory diagnostics
- **CI/CD Pipeline**: Forgejo Actions with Docker build and ECR deployment

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start development server (with stubs)
pnpm dev

# Or with real services
docker-compose up -d
USE_STUBS=false pnpm dev
```

The API server runs at `http://localhost:3333` by default.

## CLI Usage

The CLI provides an interactive way to chat with the agent:

```bash
# Build and use the CLI
pnpm --filter @siri/cli build

# Start interactive chat
node packages/cli/dist/index.js

# Send a single message
node packages/cli/dist/index.js chat "I'm feeling anxious today"

# Check API health
node packages/cli/dist/index.js health

# Show configuration
node packages/cli/dist/index.js config show
```

See [packages/cli/README.md](packages/cli/README.md) for full CLI documentation.

## API Endpoints

### Health Check

```bash
curl http://localhost:3333/health
```

### Send Message

The API uses [Vercel AI SDK](https://sdk.vercel.ai/docs) message format for compatibility with `useChat` hooks.

**Authentication required** - Include a valid JWT in the `Authorization` header:

```bash
curl -X POST http://localhost:3333/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "id": "conv_123",
    "messages": [
      {"role": "user", "parts": [{"type": "text", "text": "Hello Siri!"}], "id": "msg_1"}
    ],
    "guide": "siri"
  }'
```

The `userId` is automatically extracted from the JWT `sub` claim.

#### Request Format

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Conversation/thread ID |
| `messages` | UIMessage[] | Yes | Array of messages with `role`, `parts`, `id` |
| `guide` | string | No | System prompt name (e.g., "siri") |
| `trigger` | string | No | Action trigger type (e.g., "submit-message") |

#### Response Format

```json
{
  "id": "msg_abc123",
  "role": "assistant",
  "content": "I hear you. Feeling anxious is...",
  "conversationId": "conv_123",
  "metrics": { "totalDuration": 245, "tokensUsed": { "input": 50, "output": 120 } },
  "crisisLevel": 2,
  "emergencyTriggered": false
}
```

### Metrics

```bash
curl http://localhost:3333/health/metrics
```

## Architecture

```
[User Message]
     |
     v
+------------------------------------------------------------+
|                    Pipeline Orchestrator                    |
|                                                             |
|  +---------------+                                          |
|  | 1. Preflight  |---- CRISIS (level >= 8) ---+            |
|  |   CrisisCheck |     (<10ms target)          |            |
|  +-------+-------+                             v            |
|          |                          +----------------+      |
|          | NORMAL                   | Emergency      |      |
|          v                          | Response       |      |
|  +---------------+                  +----------------+      |
|  | 2. Memory     |   L5 (Mem0) OR L1 -> L2 -> L3 -> L4    |
|  |   Retrieval   |   + Memory Prompts from Redis          |
|  +-------+-------+                                          |
|          |                                                  |
|          v                                                  |
|  +------------------+                                       |
|  | 2.5 Memory       |   Build context from L5/Neo4j        |
|  |     Context      |   + inject memory prompts            |
|  +--------+---------+                                       |
|           |                                                 |
|           v                                                 |
|  +---------------+                                          |
|  | 3. Agent      |   Claude (via Vercel AI SDK)            |
|  |   Processing  |   Tools: findMeetings, searchLiterature,|
|  |               |          Mem0 tools, memory tools, etc. |
|  +-------+-------+                                          |
|          |                                                  |
|          +---------------------+                            |
|          |                     |  PARALLEL                  |
|          v                     v                            |
|  +---------------+     +---------------+                    |
|  | 4. Safety     |     | 5. Deep       |                    |
|  |   Validation  |     |   Crisis Eval |                    |
|  +-------+-------+     +-------+-------+                    |
|          |                     |                            |
|          v                     |                            |
|  +---------------+             |                            |
|  | 6. Persist    |<------------+                            |
|  |   + Extract   |   L5: Mem0 storage (infer=true)         |
|  |               |   L3: Entity extraction -> Neo4j        |
|  |               |   Generate memory prompts -> Redis      |
|  +---------------+                                          |
+------------------------------------------------------------+
     |
     v
[Response to User]
```

## Project Structure

```
siri/
├── packages/
│   ├── types/           # Shared TypeScript interfaces
│   ├── observability/   # Logging, tracing, metrics (wonder-logger)
│   ├── config/          # YAML config loader with env var interpolation
│   ├── db/              # Drizzle ORM, PostgreSQL session store
│   ├── memory/          # Multi-tier memory orchestration (L1-L4)
│   ├── mem0/            # L5 Mem0 integration
│   ├── crisis/          # Crisis detection patterns & handlers
│   ├── safety/          # Response safety validation
│   ├── tools/           # Vercel AI SDK tool definitions
│   ├── agent/           # System prompt builder, agent provider
│   ├── evaluation/      # Response quality evaluation
│   ├── pipeline/        # Main orchestrator
│   ├── cli/             # Command-line interface
│   └── shared/          # Shared utilities
├── apps/
│   ├── agent-api/       # Express API server (main)
│   ├── web-api/         # Voice transcription API
│   └── web-app/         # React frontend
├── scripts/
│   └── init-db.sql      # PostgreSQL schema
└── docker-compose.yml   # Local development services
```

## Memory Tier Architecture

| Tier | Store | Purpose | Latency Target | Implementation |
|------|-------|---------|----------------|----------------|
| L1 | Redis | Active session cache | <10ms | RedisContextStore ✅ |
| L2 | PostgreSQL + Drizzle | Session history, profiles | 10-50ms | PostgresSessionStore ✅ |
| L3 | Neo4j | Entity knowledge graph | 20-100ms | Neo4jKnowledgeStore ✅ |
| L4 | Qdrant | Semantic similarity | 5-20ms | QdrantVectorStore ✅ |
| **L5** | **Mem0** | **Primary memory - fact extraction & retrieval** | **10-50ms** | **Mem0Store ✅** |

When L5 is enabled (`ENABLE_L5_MEMORY=true`), it becomes the primary memory system. L3/L4 entity extraction and embeddings are disabled by default but can be force-enabled for hybrid use.

### Redis L1 Features
- Session state caching with configurable TTL (4hr default)
- Recent message retrieval for context window
- Authentication support (password, username, TLS)
- Connection pooling with exponential backoff retry

### Neo4j L3 Knowledge Graph
- **Entity extraction** from conversations using Claude Haiku
- **Database-per-user** mode for multi-tenancy (Dozer/Enterprise)
- **Lazy schema initialization** - schemas created on first access per database
- **Rich relationships** with context properties (not summaries)
- **Graph traversal** for related entities and patterns
- Entity types: person, place, event, emotion, trigger, coping_strategy, milestone, medication

### Qdrant L4 Features
- OpenAI embedding provider (text-embedding-3-small)
- **Hybrid search** with dense vectors + BM25 sparse vectors
- Semantic similarity search across conversation history
- **Literature search** - semantic search through recovery literature collection
- Automatic collection creation with HNSW indexing
- Batch indexing for bulk operations

### Mem0 L5 Features (Primary Memory)
- **Automatic fact extraction** from conversations using Mem0's inference engine
- **Deduplication and conflict resolution** - similar memories are merged automatically
- **Semantic search** for user memories with relevance scoring
- Memories injected into system prompt for contextual awareness
- Mem0 tools available for agent use (searchMemories, addMemory, etc.)

#### L5 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_L5_MEMORY` | `false` | Master switch for Mem0 L5 |
| `MEM0_API_URL` | - | Mem0 FastAPI service URL (e.g., `http://localhost:8000`) |
| `L5_MEMORY_LIMIT` | `10` | Max memories to retrieve per request |

When L5 is enabled, these features are auto-disabled (set to `true` to force enable):
- `ENABLE_L3_QUERIES` - Neo4j entity lookups
- `ENABLE_ENTITY_EXTRACTION` - LLM entity extraction to Neo4j
- `ENABLE_PREFLIGHT_EMBEDDINGS` - Query embeddings for L4 semantic search
- `ENABLE_POSTFLIGHT_EMBEDDINGS` - Message embeddings for L4 storage

## Phase-Shifted Memory Prompts

Memory prompts are pre-generated during postflight and stored in Redis L1 with per-key TTL. On the next request, these prompts are retrieved during preflight and injected into the system prompt.

### How It Works
1. **Postflight**: After a response, the `MemoryPromptGenerator` analyzes recent messages
2. **Generation**: Claude Haiku generates a narrativized memory context with topic-based TTL
3. **Storage**: Prompts stored in Redis with individual TTLs (high-relevance topics last longer)
4. **Preflight**: On next request, all non-expired prompts are retrieved and injected

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_PROMPT_ENABLED` | `false` | Enable phase-shifted memory prompts |
| `MEMORY_PROMPT_RECENT_MESSAGES` | `1` | Number of recent messages to analyze |
| `MEMORY_PROMPT_MAX_TTL_MINUTES` | `60` | Maximum TTL for memory prompts |

## Literature Search

Semantic search through recovery literature stored in PostgreSQL with embeddings in Qdrant:

### Literature Tools

| Tool | Description |
|------|-------------|
| `searchLiterature` | Semantic search for passages matching a query, filterable by fellowship |
| `getLiteraturePassage` | Get a specific page from a piece of literature |
| `listLiterature` | List all available literature, optionally filtered by fellowship |

### Supported Fellowships
- **AA** - Alcoholics Anonymous
- **NA** - Narcotics Anonymous
- **CMA** - Crystal Meth Anonymous
- **RD** - Refuge Recovery / Recover Dharma

### Database Schema
Literature is stored in two tables:
- `literature` - Metadata (title, fellowship, ISBN, edition, summary)
- `literature_blocks` - Text passages with page/line references

Embeddings are stored in a dedicated Qdrant collection (`literature`) with fellowship filtering support.

## Context Compaction

Automatic summarization of older messages to manage context window size:

### How It Works
1. After memory retrieval, checks if message count exceeds threshold (default: 30)
2. Takes the oldest N messages (default: 15)
3. Summarizes them via Claude Haiku into a single "[Earlier in this conversation]" paragraph
4. Atomically replaces original messages with summary in Redis
5. Runs fire-and-forget (non-blocking)

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPACTION_ENABLED` | `true` | Enable/disable context compaction |
| `COMPACTION_THRESHOLD` | `30` | Message count to trigger compaction |
| `COMPACTION_BATCH_SIZE` | `15` | Number of oldest messages to compact |
| `COMPACTION_MODEL` | `claude-3-haiku-20240307` | LLM for summarization |
| `COMPACTION_MAX_TOKENS` | `512` | Max tokens for summary |
| `COMPACTION_TIMEOUT_MS` | `15000` | Timeout for LLM call |

## Dynamic System Prompts

System prompts can be loaded from disk or database with priority ordering:

1. **Disk first**: Check `apps/agent-api/src/prompts/{name}.md`
2. **Database fallback**: Query `system_prompts` table for active prompt
3. **Hardcoded default**: Use embedded fallback if neither found

```sql
-- Insert a custom base identity prompt (database option)
INSERT INTO system_prompts (id, name, content, active, created, updated)
VALUES (
  'prompt_001',
  'siri',
  'You are Siri, a compassionate AI companion...',
  true,
  NOW(),
  NOW()
);
```

For development, create markdown files in `apps/agent-api/src/prompts/` for faster iteration without database changes.

## Active Memory System

Neo4j is an **active participant** in conversations, not just an archive:

### Pre-Agent Memory Context
Before the agent processes a message, relevant memories are retrieved from Neo4j and injected into the prompt:

| Mode | Description | Cost |
|------|-------------|------|
| 0 (off) | No memory context | Free |
| 1 (template) | Format with templates | Free |
| 2 (haiku) | Claude Haiku narrativizes | ~$0.0003/msg |
| 3 (hybrid) | Templates + Haiku for complex | Variable |

### Memory Tools for Claude
The agent can query and update the knowledge graph during conversations:

| Access Level | Tools Available |
|--------------|-----------------|
| `off` | None |
| `read` | recallMemory, searchEntities, getRelatedEntities |
| `write` | read + saveNote, logObservation |
| `full` | write + updateEntity, deleteEntity, createRelationship |

### Literature Tools
Always available when configured:
- `searchLiterature` - Semantic search through recovery literature
- `getLiteraturePassage` - Get specific page from a book
- `listLiterature` - List available literature by fellowship

### Post-Agent Entity Extraction
After responses, entities and relationships are extracted and stored:

```
User: "My sponsor John suggested I try the HALT technique"
        ↓ Entity Extraction (Haiku)
Neo4j: (John:Person {role: "sponsor"})
       (HALT:CopingStrategy)
       (John)-[:SUGGESTED {context: "for cravings"}]->(HALT)
```

## Crisis Detection

Two-stage crisis detection for accuracy and speed:

### Stage 1: Keyword Detection (<10ms)
Fast regex-based pattern matching for 9 crisis types:

| Level | Severity | Patterns Detected |
|-------|----------|-------------------|
| 9-10 | Critical | Suicidal ideation, overdose risk, violence risk |
| 7-8 | High | Active relapse, self-harm, imminent relapse |
| 4-6 | Elevated | Severe distress, hopelessness, isolation |
| 1-3 | Normal | Routine conversation |

### Stage 2: Deep LLM Evaluation
For messages that don't trigger emergency (level < 7), the `DeepCrisisEvaluator` runs in parallel with agent processing:
- Analyzes context and nuance
- Distinguishes past experiences from current crises
- Can escalate crisis level if patterns are detected

### Crisis Alerting
When level >= 7, `WebhookCrisisHandler` sends alerts:
- HTTP POST to configured webhook URL
- HMAC-SHA256 signed payloads
- Non-blocking (fire-and-forget)
- Includes crisis resources in response

## Authentication

The API supports JWT authentication via [Auth0](https://auth0.com):

```bash
# Configure in environment
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
AUTH0_AUDIENCE=https://api.siri.app
AUTH0_CLIENT_ID=your-spa-client-id
```

Authentication is **mandatory** — both backends throw on startup without
the `AUTH0_*` env vars set, and the SPA throws without `VITE_AUTH0_*`.

- `/api/*` endpoints require a valid JWT in `Authorization: Bearer <token>` header
- `/health` and `/health/metrics` remain public
- User ID extracted from JWT `sub` claim
- Roles extracted from the namespaced `https://siri.app/roles` claim (populated by an Auth0 Action)
- The web-app redirects every route except `/login` and `/callback` to login when not authenticated

See `docs/AUTHENTICATION.md` for the full Auth0 dashboard setup.

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

# Authentication (Auth0)
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
AUTH0_AUDIENCE=https://api.siri.app
AUTH0_CLIENT_ID=your-spa-client-id

# L1: Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=              # Optional: for authenticated Redis
REDIS_USERNAME=              # Optional: for ACL auth (Redis 6+)
REDIS_TLS=false              # Enable TLS/SSL

# L2: PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/recoverysky

# L3: Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123
NEO4J_DATABASE=neo4j         # Default database name
NEO4J_DATABASE_PER_USER=false # Enable database-per-user mode (Dozer/Enterprise)

# L4: Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=              # Optional: for Qdrant Cloud

# L5: Mem0
ENABLE_L5_MEMORY=false       # Enable Mem0 as primary memory
MEM0_API_URL=http://localhost:8000  # Mem0 FastAPI endpoint
L5_MEMORY_LIMIT=10           # Max memories to retrieve

# Feature Flags (legacy L3/L4 — opt-in; default off in L5-primary deployments)
ENABLE_L3_QUERIES=false           # Neo4j entity lookups
ENABLE_ENTITY_EXTRACTION=false    # LLM entity extraction to Neo4j
ENABLE_PREFLIGHT_EMBEDDINGS=false # Query embeddings for L4 semantic search
ENABLE_POSTFLIGHT_EMBEDDINGS=true # Message embeddings for L4 storage

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=ninshubur

# Crisis Response
CRISIS_WEBHOOK_URL=          # Webhook for crisis alerts
CRISIS_WEBHOOK_SECRET=       # HMAC secret for webhook signing
CRISIS_THRESHOLD_HIGH=7
CRISIS_THRESHOLD_CRITICAL=9

# Active Memory System
MEMORY_CONTEXT_MODE=0        # 0=off, 1=template, 2=haiku, 3=hybrid (legacy L3; auto-skipped when MEMORY_PROMPT_ENABLED=true)
MEMORY_TOOL_ACCESS=read      # off, read, write, full

# Entity Extraction
ENTITY_EXTRACTION_MODE=all   # all, none, sample:N, significant
ENTITY_MIN_IMPORTANCE=0.3    # 0.0-1.0 threshold

# Evaluation
EVALUATION_MODE=on_demand    # all, sample:N, on_demand

# Meeting API
MEETING_API_URL=http://localhost:4000
MEETING_API_TOKEN=           # Optional: Bearer token for API auth

# Context Compaction
COMPACTION_ENABLED=true      # Enable/disable context compaction
COMPACTION_THRESHOLD=30      # Message count to trigger compaction
COMPACTION_BATCH_SIZE=15     # Number of oldest messages to compact per batch
COMPACTION_MODEL=claude-3-haiku-20240307  # LLM for summarization
COMPACTION_MAX_TOKENS=512    # Max tokens for summary response
COMPACTION_TIMEOUT_MS=15000  # Timeout for LLM call (ms)

# User Caching
USER_CACHE_TTL_MINUTES=60    # TTL for user/profile cache in Redis

# Memory Prompts (phase-shifted memory)
MEMORY_PROMPT_ENABLED=false  # Enable phase-shifted memory prompts
MEMORY_PROMPT_RECENT_MESSAGES=1   # Messages to analyze per request
MEMORY_PROMPT_MAX_TTL_MINUTES=60  # Maximum TTL for prompts

# Agent Model
AGENT_MODEL=claude-sonnet-4-20250514  # Model for agent processing
```

## Docker Services

Start all infrastructure services:

```bash
# Core services (Redis, PostgreSQL, Neo4j, Qdrant)
docker-compose up -d

# With observability stack (Jaeger, Grafana, Prometheus)
docker-compose --profile observability up -d
```

| Service | Port | Purpose |
|---------|------|---------|
| Redis | 6379 | L1 cache |
| PostgreSQL | 5432 | L2 persistence |
| Neo4j | 7474, 7687 | L3 knowledge graph |
| Qdrant | 6333, 6334 | L4 vector store |
| Jaeger | 16686 | Distributed tracing UI |
| Prometheus | 9090 | Metrics collection |
| Grafana | 3333 | Dashboards |

## Development

### Build

```bash
# Build all packages (except api)
pnpm build

# Build everything including api
pnpm build:all

# Build specific package
pnpm --filter @siri/memory build
```

### Test

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Run with coverage
pnpm vitest run --coverage

# Test specific package
pnpm --filter @siri/pipeline test
```

### Test Coverage

The project maintains comprehensive unit test coverage using Vitest with mock-based testing:

| Package | Tests | Key Areas |
|---------|-------|-----------|
| @siri/types | 33 | Result types, domain errors |
| @siri/observability | 48 | Logging, tracing, metrics |
| @siri/crisis | 126 | Detection patterns, handlers, evaluators |
| @siri/memory | 101 | Stores (Redis, Qdrant, Neo4j), orchestrator, memory prompts |
| @siri/mem0 | ~30 | Mem0Store, client, transforms, InMemoryMem0Store |
| @siri/db | 20 | Schema, PostgresSessionStore |
| @siri/agent | 50 | VercelAIAgentProvider, prompt builder |
| @siri/safety | 13 | PII, medical, enabling detectors |
| @siri/evaluation | 14 | LLMEvaluator, scoring |
| @siri/tools | 37 | Recovery tools, meeting client, memory tools, Mem0 tools |
| @siri/cli | ~20 | Commands, chat, health |
| **Total** | **500+** | |

All tests use mocks for external dependencies (Redis, PostgreSQL, Neo4j, Qdrant, Mem0, AI providers).

### Type Check

```bash
pnpm typecheck
```

## Core Dependencies

- **[@jenova-marie/wonder-logger](https://github.com/jenova-marie/wonder-logger)**: Unified observability (Pino logging + OpenTelemetry tracing/metrics)
- **[@jenova-marie/ts-rust-result](https://github.com/jenova-marie/ts-rust-result)**: Type-safe Result error handling
- **[Vercel AI SDK v5](https://sdk.vercel.ai/docs)**: LLM integration with streaming and tool support
- **[@recoverysky-org/common](https://github.com/recoverysky-org/recoverysky-common)**: Shared models, schemas, and repositories
- **[Drizzle ORM](https://orm.drizzle.team)**: Type-safe PostgreSQL database access
- **[ioredis](https://github.com/redis/ioredis)**: Redis client with cluster support
- **[@qdrant/js-client-rest](https://github.com/qdrant/qdrant-js)**: Qdrant vector database client
- **[Express](https://expressjs.com)**: HTTP server framework
- **[Vitest](https://vitest.dev)**: Fast unit testing framework

## Implementation Status

### Phase 1: Agent Integration ✅
- [x] VercelAIAgentProvider with Claude (claude-sonnet-4)
- [x] Vercel AI SDK v5 with UIMessage format
- [x] Streaming support with AsyncGenerator
- [x] Tool execution loop with argument conversion
- [x] Token usage tracking and error handling
- [x] Dynamic system prompts from database

### Phase 2: PostgreSQL L2 Memory ✅
- [x] Drizzle ORM schema with migrations
- [x] PostgresSessionStore with conversation history
- [x] pgvector support for embeddings (1536 dims)
- [x] User profiles and session summaries

### Phase 3: Redis L1 Cache ✅
- [x] RedisContextStore with sorted sets
- [x] Configurable TTL (4hr default)
- [x] Authentication support (password, username, TLS)
- [x] Cache warming from L2

### Phase 4: Embeddings ✅
- [x] OpenAIEmbeddingProvider (text-embedding-3-small)
- [x] Batch processing with rate limiting
- [x] Semantic search integration

### Phase 5: Qdrant L4 Vector Store ✅
- [x] QdrantVectorStore with HNSW indexing
- [x] Semantic similarity search
- [x] Automatic collection management
- [x] Hybrid search with BM25 sparse vectors

### Phase 6: Enhanced Crisis Detection ✅
- [x] KeywordCrisisDetector with 9 pattern types
- [x] DeepCrisisEvaluator (LLM-based)
- [x] WebhookCrisisHandler with HMAC signing
- [x] Parallel evaluation with agent processing

### Phase 7: Safety & Evaluation ✅
- [x] SafetyValidator with three detectors:
  - PIIDetector (SSN, phone, email, credit card, etc.)
  - MedicalAdviceDetector (dosage, diagnosis, treatment)
  - EnablingDetector (glorification, minimization)
- [x] LLMEvaluator with quality/relevance/empathy/recovery scores
- [x] Configurable evaluation modes

### Phase 8: Neo4j L3 Knowledge Graph ✅
- [x] Neo4jKnowledgeStore with CRUD operations
- [x] EntityExtractor with LLM-based extraction
- [x] Database-per-user mode (Dozer/Enterprise)
- [x] Lazy schema initialization per database
- [x] Memory tools for Claude (recallMemory, saveNote, etc.)
- [x] MemoryContextBuilder for pre-agent injection
- [x] Rich relationship properties (graph-native design)

### Phase 9: Production Hardening ✅
- [x] Comprehensive unit test suite (470+ tests)
- [x] JWT authentication (Auth0)
- [x] Observability (OpenTelemetry + Prometheus)
- [x] Result-based error handling
- [x] User profile fetching from Auth0 userinfo
- [x] Redis caching for user/profile data

### Phase 10: Literature & Context Management ✅
- [x] Literature database schema (literature, literature_blocks)
- [x] LiteratureRepository for block hydration
- [x] Semantic literature search via Qdrant
- [x] Literature tools (searchLiterature, getLiteraturePassage, listLiterature)
- [x] Context compaction for long conversations
- [x] Fire-and-forget summarization via Haiku

### Phase 11: L5 Mem0 Memory ✅
- [x] @siri/mem0 package with Mem0Store implementation
- [x] Mem0 HTTP client with health checks
- [x] InMemoryMem0Store for testing
- [x] Integration with MemoryOrchestrator
- [x] L5 memories injected into system prompt
- [x] Mem0 tools for agent (searchMemories, addMemory)
- [x] Auto-disable L3/L4 features when L5 enabled
- [x] Postflight memory storage with inference

### Phase 12: Phase-Shifted Memory Prompts ✅
- [x] MemoryPromptStore with Redis + per-key TTL
- [x] MemoryPromptGenerator with topic-based TTL assignment
- [x] Integration into pipeline preflight/postflight
- [x] Memory prompts section in system prompt builder
- [x] CLI diagnostics for memory prompts

### Phase 13: CI/CD & Infrastructure ✅
- [x] Forgejo Actions workflow
- [x] Docker build with multi-stage optimization
- [x] ECR deployment workflow
- [x] Configurable AGENT_MODEL env var

### Phase 14: Future Enhancements
- [ ] Load testing
- [ ] API documentation (OpenAPI)
- [ ] Hybrid L3/L4/L5 memory mode

## License

Private - All rights reserved.
