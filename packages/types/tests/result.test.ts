import { describe, it, expect } from 'vitest'
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  toLogContext,
  toSpanAttributes,
  toMetricLabels,
  type Result,
  type DomainError,
} from '../src/result.js'

describe('Result type', () => {
  describe('ok', () => {
    it('creates an Ok result with a value', () => {
      const result = ok(42)
      expect(result.ok).toBe(true)
      expect(result.value).toBe(42)
    })

    it('creates an Ok result with complex objects', () => {
      const value = { name: 'test', items: [1, 2, 3] }
      const result = ok(value)
      expect(result.ok).toBe(true)
      expect(result.value).toEqual(value)
    })

    it('creates an Ok result with null', () => {
      const result = ok(null)
      expect(result.ok).toBe(true)
      expect(result.value).toBeNull()
    })
  })

  describe('err', () => {
    it('creates an Err result with an error', () => {
      const error = { kind: 'NotFound', message: 'Not found' }
      const result = err(error)
      expect(result.ok).toBe(false)
      expect(result.error).toEqual(error)
    })

    it('creates an Err result with a string', () => {
      const result = err('Something went wrong')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Something went wrong')
    })
  })

  describe('isOk', () => {
    it('returns true for Ok results', () => {
      const result = ok('value')
      expect(isOk(result)).toBe(true)
    })

    it('returns false for Err results', () => {
      const result = err('error')
      expect(isOk(result)).toBe(false)
    })
  })

  describe('isErr', () => {
    it('returns false for Ok results', () => {
      const result = ok('value')
      expect(isErr(result)).toBe(false)
    })

    it('returns true for Err results', () => {
      const result = err('error')
      expect(isErr(result)).toBe(true)
    })
  })

  describe('unwrap', () => {
    it('returns the value for Ok results', () => {
      const result = ok(42)
      expect(unwrap(result)).toBe(42)
    })

    it('throws for Err results', () => {
      const result = err({ message: 'Failed' })
      expect(() => unwrap(result)).toThrow('Unwrap called on Err')
    })
  })

  describe('unwrapOr', () => {
    it('returns the value for Ok results', () => {
      const result = ok(42)
      expect(unwrapOr(result, 0)).toBe(42)
    })

    it('returns the default for Err results', () => {
      const result: Result<number, string> = err('error')
      expect(unwrapOr(result, 99)).toBe(99)
    })
  })

  describe('map', () => {
    it('transforms the value for Ok results', () => {
      const result = ok(5)
      const mapped = map(result, (x) => x * 2)
      expect(mapped.ok).toBe(true)
      if (mapped.ok) {
        expect(mapped.value).toBe(10)
      }
    })

    it('passes through Err results unchanged', () => {
      const result: Result<number, string> = err('error')
      const mapped = map(result, (x: number) => x * 2)
      expect(mapped.ok).toBe(false)
      if (!mapped.ok) {
        expect(mapped.error).toBe('error')
      }
    })
  })

  describe('mapErr', () => {
    it('passes through Ok results unchanged', () => {
      const result = ok(42)
      const mapped = mapErr(result, (e) => `wrapped: ${e}`)
      expect(mapped.ok).toBe(true)
      if (mapped.ok) {
        expect(mapped.value).toBe(42)
      }
    })

    it('transforms the error for Err results', () => {
      const result: Result<number, string> = err('original')
      const mapped = mapErr(result, (e) => `wrapped: ${e}`)
      expect(mapped.ok).toBe(false)
      if (!mapped.ok) {
        expect(mapped.error).toBe('wrapped: original')
      }
    })
  })

  describe('andThen', () => {
    it('chains successful results', () => {
      const result = ok(5)
      const chained = andThen(result, (x) => ok(x * 2))
      expect(chained.ok).toBe(true)
      if (chained.ok) {
        expect(chained.value).toBe(10)
      }
    })

    it('short-circuits on first error', () => {
      const result: Result<number, string> = err('first error')
      const chained = andThen(result, (x: number) => ok(x * 2))
      expect(chained.ok).toBe(false)
      if (!chained.ok) {
        expect(chained.error).toBe('first error')
      }
    })

    it('propagates errors from the function', () => {
      const result = ok(5)
      const chained = andThen(result, () => err('function error'))
      expect(chained.ok).toBe(false)
      if (!chained.ok) {
        expect(chained.error).toBe('function error')
      }
    })
  })
})

describe('DomainError utilities', () => {
  const sampleError: DomainError = {
    kind: 'ValidationError',
    message: 'Invalid input provided',
    context: {
      field: 'email',
      value: 'not-an-email',
      code: 400,
    },
  }

  describe('toLogContext', () => {
    it('converts error to log context', () => {
      const context = toLogContext(sampleError)
      expect(context.error_kind).toBe('ValidationError')
      expect(context.error_message).toBe('Invalid input provided')
      expect(context.field).toBe('email')
      expect(context.value).toBe('not-an-email')
      expect(context.code).toBe(400)
    })

    it('handles empty context', () => {
      const error: DomainError = {
        kind: 'Error',
        message: 'test',
        context: {},
      }
      const context = toLogContext(error)
      expect(context.error_kind).toBe('Error')
      expect(context.error_message).toBe('test')
    })
  })

  describe('toSpanAttributes', () => {
    it('converts error to span attributes', () => {
      const attrs = toSpanAttributes(sampleError)
      expect(attrs['error.kind']).toBe('ValidationError')
      expect(attrs['error.message']).toBe('Invalid input provided')
      expect(attrs['error.context.field']).toBe('email')
      expect(attrs['error.context.value']).toBe('not-an-email')
      expect(attrs['error.context.code']).toBe(400)
    })

    it('filters out non-primitive context values', () => {
      const error: DomainError = {
        kind: 'Error',
        message: 'test',
        context: {
          primitiveString: 'hello',
          primitiveNumber: 42,
          primitiveBoolean: true,
          complexObject: { nested: 'value' },
          arrayValue: [1, 2, 3],
        },
      }
      const attrs = toSpanAttributes(error)
      expect(attrs['error.context.primitiveString']).toBe('hello')
      expect(attrs['error.context.primitiveNumber']).toBe(42)
      expect(attrs['error.context.primitiveBoolean']).toBe(true)
      expect(attrs['error.context.complexObject']).toBeUndefined()
      expect(attrs['error.context.arrayValue']).toBeUndefined()
    })
  })

  describe('toMetricLabels', () => {
    it('converts error to metric labels', () => {
      const labels = toMetricLabels(sampleError)
      expect(labels.error_kind).toBe('ValidationError')
      expect(Object.keys(labels)).toHaveLength(1)
    })
  })
})
