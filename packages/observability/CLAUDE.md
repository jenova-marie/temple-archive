# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

This is `@siri/observability`, a unified observability package for the RecoverySky Agent system. It wraps [wonder-logger](https://github.com/jenova-marie/wonder-logger) with project-specific defaults to provide:

- Structured logging via Pino with automatic trace context injection
- Distributed tracing via OpenTelemetry
- Prometheus metrics with pre-configured pipeline metrics

## Build Commands

```bash
pnpm build      # Compile TypeScript to dist/
pnpm typecheck  # Type-check without emitting
pnpm clean      # Remove dist/
```

## Architecture

This is a thin wrapper package with two source files:

- `src/index.ts` - Main exports: `initializeObservability()`, `getLogger()`, `withSpan()`, `pipelineMetrics`, and re-exports from wonder-logger
- `src/config.ts` - Environment detection utilities (`isTest()`, `isTracingEnabled()`, `isMetricsEnabled()`, `getServiceName()`)

**Singleton Pattern**: The package uses lazy-initialized singletons for `_sdk` (TelemetrySDK) and `_logger` (Pino Logger). Call `initializeObservability()` once at startup; subsequent calls are no-ops.

**Test Mode Behavior**: When `NODE_ENV=test` or `VITEST=true`, the package automatically uses silent logging with an in-memory transport and disables tracing/metrics exports.

## Dependencies

- `@jenova-marie/wonder-logger` - Core logging/tracing functionality
- `@opentelemetry/api` - OpenTelemetry API for tracing and metrics
- `@siri/types` - Workspace package for `DomainError` type (dev dependency)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICE_NAME` | `recoverysky-agent` | Service identifier for logs/traces |
| `LOG_LEVEL` | `info` | trace/debug/info/warn/error/fatal/silent |
| `OTEL_ENABLED` | `true` | Enable OpenTelemetry tracing |
| `OTEL_METRICS_ENABLED` | `true` | Enable Prometheus metrics |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | - | OTLP collector endpoint |

## Pre-defined Pipeline Metrics

The `pipelineMetrics` object exposes these metrics for the recovery agent pipeline:

- `stageDuration` - Histogram for pipeline stage timing
- `memoryCacheHits/Misses` - Counters by cache tier (L1-L4)
- `crisisDetections` - Counter by severity level
- `tokensUsed` - Counter by direction (input/output)
- `safetyViolations` - Counter by violation type
- `errors` - Counter by error kind
