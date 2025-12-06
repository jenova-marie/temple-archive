# RecoverySky Agent

An AI-powered chatbot agent designed to support people in addiction recovery. Built with a multi-tier memory system, real-time crisis detection, and safety-first design principles.

## Features

- **Multi-Tier Memory System**: L1 (Redis) + L2 (PostgreSQL) + L3 (Neo4j) + L4 (Qdrant) for contextual conversations
- **Real-Time Crisis Detection**: Pre-flight keyword matching (<10ms) with 9 crisis pattern types
- **Safety Validation**: Response sanitization and safety boundary enforcement
- **Observable Pipeline**: OpenTelemetry tracing + Prometheus metrics + structured logging
- **Type-Safe Architecture**: Result-based error handling, no exceptions thrown
- **CLI Tool**: Interactive command-line interface for chatting with the agent

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
pnpm --filter @recoverysky/cli build

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

```bash
curl -X POST http://localhost:3333/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I am feeling anxious today", "conversationId": "conv_123", "userId": "user_456"}'
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
|  | 2. Memory     |                                          |
|  |   Retrieval   |   L1 -> L2 -> L3 -> L4                  |
|  +-------+-------+                                          |
|          |                                                  |
|          v                                                  |
|  +---------------+                                          |
|  | 3. Agent      |   Claude (via Vercel AI SDK)            |
|  |   Processing  |   Tools: findMeetings, logMood, etc.    |
|  +-------+-------+                                          |
|          |                                                  |
|          +---------------------+                            |
|          |                     |  PARALLEL                  |
|          v                     v                            |
|  +---------------+     +---------------+                    |
|  | 4. Safety     |     | 5. Deep       |                    |
|  |   Validation  |     |    Evaluation |                    |
|  +-------+-------+     +-------+-------+                    |
|          |                     |                            |
|          v                     |                            |
|  +---------------+             |                            |
|  | 6. Persist    |<------------+                            |
|  |   + Response  |                                          |
|  +---------------+                                          |
+------------------------------------------------------------+
     |
     v
[Response to User]
```

## Project Structure

```
recoverysky-agent/
├── packages/
│   ├── types/           # Shared TypeScript interfaces
│   ├── observability/   # Logging, tracing, metrics (wonder-logger)
│   ├── memory/          # Multi-tier memory orchestration
│   ├── crisis/          # Crisis detection patterns & handlers
│   ├── safety/          # Response safety validation
│   ├── tools/           # Vercel AI SDK tool definitions
│   ├── agent/           # System prompt builder, agent provider
│   ├── evaluation/      # Response quality evaluation
│   ├── pipeline/        # Main orchestrator
│   └── cli/             # Command-line interface
├── apps/
│   └── api/             # Express API server
├── scripts/
│   └── init-db.sql      # PostgreSQL schema
└── docker-compose.yml   # Local development services
```

## Memory Tier Architecture

| Tier | Store | Purpose | Latency Target | Implementation |
|------|-------|---------|----------------|----------------|
| L1 | Redis | Active session cache | <10ms | InMemoryContextStore (stub) |
| L2 | PostgreSQL + pgvector | Session history, profiles | 10-50ms | InMemorySessionStore (stub) |
| L3 | Neo4j | Entity relationships | 20-100ms | InMemoryKnowledgeStore (stub) |
| L4 | Qdrant | Semantic similarity | 5-20ms | InMemoryVectorStore (stub) |

## Crisis Detection

The system detects 9 types of crisis patterns with severity levels 1-10:

| Level | Severity | Patterns Detected |
|-------|----------|-------------------|
| 9-10 | Critical | Suicidal ideation, overdose risk, violence risk |
| 7-8 | High | Active relapse, self-harm, imminent relapse |
| 4-6 | Elevated | Severe distress, hopelessness, isolation |
| 1-3 | Normal | Routine conversation |

When level >= 8, the pipeline triggers an emergency response with crisis resources.

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
pnpm --filter @recoverysky/memory build
```

### Test

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Test specific package
pnpm --filter @recoverysky/pipeline test
```

### Type Check

```bash
pnpm typecheck
```

## Core Dependencies

- **[@jenova-marie/wonder-logger](https://github.com/jenova-marie/wonder-logger)**: Unified observability (Pino logging + OpenTelemetry tracing/metrics)
- **[@jenova-marie/ts-rust-result](https://github.com/jenova-marie/ts-rust-result)**: Type-safe Result error handling
- **[Vercel AI SDK](https://sdk.vercel.ai/docs)**: LLM integration with streaming and tool support
- **[Express](https://expressjs.com)**: HTTP server framework

## Implementation Status

### Phase 0: Foundation (Complete)
- [x] Monorepo with pnpm workspaces
- [x] All packages scaffolded with interfaces
- [x] Stub implementations for all providers
- [x] Pipeline orchestrator
- [x] Express API with routes
- [x] Docker Compose configuration

### Phase 1: Real Crisis Detection
- [ ] Expand crisis keyword patterns
- [ ] Add LLM-based deep evaluation
- [ ] Implement crisis handler with alerting

### Phase 2-7: See PLAN.md for roadmap

## License

Private - All rights reserved.
