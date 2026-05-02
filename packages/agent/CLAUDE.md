# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@siri/agent` is part of the RecoverySky monorepo - an AI chatbot agent for addiction recovery support. This package provides:
- Dynamic system prompt builder for the "Sky" AI companion
- Agent provider interface (`IAgentProvider`) for LLM integration
- Mock implementation for testing

## Commands

```bash
# Build (from this package or root)
pnpm build

# Type check
pnpm typecheck

# Run tests (from monorepo root)
pnpm test

# Clean build artifacts
pnpm clean
```

## Architecture

### Monorepo Context
This is a pnpm workspace monorepo. Sibling packages:
- `@siri/types` - Shared TypeScript types (dependency)
- `@siri/observability` - Logging/tracing utilities (dependency)
- `@siri/crisis` - Crisis detection
- `@siri/memory` - Multi-tier memory system
- `@siri/pipeline` - Message processing pipeline
- `@siri/tools` - Agent tools (findMeetings, logMood, etc.)

### Core Components

**`systemPrompt.ts`** - Builds context-aware prompts with sections:
1. Base identity (Sky persona)
2. User context (recovery phase, sobriety, triggers, coping strategies)
3. Session context (current topic, emotions, events)
4. Crisis instructions (levels 4-10 trigger different responses)
5. Recovery guidelines
6. Tool instructions
7. Safety boundaries

**`MockAgentProvider.ts`** - Test implementation of `IAgentProvider`:
- Supports both `generate()` and `stream()` methods
- Context-aware responses for crisis, relapse, greetings, mood
- Configurable delay and custom mock responses via `setMockResponse()`

### Key Types (from @siri/types)

```typescript
interface IAgentProvider {
  generate(input: AgentInput, ctx: TraceContext): Promise<Result<AgentResponse, AgentError>>
  stream(input: AgentInput, ctx: TraceContext): AsyncGenerator<StreamChunk, AgentResponse>
}

interface AgentInput {
  userMessage: string
  context: AssembledContext
  crisisCheck?: CrisisCheckResult
  systemPrompt: string
}
```

### Result Pattern
Uses `Result<T, E>` (ok/err pattern) from `@siri/types` for error handling.

## TypeScript Configuration

- ES2022 target with NodeNext modules
- Strict mode enabled with additional checks (noUnusedLocals, noImplicitReturns)
- Uses `verbatimModuleSyntax` - import types with `import type`
- Composite projects with references to types and observability packages
