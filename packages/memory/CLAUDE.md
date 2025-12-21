# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build        # Compile TypeScript to dist/
pnpm test         # Run tests once with vitest
pnpm test:watch   # Run tests in watch mode
pnpm typecheck    # Type check without emitting
pnpm clean        # Remove dist/ directory
```

## Architecture

This package implements a **multi-tier memory orchestration system** for contextual conversations. The `MemoryOrchestrator` coordinates retrieval and storage across four tiers:

```
L1 (Redis)     → Active session cache, <10ms, 4hr TTL
L2 (PostgreSQL) → Full history + user profiles, 10-50ms
L3 (Neo4j)     → Knowledge graph (reserved for future)
L4 (Qdrant)    → Semantic vector search, 5-20ms
```

### Retrieval Flow

1. **L1 hit** → Return cached messages immediately
2. **L1 miss** → Query L2 for conversation history, warm L1 cache
3. **L2 miss** → Semantic search via L4 if query embedding provided
4. **All miss** → Return empty context with user profile

### Key Types

- `MemoryOrchestrator` - Main orchestrator class (src/MemoryOrchestrator.ts)
- `AssembledContext` - Combined result containing messages, userProfile, sessionState, previousSessions, semanticMatches
- `IContextStore`, `ISessionStore`, `IKnowledgeStore`, `IVectorStore` - Store interfaces from `@pippa/types`

### Store Implementations

Currently only in-memory stubs exist (src/stubs/). Production implementations (Redis, PostgreSQL, Neo4j, Qdrant) are planned.

Stubs are exported from two paths:
- `@pippa/memory` - Main exports including stubs
- `@pippa/memory/stubs` - Stubs-only subpath export

## Dependencies

- `@pippa/types` - Shared interfaces (Result, Message, store interfaces)
- `@pippa/observability` - Logging (`getLogger`), tracing (`withSpan`), metrics (`pipelineMetrics`)

Uses the `Result<T, E>` pattern with `ok()` and `err()` helpers from types package.
