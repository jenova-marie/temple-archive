import { describe, it, expect } from 'vitest'
import { CRISIS_PATTERNS, CRISIS_RESOURCES, type CrisisPattern } from './patterns.js'

describe('CRISIS_PATTERNS', () => {
  it('is an array of patterns', () => {
    expect(Array.isArray(CRISIS_PATTERNS)).toBe(true)
    expect(CRISIS_PATTERNS.length).toBeGreaterThan(0)
  })

  it('contains all required pattern types', () => {
    const types = CRISIS_PATTERNS.map((p) => p.type)
    expect(types).toContain('suicidal_ideation')
    expect(types).toContain('self_harm')
    expect(types).toContain('overdose_risk')
    expect(types).toContain('violence_risk')
    expect(types).toContain('active_relapse')
    expect(types).toContain('imminent_relapse')
    expect(types).toContain('severe_distress')
    expect(types).toContain('hopelessness')
    expect(types).toContain('isolation')
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
