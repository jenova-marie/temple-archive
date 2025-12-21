# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

This is `@pippa/pipeline`, the main orchestrator for RecoverySky Agent message processing. It coordinates a 6-stage pipeline: crisis detection → memory retrieval → agent processing → safety validation → evaluation → persistence.

## Commands

```bash
pnpm build      # Compile TypeScript to dist/
pnpm typecheck  # Type check without emit
pnpm test       # Run tests (vitest)
pnpm test:watch # Run tests in watch mode
```

## Architecture

### Pipeline Stages (Pipeline.ts)

The `Pipeline` class orchestrates message processing through these stages:

1. **Crisis Check** (<10ms target) - Pattern matching for crisis indicators. Level ≥9 triggers emergency response and short-circuits the pipeline.

2. **Memory Retrieval** - Multi-tier memory lookup (L1 Redis → L2 PostgreSQL → L3/L4 Neo4j/Qdrant). Continues with empty context on failure.

3. **Agent Processing** - Generates response via Claude using system prompt + assembled context.

4. **Safety + Evaluation** (parallel) - Validates response safety and evaluates quality. Safety violations may result in sanitized output.

5. **Persist** - Stores user and assistant messages with optional embeddings, updates session state.

### Result Pattern

All operations return `Result<T, E>` types from `@pippa/types`. Check `result.ok` before accessing `result.value` or `result.error`.

### Dependencies (Injected)

- `crisisDetector: ICrisisDetector` - Crisis pattern detection
- `crisisHandler: ICrisisHandler` - Emergency response handling
- `memory: MemoryOrchestrator` - Multi-tier memory operations
- `agent: IAgentProvider` - LLM response generation
- `safety: ISafetyValidator` - Response safety validation
- `evaluator: IEvaluator` - Response quality evaluation
- `embedding?: IEmbeddingProvider` - Optional semantic search embeddings

### Monorepo Context

Part of a pnpm workspace. Related packages:
- `@pippa/types` - Shared types and interfaces
- `@pippa/observability` - Logging/tracing via `getLogger()`, `withSpan()`, `pipelineMetrics`
- `@pippa/memory`, `@pippa/crisis`, `@pippa/safety`, `@pippa/agent`, `@pippa/evaluation`
