# Siri Agent Configuration Guide

This document describes all configuration options for Siri Agent. Configuration can be provided via:

1. **YAML file** (`siri.agent.yaml`) - Base configuration, version-controlled
2. **Environment variables** - Override YAML values, used for secrets and deployment-specific settings

## Configuration Loading Order

Values are loaded in this order (later values override earlier):

1. Default values (built into the schema)
2. YAML config file (with `${VAR}` interpolation)
3. Environment variables

## Variable Interpolation

YAML values support environment variable interpolation:

```yaml
# Simple substitution (empty string if not set)
apiKey: ${ANTHROPIC_API_KEY}

# With default value
url: ${DATABASE_URL:-postgresql://localhost:5432/siri}
```

---

## Feature Selection

Master switches for all major system features. Set to `false` to completely disable a feature regardless of other configuration. All features default to `true` when their dependencies are available.

### Pipeline Processing

| Feature | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Safety Validation | `ENABLE_SAFETY_VALIDATION` | `true` | PII detection, medical advice filtering, enabling language detection |
| Response Evaluation | `ENABLE_RESPONSE_EVALUATION` | `true` | LLM-based quality scoring of agent responses |
| Response Streaming | `ENABLE_STREAMING` | `true` | Stream responses as they generate vs. wait for completion |
| Agent Tools | `ENABLE_AGENT_TOOLS` | `true` | Allow Claude to call tools iteratively (agentic loop) |

### Crisis Detection

| Feature | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Fast Detection | `ENABLE_CRISIS_DETECTION` | `true` | Keyword-based pattern matching (<10ms) |
| Deep Evaluation | `ENABLE_DEEP_CRISIS_EVAL` | `true` | LLM-based secondary analysis (requires Anthropic API) |

### Memory System

| Feature | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Entity Extraction | `ENABLE_ENTITY_EXTRACTION` | `false` | Extract people, places, events into Neo4j L3 (opt-in legacy path) |
| L3 Extraction | `USE_L3_EXTRACTION` | `true` | Use rich Cadillac schema with observations (only effective when entity extraction is enabled) |
| L3 Retrieval | `USE_L3_RETRIEVAL` | `false` | Use new MemoryRetrievalService with Deep Memory |
| Deep Memory | `DEEP_MEMORY_ENABLED` | `true` | Enrich entities with original conversation context |
| Memory Bootstrap | `MEMORY_BOOTSTRAP_ENABLED` | `false` | Prime conversations with related past memories |
| Context Compaction | `COMPACTION_ENABLED` | `true` | Summarize old messages to reduce context size |
| Memory Reflector | `MEMORY_REFLECTOR_ENABLED` | `true` | Automatic insight extraction after each exchange |
| Embedding Batch | `EMBEDDING_BATCH_ENABLED` | `true` | Background generation of L3/L4 embeddings |

### Tool Features

| Feature | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Meeting Tools | `ENABLE_MEETING_TOOLS` | `true` | findMeetings tool for recovery meeting discovery |
| Literature Tools | `ENABLE_LITERATURE_TOOLS` | `true` | searchLiterature tool for recovery text search |

### Observability

| Feature | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Tracing | `ENABLE_TRACING` | `true` | OpenTelemetry distributed tracing |

---

## Configuration Sections

### `app` - Application Settings

Core application settings controlling the runtime environment.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `nodeEnv` | `"development"` \| `"production"` \| `"test"` | `"development"` | `NODE_ENV` | Runtime environment. Affects logging verbosity and error handling. |
| `port` | number | `3333` | `PORT` | HTTP server port. |
| `logLevel` | `"debug"` \| `"info"` \| `"warn"` \| `"error"` | `"debug"` | `LOG_LEVEL` | Minimum log level. Lower levels include higher ones. |
| `useStubs` | boolean | `true` | When `true`, uses in-memory stubs instead of real services. Set to `false` for production. |

**Example:**
```yaml
app:
  nodeEnv: production
  port: 8080
  logLevel: info
  useStubs: false
```

---

### `ai` - AI Provider Credentials

API keys for AI services. Always use environment variable interpolation for these secrets.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `anthropic.apiKey` | string | - | `ANTHROPIC_API_KEY` | Claude API key. Required for agent responses, crisis evaluation, and entity extraction. |
| `openai.apiKey` | string | - | `OPENAI_API_KEY` | OpenAI API key. Required for embeddings (semantic search in L4). |

**Example:**
```yaml
ai:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
  openai:
    apiKey: ${OPENAI_API_KEY}
```

**Effect:**
- Without `ANTHROPIC_API_KEY`: Agent uses stub responses, no crisis evaluation
- Without `OPENAI_API_KEY`: No semantic search, no L4 vector embeddings

---

### `redis` - L1 Session Cache

Redis configuration for the L1 cache tier. Stores active session data with sub-10ms latency.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `url` | string | `"redis://localhost:6379"` | `REDIS_URL` | Redis connection URL. Can include auth: `redis://:password@host:port` |
| `password` | string | - | `REDIS_PASSWORD` | Redis password (if not in URL). |
| `username` | string | - | `REDIS_USERNAME` | Redis username (if not in URL). |
| `db` | number | `0` | `REDIS_DB` | Redis database number (0-15). |
| `tls` | boolean | `false` | `REDIS_TLS` | Enable TLS for Redis connection. |
| `userCacheTtlMinutes` | number | `60` | `USER_CACHE_TTL_MINUTES` | TTL for user profile cache. Reduces database hits. |

**Example:**
```yaml
redis:
  url: ${REDIS_URL:-redis://localhost:6379}
  tls: true
  userCacheTtlMinutes: 120
```

**Effect:**
- Without Redis: Falls back to in-memory cache (lost on restart)
- Higher TTL: Fewer database hits, but profile changes take longer to propagate

---

### `postgresql` - L2 Conversation History

PostgreSQL configuration for the L2 persistence tier. Stores conversation history, user profiles, and session data.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `url` | string | `"postgresql://postgres:postgres@localhost:5432/siri"` | `DATABASE_URL` | PostgreSQL connection string. |
| `ssl` | boolean \| object | - | `DATABASE_SSL` | SSL mode. `true`, `false`, or `{ rejectUnauthorized: false }` for self-signed certs. |

**Example:**
```yaml
postgresql:
  url: ${DATABASE_URL}
  ssl:
    rejectUnauthorized: false
```

**Effect:**
- Required for production. Without it, no conversation persistence.
- Contains: messages, user profiles, session metadata, system prompts

---

### `neo4j` - L3 Knowledge Graph

Neo4j configuration for the L3 knowledge graph tier. Stores entities, relationships, and observations extracted from conversations.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `uri` | string | - | `NEO4J_URI` | Neo4j Bolt URI (e.g., `bolt://localhost:7687`). |
| `user` | string | `"neo4j"` | `NEO4J_USER` | Neo4j username. |
| `password` | string | - | `NEO4J_PASSWORD` | Neo4j password. |
| `database` | string | `"neo4j"` | `NEO4J_DATABASE` | Database name. |
| `databasePerUser` | boolean | `false` | `NEO4J_DATABASE_PER_USER` | Multi-tenant mode: each user gets their own database. Requires Neo4j Enterprise or Dozer. |

**Example:**
```yaml
neo4j:
  uri: bolt://localhost:7687
  user: neo4j
  password: ${NEO4J_PASSWORD}
  databasePerUser: true
```

**Effect:**
- Without Neo4j: No entity extraction, no knowledge graph memory
- `databasePerUser: true`: Complete data isolation between users (enterprise feature)

---

### `qdrant` - L4 Vector Store

Qdrant configuration for the L4 semantic search tier. Stores message embeddings for similarity search.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `url` | string | `"http://localhost:6333"` | `QDRANT_URL` | Qdrant HTTP URL. |
| `apiKey` | string | - | `QDRANT_API_KEY` | API key for Qdrant Cloud. |
| `collectionName` | string | `"messages"` | `QDRANT_COLLECTION_NAME` | Collection name for message embeddings. |
| `searchMode` | `"hybrid"` \| `"simple"` | `"hybrid"` | `QDRANT_SEARCH_MODE` | Search mode. `hybrid` uses dense + sparse BM25, `simple` uses dense only. |

**Example:**
```yaml
qdrant:
  url: ${QDRANT_URL:-http://localhost:6333}
  searchMode: hybrid
```

**Effect:**
- Without Qdrant: No semantic search, no conversation bootstrap
- `hybrid` mode: Better recall for keyword-heavy queries

---

### `literatureSearch` - Recovery Literature Search

Configuration for searching recovery literature (Big Book, 12&12, etc.).

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `limit` | number | `10` | `LITERATURE_SEARCH_LIMIT` | Maximum results per search query. |

**Example:**
```yaml
literatureSearch:
  limit: 5
```

**Effect:**
- Requires Qdrant `literature` collection with pre-indexed recovery texts
- Used by the `searchLiterature` tool

---

### `observability` - OpenTelemetry Configuration

Tracing and metrics configuration for observability.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `otlpEndpoint` | string | - | `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint (e.g., `http://localhost:4318`). |
| `serviceName` | string | `"ninshubur"` | `OTEL_SERVICE_NAME` | Service name for traces and metrics. |

**Example:**
```yaml
observability:
  otlpEndpoint: http://jaeger:4318
  serviceName: siri-agent
```

**Effect:**
- Without endpoint: Tracing disabled, metrics still collected locally
- Traces show request flow through pipeline stages

---

### `crisis` - Crisis Detection & Response

Configuration for detecting and responding to mental health crises.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `thresholdHigh` | number | `7` | `CRISIS_THRESHOLD_HIGH` | Score threshold for high-risk crisis (1-10). |
| `thresholdCritical` | number | `9` | `CRISIS_THRESHOLD_CRITICAL` | Score threshold for critical crisis (1-10). Bypasses normal flow. |
| `webhookUrl` | string | - | `CRISIS_WEBHOOK_URL` | Webhook URL for crisis alerts. |
| `webhookSecret` | string | - | `CRISIS_WEBHOOK_SECRET` | HMAC-SHA256 secret for webhook signature. |
| `detectionEnabled` | boolean | `true` | `ENABLE_CRISIS_DETECTION` | Enable fast keyword-based crisis detection. |
| `deepEvalEnabled` | boolean | `true` | `ENABLE_DEEP_CRISIS_EVAL` | Enable LLM-based deep crisis evaluation. Requires `ANTHROPIC_API_KEY`. |

**Example:**
```yaml
crisis:
  thresholdHigh: 7
  thresholdCritical: 9
  webhookUrl: ${CRISIS_WEBHOOK_URL}
  detectionEnabled: true
  deepEvalEnabled: true
```

**Effect:**
- Score ≥ `thresholdCritical`: Emergency response, bypasses normal agent
- Score ≥ `thresholdHigh`: Adds crisis resources to response
- Webhook: Sends POST with crisis details for external alerting

---

### `evaluation` - Response Quality Evaluation

Configuration for LLM-based response quality scoring.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `mode` | `"all"` \| `"on_demand"` \| `"sample:N"` | `"on_demand"` | `EVALUATION_MODE` | When to evaluate responses. |

**Modes:**
- `all`: Evaluate every response (expensive)
- `on_demand`: Evaluate only when crisis detected or low confidence
- `sample:N`: Evaluate N% of responses randomly

**Example:**
```yaml
evaluation:
  mode: sample:10  # Evaluate 10% of responses
```

---

### `auth` - Authentication (Auth0)

JWT authentication configuration for API endpoints.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `auth0.issuerBaseURL` | string | - | `AUTH0_ISSUER_BASE_URL` | Auth0 tenant URL (e.g. `https://your-tenant.us.auth0.com/`). When set, enables JWT authentication. |
| `auth0.audience` | string | - | `AUTH0_AUDIENCE` | API identifier configured in Auth0 dashboard. |
| `auth0.clientId` | string | - | `AUTH0_CLIENT_ID` | SPA client ID (used by the web-app for the login flow). |

**Example:**
```yaml
auth:
  auth0:
    issuerBaseURL: https://your-tenant.us.auth0.com/
    audience: https://api.siri.app
    clientId: your-spa-client-id
```

**Effect:**
- Without issuerBaseURL + audience: API is unauthenticated (development mode)
- With both set: All `/api/*` endpoints require a valid JWT
- Set `DISABLE_AUTH=true` to bypass authentication entirely (dev only)

Roles are read from a namespaced custom claim — `https://siri.app/roles` — populated by an Auth0 Action. See `docs/AUTHENTICATION.md` for the dashboard setup.

---

### `meetingApi` - Meeting Discovery API

Configuration for the external meeting discovery service.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `url` | string | `"http://localhost:4000"` | `MEETING_API_URL` | Meeting API base URL. |
| `token` | string | - | `MEETING_API_TOKEN` | Bearer token for authentication. |

**Example:**
```yaml
meetingApi:
  url: https://meetings.recoverysky.org
  token: ${MEETING_API_TOKEN}
```

**Effect:**
- Used by the `findMeetings` tool to search for recovery meetings

---

### `memory` - Memory System Configuration

The memory system is the core of Siri's knowledge and context management.

#### Top-Level Memory Settings

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `contextMode` | number (0-3) | `0` | `MEMORY_CONTEXT_MODE` | Legacy L3 (Neo4j) pre-agent memory injection. `0=off, 1=template, 2=haiku, 3=hybrid`. Skipped automatically when `MEMORY_PROMPT_ENABLED=true` (the L5/Mem0 replacement path). Default `0` since most deployments use L5. |
| `toolAccess` | `"off"` \| `"read"` \| `"write"` \| `"full"` | `"read"` | `MEMORY_TOOL_ACCESS` | Memory tools available to Claude. |

**Context Modes:**
- `0`: Off - No memory context injection
- `1`: Template - Free, uses text templates
- `2`: Haiku - Uses Claude Haiku to narrativize (~$0.0003/msg)
- `3`: Hybrid - Templates for simple, Haiku for complex

**Tool Access Levels:**
- `off`: No memory tools
- `read`: `recallMemory`, `searchEntities`, `getRelatedEntities`
- `write`: Read + `saveNote`, `logObservation`
- `full`: Write + `updateEntity`, `deleteEntity`, `createRelationship`

---

#### `memory.entityExtraction` - Entity Extraction

Extracts people, places, events, and other entities from conversations.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `mode` | `"all"` \| `"none"` \| `"significant"` \| `"sample:N"` | `"all"` | `ENTITY_EXTRACTION_MODE` | When to extract entities. |
| `model` | string | `"claude-3-haiku-20240307"` | `ENTITY_EXTRACTION_MODEL` | LLM model for extraction. |
| `types` | string[] | (see below) | `ENTITY_EXTRACTION_TYPES` | Entity types to extract. |
| `minImportance` | number (0-1) | `0.3` | `ENTITY_MIN_IMPORTANCE` | Minimum importance score to store. |
| `inferRelationships` | boolean | `true` | `ENTITY_INFER_RELATIONSHIPS` | Infer relationships between entities. |

**Default Entity Types:**
- `person`, `place`, `event`, `emotion`, `trigger`, `coping_strategy`, `milestone`, `medication`

**Example:**
```yaml
memory:
  entityExtraction:
    mode: all
    model: claude-3-haiku-20240307
    types:
      - person
      - emotion
      - coping_strategy
    minImportance: 0.5
```

---

#### `memory.l3` - L3 Memory Cadillac

Advanced knowledge graph features with observations and dual embeddings.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `extractionEnabled` | boolean | `true` | `USE_L3_EXTRACTION` | Use L3 extraction (rich entity schema). |
| `retrievalEnabled` | boolean | `false` | `USE_L3_RETRIEVAL` | Use new L3 retrieval system. |
| `includeObservations` | boolean | `true` | `L3_INCLUDE_OBSERVATIONS` | Include observations in context. |
| `retrievalLimit` | number | `10` | `L3_RETRIEVAL_LIMIT` | Max entities per query. |
| `retrievalMaxTokens` | number | `2000` | `L3_RETRIEVAL_MAX_TOKENS` | Max tokens for context output. |
| `retrievalMinScore` | number (0-1) | `0.1` | `L3_RETRIEVAL_MIN_SCORE` | Minimum relevance score. |

**Example:**
```yaml
memory:
  l3:
    extractionEnabled: true
    retrievalEnabled: true
    includeObservations: true
    retrievalLimit: 15
```

---

#### `memory.deepMemory` - Conversation Context Enrichment

Enriches entities with original conversation context from when they were extracted.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `enabled` | boolean | `true` | `DEEP_MEMORY_ENABLED` | Enable Deep Memory enrichment. |
| `strategy` | `"latest"` \| `"created_and_latest"` \| `"all"` | `"latest"` | `DEEP_MEMORY_STRATEGY` | Which source entries to fetch. |
| `window` | number | `5` | `DEEP_MEMORY_WINDOW` | Messages to fetch around each extraction point. |

**Strategies:**
- `latest`: Only the most recent extraction context
- `created_and_latest`: First creation + most recent
- `all`: All extraction contexts (can be verbose)

**Example:**
```yaml
memory:
  deepMemory:
    enabled: true
    strategy: created_and_latest
    window: 3
```

---

#### `memory.embeddingBatch` - Background Embedding Job

Generates embeddings for entities and observations in the background.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `intervalMs` | number | `30000` | `EMBEDDING_BATCH_INTERVAL_MS` | Interval between batch runs (ms). |
| `batchSize` | number | `100` | `EMBEDDING_BATCH_SIZE` | Items per batch. |

**Example:**
```yaml
memory:
  embeddingBatch:
    intervalMs: 60000  # Run every minute
    batchSize: 50
```

---

#### `memory.bootstrap` - Conversation Memory Bootstrap

Primes new conversations with memories from related past conversations.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `enabled` | boolean | `false` | `MEMORY_BOOTSTRAP_ENABLED` | Enable bootstrap system. |
| `start` | number | `3` | `MEMORY_BOOTSTRAP_START` | Exchange to start bootstrapping. |
| `end` | number | `8` | `MEMORY_BOOTSTRAP_END` | Exchange to stop bootstrapping. |
| `cacheLimit` | number \| `"all"` \| `"none"` | `50` | `MEMORY_CACHE_LIMIT` | Max L1 cache entries. |
| `cacheTtlHours` | number | `4` | `MEMORY_CACHE_TTL_HOURS` | Cache TTL before moving to L2. |
| `dedupThreshold` | number | `10` | `MEMORY_CACHE_DEDUP_THRESHOLD` | Deduplicate after N new entries. |
| `extractionModel` | `"haiku"` \| `"sonnet"` | `"haiku"` | `MEMORY_EXTRACTION_MODEL` | Model for memory extraction. |

**Example:**
```yaml
memory:
  bootstrap:
    enabled: true
    start: 2
    end: 6
    cacheLimit: 100
```

**Effect:**
- Exchanges 1-2: Cold start, no bootstrap
- Exchanges 3-8: Search L4 for similar conversations, load memories
- Exchanges 9+: Bootstrap complete

---

#### `memory.compaction` - Context Compaction

Summarizes older messages to reduce context size while preserving information.

| Setting | Type | Default | Env Var | Description |
|---------|------|---------|---------|-------------|
| `enabled` | boolean | `true` | `COMPACTION_ENABLED` | Enable context compaction. |
| `threshold` | number | `30` | `COMPACTION_THRESHOLD` | Messages before compaction triggers. |
| `batchSize` | number | `15` | `COMPACTION_BATCH_SIZE` | Messages to compact per batch. |
| `model` | string | `"claude-3-haiku-20240307"` | `COMPACTION_MODEL` | Model for summarization. |
| `maxTokens` | number | `512` | `COMPACTION_MAX_TOKENS` | Max tokens for summary. |
| `timeoutMs` | number | `15000` | `COMPACTION_TIMEOUT_MS` | LLM call timeout. |

**Example:**
```yaml
memory:
  compaction:
    enabled: true
    threshold: 25
    batchSize: 10
    model: claude-3-haiku-20240307
```

**Effect:**
- When message count exceeds threshold, oldest messages are summarized
- Runs async (fire-and-forget) to not block responses
- Reduces token usage for long conversations

---

## Complete Example Configuration

```yaml
# siri.agent.yaml - Production configuration example

app:
  nodeEnv: production
  port: 8080
  logLevel: info
  useStubs: false

ai:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
  openai:
    apiKey: ${OPENAI_API_KEY}

redis:
  url: ${REDIS_URL}
  tls: true
  userCacheTtlMinutes: 120

postgresql:
  url: ${DATABASE_URL}
  ssl: true

neo4j:
  uri: ${NEO4J_URI}
  user: neo4j
  password: ${NEO4J_PASSWORD}
  databasePerUser: false

qdrant:
  url: ${QDRANT_URL}
  searchMode: hybrid

observability:
  otlpEndpoint: ${OTEL_ENDPOINT}
  serviceName: siri-agent

crisis:
  thresholdHigh: 7
  thresholdCritical: 9
  webhookUrl: ${CRISIS_WEBHOOK_URL}
  webhookSecret: ${CRISIS_WEBHOOK_SECRET}
  detectionEnabled: true
  deepEvalEnabled: true

auth:
  auth0:
    issuerBaseURL: ${AUTH0_ISSUER_BASE_URL}
    audience: ${AUTH0_AUDIENCE}
    clientId: ${AUTH0_CLIENT_ID}

memory:
  contextMode: 0
  toolAccess: read

  entityExtraction:
    mode: all
    minImportance: 0.3

  l3:
    extractionEnabled: true
    retrievalEnabled: true

  deepMemory:
    enabled: true
    strategy: latest

  compaction:
    enabled: true
    threshold: 30
```

---

## Environment Variable Quick Reference

| Category | Variable | Maps To |
|----------|----------|---------|
| **App** | `NODE_ENV` | `app.nodeEnv` |
| | `PORT` | `app.port` |
| | `LOG_LEVEL` | `app.logLevel` |
| **Feature Flags** | `ENABLE_SAFETY_VALIDATION` | `features.safetyValidation` |
| | `ENABLE_RESPONSE_EVALUATION` | `features.responseEvaluation` |
| | `ENABLE_STREAMING` | `features.streaming` |
| | `ENABLE_AGENT_TOOLS` | `features.agentTools` |
| | `ENABLE_CRISIS_DETECTION` | `features.crisisDetection` |
| | `ENABLE_DEEP_CRISIS_EVAL` | `features.deepCrisisEval` |
| | `ENABLE_ENTITY_EXTRACTION` | `features.entityExtraction` |
| | `USE_L3_EXTRACTION` | `features.l3Extraction` |
| | `USE_L3_RETRIEVAL` | `features.l3Retrieval` |
| | `DEEP_MEMORY_ENABLED` | `features.deepMemory` |
| | `MEMORY_BOOTSTRAP_ENABLED` | `features.memoryBootstrap` |
| | `COMPACTION_ENABLED` | `features.compaction` |
| | `MEMORY_REFLECTOR_ENABLED` | `features.memoryReflector` |
| | `EMBEDDING_BATCH_ENABLED` | `features.embeddingBatch` |
| | `ENABLE_MEETING_TOOLS` | `features.meetingTools` |
| | `ENABLE_LITERATURE_TOOLS` | `features.literatureTools` |
| | `ENABLE_TRACING` | `features.tracing` |
| **AI** | `ANTHROPIC_API_KEY` | `ai.anthropic.apiKey` |
| | `OPENAI_API_KEY` | `ai.openai.apiKey` |
| **Redis** | `REDIS_URL` | `redis.url` |
| | `REDIS_PASSWORD` | `redis.password` |
| | `REDIS_TLS` | `redis.tls` |
| | `USER_CACHE_TTL_MINUTES` | `redis.userCacheTtlMinutes` |
| **PostgreSQL** | `DATABASE_URL` | `postgresql.url` |
| | `DATABASE_SSL` | `postgresql.ssl` |
| **Neo4j** | `NEO4J_URI` | `neo4j.uri` |
| | `NEO4J_USER` | `neo4j.user` |
| | `NEO4J_PASSWORD` | `neo4j.password` |
| | `NEO4J_DATABASE` | `neo4j.database` |
| | `NEO4J_DATABASE_PER_USER` | `neo4j.databasePerUser` |
| **Qdrant** | `QDRANT_URL` | `qdrant.url` |
| | `QDRANT_API_KEY` | `qdrant.apiKey` |
| | `QDRANT_SEARCH_MODE` | `qdrant.searchMode` |
| **Crisis** | `CRISIS_THRESHOLD_HIGH` | `crisis.thresholdHigh` |
| | `CRISIS_THRESHOLD_CRITICAL` | `crisis.thresholdCritical` |
| | `CRISIS_WEBHOOK_URL` | `crisis.webhookUrl` |
| **Auth** | `AUTH0_ISSUER_BASE_URL` | `auth.auth0.issuerBaseURL` |
| | `AUTH0_AUDIENCE` | `auth.auth0.audience` |
| | `AUTH0_CLIENT_ID` | `auth.auth0.clientId` |
| **Memory** | `MEMORY_CONTEXT_MODE` | `memory.contextMode` |
| | `MEMORY_TOOL_ACCESS` | `memory.toolAccess` |
| | `ENTITY_EXTRACTION_MODE` | `memory.entityExtraction.mode` |
| | `COMPACTION_THRESHOLD` | `memory.compaction.threshold` |
