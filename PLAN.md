# RecoverySky Agent - Implementation Roadmap

## Current State

**Phases 0-8 substantially complete.** Production-ready foundation with multi-tier memory:

- 10 packages in pnpm monorepo (types, observability, memory, crisis, safety, tools, agent, evaluation, pipeline, cli)
- 1 application (apps/api) + @pippa/db package
- Pipeline orchestrator with 6-stage processing
- **1000 tests passing** with dedicated `tests/` directories
- Vercel AI SDK integration with Claude (VercelAIAgentProvider)
- Multi-tier memory: Redis (L1), PostgreSQL (L2), Neo4j (L3), Qdrant (L4)
- LLM-based entity extraction to knowledge graph
- Production safety validators (PII, Medical, Enabling detectors)
- JWT authentication via Zitadel
- Meeting discovery API integration (findMeetings tool)

**What works today:**
- Send messages via CLI or HTTP with real Claude responses
- Crisis detection with keyword patterns (9 categories) + deep LLM evaluation
- Multi-tier memory with Redis caching, PostgreSQL persistence, Neo4j graph, Qdrant vectors
- Entity extraction from conversations to knowledge graph
- Memory tools for agent to query/save to knowledge graph
- Safety validation (PII detection, medical advice, enabling language)
- LLM-based response evaluation
- JWT authentication (Zitadel)
- Meeting discovery (AA, NA, CMA, RD)

**What needs work:**
- Neo4j schema documentation (see Phase 8.6)
- Streaming responses endpoint
- Production hardening (Phase 9)
- CI/CD pipeline

---

## Implementation Phases

### Phase 1: Real Agent Integration (Start Here)

**Why First:** The agent is the core value proposition. Everything else supports it.

**Goal:** Replace MockAgentProvider with Claude via Anthropic SDK

**Package:** `@pippa/agent`

**Tasks:**

```
1.1 [ ] Install Anthropic SDK
        pnpm --filter @pippa/agent add @anthropic-ai/sdk

1.2 [ ] Create ClaudeAgentProvider
        packages/agent/src/ClaudeAgentProvider.ts
        - Implement IAgentProvider interface
        - generate() method for non-streaming
        - stream() method returning AsyncGenerator<StreamChunk>
        - Token usage tracking
        - Error handling with Result types

1.3 [ ] Environment Configuration
        - Add ANTHROPIC_API_KEY to .env.example
        - Update container.ts to select provider based on USE_STUBS

1.4 [ ] Streaming Support in Pipeline
        - Update Pipeline to support streaming mode
        - Update chat route to support SSE responses
        - Add streaming endpoint: POST /api/chat/stream

1.5 [ ] Tool Integration
        - Connect @pippa/tools definitions to agent
        - Implement tool execution loop
        - Handle tool_use stop reason

1.6 [ ] Unit Tests
        - Test ClaudeAgentProvider with mocked SDK
        - Test streaming behavior
        - Test tool calling flow
```

**Verification:**
```bash
# Set API key
export ANTHROPIC_API_KEY=sk-ant-xxx

# Test real response
curl -X POST http://localhost:3333/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, how are you?", "conversationId": "test-1", "userId": "user-1"}'
```

---

### Phase 2: L2 Memory (PostgreSQL + pgvector)

**Why Second:** Persistent conversation history is essential for context.

**Goal:** Replace InMemorySessionStore with PostgreSQL

**Package:** `@pippa/memory`

**Prerequisites:**
- PostgreSQL running (docker-compose up postgres)
- pgvector extension enabled

**Tasks:**

```
2.1 [ ] Install Dependencies
        pnpm --filter @pippa/memory add pg @types/pg drizzle-orm drizzle-kit

2.2 [ ] Database Schema (Drizzle)
        packages/memory/src/db/schema.ts
        - conversations table
        - messages table (with vector column)
        - user_memory table
        - session_summaries table

2.3 [ ] Migrations
        packages/memory/drizzle/
        - Set up drizzle.config.ts
        - Create initial migration
        - Add pnpm script: "db:migrate"

2.4 [ ] PostgresSessionStore Implementation
        packages/memory/src/stores/PostgresSessionStore.ts
        - Implement ISessionStore interface
        - getConversationHistory()
        - getUserProfile()
        - persistMessage()
        - updateUserProfile()

2.5 [ ] Vector Search Integration
        - Add embedding column to messages
        - Implement hybrid search (metadata + vector)
        - Query for semantically similar messages

2.6 [ ] Update MemoryOrchestrator
        - Use PostgresSessionStore as L2
        - Implement L1 → L2 fallback properly
        - Warm L1 cache after L2 hit

2.7 [ ] Update Container
        - Inject PostgresSessionStore when USE_STUBS=false
        - Connection pooling configuration

2.8 [ ] Integration Tests
        - Test with Docker PostgreSQL
        - Test message persistence
        - Test user profile CRUD
        - Test vector search
```

**Verification:**
```bash
# Start PostgreSQL
docker-compose up -d postgres

# Run migrations
pnpm --filter @pippa/memory db:migrate

# Start server
USE_STUBS=false pnpm dev

# Send message, restart server, verify history persists
```

---

### Phase 3: L1 Memory (Redis)

**Why Third:** Adds session caching for performance.

**Goal:** Replace InMemoryContextStore with Redis

**Package:** `@pippa/memory`

**Prerequisites:**
- Redis running (docker-compose up redis)

**Tasks:**

```
3.1 [ ] Install Dependencies
        pnpm --filter @pippa/memory add ioredis @types/ioredis

3.2 [ ] RedisContextStore Implementation
        packages/memory/src/stores/RedisContextStore.ts
        - Implement IContextStore interface
        - Sorted sets for message ordering
        - Hash maps for session state
        - TTL management (4 hour default)

3.3 [ ] Redis Key Schema
        - session:{conversationId}:messages (SortedSet)
        - session:{conversationId}:state (Hash)
        - user:{userId}:preferences (Hash)

3.4 [ ] Connection Management
        - Connection pooling
        - Reconnection handling
        - Health check endpoint

3.5 [ ] Cache Invalidation
        - TTL-based expiry
        - Explicit invalidation on profile update

3.6 [ ] Update MemoryOrchestrator
        - L1 hit returns immediately
        - L1 miss queries L2, warms L1
        - Track cache hit/miss metrics

3.7 [ ] Integration Tests
        - Test with Docker Redis
        - Test TTL behavior
        - Test cache warming
```

**Verification:**
```bash
# Start Redis
docker-compose up -d redis

# Start server
USE_STUBS=false pnpm dev

# Send multiple messages, verify Redis keys
docker exec recoverysky-redis redis-cli keys '*'
```

---

### Phase 4: Embeddings Integration

**Why Fourth:** Required for semantic search in L2 and L4.

**Goal:** Generate embeddings for messages, enable semantic search

**Packages:** `@pippa/memory`, `@pippa/types`

**Tasks:**

```
4.1 [ ] Install OpenAI SDK
        pnpm --filter @pippa/memory add openai

4.2 [ ] OpenAIEmbeddingProvider Implementation
        packages/memory/src/providers/OpenAIEmbeddingProvider.ts
        - Implement IEmbeddingProvider interface
        - embed() for single text
        - embedBatch() for bulk processing
        - text-embedding-3-small model (1536 dimensions)

4.3 [ ] Embedding Pipeline
        - Generate embedding on message persist
        - Store in PostgreSQL vector column
        - Store in Qdrant (Phase 5)

4.4 [ ] Semantic Search in L2
        - Query similar messages by embedding
        - Combine with metadata filters
        - Return top-k matches

4.5 [ ] Update Pipeline
        - Generate query embedding for incoming message
        - Pass to MemoryOrchestrator
        - Include semantic matches in context

4.6 [ ] Rate Limiting & Batching
        - Batch embeddings for efficiency
        - Handle rate limits gracefully
```

**Verification:**
```bash
# Set API key
export OPENAI_API_KEY=sk-xxx

# Send message, verify embedding stored
# Query for semantic similarity
```

---

### Phase 5: L4 Memory (Qdrant)

**Why Fifth:** Full semantic search across all history.

**Goal:** Replace InMemoryVectorStore with Qdrant

**Package:** `@pippa/memory`

**Prerequisites:**
- Qdrant running (docker-compose up qdrant)

**Tasks:**

```
5.1 [ ] Install Qdrant Client
        pnpm --filter @pippa/memory add @qdrant/js-client-rest

5.2 [ ] QdrantVectorStore Implementation
        packages/memory/src/stores/QdrantVectorStore.ts
        - Implement IVectorStore interface
        - upsert() vectors with payload
        - search() with filters
        - delete() by ID

5.3 [ ] Collection Setup
        - Collection: messages
        - Vector size: 1536 (OpenAI)
        - Distance: Cosine
        - Payload indexes for userId, conversationId

5.4 [ ] Payload Schema
        - userId, conversationId
        - content, role
        - timestamp
        - entities[], crisisLevel

5.5 [ ] Update MemoryOrchestrator
        - Query L4 for semantic matches
        - Filter by userId
        - Merge results with L2

5.6 [ ] Background Indexing
        - Index historical messages
        - Handle large backlogs
```

**Verification:**
```bash
# Start Qdrant
docker-compose up -d qdrant

# Verify collection created
curl http://localhost:6333/collections

# Send messages, verify vectors stored
```

---

### Phase 6: Enhanced Crisis Detection

**Why Sixth:** Core safety feature needs production hardening.

**Goal:** Production-ready crisis detection with alerting

**Package:** `@pippa/crisis`

**Tasks:**

```
6.1 [ ] Expand Pattern Library
        - Add more pattern variations
        - Reduce false positives
        - Add context-aware patterns

6.2 [ ] LLM-Based Deep Evaluation
        packages/crisis/src/DeepCrisisEvaluator.ts
        - Secondary LLM check for high-risk messages
        - Runs in parallel with response generation
        - Validates or adjusts keyword detection

6.3 [ ] Real Crisis Handler
        packages/crisis/src/CrisisHandler.ts
        - Replace StubCrisisHandler
        - Webhook notifications
        - Audit logging
        - Resource injection

6.4 [ ] Alerting Integration
        - PagerDuty/Slack webhooks
        - Configurable thresholds
        - Rate limiting alerts

6.5 [ ] Red Team Testing
        - Adversarial input testing
        - False positive analysis
        - False negative analysis
        - Document edge cases

6.6 [ ] Crisis Response Templates
        - Level-appropriate responses
        - Localized resources
        - Escalation protocols
```

**Verification:**
```bash
# Test various crisis inputs
recoverysky chat -m "I'm having thoughts of hurting myself"

# Verify:
# - Correct crisis level detected
# - Emergency response triggered
# - Alert sent (if configured)
```

---

### Phase 7: Safety & Evaluation

**Why Seventh:** Required for production deployment.

**Goal:** Replace stubs with real validators

**Packages:** `@pippa/safety`, `@pippa/evaluation`

**Tasks:**

```
7.1 [ ] PII Detector
        packages/safety/src/detectors/PIIDetector.ts
        - Regex patterns for SSN, phone, email, address
        - Named entity recognition
        - Redaction or rejection

7.2 [ ] Medical Advice Detector
        packages/safety/src/detectors/MedicalAdviceDetector.ts
        - Detect medication recommendations
        - Detect dosage information
        - Detect diagnostic statements

7.3 [ ] Enabling Language Detector
        packages/safety/src/detectors/EnablingDetector.ts
        - Detect glorification of substance use
        - Detect minimization of harm
        - Detect enablement patterns

7.4 [ ] SafetyValidator Implementation
        packages/safety/src/SafetyValidator.ts
        - Combine all detectors
        - Return violations with severity
        - Support sanitization

7.5 [ ] LLM Evaluator
        packages/evaluation/src/LLMEvaluator.ts
        - Quality scoring (0-1)
        - Empathy scoring (0-1)
        - Recovery appropriateness (0-1)
        - Relevance scoring (0-1)

7.6 [ ] Evaluation Feedback Loop
        - Store evaluation results
        - Aggregate metrics
        - Identify improvement areas
```

---

### Phase 8: L3 Memory (Neo4j Knowledge Graph) ✅ COMPLETE

**Status:** Implemented with LLM-based entity extraction

**What's Done:**
- Neo4j driver installed and integrated
- `Neo4jKnowledgeStore` implementing `IKnowledgeStore` interface
- `EntityExtractor` using Claude Haiku for LLM-based extraction
- Database-per-user mode support (for multi-tenant deployments)
- Memory tools for agent to query/write to knowledge graph
- Full test coverage (1000 tests passing)

**Current Implementation:**

```
8.1 [x] Neo4j Driver Installation
        neo4j-driver in @pippa/memory

8.2 [x] Neo4jKnowledgeStore Implementation
        packages/memory/src/stores/Neo4jKnowledgeStore.ts
        - upsertEntity(), createRelationship()
        - getRelatedEntities() with multi-hop traversal
        - searchEntities() with pattern matching
        - Database-per-user mode (NEO4J_DATABASE_PER_USER)

8.3 [x] Entity Extraction Pipeline
        packages/memory/src/extraction/EntityExtractor.ts
        - LLM-based extraction using Claude Haiku
        - Configurable via ENTITY_EXTRACTION_MODE (all/none/sample:N/significant)
        - 8 entity types: person, place, event, emotion, trigger,
          coping_strategy, milestone, medication
        - Relationship inference between entities

8.4 [x] Memory Tools for Agent
        packages/tools/src/memoryTools.ts
        - recallMemory, searchEntities, getRelatedEntities (read)
        - saveNote, logObservation (write)
        - updateEntity, deleteEntity, createRelationship (full)
        - Access controlled via MEMORY_TOOL_ACCESS env var

8.5 [x] Integration with Pipeline
        - Entity extraction runs after message persistence
        - Non-blocking (fire-and-forget) for response latency
```

**Remaining Tasks:**

```
8.6 [ ] Define Neo4j Memory Schema Document
        content/concept/neo4j-schema.md
        - Node types and properties
        - Relationship types and semantics
        - Indexing strategy
        - Query patterns for common operations
        - Multi-tenant database naming conventions

8.7 [ ] Graph Visualization & Admin
        - Cypher queries for debugging
        - Admin endpoints for graph inspection
        - Export/import utilities

8.8 [ ] Advanced Graph Queries
        - Temporal pattern detection
        - Trigger → coping strategy correlation
        - Recovery journey timeline
```

**Environment Variables:**
```bash
# Neo4j Connection
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123
NEO4J_DATABASE=neo4j                    # Default database
NEO4J_DATABASE_PER_USER=false           # Enable multi-tenant mode

# Entity Extraction
ENTITY_EXTRACTION_MODE=all              # all|none|sample:N|significant
ENTITY_EXTRACTION_MODEL=claude-3-haiku-20240307
ENTITY_EXTRACTION_TYPES=person,place,event,emotion,trigger,coping_strategy,milestone,medication
ENTITY_MIN_IMPORTANCE=0.3
ENTITY_INFER_RELATIONSHIPS=true

# Memory Tools
MEMORY_TOOL_ACCESS=write                # off|read|write|full
```

---

### Phase 9: Production Hardening

**Goal:** Production-ready deployment

**Tasks:**

```
9.1 [ ] Comprehensive Test Suite
        - Unit tests for all packages (>80% coverage)
        - Integration tests with Docker services
        - E2E tests for API endpoints
        - Load testing

9.2 [ ] Observability
        - Verify all spans instrumented
        - Set up Grafana dashboards
        - Configure alerting rules
        - Log aggregation

9.3 [ ] Security Audit
        - Input validation
        - Rate limiting
        - Authentication/Authorization
        - Secret management
        - HTTPS enforcement

9.4 [ ] Performance Optimization
        - Profile hot paths
        - Optimize database queries
        - Connection pooling tuning
        - Caching strategy review

9.5 [ ] Documentation
        - API documentation (OpenAPI)
        - Deployment guide
        - Runbook for operations
        - Architecture decision records

9.6 [ ] CI/CD Pipeline
        - GitHub Actions workflows
        - Automated testing
        - Docker image builds
        - Deployment automation
```

---

## Quick Reference: Phase Dependencies

```
Phase 1 (Agent) ─────────────────────────────────────────────┐
                                                              │
Phase 2 (PostgreSQL) ───────────────────────────────────────┐│
           │                                                 ││
Phase 3 (Redis) ─────────────────────────────────────────┐  ││
           │                                              │  ││
Phase 4 (Embeddings) ───────────────────────────────────┐│  ││
           │                                             ││  ││
Phase 5 (Qdrant) ──────────────────────────────────────┐││  ││
                                                        │││  ││
Phase 6 (Crisis) ─────────────────────────────────────┐ │││  ││
                                                       │ │││  ││
Phase 7 (Safety/Eval) ─────────────────────────────┐  │ │││  ││
                                                    │  │ │││  ││
Phase 8 (Neo4j) ─────────────────────────────────┐ │  │ │││  ││
                                                  │ │  │ │││  ││
Phase 9 (Production) ◄────────────────────────────┴─┴──┴─┴┴┴──┴┘
```

**Critical Path:** 1 → 2 → 4 → 9

**Parallel Tracks:**
- Track A: 1 → 2 → 3 → 4 → 5
- Track B: 6 → 7
- Track C: 8 (independent)

---

## Environment Variables Reference

```bash
# Application
NODE_ENV=development|production
PORT=3333
LOG_LEVEL=debug|info|warn|error
USE_STUBS=true|false

# AI Providers
ANTHROPIC_API_KEY=sk-ant-xxx         # Phase 1
OPENAI_API_KEY=sk-xxx                 # Phase 4

# L1: Redis
REDIS_URL=redis://localhost:6379      # Phase 3

# L2: PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/recoverysky  # Phase 2

# L3: Neo4j
NEO4J_URI=bolt://localhost:7687       # Phase 8
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123

# L4: Qdrant
QDRANT_URL=http://localhost:6333      # Phase 5

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Crisis Response
CRISIS_ALERT_WEBHOOK_URL=             # Phase 6
CRISIS_THRESHOLD_HIGH=7
CRISIS_THRESHOLD_CRITICAL=9
```

---

## Getting Started: Phase 1

```bash
# 1. Install Anthropic SDK
pnpm --filter @pippa/agent add @anthropic-ai/sdk

# 2. Create ClaudeAgentProvider (see task 1.2)

# 3. Set API key
export ANTHROPIC_API_KEY=sk-ant-xxx

# 4. Update container.ts to use ClaudeAgentProvider

# 5. Start server
USE_STUBS=false pnpm dev

# 6. Test
recoverysky chat -m "Hello!"
```

---

## Related Documentation

- [`content/ARCHITECTURE.md`](./content/ARCHITECTURE.md) - System architecture diagrams
- [`content/concept/memory-system-architecture.md`](./content/concept/memory-system-architecture.md) - Memory tier design
- [`content/concept/context-flow-detailed.md`](./content/concept/context-flow-detailed.md) - Context assembly flow
- [`CLAUDE.md`](./CLAUDE.md) - Development commands and patterns
