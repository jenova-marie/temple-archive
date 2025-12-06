# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Build the CLI
pnpm build

# Watch mode for development
pnpm dev

# Type checking only
pnpm typecheck

# Run locally after build
node dist/index.js

# Run with ts-node alternative
npx tsx src/index.ts

# Clean build artifacts
pnpm clean
```

This is part of a pnpm monorepo. From the monorepo root:
```bash
pnpm --filter @recoverysky/cli build
```

## Architecture

This is a TypeScript CLI for the RecoverySky Agent API, a mental health support chatbot.

### Module Structure

- **`src/index.ts`** - Entry point, CLI command definitions using Commander.js
- **`src/api.ts`** - API client with `sendMessage()`, `checkHealth()`, `getMetrics()` functions
- **`src/config.ts`** - Persistent configuration using the `conf` package (stores `apiUrl`, `userId`, `conversationId`)
- **`src/commands/`** - Command implementations:
  - `chat.ts` - Single message and interactive chat loop
  - `config.ts` - Configuration management commands
  - `health.ts` - API health check and metrics display

### Key Patterns

- ES modules with `.js` extensions in imports (required by NodeNext module resolution)
- All API calls go through `src/api.ts` which reads config from `src/config.ts`
- Interactive mode uses `inquirer` for prompts, `ora` for spinners, `chalk` for styling
- Crisis levels 4+ are displayed with color-coded indicators (blue/yellow/red)
- Configuration persists to OS-appropriate location via `conf` package

### API Endpoints

The CLI communicates with these endpoints:
- `POST /api/chat` - Send message, returns response with crisis level and metrics
- `GET /health` - Health check with uptime and version
- `GET /health/metrics` - Prometheus-style metrics

### TypeScript Configuration

Extends `../../tsconfig.base.json` from the monorepo root. Uses ES2022 target, NodeNext module resolution, strict mode enabled.
