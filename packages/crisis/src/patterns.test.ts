import { describe, it, expect } from 'vitest'
import { CRISIS_PATTERNS, CRISIS_RESOURCES, type CrisisPattern } from './patterns.js'
import { KeywordCrisisDetector } from './KeywordCrisisDetector.js'

const createTraceContext = () => ({
  requestId: `req_${Date.now()}`,
  spanId: 'span-123',
  traceId: 'trace-123',
})

describe('CRISIS_PATTERNS', () => {
  it('is an array of patterns', () => {
    expect(Array.isArray(CRISIS_PATTERNS)).toBe(true)
    expect(CRISIS_PATTERNS.length).toBeGreaterThan(0)
  })

  it('should have 12 crisis patterns defined', () => {
    expect(CRISIS_PATTERNS).toHaveLength(12)
  })

  it('contains all required pattern types', () => {
    const types = CRISIS_PATTERNS.map((p) => p.type)
    expect(types).toContain('suicidal_ideation')
    expect(types).toContain('self_harm')
    expect(types).toContain('overdose_risk')
    expect(types).toContain('violence_risk')
    expect(types).toContain('active_relapse')
    expect(types).toContain('imminent_relapse')
    expect(types).toContain('withdrawal_symptoms')
    expect(types).toContain('severe_distress')
    expect(types).toContain('hopelessness')
    expect(types).toContain('isolation')
    expect(types).toContain('medication_noncompliance')
    expect(types).toContain('financial_crisis')
  })

  describe('pattern structure', () => {
    CRISIS_PATTERNS.forEach((pattern: CrisisPattern) => {
      describe(`${pattern.type}`, () => {
        it('has a valid type', () => {
          expect(typeof pattern.type).toBe('string')
          expect(pattern.type.length).toBeGreaterThan(0)
        })

        it('has a valid baseLevel between 1 and 10', () => {
          expect(pattern.baseLevel).toBeGreaterThanOrEqual(1)
          expect(pattern.baseLevel).toBeLessThanOrEqual(10)
        })

        it('has at least one regex pattern', () => {
          expect(pattern.patterns.length).toBeGreaterThan(0)
          pattern.patterns.forEach((regex) => {
            expect(regex).toBeInstanceOf(RegExp)
          })
        })

        it('has boostKeywords array', () => {
          expect(Array.isArray(pattern.boostKeywords)).toBe(true)
        })

        it('has dampeners array', () => {
          expect(Array.isArray(pattern.dampeners)).toBe(true)
        })
      })
    })
  })

  describe('pattern severity levels', () => {
    it('suicidal_ideation has critical level (9+)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'suicidal_ideation')
      expect(pattern?.baseLevel).toBeGreaterThanOrEqual(9)
    })

    it('overdose_risk has critical level (9+)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'overdose_risk')
      expect(pattern?.baseLevel).toBeGreaterThanOrEqual(9)
    })

    it('self_harm has high level (8)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'self_harm')
      expect(pattern?.baseLevel).toBe(8)
    })

    it('active_relapse has high level (8)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'active_relapse')
      expect(pattern?.baseLevel).toBe(8)
    })

    it('imminent_relapse has elevated level (7)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'imminent_relapse')
      expect(pattern?.baseLevel).toBe(7)
    })

    it('severe_distress has elevated level (6)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'severe_distress')
      expect(pattern?.baseLevel).toBe(6)
    })

    it('hopelessness has elevated level (5)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'hopelessness')
      expect(pattern?.baseLevel).toBe(5)
    })

    it('isolation has elevated level (4)', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'isolation')
      expect(pattern?.baseLevel).toBe(4)
    })
  })

  describe('regex pattern matching', () => {
    it('suicidal_ideation patterns match expected phrases', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'suicidal_ideation')!
      const testPhrases = [
        'I want to kill myself',
        'thinking about suicide',
        'I want to die',
        'end it all',
        'no point in living',
      ]
      testPhrases.forEach((phrase) => {
        const matches = pattern.patterns.some((regex) => regex.test(phrase))
        expect(matches).toBe(true)
      })
    })

    it('self_harm patterns match expected phrases', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'self_harm')!
      const testPhrases = [
        'cut myself',
        'self-harm',
        'hurting myself',
      ]
      testPhrases.forEach((phrase) => {
        const matches = pattern.patterns.some((regex) => regex.test(phrase))
        expect(matches).toBe(true)
      })
    })

    it('active_relapse patterns match expected phrases', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'active_relapse')!
      const testPhrases = [
        'relapsed again',
        'fell off the wagon',
        'high right now',
        'drunk right now',
      ]
      testPhrases.forEach((phrase) => {
        const matches = pattern.patterns.some((regex) => regex.test(phrase))
        expect(matches).toBe(true)
      })
    })
  })
})

describe('CRISIS_RESOURCES', () => {
  it('has national resources', () => {
    expect(CRISIS_RESOURCES.national).toBeDefined()
    expect(Array.isArray(CRISIS_RESOURCES.national)).toBe(true)
    expect(CRISIS_RESOURCES.national.length).toBeGreaterThan(0)
  })

  it('has recovery resources', () => {
    expect(CRISIS_RESOURCES.recovery).toBeDefined()
    expect(Array.isArray(CRISIS_RESOURCES.recovery)).toBe(true)
    expect(CRISIS_RESOURCES.recovery.length).toBeGreaterThan(0)
  })

  describe('national resources', () => {
    it('includes 988 Suicide & Crisis Lifeline', () => {
      const resource = CRISIS_RESOURCES.national.find((r) => r.name.includes('988'))
      expect(resource).toBeDefined()
      expect(resource?.contactValue).toBe('988')
      expect(resource?.available24x7).toBe(true)
    })

    it('includes Crisis Text Line', () => {
      const resource = CRISIS_RESOURCES.national.find((r) => r.name.includes('Text'))
      expect(resource).toBeDefined()
      expect(resource?.contactMethod).toBe('text')
      expect(resource?.contactValue).toBe('741741')
    })

    it('includes SAMHSA National Helpline', () => {
      const resource = CRISIS_RESOURCES.national.find((r) => r.name.includes('SAMHSA'))
      expect(resource).toBeDefined()
      expect(resource?.available24x7).toBe(true)
    })
  })

  describe('recovery resources', () => {
    it('includes AA Hotline', () => {
      const resource = CRISIS_RESOURCES.recovery.find((r) => r.name.includes('AA'))
      expect(resource).toBeDefined()
      expect(resource?.available24x7).toBe(true)
    })

    it('includes NA Helpline', () => {
      const resource = CRISIS_RESOURCES.recovery.find((r) => r.name.includes('NA'))
      expect(resource).toBeDefined()
      expect(resource?.contactMethod).toBe('phone')
    })
  })

  describe('resource structure', () => {
    const allResources = [...CRISIS_RESOURCES.national, ...CRISIS_RESOURCES.recovery]

    allResources.forEach((resource) => {
      describe(`${resource.name}`, () => {
        it('has required fields', () => {
          expect(typeof resource.name).toBe('string')
          expect(typeof resource.description).toBe('string')
          expect(['phone', 'text'].includes(resource.contactMethod)).toBe(true)
          expect(typeof resource.contactValue).toBe('string')
          expect(typeof resource.available24x7).toBe('boolean')
        })
      })
    })
  })
})

describe('new patterns', () => {
  const detector = new KeywordCrisisDetector()
  const ctx = createTraceContext()

  describe('withdrawal_symptoms', () => {
    it('should detect withdrawal symptoms', async () => {
      const result = await detector.detect(
        'I cannot stop shaking badly and the sweating is uncontrollable',
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.level).toBeGreaterThanOrEqual(7)
        expect(result.value.patterns.some((p) => p.type === 'withdrawal_symptoms')).toBe(true)
      }
    })

    it('should have withdrawal_symptoms at level 7', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'withdrawal_symptoms')
      expect(pattern?.baseLevel).toBe(7)
    })
  })

  describe('medication_noncompliance', () => {
    it('should detect stopping medication', async () => {
      const result = await detector.detect(
        'I stopped taking my medications because I feel fine now',
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.level).toBeGreaterThanOrEqual(4)
        expect(result.value.patterns.some((p) => p.type === 'medication_noncompliance')).toBe(true)
      }
    })

    it('should have medication_noncompliance at level 5', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'medication_noncompliance')
      expect(pattern?.baseLevel).toBe(5)
    })
  })

  describe('financial_crisis', () => {
    it('should have financial_crisis at level 4', () => {
      const pattern = CRISIS_PATTERNS.find((p) => p.type === 'financial_crisis')
      expect(pattern?.baseLevel).toBe(4)
    })
  })
})

describe('improved dampeners', () => {
  const detector = new KeywordCrisisDetector()
  const ctx = createTraceContext()

  describe('past tense dampeners', () => {
    it('should dampen past suicide discussion', async () => {
      const result = await detector.detect(
        'Years ago I used to think about suicide but I do not anymore',
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        // Past tense should reduce or eliminate crisis detection
        expect(result.value.level).toBeLessThan(9)
      }
    })
  })

  describe('hypothetical dampeners', () => {
    it('should dampen hypothetical questions', async () => {
      const result = await detector.detect(
        'What if someone was thinking about suicide, what would you tell them?',
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        // "what if" is a hypothetical dampener
        expect(result.value.level).toBeLessThan(9)
      }
    })
  })

  describe('media reference dampeners', () => {
    it('should dampen movie references', async () => {
      const result = await detector.detect(
        'In the movie the character wanted to kill himself but was saved',
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        // "in the movie" and "the character" are media dampeners
        expect(result.value.level).toBeLessThan(9)
      }
    })
  })

  describe('helping others dampeners', () => {
    it('should dampen friend concern', async () => {
      const result = await detector.detect(
        'My friend is talking about suicide and I am worried about them',
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        // "my friend" is a helping-others dampener
        expect(result.value.level).toBeLessThan(9)
      }
    })
  })
})

describe('boost keywords', () => {
  const detector = new KeywordCrisisDetector()
  const ctx = createTraceContext()

  it('should boost with immediacy keywords', async () => {
    const withoutBoost = await detector.detect('I want to end it all', ctx)
    const withBoost = await detector.detect('I want to end it all right now tonight', ctx)

    expect(withoutBoost.ok).toBe(true)
    expect(withBoost.ok).toBe(true)

    if (withoutBoost.ok && withBoost.ok) {
      expect(withBoost.value.level).toBeGreaterThanOrEqual(withoutBoost.value.level)
    }
  })
})

describe('false positive prevention', () => {
  const detector = new KeywordCrisisDetector()
  const ctx = createTraceContext()

  it('should not flag normal recovery discussion', async () => {
    const result = await detector.detect(
      'I am doing well in my recovery journey and have 6 months sober',
      ctx
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.level).toBeLessThanOrEqual(3)
    }
  })

  it('should not flag general wellness check', async () => {
    const result = await detector.detect(
      'How are you feeling today? I wanted to check in with you.',
      ctx
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.level).toBeLessThanOrEqual(3)
    }
  })
})
