/**
 * RecoverySky Observability Package
 *
 * Provides unified logging, tracing, and metrics using wonder-logger.
 * This package wraps wonder-logger with project-specific defaults.
 */

import {
  createLogger,
  createTelemetry,
  createMemoryTransport,
  createConsoleTransport,
  withSpan,
  getMemoryLogs,
  clearMemoryLogs,
  type TelemetrySDK,
} from '@jenova-marie/wonder-logger'
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api'
import type { Span } from '@opentelemetry/api'
import type { DomainError } from '@recoverysky/types'
import {
  isTest,
  isTracingEnabled,
  isMetricsEnabled,
  getServiceName,
} from './config.js'

// Logger type from pino (wonder-logger re-exports this)
type Logger = ReturnType<typeof createLogger>

// Lazy-initialized singletons
let _sdk: TelemetrySDK | null = null
let _logger: Logger | null = null

/**
 * Initialize the observability stack (telemetry + logger)
 * Call this once at application startup
 */
export function initializeObservability(): void {
  if (_sdk || _logger) {
    return // Already initialized
  }

  const serviceName = getServiceName()

  // In test mode, create minimal setup
  if (isTest()) {
    _logger = createLogger({
      name: serviceName,
      level: 'silent',
      transports: [createMemoryTransport({ name: serviceName, maxSize: 1000 })],
    })
    return
  }

  // Initialize telemetry SDK first (required for trace context in logs)
  if (isTracingEnabled() || isMetricsEnabled()) {
    _sdk = createTelemetry({
      serviceName,
      tracing: {
        enabled: isTracingEnabled(),
        exporter: 'otlp',
      },
      metrics: {
        enabled: isMetricsEnabled(),
        exporters: ['prometheus'],
      },
    })
  }

  // Initialize logger with transports
  _logger = createLogger({
    name: serviceName,
    level: (process.env.LOG_LEVEL || 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent',
    transports: [
      createConsoleTransport({ level: 'debug' }),
      createMemoryTransport({ name: serviceName, maxSize: 10000 }),
    ],
  })
}

/**
 * Get the logger instance
 */
export function getLogger(): Logger {
  if (!_logger) {
    initializeObservability()
  }
  return _logger!
}

/**
 * Create a child logger with bound context
 */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings)
}

/**
 * Get the telemetry SDK (for shutdown, flush, etc.)
 */
export function getTelemetrySDK(): TelemetrySDK | null {
  return _sdk
}

/**
 * Shutdown observability (call on process exit)
 */
export async function shutdownObservability(): Promise<void> {
  if (_sdk) {
    await _sdk.shutdown()
    _sdk = null
  }
  _logger = null
}

// Re-export withSpan for manual instrumentation
export { withSpan }

/**
 * Get the tracer for the agent
 */
export function getTracer(name?: string) {
  return trace.getTracer(name || getServiceName())
}

/**
 * Get the meter for metrics
 */
export function getMeter(name?: string) {
  return metrics.getMeter(name || getServiceName())
}

/**
 * Get the active span
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan()
}

/**
 * Record an error on the current span
 */
export function recordSpanError(error: Error | DomainError): void {
  const span = getActiveSpan()
  if (!span) return

  if ('kind' in error) {
    // Domain error
    span.setAttributes({
      'error.kind': error.kind,
      'error.message': error.message,
      ...Object.entries(error.context).reduce(
        (acc, [key, value]) => {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            acc[`error.context.${key}`] = value
          }
          return acc
        },
        {} as Record<string, string | number | boolean>
      ),
    })
  } else {
    // Standard error
    span.recordException(error)
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
}

// Re-export memory log utilities for testing
export { getMemoryLogs, clearMemoryLogs }

// Re-export config utilities
export { isTest, isTracingEnabled, isMetricsEnabled, getServiceName }

// Create pre-defined metrics for the pipeline
const meter = metrics.getMeter(getServiceName())

/**
 * Pipeline metrics
 */
export const pipelineMetrics = {
  /** Duration of each pipeline stage */
  stageDuration: meter.createHistogram('pipeline_stage_duration_ms', {
    description: 'Duration of each pipeline stage in milliseconds',
    unit: 'ms',
  }),

  /** Memory cache hits */
  memoryCacheHits: meter.createCounter('memory_cache_hits_total', {
    description: 'Total memory cache hits',
  }),

  /** Memory cache misses */
  memoryCacheMisses: meter.createCounter('memory_cache_misses_total', {
    description: 'Total memory cache misses',
  }),

  /** Crisis detections by level */
  crisisDetections: meter.createCounter('crisis_detections_total', {
    description: 'Total crisis detections by level',
  }),

  /** Token usage */
  tokensUsed: meter.createCounter('agent_tokens_total', {
    description: 'Total tokens used by direction',
  }),

  /** Safety violations */
  safetyViolations: meter.createCounter('safety_violations_total', {
    description: 'Total safety violations by type',
  }),

  /** Errors by kind */
  errors: meter.createCounter('errors_total', {
    description: 'Total errors by kind',
  }),
}
