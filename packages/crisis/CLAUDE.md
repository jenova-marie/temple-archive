# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@pippa/crisis` is a real-time crisis detection package for the RecoverySky Agent system. It performs fast pre-flight crisis detection using keyword and pattern matching, with a target of **<10ms** detection time.

## Commands

```bash
pnpm build       # Compile TypeScript to dist/
pnpm test        # Run tests with vitest
pnpm test:watch  # Run tests in watch mode
pnpm typecheck   # Type check without emitting
pnpm clean       # Remove dist/
```

## Architecture

This is an ESM-only package using TypeScript composite projects.

### Core Components

- **KeywordCrisisDetector** (`src/KeywordCrisisDetector.ts`): Main detector implementing `ICrisisDetector` interface. Uses regex pattern matching with confidence scoring based on boost keywords and dampeners.

- **CRISIS_PATTERNS** (`src/patterns.ts`): Array of 9 crisis pattern definitions organized by severity:
  - Critical (9-10): `suicidal_ideation`, `overdose_risk`, `violence_risk`, `self_harm`
  - High (7-8): `active_relapse`, `imminent_relapse`
  - Elevated (4-6): `severe_distress`, `hopelessness`, `isolation`

- **CRISIS_RESOURCES** (`src/patterns.ts`): Predefined crisis hotline resources (national and recovery-specific).

### Stub Implementations

For testing, use `StubCrisisDetector` and `StubCrisisHandler` from `src/stubs/`. Both allow configurable mock results.

### Dependencies

This package depends on sibling workspace packages:
- `@pippa/types` - Type definitions (`ICrisisDetector`, `CrisisCheckResult`, etc.)
- `@pippa/observability` - Logging and metrics (`getLogger`, `withSpan`, `pipelineMetrics`)

## Detection Algorithm

1. Normalize message to lowercase
2. Match against regex patterns in `CRISIS_PATTERNS`
3. Skip matches with dampeners (false positive reducers)
4. Calculate confidence: `0.6 + (boostCount * 0.1)` (max 1.0)
5. Adjust level: `baseLevel + floor(boostCount / 2) - dampenerCount` (clamped 1-10)
6. Determine action based on thresholds:
   - `>= emergencyThreshold` (default 9): `emergency_protocol`
   - `>= resourceThreshold` (default 7): `inject_resources`
   - `>= 4`: `monitor`
   - Otherwise: `none`

## Result Types

Uses `Result<T, E>` pattern from `@pippa/types` - check `result.ok` before accessing `result.value`.
