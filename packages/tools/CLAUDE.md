# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@siri/tools` provides AI tool definitions for the RecoverySky Agent, built with Vercel AI SDK. These tools enable the AI agent to:
- Find AA/NA meetings (`findMeetings`)
- Log user mood (`logMood`)
- Get crisis resources (`getCrisisResources`)
- Get recovery resources (`getResources`)

## Commands

```bash
# Build the package
pnpm build

# Type check without emitting
pnpm typecheck

# Clean build artifacts
pnpm clean
```

## Architecture

This package is part of the `ninshubur` monorepo. It exports tool definitions that are consumed by the agent package.

**Key files:**
- `src/definitions.ts` - All tool definitions using `tool()` from Vercel AI SDK with Zod schemas
- `src/index.ts` - Re-exports for public API

**Dependencies:**
- `@siri/observability` - For tracing (`withSpan`) and logging (`getLogger`)
- `@siri/types` - Shared types
- `ai` - Vercel AI SDK for `tool()` function
- `zod` - Schema validation for tool parameters

**Pattern:** Each tool is wrapped in `withSpan('tool.<name>', ...)` for observability and creates a child logger for structured logging.

## Note

Tool implementations are currently stubs returning mock data. Production implementations will integrate with real meeting APIs and persist mood data to the database.
