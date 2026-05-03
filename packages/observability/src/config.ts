/**
 * Environment-specific configuration overrides for observability
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Get the path to the wonder-logger.yaml config file
 */
export function getConfigPath(): string {
  return join(__dirname, '..', 'wonder-logger.yaml')
}

/**
 * Check if we're in a production environment
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Check if we're in a test environment
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  // Disable tracing in tests by default
  if (isTest() && process.env.ENABLE_TRACING !== 'true') {
    return false
  }
  return process.env.OTEL_ENABLED !== 'false'
}

/**
 * Check if metrics are enabled
 */
export function isMetricsEnabled(): boolean {
  // Disable metrics in tests by default
  if (isTest() && process.env.ENABLE_METRICS !== 'true') {
    return false
  }
  return process.env.OTEL_METRICS_ENABLED !== 'false'
}

/**
 * Get service name
 */
export function getServiceName(): string {
  return process.env.SERVICE_NAME || 'ninshubur'
}

/**
 * Get service version
 */
export function getServiceVersion(): string {
  return process.env.SERVICE_VERSION || '0.1.0'
}
