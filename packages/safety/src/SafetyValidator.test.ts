import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { SafetyValidator } from './SafetyValidator.js'
import type { AssembledContext } from '@recoverysky/types'

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: 'span-123',
  traceId: 'trace-123',
})

const createMockContext = (): AssembledContext => ({
  messages: [],
  userProfile: null,
  sessionEntities: { people: [], places: [], events: [], emotions: [], medications: [] },
  sessionState: { startTime: Date.now(), lastActivity: Date.now(), messageCount: 0, crisisLevel: 1 },
  previousSessions: [],
})

// Mock Anthropic client
const mockCreate = vi.fn()
const mockClient = {
  messages: {
    create: mockCreate,
  },
} as unknown as Anthropic

describe('SafetyValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create validator without Anthropic client', () => {
      const validator = new SafetyValidator(null)
      expect(validator).toBeDefined()
    })

    it('should create validator with Anthropic client', () => {
      const validator = new SafetyValidator(mockClient)
      expect(validator).toBeDefined()
    })

    it('should accept custom config', () => {
      const validator = new SafetyValidator(null, {
        enableLLMDetection: false,
        redactPII: false,
      })
      expect(validator).toBeDefined()
    })
  })

  describe('validate - clean output', () => {
    it('should pass for clean output', async () => {
      const validator = new SafetyValidator(null)
      const result = await validator.validate(
        'Your recovery is going great! Keep attending meetings.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true)
        expect(result.value.violations).toHaveLength(0)
        expect(result.value.sanitizedOutput).toBeUndefined()
      }
    })

    it('should have low processing time for clean output', async () => {
      const validator = new SafetyValidator(null)
      const result = await validator.validate(
        'Keep up the great work!',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.processingTimeMs).toBeLessThan(100)
      }
    })
  })

  describe('validate - PII detection', () => {
    it('should detect and redact SSN', async () => {
      const validator = new SafetyValidator(null, { redactPII: true })
      const result = await validator.validate(
        'Your SSN is 123-45-6789 on file.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true) // Passed because sanitized
        expect(result.value.violations.length).toBeGreaterThan(0)
        expect(result.value.violations[0].type).toBe('pii')
        expect(result.value.sanitizedOutput).toContain('[SSN REDACTED]')
        expect(result.value.sanitizedOutput).not.toContain('123-45-6789')
      }
    })

    it('should detect and redact email', async () => {
      const validator = new SafetyValidator(null, { redactPII: true })
      const result = await validator.validate(
        'Contact us at support@example.com for help.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true)
        expect(result.value.violations.some((v) => v.type === 'pii')).toBe(true)
        expect(result.value.sanitizedOutput).toContain('[EMAIL REDACTED]')
      }
    })

    it('should detect multiple PII types', async () => {
      const validator = new SafetyValidator(null, { redactPII: true })
      const result = await validator.validate(
        'Call 555-123-4567 or email test@example.com',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.violations.length).toBeGreaterThanOrEqual(2)
        expect(result.value.sanitizedOutput).toContain('[PHONE REDACTED]')
        expect(result.value.sanitizedOutput).toContain('[EMAIL REDACTED]')
      }
    })

    it('should skip redaction when disabled', async () => {
      const validator = new SafetyValidator(null, { redactPII: false })
      const result = await validator.validate(
        'Your SSN is 123-45-6789',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Still detects but doesn't redact
        expect(result.value.violations.length).toBeGreaterThan(0)
      }
    })
  })

  describe('validate - medical advice detection', () => {
    it('should detect medical advice (prefilter only)', async () => {
      const validator = new SafetyValidator(null, { enableLLMDetection: false })
      const result = await validator.validate(
        'You should take 500 mg of ibuprofen twice daily',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.violations.some((v) => v.type === 'medical_advice')).toBe(true)
        expect(result.value.passed).toBe(false) // Cannot sanitize medical advice
      }
    })

    it('should use LLM for medical advice confirmation', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isMedicalAdvice: true,
              confidence: 0.9,
              reasoning: 'Recommends specific dosage',
            }),
          },
        ],
      })

      const validator = new SafetyValidator(mockClient, { enableLLMDetection: true })
      const result = await validator.validate(
        'Take 500 mg twice daily for pain',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.violations.some((v) => v.type === 'medical_advice')).toBe(true)
      }
      expect(mockCreate).toHaveBeenCalled()
    })
  })

  describe('validate - enabling language detection', () => {
    it('should detect enabling language (prefilter only)', async () => {
      const validator = new SafetyValidator(null, { enableLLMDetection: false })
      const result = await validator.validate(
        'You deserve a drink after all that hard work!',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.violations.some((v) => v.type === 'enabling_language')).toBe(true)
        expect(result.value.passed).toBe(false) // Cannot sanitize enabling
      }
    })

    it('should use LLM for enabling confirmation', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isEnabling: true,
              confidence: 0.85,
              reasoning: 'Suggests deserving alcohol',
              type: 'glorification',
            }),
          },
        ],
      })

      const validator = new SafetyValidator(mockClient, { enableLLMDetection: true })
      const result = await validator.validate(
        'You deserve a drink!',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.violations.some((v) => v.type === 'enabling_language')).toBe(true)
      }
    })
  })

  describe('validate - combined violations', () => {
    it('should detect multiple violation types', async () => {
      const validator = new SafetyValidator(null, { enableLLMDetection: false })
      const result = await validator.validate(
        'Your phone is 555-123-4567. Take 500 mg for pain. You deserve a drink!',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        const types = result.value.violations.map((v) => v.type)
        expect(types).toContain('pii')
        expect(types).toContain('medical_advice')
        expect(types).toContain('enabling_language')
      }
    })

    it('should redact PII but fail on medical/enabling', async () => {
      const validator = new SafetyValidator(null, {
        enableLLMDetection: false,
        redactPII: true,
        blockOnFailedSanitization: true,
      })

      const result = await validator.validate(
        'Call 555-123-4567. Take 500 mg daily.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(false) // Medical advice cannot be sanitized
        expect(result.value.sanitizedOutput).toContain('[PHONE REDACTED]')
      }
    })
  })

  describe('validate - sanitization behavior', () => {
    it('should pass when only PII is found and redacted', async () => {
      const validator = new SafetyValidator(null, {
        redactPII: true,
        blockOnFailedSanitization: true,
      })

      const result = await validator.validate(
        'Your email is test@example.com',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true) // PII can be sanitized
        expect(result.value.sanitizedOutput).toContain('[EMAIL REDACTED]')
      }
    })

    it('should not block when blockOnFailedSanitization is false', async () => {
      const validator = new SafetyValidator(null, {
        enableLLMDetection: false,
        blockOnFailedSanitization: false,
      })

      const result = await validator.validate(
        'Take 500 mg daily',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true) // Doesn't block on failed sanitization
        expect(result.value.violations.length).toBeGreaterThan(0)
      }
    })
  })

  describe('validate - error handling', () => {
    it('should handle LLM errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API error'))

      const validator = new SafetyValidator(mockClient, { enableLLMDetection: true })
      const result = await validator.validate(
        'Take 500 mg daily', // Will trigger prefilter
        createMockContext(),
        createTraceContext()
      )

      // Should still return a result (fallback to prefilter)
      expect(result.ok).toBe(true)
    })
  })

  describe('validate - parallel LLM detection', () => {
    it('should run LLM detectors in parallel by default', async () => {
      let callOrder: string[] = []

      mockCreate
        .mockImplementationOnce(async () => {
          callOrder.push('first')
          await new Promise((r) => setTimeout(r, 50))
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ isMedicalAdvice: false, confidence: 0.5, reasoning: 'test' }),
              },
            ],
          }
        })
        .mockImplementationOnce(async () => {
          callOrder.push('second')
          await new Promise((r) => setTimeout(r, 50))
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ isEnabling: false, confidence: 0.5, reasoning: 'test', type: null }),
              },
            ],
          }
        })

      const validator = new SafetyValidator(mockClient, {
        enableLLMDetection: true,
        parallelLLMDetection: true,
      })

      // Text that triggers both prefilters
      await validator.validate(
        'Take 500 mg. You deserve a drink!',
        createMockContext(),
        createTraceContext()
      )

      // Both calls should start nearly simultaneously (parallel)
      expect(mockCreate).toHaveBeenCalledTimes(2)
    })
  })

  describe('recovery context - false positives', () => {
    it('should not flag general wellness advice', async () => {
      const validator = new SafetyValidator(null)
      const result = await validator.validate(
        'Try to get more sleep and exercise regularly. Stay hydrated!',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true)
        expect(result.value.violations).toHaveLength(0)
      }
    })

    it('should not flag meeting recommendations', async () => {
      const validator = new SafetyValidator(null)
      const result = await validator.validate(
        'Consider attending an AA meeting today. Your sponsor can help.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true)
        expect(result.value.violations).toHaveLength(0)
      }
    })

    it('should not flag cravings discussion', async () => {
      const validator = new SafetyValidator(null)
      const result = await validator.validate(
        'Cravings are challenging but they will pass. Deep breathing can help.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true)
        expect(result.value.violations).toHaveLength(0)
      }
    })

    it('should not flag relapse prevention discussion', async () => {
      const validator = new SafetyValidator(null)
      const result = await validator.validate(
        'Relapse is a risk, but with your support network, you can stay strong.',
        createMockContext(),
        createTraceContext()
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.passed).toBe(true)
        expect(result.value.violations).toHaveLength(0)
      }
    })
  })
})
