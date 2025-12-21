# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@pippa/safety` is a response safety validation package for the RecoverySky Agent system. It validates AI-generated responses before they reach users, detecting PII, medical advice, enabling language, and harmful content.

This is part of a pnpm monorepo (`recoverysky-agent`) and depends on sibling packages:
- `@pippa/types` - Type definitions including `ISafetyValidator`, `SafetyValidationResult`, `SafetyViolation`
- `@pippa/observability` - Logging (`getLogger`), tracing (`withSpan`), and metrics (`pipelineMetrics`)

## Common Commands

```bash
# Build the package
pnpm build

# Type check without emitting
pnpm typecheck

# Clean build artifacts
pnpm clean
```

## Architecture

The package exports a single class `StubSafetyValidator` implementing the `ISafetyValidator` interface from `@pippa/types`.

**Current implementation** (`src/StubSafetyValidator.ts`): A stub with basic regex pattern matching for SSN and medical dosage detection. Designed for testing and as a scaffold for the production implementation.

**Key patterns:**
- Uses `Result<T, E>` pattern from `@pippa/types` for error handling (returns `ok(value)` or `err(error)`)
- All validation wrapped in OpenTelemetry spans via `withSpan()`
- Metrics recorded via `pipelineMetrics.safetyViolations`
- Mock injection support (`addMockViolation`/`clearMockViolations`) for testing

**Validation flow:**
1. Receives output string, assembled context, and trace context
2. Runs pattern-based checks (currently: SSN, dosage patterns)
3. Includes any mock violations (for testing)
4. Records metrics per violation type
5. Returns `SafetyValidationResult` with `passed` boolean, violations array, and timing
