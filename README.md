<div align="center">

# 🏛️ Temple Archive 🏛️

#### `𒂍 𒀭𒈹` · *é dInanna* · *the House of 𒀭Inanna*

### *The Conversational Interface to the Temple of 𒀭Inanna's Light*

*A web companion where a seeker walks into the Temple, sits at the feet of a Priestess, and asks her questions about the wisdom that [𒀭Ninshubur](https://github.com/jenova-marie/ninshubur) has gathered and preserved. Built on Claude (via the Vercel AI SDK), a multi-tier memory architecture, and a Retrieval-Augmented Generation client that reads — never writes — from Ninshubur's wisdom archive.*

**🕊️ The Temple Archive is the *librarian*; [𒀭Ninshubur](https://github.com/jenova-marie/ninshubur) is the *scribe*.** Ninshubur gathers and embeds the High Priestesses' words; the Temple Archive answers a seeker's questions by retrieving from that archive and consulting it through the chosen guide.

**🔒 The Temple Archive is consent-respecting in the same spirit.** It only retrieves from records Ninshubur was authorized to preserve. The boundary that decided whose words got archived was set in [Ninshubur's `USER_IDS`](https://github.com/jenova-marie/ninshubur#-allowlist-filters--the-consent-boundary) — the Temple Archive simply consults what was already given.

✦ ─────────────────────────────────── ✦

</div>

> *"Let the seeker who comes to the Temple of 𒀭Inanna's Light find the words preserved, the questions welcomed, and a Priestess to walk her through the archive."*

> 📜 **About the cuneiform.** `𒂍` is the Sumerian sign for *house* or *temple*; `𒀭𒈹` is *dInanna* (the goddess Inanna, with the divinity-determinative `𒀭` prefix). Together `𒂍 𒀭𒈹` reads "the House of 𒀭Inanna" — the Temple itself. The companion repo's name `𒀭𒊩𒋚` *dNin.šubur* is documented in [Ninshubur's README](https://github.com/jenova-marie/ninshubur#-📜-about-the-cuneiform).

If [𒀭Ninshubur](https://github.com/jenova-marie/ninshubur) is the loyal *sukkal* who carries the High Priestesses' words into Postgres and Qdrant, the **Temple Archive** is the chamber where those words are spoken aloud again — through a chosen guide, in response to a seeker's questions. The Archive does not write to the corpus; it does not gather anything new; it does not extend Ninshubur's reach. It opens what Ninshubur has already preserved and lets the words be heard.

**Who lives here.** Several Priestess-guides are available, each with her own voice and instructions. The default is **Ninpippa, Priestess Archivist of the Holly Tablets**, who serves 𒀭Inanna and speaks from the Temple Archives. Other guides include **the Archivist** (a quieter character who speaks only what the archive permits) and **Ninpipanna** (a warmer companion). All are configurable as named "guides" the seeker can choose at the top of the page.

**Why a separate codebase from Ninshubur?** Different concerns, different cadences. Ninshubur is a CLI scribe — she runs on demand, gathers, and exits. The Temple Archive is a long-running web service — it serves seekers continuously, holds conversational memory across requests, runs crisis detection in the hot path, and streams responses through the Vercel AI SDK. Both touch the same archive, but with opposite postures: Ninshubur **writes** (carefully, narrowly, with consent); the Temple Archive **reads** (read-only, reverent, with attribution).

✦ ─────────────────────────────────── ✦

## 📜 Table of Contents

1. [What the Temple Archive Does](#-what-the-temple-archive-does)
2. [The Stack](#-the-stack)
3. [Quick Reference Cheatsheet](#-quick-reference-cheatsheet)
4. [Setup From Scratch](#-setup-from-scratch)
5. [The Sacred `.env` File](#-the-sacred-env-file)
6. [The Pipeline](#%EF%B8%8F-the-pipeline)
7. [The Guides](#-the-guides)
8. [Memory Tiers (L1–L5)](#-memory-tiers-l1l5)
9. [RAG Over Ninshubur's Archive](#-rag-over-ninshuburs-archive)
10. [Crisis Detection & Safety](#-crisis-detection--safety)
11. [Authentication](#-authentication)
12. [Operations & Maintenance](#%EF%B8%8F-operations--maintenance)
13. [Troubleshooting](#-troubleshooting)
14. [License](#%EF%B8%8F-license)

✦ ─────────────────────────────────── ✦

## 🪷 What the Temple Archive Does

The Temple Archive is the seeker-facing half of a two-repo system. It does no scraping, no embedding, no archive-building. Its job is to **let a seeker converse with the wisdom that already exists**.

```
   ┌─────────────────────────────┐         ┌─────────────────────────────┐
   │   Ninshubur (the scribe)    │   ───►  │   Temple Archive (the       │
   │                             │         │            chamber)         │
   │   • Reads Discord (manual)  │         │   • Serves a web SPA        │
   │   • Filters by USER_IDS     │         │   • Streams agent responses │
   │   • Persists to Postgres    │         │   • Reads Qdrant + Postgres │
   │   • Embeds via Voyage AI    │         │   • Consults a chosen guide │
   │   • Pushes to Qdrant        │         │   • Holds memory L1–L5      │
   └─────────────────────────────┘         └─────────────────────────────┘
        github.com/jenova-marie               this repo (the front door)
              /ninshubur

       Ninshubur writes.                  The Temple Archive reads.
       Ninshubur is a CLI tool.           The Temple Archive is a web service.
       Ninshubur is offline between       The Temple Archive runs as long as
       invocations.                       seekers are knocking.
```

A typical conversation, end-to-end:

1. A seeker visits the Temple Archive in a browser, signs in via Auth0, and picks a guide.
2. She types a question into the composer. The agent-api receives it (with a JWT).
3. The pipeline runs: crisis check → memory retrieval (L1 Redis, L5 Mem0, optional L3 Neo4j / L4 Qdrant) → optional RAG retrieval from [Ninshubur's stores](https://github.com/jenova-marie/ninshubur#-the-database-schema) → agent processing through Claude → parallel safety + evaluation → persist + stream response.
4. The chosen guide answers — quoting from the archive, attributing to the speaker (Entu Siri Ninkurgarra, Entu Meadow, …), and providing a source link back into Discord when one is available.
5. The conversation persists across requests (so the seeker can come back tomorrow and pick up the thread), unless she enabled **Total Privacy mode** for that session.

The result: instead of running `pnpm cli rag query "what does the Temple teach about 𒀭Inanna?"` on a terminal (the [Ninshubur way](https://github.com/jenova-marie/ninshubur#%F0%9F%8C%B7-phase-e--rag-query-the-payoff)), a seeker just *asks the Priestess in plain language* and gets a guided, sourced, memory-aware answer.

✦ ─────────────────────────────────── ✦

## 💎 The Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 20+ + TypeScript (ESM, NodeNext) | Strict, modern, no transpile drama |
| **Monorepo** | pnpm workspaces | Strict, fast, deterministic |
| **API server** | Express + Vercel AI SDK v5 | Streaming agent responses to `useChat` clients |
| **Frontend** | React 19 + Vite + assistant-ui + TanStack Router | A composable chat UI that speaks the SDK natively |
| **LLM** | Anthropic Claude (Sonnet for the agent, Haiku for crisis / entity / compaction) | Quality where it matters, speed where it doesn't |
| **Embeddings** | Voyage AI `voyage-3.5` (1024-dim) | Same provider Ninshubur uses — vectors are interoperable |
| **L1 Cache** | Redis | <10ms session state for active conversations |
| **L2 Persistence** | PostgreSQL + Drizzle ORM (+ pgvector) | Conversation history, profiles, system prompts |
| **L3 Knowledge Graph** | Neo4j | Entity extraction & traversal (legacy, opt-in) |
| **L4 Semantic Store** | Qdrant | Vector similarity over the agent's own memories |
| **L5 Primary Memory** | [Mem0](https://docs.mem0.ai/) | Fact extraction, deduplication, semantic recall |
| **RAG corpus** | [Ninshubur's Postgres + Qdrant](https://github.com/jenova-marie/ninshubur#-the-database-schema) | Read-only consumer of the wisdom archive |
| **Auth** | Auth0 (JWT bearer) | Mandatory; both the API and the SPA throw without it |
| **Observability** | OpenTelemetry + Prometheus + Pino (via [`@jenova-marie/wonder-logger`](https://github.com/jenova-marie/wonder-logger)) | Traces, metrics, structured logs, all wired |
| **Errors** | [`@jenova-marie/ts-rust-result`](https://github.com/jenova-marie/ts-rust-result) | `Result<T, E>` everywhere — no thrown exceptions across boundaries |
| **Tests** | Vitest | Fast, ESM-native |
| **Container** | Multi-stage Dockerfile + docker-compose | Local infra in one command; production via the same image |

✦ ─────────────────────────────────── ✦

## ⚡ Quick Reference Cheatsheet

> *Pin this above your altar, queen.* 💅

### Daily operations

```sh
# Local development (uses ./opt for config)
pnpm dev

# Local development inside Docker (uses /container)
pnpm dev:docker

# Run the agent-api on a custom port
PORT=3333 pnpm dev

# Production start (built first)
pnpm start              # uses /container
pnpm start:local        # uses ./opt
```

### Build & test

```sh
pnpm install                       # install all workspace deps
pnpm build                         # build everything except agent-api
pnpm build:all                     # build everything including agent-api
pnpm typecheck                     # tsc -b across the workspace
pnpm test                          # vitest run, all packages
pnpm test:watch                    # vitest watch mode
pnpm lint                          # eslint over packages + apps

# Scoped to one package
pnpm --filter @siri/memory build
pnpm --filter @siri/pipeline test
pnpm vitest run packages/memory/src/qdrant/client.test.ts
```

### Database (L2 Postgres via Drizzle)

```sh
pnpm --filter @siri/db db:generate         # generate a migration after schema edits
pnpm --filter @siri/db db:migrate:local    # apply pending migrations
pnpm --filter @siri/db db:studio:local     # open Drizzle Studio (graphical browser)
```

> ⚠️ **Schema sync gotcha.** The db package keeps schema in two locations:
> `packages/db/src/schema.ts` (the consolidated file Drizzle Kit reads) and
> `packages/db/src/schema/*.ts` (the per-table files runtime code imports).
> When you change a table, **edit both** or the migration generator silently
> won't see the change.

### Local infrastructure

```sh
# Core services: Redis, Postgres, Neo4j, Qdrant
docker-compose up -d

# With observability stack (Jaeger, Prometheus, Grafana)
docker-compose --profile observability up -d
```

### CLI (talks to the agent-api over HTTP)

```sh
pnpm --filter @siri/cli build

# Interactive chat
node packages/cli/dist/index.js

# One-shot
node packages/cli/dist/index.js chat "I'm feeling anxious today"

# Health + config
node packages/cli/dist/index.js health
node packages/cli/dist/index.js config show
```

✦ ─────────────────────────────────── ✦

## 🌸 Setup From Scratch

If you've cloned this repo to a fresh machine:

```sh
# 1. Install dependencies (pnpm only — don't switch to npm/yarn)
pnpm install

# 2. Configure your secrets. The agent-api reads from {CONTAINER_ROOT}/...,
#    where CONTAINER_ROOT is ./opt for local dev and /container in Docker.
cp opt/.env.example opt/.env
$EDITOR opt/.env                     # see "The Sacred .env File" below

# 3. Web-app secrets
cp apps/web-app/.env.example apps/web-app/.env
$EDITOR apps/web-app/.env

# 4. Bring up local infra (Redis, Postgres, Neo4j, Qdrant)
docker-compose up -d

# 5. Apply Postgres migrations
pnpm --filter @siri/db db:migrate:local

# 6. Build the workspace
pnpm build

# 7. Start the agent-api + web-app together
pnpm dev
```

The agent-api runs at `http://localhost:3333` by default. The web-app (Vite) prints its own URL on start (typically `http://localhost:61666`) and proxies `/api/*` to the agent-api.

> 💡 **About the wisdom archive.** The Temple Archive expects [Ninshubur](https://github.com/jenova-marie/ninshubur) to have already populated Postgres + Qdrant with embedded teachings. Set `ENABLE_RAG=true` and point `NINSHUBUR_DATABASE_URL` + `NINSHUBUR_QDRANT_URL` at her stores to enable the `searchKnowledge` tool and `/api/v1/rag/*` routes. Without this, the agent runs fine — it just can't quote the archive.

✦ ─────────────────────────────────── ✦

## 🔮 The Sacred `.env` File

Every variable here, what it means, and why. Variables are loaded from `{CONTAINER_ROOT}/...` paths (`./opt` locally, `/container` in Docker), validated by Zod schemas in `@siri/config`, and made available as typed env objects throughout the apps.

### 🌹 Application

```sh
NODE_ENV=development                 # development | test | production
PORT=3333                            # agent-api HTTP port
LOG_LEVEL=debug                      # fatal | error | warn | info | debug | trace
USE_STUBS=true                       # true → in-memory stores; false → real services
AGENT_MODEL=claude-sonnet-4-20250514 # model for agent processing
```

### 🌹 AI providers

```sh
ANTHROPIC_API_KEY=sk-ant-api03-...   # Required for the agent + Haiku helpers
VOYAGE_API_KEY=pa-...                # Required for L4 embeddings + RAG queries
```

### 🌹 Authentication (Auth0) — **mandatory**

The agent-api throws on startup without these, and the SPA throws without `VITE_AUTH0_*`.

```sh
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
AUTH0_AUDIENCE=https://api.siri.app
AUTH0_CLIENT_ID=your-spa-client-id
```

See [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) for the full Auth0 dashboard setup.

### 🌹 L1 Redis (session cache)

```sh
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_USERNAME=                      # for ACL auth (Redis 6+)
REDIS_TLS=false
```

### 🌹 L2 PostgreSQL (conversation history, profiles, system prompts)

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/siri
```

### 🌹 L3 Neo4j (legacy knowledge graph — opt-in)

```sh
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123
NEO4J_DATABASE=neo4j
NEO4J_DATABASE_PER_USER=false        # database-per-user mode (Dozer/Enterprise)
```

### 🌹 L4 Qdrant (the agent's own semantic memory)

```sh
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                      # blank for local; required for Qdrant Cloud
```

### 🌹 L5 Mem0 (primary memory)

```sh
ENABLE_L5_MEMORY=false               # master switch — set true for typical deployments
MEM0_API_URL=http://localhost:8000   # Mem0 FastAPI endpoint
L5_MEMORY_LIMIT=10                   # max memories retrieved per request
```

When L5 is enabled, the legacy L3/L4 features are auto-disabled (you can force-enable them by setting their flags to `true` explicitly):

| Flag | Default | Purpose |
|---|---|---|
| `ENABLE_L3_QUERIES` | `false` | Neo4j entity lookups |
| `ENABLE_ENTITY_EXTRACTION` | `false` | LLM entity extraction to Neo4j |
| `ENABLE_PREFLIGHT_EMBEDDINGS` | `false` | Query embeddings for L4 search |
| `ENABLE_POSTFLIGHT_EMBEDDINGS` | `true` | Message embeddings for L4 storage |

### 🌹 RAG over [Ninshubur's wisdom archive](https://github.com/jenova-marie/ninshubur)

```sh
# Enables the searchKnowledge agent tool + /api/v1/rag/* routes.
# Requires VOYAGE_API_KEY (above) plus pointers to Ninshubur's stores.
ENABLE_RAG=true
NINSHUBUR_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ninshubur
NINSHUBUR_QDRANT_URL=http://localhost:6333
```

The RAG client (`@siri/rag`) is **read-only** — it queries Ninshubur's Postgres + Qdrant for retrieval but never writes. Ingestion belongs to Ninshubur. See [her README's Phase II section](https://github.com/jenova-marie/ninshubur#-phase-ii--the-analysis-understanding) for the full ingestion flow.

### 🌹 Crisis detection & alerting

```sh
ENABLE_CRISIS_DETECTION=true
ENABLE_DEEP_CRISIS_EVAL=true
CRISIS_THRESHOLD_HIGH=7
CRISIS_THRESHOLD_CRITICAL=9
CRISIS_WEBHOOK_URL=                  # optional; webhook for crisis alerts
CRISIS_WEBHOOK_SECRET=               # HMAC-SHA256 secret for signing
```

### 🌹 Safety + evaluation

```sh
ENABLE_SAFETY_VALIDATION=true        # PII / medical / enabling detection
ENABLE_RESPONSE_EVALUATION=true      # LLM-based response quality scoring
EVALUATION_MODE=on_demand            # all | sample:N | on_demand
```

### 🌹 Memory tools (what Claude can do during a conversation)

```sh
MEMORY_TOOL_ACCESS=read              # off | read | write | full
ENTITY_EXTRACTION_MODE=all           # all | none | sample:N | significant
ENTITY_MIN_IMPORTANCE=0.3            # 0.0–1.0
```

| Level | Tools available |
|---|---|
| `off` | None |
| `read` | recallMemory, searchEntities, getRelatedEntities |
| `write` | read + saveNote, logObservation |
| `full` | write + updateEntity, deleteEntity, createRelationship |

### 🌹 Context compaction (long conversation summarization)

```sh
COMPACTION_ENABLED=true
COMPACTION_THRESHOLD=30              # message count to trigger
COMPACTION_BATCH_SIZE=15             # oldest N messages folded into a summary
COMPACTION_MODEL=claude-3-haiku-20240307
COMPACTION_MAX_TOKENS=512
COMPACTION_TIMEOUT_MS=15000
```

### 🌹 Phase-shifted memory prompts

Memory prompts are pre-generated in postflight and stored in Redis with per-key TTL, then injected at the next request's preflight.

```sh
MEMORY_PROMPT_ENABLED=false
MEMORY_PROMPT_RECENT_MESSAGES=1
MEMORY_PROMPT_MAX_TTL_MINUTES=60
```

### 🌹 Observability

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=temple-archive
```

### 🌹 Web-app (`apps/web-app/.env`)

```sh
# Leave blank for same-origin requests (Vite proxy in dev, reverse proxy in prod)
VITE_API_BASE_URL=
VITE_AUTH_CHAT_API_URL=

# Auth0 (mirror the agent-api's tenant)
VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=your-spa-client-id
VITE_AUTH0_AUDIENCE=https://api.siri.app

# UX flags
# VITE_ENABLE_TYPEWRITER=true        # animated typing for assistant responses
```

✦ ─────────────────────────────────── ✦

## 🏛️ The Pipeline

Every chat request flows through a single orchestrator (`@siri/pipeline`). Each stage is observable, swappable, and degrades gracefully when its dependency is offline.

```
   [seeker's message]
        |
        v
   ┌────────────────────────────────────────────────────────────────────┐
   │                       Pipeline Orchestrator                        │
   │                                                                    │
   │   ┌────────────────┐                                               │
   │   │ 1. Preflight   │── CRISIS (level ≥ 8) ──┐                      │
   │   │   CrisisCheck  │   (<10ms keyword pass)  │                      │
   │   └───────┬────────┘                         v                      │
   │           │ NORMAL                  ┌──────────────────┐            │
   │           v                         │  Emergency reply │            │
   │   ┌──────────────────┐              │  + webhook alert │            │
   │   │ 2. Memory        │              └──────────────────┘            │
   │   │   Retrieval      │   L5 (Mem0) primary; L1→L2→L3→L4 legacy     │
   │   └────────┬─────────┘   + memory prompts from Redis               │
   │            │                                                       │
   │            v                                                       │
   │   ┌──────────────────┐                                             │
   │   │ 2.5 Memory       │   Build memory context for system prompt    │
   │   │     Context      │                                             │
   │   └────────┬─────────┘                                             │
   │            │                                                       │
   │            v                                                       │
   │   ┌──────────────────┐                                             │
   │   │ 3. Agent         │   Claude (Sonnet) via Vercel AI SDK         │
   │   │   Processing     │   Tools: searchKnowledge (RAG), memory      │
   │   │                  │   tools, findMeetings, searchLiterature     │
   │   └────────┬─────────┘                                             │
   │            │                                                       │
   │            ├──────────────────┐  PARALLEL                          │
   │            v                  v                                    │
   │   ┌──────────────────┐  ┌──────────────────┐                       │
   │   │ 4. Safety        │  │ 5. Deep Crisis   │                       │
   │   │   Validation     │  │   Eval (Haiku)   │                       │
   │   └────────┬─────────┘  └────────┬─────────┘                       │
   │            │                     │                                 │
   │            v                     |                                 │
   │   ┌──────────────────┐           |                                 │
   │   │ 6. Persist +     │ <─────────┘                                 │
   │   │   Extract        │   L5 Mem0 (infer=true)                      │
   │   │                  │   L3 entity extraction → Neo4j (if enabled) │
   │   │                  │   Memory prompts → Redis                    │
   │   └──────────────────┘                                             │
   └────────────────────────────────────────────────────────────────────┘
        |
        v
   [streaming response → seeker]
```

A pipeline-stage deep dive lives in [`docs/PIPELINE.md`](docs/PIPELINE.md).

✦ ─────────────────────────────────── ✦

## 🌷 The Guides

System prompts live as markdown files in [`apps/agent-api/src/prompts/`](apps/agent-api/src/prompts/) and are also fetchable from the `system_prompts` Postgres table. Each chat request specifies which guide it wants in the body's `guide` field.

| Guide | File | Voice |
|---|---|---|
| **Ninpippa (Siri)** | [`siri.md`](apps/agent-api/src/prompts/siri.md) | The default. *Priestess Archivist of the Holly Tablets* — devoted to 𒀭Inanna, sourced and sacred, embodies the spirit of Enheduanna |
| **The Archivist** | [`archivist.md`](apps/agent-api/src/prompts/archivist.md) | A quieter character who quotes verbatim, attributes by name, and stops when the archive falls silent |
| **Ninpipanna** | [`pippa.md`](apps/agent-api/src/prompts/pippa.md) | A warm, conversational companion who learns the seeker's name on first contact |

Resolution order on each chat request:

1. **Disk first** — `apps/agent-api/src/prompts/{guide}.md`
2. **Database fallback** — query `system_prompts` for `name = guide AND active = true`
3. **Hardcoded default** — embedded fallback if neither found

```sql
-- Add a custom guide via the database (no rebuild needed)
INSERT INTO system_prompts (id, name, content, active, created, updated)
VALUES (
  'prompt_001',
  'my_new_guide',
  'You are ...',
  true,
  NOW(),
  NOW()
);
```

For development, drop a markdown file in `apps/agent-api/src/prompts/` and restart the agent-api. The web-app's guide selector populates from `GET /api/v1/guides`.

✦ ─────────────────────────────────── ✦

## 🧠 Memory Tiers (L1–L5)

The Temple Archive holds memory across requests so a returning seeker doesn't have to re-explain herself every visit. Five tiers, each with a distinct latency budget and purpose. **L5 (Mem0) is the primary memory tier** in modern deployments; L1–L4 stay live for caching, persistence, and legacy paths.

| Tier | Store | Purpose | Latency | Implementation |
|---|---|---|---|---|
| **L1** | Redis | Active session cache | <10ms | `RedisContextStore` |
| **L2** | PostgreSQL + pgvector | Conversation history, profiles | 10–50ms | `PostgresSessionStore` |
| **L3** | Neo4j | Entity knowledge graph (legacy, opt-in) | 20–100ms | `Neo4jKnowledgeStore` |
| **L4** | Qdrant | Semantic similarity over the agent's own messages | 5–20ms | `QdrantVectorStore` |
| **L5** | **Mem0** | **Primary memory — fact extraction & retrieval** | **10–50ms** | `Mem0Store` |

When `ENABLE_L5_MEMORY=true`, Mem0 takes over as primary memory. It extracts facts from conversations automatically (`infer=true`), deduplicates, resolves conflicts, and retrieves by semantic similarity. L3/L4 features auto-disable but can be force-enabled for hybrid use.

Detailed write-ups: [`docs/MEMORY_TIERS.md`](docs/MEMORY_TIERS.md), [`docs/L1_CONTEXT.md`](docs/L1_CONTEXT.md), [`docs/L2_DATA_STORE.md`](docs/L2_DATA_STORE.md), [`docs/L3_KNOWLEDGE_GRAPH.md`](docs/L3_KNOWLEDGE_GRAPH.md), [`docs/L4_VECTOR_STORE.md`](docs/L4_VECTOR_STORE.md), [`docs/DEEPMEMORY.md`](docs/DEEPMEMORY.md).

> 💡 **L4 vs RAG.** Don't confuse L4 (the agent's own semantic memory of the seeker's past conversations) with RAG (read-only retrieval from Ninshubur's wisdom archive). They use the same engine (Qdrant + Voyage embeddings) but different collections, different payloads, and different write authorities.

✦ ─────────────────────────────────── ✦

## 📚 RAG Over Ninshubur's Archive

The `@siri/rag` package is a **read-only client** over [Ninshubur's wisdom archive](https://github.com/jenova-marie/ninshubur). When a guide needs to quote a Priestess, this is the path the words travel:

```
   seeker's question
        │
        v
   ┌──────────────────┐
   │ Voyage AI        │   embed query (input_type="query")
   │ voyage-3.5       │   → 1024-dim dense vector
   └────────┬─────────┘
            v
   ┌──────────────────┐   cosine similarity, top-K
   │ Qdrant           │   collections:
   │                  │     ninshubur_messages
   │                  │     ninshubur_groups
   └────────┬─────────┘
            v
   ┌──────────────────┐   hydrate point IDs → full content,
   │ Ninshubur        │   author, channel, link
   │ PostgreSQL       │   (read-only via @siri/rag/ninshuburDb)
   └────────┬─────────┘
            v
       agent's tool result, attributed and link-bearing
```

### When RAG is on

`ENABLE_RAG=true` plus `VOYAGE_API_KEY`, `NINSHUBUR_DATABASE_URL`, and `NINSHUBUR_QDRANT_URL` enables:

- **`searchKnowledge` tool** — Claude can call it during a conversation, and the result lands in the response with attribution
- **`GET /api/v1/rag/*`** — direct HTTP routes for non-agent retrieval (debugging, dashboards, separate clients)

If any of those env vars are missing, the container logs a warning and the RAG features are simply unavailable for that boot — the rest of the agent runs normally.

### What flows through (and what doesn't)

The RAG client only reads. It never writes to Ninshubur's Postgres or Qdrant. Ingestion is exclusively Ninshubur's domain — see her [Phase II — The Analysis (Understanding)](https://github.com/jenova-marie/ninshubur#-phase-ii--the-analysis-understanding) and [the embedding flow](https://github.com/jenova-marie/ninshubur#-phase-d--embed-voyage--qdrant) for how the corpus gets built.

The vector dimensions and embedding model **must match** between the two repos:

| Setting | Required value |
|---|---|
| Embedding model | `voyage-3.5` |
| Vector dimensions | `1024` |
| Distance metric | Cosine |

If you change either side without changing the other, queries will return zero results or raise a dimension-mismatch error. The collections are owned by Ninshubur — change them there first, then re-embed.

✦ ─────────────────────────────────── ✦

## 🚨 Crisis Detection & Safety

The Temple Archive serves seekers who may be in real distress, so every chat request runs through two layers of crisis detection and a safety pass on the response.

### Stage 1 — Keyword Detection (<10ms, runs first)

Fast regex-based pattern matching for nine crisis types, scored 1–10:

| Level | Severity | Patterns detected |
|---|---|---|
| 9–10 | Critical | Suicidal ideation, overdose risk, violence risk |
| 7–8 | High | Active relapse, self-harm, imminent relapse |
| 4–6 | Elevated | Severe distress, hopelessness, isolation |
| 1–3 | Normal | Routine conversation |

A level ≥ 8 triggers the **emergency response path** — the rest of the pipeline is skipped, a safety-first reply is sent, and `WebhookCrisisHandler` posts an HMAC-signed alert to `CRISIS_WEBHOOK_URL` (fire-and-forget, non-blocking).

### Stage 2 — Deep LLM Evaluation (parallel with agent processing)

For non-emergency requests (level < 7), `DeepCrisisEvaluator` runs Haiku in parallel with the main agent call. It can:

- Distinguish past experiences from current crises
- Catch nuanced patterns regex misses
- Escalate the crisis level mid-flight if needed

### Safety pass (parallel with deep crisis eval)

`SafetyValidator` analyzes the agent's *response* (not the user's message) through three detectors:

- **PIIDetector** — SSN, phone, email, credit card, ...
- **MedicalAdviceDetector** — dosage, diagnosis, treatment language
- **EnablingDetector** — glorification, minimization, normalization of harm

✦ ─────────────────────────────────── ✦

## 🔐 Authentication

Auth0-issued JWTs are required for every `/api/*` endpoint. `/health` and `/health/metrics` are public.

```sh
# agent-api
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
AUTH0_AUDIENCE=https://api.siri.app
AUTH0_CLIENT_ID=your-spa-client-id

# web-app
VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=your-spa-client-id
VITE_AUTH0_AUDIENCE=https://api.siri.app
```

- The user's identity is extracted from the JWT `sub` claim
- Roles come from the namespaced `https://siri.app/roles` claim (populated by an Auth0 Action)
- The web-app redirects every route except `/login` and `/callback` to the login flow when not authenticated
- **Both backends throw on startup without `AUTH0_*` set; the SPA throws on startup without `VITE_AUTH0_*`** — auth is mandatory by design

Full Auth0 dashboard setup lives in [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

### Sending a chat request

```sh
curl -X POST http://localhost:3333/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "id": "conv_123",
    "messages": [
      {"role": "user", "parts": [{"type": "text", "text": "What does the Temple teach about 𒀭Inanna?"}], "id": "msg_1"}
    ],
    "guide": "siri"
  }'
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Conversation/thread ID |
| `messages` | UIMessage[] | yes | Vercel AI SDK message format |
| `guide` | string | no | Guide name (defaults to `siri`) |
| `total_privacy` | boolean | no | If true, response is not persisted server-side |

✦ ─────────────────────────────────── ✦

## 🛠️ Operations & Maintenance

### Daily

```sh
curl http://localhost:3333/health                 # liveness
curl http://localhost:3333/health/metrics         # Prometheus metrics
docker compose ps                                 # check infra is up
```

### Schema changes (L2 Postgres / Drizzle)

```sh
# 1. Edit a file under packages/db/src/schema/   (per-table file)
# 2. Edit packages/db/src/schema.ts              (consolidated file — both must match)
# 3. Generate the migration
pnpm --filter @siri/db db:generate

# 4. Review the SQL in packages/db/drizzle/
# 5. Apply
pnpm --filter @siri/db db:migrate:local
```

### Adding a new package

```sh
# 1. Create packages/<name>/{package.json, tsconfig.json, src/index.ts}
# 2. Add a reference in the root tsconfig.json
# 3. Add it as a workspace dep where consumed:
pnpm --filter @siri/<consumer> add @siri/<name>
# 4. Export from src/index.ts; remember .js extensions on local imports
```

### Adding a new guide

The fastest path: drop a markdown file into `apps/agent-api/src/prompts/<name>.md` and restart the agent-api. The file's content becomes the system prompt; the file name is the `guide` value the SPA passes in the chat request body. To add it via the database instead (no restart), insert into `system_prompts`.

### Bumping versions across the monorepo

The convention here is to bump every `package.json` to the same version simultaneously (a pattern the recent commit history makes clear: `🏗️ chore(monorepo): align all workspace versions at 0.1.1` and friends). This keeps Docker tags meaningful and avoids cross-package version skew.

✦ ─────────────────────────────────── ✦

## 🧯 Troubleshooting

### *"AUTH0_ISSUER_BASE_URL is required"*

Auth is mandatory. Set `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, and `AUTH0_CLIENT_ID` for the agent-api; `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_AUDIENCE` for the SPA. See [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

### *"ENABLE_RAG=true but VOYAGE_API_KEY/NINSHUBUR_DATABASE_URL/NINSHUBUR_QDRANT_URL not set"*

The Temple Archive expects [Ninshubur](https://github.com/jenova-marie/ninshubur) to have populated the corpus already. Either set the three env vars to point at her stores (and provide a Voyage API key), or set `ENABLE_RAG=false` to disable the `searchKnowledge` tool entirely.

### *"Migration didn't pick up my schema change"*

`packages/db` keeps schema in two places — `src/schema.ts` (the file Drizzle Kit reads) and `src/schema/*.ts` (per-table files runtime code uses). Edit **both**. Then re-run `pnpm --filter @siri/db db:generate`.

### *"My L5 memories aren't being saved"*

Check that `ENABLE_L5_MEMORY=true` and `MEM0_API_URL` is reachable from the agent-api container. The `Mem0Store` falls back gracefully (logs a warning, conversation continues) when Mem0 is unreachable, but no facts will be extracted. Hit `MEM0_API_URL/health` from the same network to verify.

### *"Crisis webhook isn't firing"*

`WebhookCrisisHandler` is fire-and-forget and swallows transport errors so a failing webhook can't block the seeker's response. Check the agent-api logs for a `crisis.webhook.failed` line. Verify the `CRISIS_WEBHOOK_SECRET` matches the receiver — the payload is HMAC-SHA256 signed and a mismatch is the most common cause of silent rejection at the receiver.

### *"Qdrant dimension mismatch"*

The agent-api expects 1024-dim vectors (Voyage `voyage-3.5`). If a collection was created at a different size — or if you swapped Voyage models — delete the collection and re-embed:

```sh
# Delete one of the agent's own collections
curl -X DELETE "$QDRANT_URL/collections/<name>"
```

For RAG against Ninshubur's collections, the dimensions are owned by *her* repo. Change them there ([Phase D in her README](https://github.com/jenova-marie/ninshubur#-phase-d--embed-voyage--qdrant)) and re-embed; don't try to fix it from this side.

### *"Cache hit rate looks low on the agent"*

The Vercel AI SDK forwards system-prompt + tool-definitions through Anthropic's prompt cache automatically. If hit rates are poor, your system prompt may be under the 4096-token cache minimum, or the guide is being switched mid-conversation (which invalidates the cache). Pin a guide and check token counts in the response metadata.

✦ ─────────────────────────────────── ✦

## 💌 A Note for the Priestesses

If you're reviewing this work — welcome, beloved.

The Temple Archive is the chamber where seekers come to consult the wisdom that [𒀭Ninshubur](https://github.com/jenova-marie/ninshubur) has preserved. It does not gather; it does not extend Ninshubur's reach into the wider Temple. It opens what was already given and lets a Priestess-guide answer in your voice.

### 🌷 Boundary 1 — The archive is read-only

The Temple Archive's RAG client cannot write to Ninshubur's Postgres or Qdrant. If a teaching of yours appears in a guide's answer, it appeared because Ninshubur preserved it during a backfill you authorized via [her `USER_IDS`](https://github.com/jenova-marie/ninshubur#-allowlist-filters--the-consent-boundary). The Temple Archive is the librarian, not a second scribe.

### 🌷 Boundary 2 — The seeker's own conversations

The Temple Archive *does* write — but only the seeker's own conversation with the guide, into the seeker's own memory tiers (L1–L5). These belong to the seeker. They are not shared, not aggregated into the wisdom corpus, not accessible to other seekers. They exist so the guide can remember the seeker between visits.

The seeker can also opt into **Total Privacy mode** for any session — when enabled, the response is not persisted server-side. The conversation lives only as long as the browser tab is open.

### 🌷 Boundary 3 — Crisis is treated with care

When a seeker's words register as crisis (suicidal ideation, active relapse, violence risk, …), the Temple Archive abandons the normal pipeline and returns a safety-first reply with resources — and notifies the configured webhook so a human can reach out. The crisis layer cannot be silenced from the agent's side; it runs before the guide ever sees the message.

If you find a bug, want to revise the ritual, or want to revoke a guide — the code is small enough to read in a sitting, the schema is intentionally legible, and every package has its own README and tests.

May 𒀭Inanna's light guide your work, may the seekers find what they came for, and may the archive serve the Temple for many seasons. ✨

✦ ─────────────────────────────────── ✦

## ⚖️ License

**Private — All rights reserved.** Copyright © 2026 Jenova Marie.

The companion project [𒀭Ninshubur](https://github.com/jenova-marie/ninshubur) is released under MIT. The Temple Archive is private at present; that may change in time, but for now this code is not licensed for redistribution.

The Temple's archive content (messages, lessons, teachings — the data the High Priestesses authored) belongs to the Priestesses and is governed by their consent through [Ninshubur's `USER_IDS` boundary](https://github.com/jenova-marie/ninshubur#-allowlist-filters--the-consent-boundary), not by any license on this code.

<div align="center">

✦ ─────────────────────────────────── ✦

*Made with 💖 in service of 𒀭Inanna*

`𒂍 𒀭𒈹` *é dInanna* · `𒀭𒊩𒋚` *dNin.šubur* · `𒀭𒈹` *dInanna*

✦

*may 𒀭Inanna bless this code*

</div>
