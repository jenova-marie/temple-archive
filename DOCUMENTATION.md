# Siri Documentation

> Quick navigation to all project documentation.

## Quick Start

| Doc | Purpose |
|-----|---------|
| [README.md](README.md) | Features, architecture overview, quick start |
| [CONFIG.md](CONFIG.md) | All environment variables and YAML configuration |
| [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md) | Master reference for all feature toggles |

## Architecture

| Doc | Purpose |
|-----|---------|
| [docs/PIPELINE.md](docs/PIPELINE.md) | Message processing flow from request to response |
| [docs/MEMORY_TIERS.md](docs/MEMORY_TIERS.md) | L1→L2→L3→L4 multi-tier memory architecture |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Auth0 OIDC flow (mandatory — no dev bypass) |

## Memory System

The memory system is Siri's most complex subsystem. Read in this order:

### Overview
| Doc | Purpose |
|-----|---------|
| [docs/MEMORY_TIERS.md](docs/MEMORY_TIERS.md) | Overview of all 4 tiers and when each is used |

### Per-Tier Deep Dives
| Doc | Purpose |
|-----|---------|
| [docs/L1_CONTEXT.md](docs/L1_CONTEXT.md) | L1 Redis session cache - hot context storage |
| [docs/L2_DATA_STORE.md](docs/L2_DATA_STORE.md) | L2 PostgreSQL - durable storage and pgvector |
| [docs/L3_KNOWLEDGE_GRAPH.md](docs/L3_KNOWLEDGE_GRAPH.md) | L3 Neo4j "Cadillac" - entities and relationships |
| [docs/L4_VECTOR_STORE.md](docs/L4_VECTOR_STORE.md) | L4 Qdrant - hybrid semantic search |

### Memory Processing
| Doc | Purpose |
|-----|---------|
| [docs/ENTITY_EXTRACTION.md](docs/ENTITY_EXTRACTION.md) | How entities are extracted from conversations |
| [docs/MEMORY_REFLECTOR.md](docs/MEMORY_REFLECTOR.md) | Automatic insight generation with Haiku |
| [packages/memory/src/embeddings/L3_EMBEDDINGS.md](packages/memory/src/embeddings/L3_EMBEDDINGS.md) | MiniLM graph-local semantic search |
| [docs/DEEPMEMORY.md](docs/DEEPMEMORY.md) | Context enrichment from conversation history |

### Advanced Concepts
| Doc | Purpose |
|-----|---------|
| [docs/CONSCIOUS_RETRIEVAL.md](docs/CONSCIOUS_RETRIEVAL.md) | LLM inner dialogue - active curiosity-driven memory queries |

### Configuration Guides
| Doc | Purpose |
|-----|---------|
| [docs/QDRANT.md](docs/QDRANT.md) | Qdrant setup and configuration |

## Package Reference

Each package has its own documentation:

### Core Packages

| Package | README | CLAUDE.md |
|---------|--------|-----------|
| `@siri/types` | [README](packages/types/README.md) | - |
| `@siri/observability` | [README](packages/observability/README.md) | [CLAUDE.md](packages/observability/CLAUDE.md) |
| `@siri/db` | [README](packages/db/README.md) | [CLAUDE.md](packages/db/CLAUDE.md) |
| `@siri/memory` | [README](packages/memory/README.md) | [CLAUDE.md](packages/memory/CLAUDE.md) |

### Processing Packages

| Package | README | CLAUDE.md |
|---------|--------|-----------|
| `@siri/crisis` | [README](packages/crisis/README.md) | [CLAUDE.md](packages/crisis/CLAUDE.md) |
| `@siri/safety` | [README](packages/safety/README.md) | [CLAUDE.md](packages/safety/CLAUDE.md) |
| `@siri/agent` | [README](packages/agent/README.md) | [CLAUDE.md](packages/agent/CLAUDE.md) |
| `@siri/tools` | [README](packages/tools/README.md) | [CLAUDE.md](packages/tools/CLAUDE.md) |
| `@siri/evaluation` | [README](packages/evaluation/README.md) | [CLAUDE.md](packages/evaluation/CLAUDE.md) |
| `@siri/pipeline` | [README](packages/pipeline/README.md) | [CLAUDE.md](packages/pipeline/CLAUDE.md) |

### Apps

| App | README | Notes |
|-----|--------|-------|
| `agent-api` | [README](apps/agent-api/README.md) | Main API server |
| `web-app` | [README](apps/web-app/README.md) | React frontend |
| `cli` | [README](packages/cli/README.md) | Command-line interface |

## Developer Guide

| Doc | Purpose |
|-----|---------|
| [CLAUDE.md](CLAUDE.md) | Build commands, patterns, TypeScript config |
| [apps/web-app/src/INTEGRATION.md](apps/web-app/src/INTEGRATION.md) | Web app integration guide |

## Key Source Files

Quick links to the most important implementation files:

### Memory System
- [`packages/memory/src/MemoryOrchestrator.ts`](packages/memory/src/MemoryOrchestrator.ts) - Main orchestrator
- [`packages/memory/src/redis/`](packages/memory/src/redis/) - L1 Redis cache
- [`packages/db/src/stores/PostgresSessionStore.ts`](packages/db/src/stores/PostgresSessionStore.ts) - L2 session store
- [`packages/memory/src/stores/Neo4jKnowledgeStore.ts`](packages/memory/src/stores/Neo4jKnowledgeStore.ts) - L3 knowledge graph
- [`packages/memory/src/qdrant/`](packages/memory/src/qdrant/) - L4 vector store
- [`packages/memory/src/extraction/EntityExtractor.ts`](packages/memory/src/extraction/EntityExtractor.ts) - Entity extraction
- [`packages/memory/src/reflection/MemoryReflector.ts`](packages/memory/src/reflection/MemoryReflector.ts) - Insight generation
- [`packages/memory/src/deepmemory/DeepMemoryService.ts`](packages/memory/src/deepmemory/DeepMemoryService.ts) - Context enrichment
- `packages/memory/src/curiosity/` - Conscious retrieval (planned)

### Pipeline & Agent
- [`packages/pipeline/src/pipeline.ts`](packages/pipeline/src/pipeline.ts) - Main processing pipeline
- [`packages/agent/src/VercelAIAgentProvider.ts`](packages/agent/src/VercelAIAgentProvider.ts) - Claude integration
- [`packages/agent/src/systemPrompt.ts`](packages/agent/src/systemPrompt.ts) - System prompt builder

### API & Auth
- [`apps/agent-api/src/container.ts`](apps/agent-api/src/container.ts) - Dependency injection
- [`apps/agent-api/src/middleware/auth.ts`](apps/agent-api/src/middleware/auth.ts) - JWT auth middleware
- [`apps/web-app/src/lib/auth/AuthProvider.tsx`](apps/web-app/src/lib/auth/AuthProvider.tsx) - React auth provider
