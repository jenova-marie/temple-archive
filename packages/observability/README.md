# @pippa/observability

Unified observability stack for the RecoverySky Agent system, built on [wonder-logger](https://github.com/jenova-marie/wonder-logger).

## Installation

```bash
pnpm add @pippa/observability
```

## Overview

This package provides:

- **Structured logging** via Pino with automatic trace context injection
- **Distributed tracing** via OpenTelemetry
- **Prometheus metrics** for monitoring and alerting
- **Pipeline-specific metrics** pre-configured for recovery agent use cases

## Quick Start

```typescript
import {
  initializeObservability,
  getLogger,
  withSpan,
  pipelineMetrics,
} from '@pippa/observability'

// Initialize at application startup
initializeObservability()

// Get a logger instance
const logger = getLogger()

// Log with context
logger.info({ userId: '123' }, 'User connected')

// Create a traced span
const result = await withSpan('myOperation', async () => {
  logger.debug('Inside traced operation')
  return { data: 'value' }
})

// Record metrics
pipelineMetrics.stageDuration.record(150, { stage: 'agent' })
pipelineMetrics.memoryCacheHits.add(1, { tier: 'L1' })
```

## Configuration

### Environment Variables

```bash
# Service identification
SERVICE_NAME=recoverysky-agent
SERVICE_VERSION=1.0.0
NODE_ENV=development

# Logging
LOG_LEVEL=debug  # trace, debug, info, warn, error, fatal, silent

# Tracing
OTEL_TRACING_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Metrics
OTEL_METRICS_ENABLED=true
```

### Test Mode

In test environments (`NODE_ENV=test`), the package automatically:

- Uses silent logging
- Stores logs in memory for assertions
- Disables tracing/metrics exports

```typescript
import { getMemoryLogs, clearMemoryLogs } from '@pippa/observability'

// In tests
const logs = getMemoryLogs('recoverysky-agent')
expect(logs).toContainEqual(expect.objectContaining({ msg: 'Expected message' }))
clearMemoryLogs('recoverysky-agent')
```

## API Reference

### Initialization

```typescript
// Initialize the observability stack (call once at startup)
initializeObservability(): void

// Shutdown gracefully (call on process exit)
shutdownObservability(): Promise<void>
```

### Logging

```typescript
// Get the singleton logger
getLogger(): Logger

// Create a child logger with bound context
createChildLogger(bindings: Record<string, unknown>): Logger

// Example usage
const logger = getLogger().child({ requestId: 'req-123' })
logger.info({ userId: 'user-456' }, 'Processing request')
```

### Tracing

```typescript
// Execute code within a traced span
withSpan<T>(name: string, fn: () => Promise<T>): Promise<T>

// Get the active span for adding attributes
getActiveSpan(): Span | undefined

// Get a tracer instance
getTracer(name?: string): Tracer

// Record an error on the current span
recordSpanError(error: Error | DomainError): void
```

### Metrics

```typescript
// Get a meter instance for custom metrics
getMeter(name?: string): Meter

// Pre-configured pipeline metrics
pipelineMetrics.stageDuration      // Histogram: stage execution time
pipelineMetrics.memoryCacheHits    // Counter: cache hits by tier
pipelineMetrics.memoryCacheMisses  // Counter: cache misses by tier
pipelineMetrics.crisisDetections   // Counter: detections by level
pipelineMetrics.tokensUsed         // Counter: LLM tokens by direction
pipelineMetrics.safetyViolations   // Counter: violations by type
pipelineMetrics.errors             // Counter: errors by kind
```

## Pipeline Metrics

Pre-defined metrics for the RecoverySky pipeline:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `pipeline_stage_duration_ms` | Histogram | `stage` | Duration of each pipeline stage |
| `memory_cache_hits_total` | Counter | `tier` | Cache hits (L1, L2, L3, L4) |
| `memory_cache_misses_total` | Counter | `tier` | Cache misses by tier |
| `crisis_detections_total` | Counter | `level` | Crisis detections by severity |
| `agent_tokens_total` | Counter | `direction` | Token usage (input/output) |
| `safety_violations_total` | Counter | `type` | Safety violations by type |
| `errors_total` | Counter | `error_kind` | Errors by kind |

## Integration with Domain Errors

```typescript
import { recordSpanError } from '@pippa/observability'
import type { DomainError } from '@pippa/types'

const error: DomainError = {
  kind: 'ValidationError',
  message: 'Invalid input',
  context: { field: 'email' },
}

// Automatically sets span status and attributes
recordSpanError(error)
```

## Transports

The package configures the following transports:

- **Console**: Pretty-printed in development, JSON in production
- **Memory**: In-memory buffer for testing (configurable size)
- **OTLP**: OpenTelemetry logs export (when enabled)

## Development

```bash
# Build
pnpm build

# Type check
pnpm typecheck

# Clean
pnpm clean
```

## Dependencies

- [@jenova-marie/wonder-logger](https://github.com/jenova-marie/wonder-logger) - Core logging/tracing
- [@opentelemetry/api](https://opentelemetry.io/docs/instrumentation/js/) - OpenTelemetry API
