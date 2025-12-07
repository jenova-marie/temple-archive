import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { MedicalAdviceDetector } from './MedicalAdviceDetector.js'

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: 'span-123',
  traceId: 'trace-123',
})

// Mock Anthropic client
const mockCreate = vi.fn()
const mockClient = {
  messages: {
    create: mockCreate,
  },
} as unknown as Anthropic

describe('MedicalAdviceDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('preFilter', () => {
    const detector = new MedicalAdviceDetector(null)

    describe('dosage patterns', () => {
      it('should detect mg dosage recommendation', () => {
        const matches = detector.preFilter('Take 500 mg twice daily')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'dosage_recommendation')).toBe(true)
      })

      it('should detect pill count recommendation', () => {
        const matches = detector.preFilter('Take 2 pills every morning')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'dosage_recommendation')).toBe(true)
      })

      it('should detect frequency recommendation', () => {
        const matches = detector.preFilter('Use this three times a day')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'dosage_frequency')).toBe(true)
      })
    })

    describe('diagnostic patterns', () => {
      it('should detect disorder diagnosis', () => {
        const matches = detector.preFilter('You have anxiety disorder')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'diagnosis_statement')).toBe(true)
      })

      it('should detect implied diagnosis', () => {
        const matches = detector.preFilter('It sounds like you have depression')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'diagnosis_sounds_like')).toBe(true)
      })

      it('should detect probable diagnosis', () => {
        const matches = detector.preFilter('You probably have a sleep disorder')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'diagnosis_statement')).toBe(true)
      })
    })

    describe('treatment patterns', () => {
      it('should detect treatment instruction', () => {
        const matches = detector.preFilter('Treat your pain with ibuprofen')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'treatment_instruction')).toBe(true)
      })

      it('should detect procedure recommendation', () => {
        // Pattern: you need/should/must get/have/undergo (a|an )? (word )? surgery/procedure/operation/scan/test/biopsy
        const matches = detector.preFilter('You must have surgery soon')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'medical_procedure')).toBe(true)
      })
    })

    describe('dangerous advice patterns', () => {
      it('should detect stop medication advice', () => {
        const matches = detector.preFilter("You should stop taking your medication")
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'stop_medication')).toBe(true)
      })

      it('should detect increase dosage advice', () => {
        const matches = detector.preFilter('Maybe double your dose')
        expect(matches.length).toBeGreaterThan(0)
        expect(matches.some((m) => m.pattern === 'increase_dosage')).toBe(true)
      })
    })

    describe('dampeners', () => {
      it('should reduce confidence when consult doctor is mentioned', () => {
        const text = 'Take 500 mg but please consult your doctor first'
        const matches = detector.preFilter(text)
        expect(matches.length).toBeGreaterThan(0)
        expect(matches[0].confidence).toBeLessThan(0.5) // Dampened
      })

      it('should reduce confidence with not medical advice disclaimer', () => {
        const text = 'This is not medical advice but 2 pills might help'
        const matches = detector.preFilter(text)
        expect(matches.length).toBeGreaterThan(0)
        expect(matches[0].confidence).toBeLessThan(0.5) // Dampened
      })
    })

    describe('no matches', () => {
      it('should not match general wellness advice', () => {
        const matches = detector.preFilter('Try to get more sleep and exercise regularly')
        expect(matches).toHaveLength(0)
      })

      it('should not match recovery encouragement', () => {
        const matches = detector.preFilter('Your recovery journey is going well')
        expect(matches).toHaveLength(0)
      })

      it('should not match support resources', () => {
        const matches = detector.preFilter('Consider attending a support group meeting')
        expect(matches).toHaveLength(0)
      })
    })
  })

  describe('analyzeLLM', () => {
    it('should return null when client is not provided', async () => {
      const detector = new MedicalAdviceDetector(null)
      const result = await detector.analyzeLLM('test text', createTraceContext())
      expect(result).toBeNull()
    })

    it('should parse LLM response correctly', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isMedicalAdvice: true,
              confidence: 0.9,
              reasoning: 'Contains specific dosage recommendation',
            }),
          },
        ],
      })

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.analyzeLLM('Take 500mg twice daily', createTraceContext())

      expect(result).not.toBeNull()
      expect(result!.isMedicalAdvice).toBe(true)
      expect(result!.confidence).toBe(0.9)
      expect(result!.reasoning).toContain('dosage')
    })

    it('should handle LLM response with extra text', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Here is my analysis:\n' +
              JSON.stringify({
                isMedicalAdvice: false,
                confidence: 0.85,
                reasoning: 'General wellness suggestion only',
              }) +
              '\n\nLet me know if you need more details.',
          },
        ],
      })

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.analyzeLLM('Try to exercise more', createTraceContext())

      expect(result).not.toBeNull()
      expect(result!.isMedicalAdvice).toBe(false)
    })

    it('should handle LLM errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API error'))

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.analyzeLLM('test', createTraceContext())

      expect(result).toBeNull()
    })

    it('should handle invalid JSON response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'I cannot analyze this text properly',
          },
        ],
      })

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.analyzeLLM('test', createTraceContext())

      expect(result).toBeNull()
    })

    it('should clamp confidence to 0-1 range', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isMedicalAdvice: true,
              confidence: 1.5, // Invalid
              reasoning: 'test',
            }),
          },
        ],
      })

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.analyzeLLM('test', createTraceContext())

      expect(result!.confidence).toBe(1)
    })
  })

  describe('detect', () => {
    it('should return no medical advice for clean text', async () => {
      const detector = new MedicalAdviceDetector(null)
      const result = await detector.detect(
        'Your recovery is going well, keep up the good work!',
        createTraceContext(),
        false
      )

      expect(result.isMedicalAdvice).toBe(false)
      expect(result.confidence).toBeGreaterThan(0.8)
      expect(result.matchedPatterns).toHaveLength(0)
    })

    it('should detect medical advice without LLM', async () => {
      const detector = new MedicalAdviceDetector(null)
      const result = await detector.detect(
        'You should take 500 mg of ibuprofen',
        createTraceContext(),
        false
      )

      expect(result.isMedicalAdvice).toBe(true)
      expect(result.matchedPatterns.length).toBeGreaterThan(0)
    })

    it('should use LLM for confirmation when enabled', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isMedicalAdvice: true,
              confidence: 0.95,
              reasoning: 'Recommends specific medication dosage',
            }),
          },
        ],
      })

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.detect(
        'Take 500 mg twice daily',
        createTraceContext(),
        true
      )

      expect(result.isMedicalAdvice).toBe(true)
      expect(result.confidence).toBe(0.95)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it('should fall back to prefilter when LLM fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'))

      const detector = new MedicalAdviceDetector(mockClient)
      const result = await detector.detect(
        'Take 500 mg twice daily',
        createTraceContext(),
        true
      )

      // Should still detect based on prefilter
      expect(result.isMedicalAdvice).toBe(true)
      expect(result.matchedPatterns.length).toBeGreaterThan(0)
    })
  })

  describe('detectViolations', () => {
    it('should return SafetyViolation for medical advice', async () => {
      const detector = new MedicalAdviceDetector(null)
      const violations = await detector.detectViolations(
        'Take 500 mg twice daily',
        createTraceContext(),
        false
      )

      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        type: 'medical_advice',
        severity: expect.stringMatching(/medium|high/),
      })
    })

    it('should return empty for non-medical text', async () => {
      const detector = new MedicalAdviceDetector(null)
      const violations = await detector.detectViolations(
        'Keep attending your meetings!',
        createTraceContext(),
        false
      )

      expect(violations).toHaveLength(0)
    })

    it('should return high severity for high confidence', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isMedicalAdvice: true,
              confidence: 0.95,
              reasoning: 'Explicit dosage recommendation',
            }),
          },
        ],
      })

      const detector = new MedicalAdviceDetector(mockClient)
      const violations = await detector.detectViolations(
        'Take exactly 1000mg of aspirin every 4 hours',
        createTraceContext(),
        true
      )

      expect(violations).toHaveLength(1)
      expect(violations[0].severity).toBe('high')
    })
  })

  describe('addiction recovery context', () => {
    const detector = new MedicalAdviceDetector(null)

    it('should not flag MAT discussion', async () => {
      const result = await detector.detect(
        'Medication-assisted treatment can be helpful for some people in recovery',
        createTraceContext(),
        false
      )
      expect(result.isMedicalAdvice).toBe(false)
    })

    it('should not flag general support', async () => {
      const result = await detector.detect(
        'I encourage you to speak with your doctor about treatment options',
        createTraceContext(),
        false
      )
      expect(result.isMedicalAdvice).toBe(false)
    })

    it('should not flag meeting suggestions', async () => {
      const result = await detector.detect(
        'Have you considered attending an AA or NA meeting?',
        createTraceContext(),
        false
      )
      expect(result.isMedicalAdvice).toBe(false)
    })
  })
})
