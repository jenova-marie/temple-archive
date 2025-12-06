/**
 * Success result
 */
export interface Ok<T> {
  ok: true
  value: T
}

/**
 * Error result
 */
export interface Err<E> {
  ok: false
  error: E
}

/**
 * Result type - either success with value or error
 *
 * This is a simplified version compatible with @jenova-marie/ts-rust-result
 */
export type Result<T, E> = Ok<T> | Err<E>

/**
 * Create a success result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

/**
 * Create an error result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

/**
 * Check if result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

/**
 * Check if result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

/**
 * Unwrap a result, throwing if error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value
  }
  throw new Error(`Unwrap called on Err: ${JSON.stringify(result.error)}`)
}

/**
 * Unwrap a result with a default value
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value
  }
  return defaultValue
}

/**
 * Map over a successful result
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value))
  }
  return result
}

/**
 * Map over an error result
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (!result.ok) {
    return err(fn(result.error))
  }
  return result
}

/**
 * Chain results together
 */
export function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  if (result.ok) {
    return fn(result.value)
  }
  return result
}

/**
 * Base interface for domain errors
 */
export interface DomainError {
  kind: string
  message: string
  context: Record<string, unknown>
  cause?: unknown
  timestamp?: number
}

/**
 * Convert domain error to log context
 */
export function toLogContext(error: DomainError): Record<string, unknown> {
  return {
    error_kind: error.kind,
    error_message: error.message,
    ...error.context,
  }
}

/**
 * Convert domain error to span attributes
 */
export function toSpanAttributes(error: DomainError): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    'error.kind': error.kind,
    'error.message': error.message,
  }

  for (const [key, value] of Object.entries(error.context)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attrs[`error.context.${key}`] = value
    }
  }

  return attrs
}

/**
 * Convert domain error to metric labels
 */
export function toMetricLabels(error: DomainError): Record<string, string> {
  return {
    error_kind: error.kind,
  }
}
