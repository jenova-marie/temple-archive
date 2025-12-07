import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findMeetings, logMood, getCrisisResources, getResources, recoveryTools } from './definitions.js'

// Mock observability
vi.mock('@recoverysky/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}))

describe('tools/definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findMeetings', () => {
    it('has correct description', () => {
      expect(findMeetings.description).toContain('AA')
      expect(findMeetings.description).toContain('NA')
      expect(findMeetings.description).toContain('meeting')
    })

    it('returns AA meetings when type is aa', async () => {
      const result = await findMeetings.execute({ type: 'aa' })

      expect(result.success).toBe(true)
      expect(result.meetings.every((m: { type: string }) => m.type === 'aa')).toBe(true)
    })

    it('returns NA meetings when type is na', async () => {
      const result = await findMeetings.execute({ type: 'na' })

      expect(result.success).toBe(true)
      expect(result.meetings.every((m: { type: string }) => m.type === 'na')).toBe(true)
    })

    it('returns both AA and NA meetings when type is both', async () => {
      const result = await findMeetings.execute({ type: 'both' })

      expect(result.success).toBe(true)
      expect(result.meetings.length).toBeGreaterThan(0)
      expect(result.meetings.some((m: { type: string }) => m.type === 'aa')).toBe(true)
      expect(result.meetings.some((m: { type: string }) => m.type === 'na')).toBe(true)
    })

    it('uses provided location', async () => {
      const result = await findMeetings.execute({ type: 'aa', location: 'Seattle, WA' })

      expect(result.success).toBe(true)
      expect(result.meetings[0].location).toBe('Seattle, WA')
    })

    it('uses provided day', async () => {
      const result = await findMeetings.execute({ type: 'aa', day: 'monday' })

      expect(result.success).toBe(true)
      expect(result.meetings[0].day).toBe('monday')
    })

    it('uses provided format', async () => {
      const result = await findMeetings.execute({ type: 'aa', format: 'online' })

      expect(result.success).toBe(true)
      expect(result.meetings[0].format).toBe('online')
    })

    it('includes meeting details', async () => {
      const result = await findMeetings.execute({ type: 'both' })

      const meeting = result.meetings[0]
      expect(meeting.name).toBeDefined()
      expect(meeting.type).toBeDefined()
      expect(meeting.time).toBeDefined()
      expect(meeting.day).toBeDefined()
      expect(meeting.location).toBeDefined()
      expect(meeting.format).toBeDefined()
      expect(meeting.description).toBeDefined()
    })

    it('returns message with count', async () => {
      const result = await findMeetings.execute({ type: 'aa' })

      expect(result.message).toContain('Found')
      expect(result.message).toContain('AA')
    })
  })

  describe('logMood', () => {
    it('has correct description', () => {
      expect(logMood.description).toContain('mood')
    })

    it('logs mood successfully', async () => {
      const result = await logMood.execute({ mood: 'good' })

      expect(result.success).toBe(true)
      expect(result.entry.mood).toBe('good')
      expect(result.message).toContain('good')
    })

    it('includes entry id and timestamp', async () => {
      const result = await logMood.execute({ mood: 'okay' })

      expect(result.entry.id).toMatch(/^mood_\d+$/)
      expect(result.entry.timestamp).toBeDefined()
    })

    it('includes optional notes', async () => {
      const result = await logMood.execute({ mood: 'struggling', notes: 'Had a tough day' })

      expect(result.entry.notes).toBe('Had a tough day')
    })

    it('includes optional triggers', async () => {
      const result = await logMood.execute({ mood: 'bad', triggers: ['stress', 'isolation'] })

      expect(result.entry.triggers).toEqual(['stress', 'isolation'])
    })

    it('includes optional coping strategies', async () => {
      const result = await logMood.execute({
        mood: 'okay',
        copingStrategies: ['deep breathing', 'called sponsor'],
      })

      expect(result.entry.copingStrategies).toEqual(['deep breathing', 'called sponsor'])
    })

    it('returns positive encouragement for good moods', async () => {
      const result = await logMood.execute({ mood: 'great' })

      expect(result.encouragement).toContain('wonderful')
    })

    it('returns neutral encouragement for okay mood', async () => {
      const result = await logMood.execute({ mood: 'okay' })

      expect(result.encouragement).toContain('progress')
    })

    it('returns supportive encouragement for struggling moods', async () => {
      const result = await logMood.execute({ mood: 'struggling' })

      expect(result.encouragement).toContain('strength')
    })

    it('accepts all mood levels', async () => {
      const moods = ['great', 'good', 'okay', 'struggling', 'bad', 'crisis'] as const

      for (const mood of moods) {
        const result = await logMood.execute({ mood })
        expect(result.success).toBe(true)
        expect(result.entry.mood).toBe(mood)
      }
    })
  })

  describe('getCrisisResources', () => {
    it('has correct description', () => {
      expect(getCrisisResources.description).toContain('crisis')
      expect(getCrisisResources.description).toContain('emergency')
    })

    it('returns all resources by default', async () => {
      const result = await getCrisisResources.execute({})

      expect(result.success).toBe(true)
      expect(result.resources.length).toBeGreaterThan(0)
      expect(result.urgent).toBe(true)
    })

    it('returns general resources', async () => {
      const result = await getCrisisResources.execute({ type: 'general' })

      expect(result.success).toBe(true)
      expect(result.resources.some((r: { phone: string }) => r.phone === '988')).toBe(true)
    })

    it('returns suicide resources', async () => {
      const result = await getCrisisResources.execute({ type: 'suicide' })

      expect(result.success).toBe(true)
      expect(result.resources.some((r: { phone: string }) => r.phone === '988')).toBe(true)
    })

    it('returns substance resources', async () => {
      const result = await getCrisisResources.execute({ type: 'substance' })

      expect(result.success).toBe(true)
      expect(result.resources.some((r: { name: string }) => r.name.includes('SAMHSA'))).toBe(true)
    })

    it('returns domestic violence resources', async () => {
      const result = await getCrisisResources.execute({ type: 'domestic-violence' })

      expect(result.success).toBe(true)
      expect(result.resources.some((r: { name: string }) => r.name.includes('Domestic Violence'))).toBe(true)
    })

    it('includes resource details', async () => {
      const result = await getCrisisResources.execute({ type: 'general' })

      const resource = result.resources[0]
      expect(resource.name).toBeDefined()
      expect(resource.description).toBeDefined()
      expect(resource.available24x7).toBe(true)
    })

    it('includes supportive message', async () => {
      const result = await getCrisisResources.execute({})

      expect(result.message).toContain('24/7')
      expect(result.message).toContain('support')
    })
  })

  describe('getResources', () => {
    it('has correct description', () => {
      expect(getResources.description).toContain('recovery')
      expect(getResources.description).toContain('resources')
    })

    it('returns relapse prevention resources', async () => {
      const result = await getResources.execute({ topic: 'relapse-prevention' })

      expect(result.success).toBe(true)
      expect(result.topic).toBe('relapse-prevention')
      expect(result.resources.length).toBeGreaterThan(0)
    })

    it('returns coping strategies resources', async () => {
      const result = await getResources.execute({ topic: 'coping-strategies' })

      expect(result.success).toBe(true)
      expect(result.resources.some((r: { title: string }) => r.title.includes('Grounding'))).toBe(true)
    })

    it('returns meditation resources', async () => {
      const result = await getResources.execute({ topic: 'meditation' })

      expect(result.success).toBe(true)
      expect(result.resources.some((r: { title: string }) => r.title.includes('Meditation'))).toBe(true)
    })

    it('returns general resources for unknown topics', async () => {
      const result = await getResources.execute({ topic: 'general' })

      expect(result.success).toBe(true)
      expect(result.resources.length).toBeGreaterThan(0)
    })

    it('includes resource details', async () => {
      const result = await getResources.execute({ topic: 'relapse-prevention' })

      const resource = result.resources[0]
      expect(resource.title).toBeDefined()
      expect(resource.description).toBeDefined()
      expect(resource.type).toBeDefined()
    })

    it('returns message with topic', async () => {
      const result = await getResources.execute({ topic: 'coping-strategies' })

      expect(result.message).toContain('coping strategies')
    })

    it('accepts all topic types', async () => {
      const topics = [
        'relapse-prevention',
        'coping-strategies',
        'meditation',
        'exercise',
        'nutrition',
        'sleep',
        'relationships',
        'work-life',
        'general',
      ] as const

      for (const topic of topics) {
        const result = await getResources.execute({ topic })
        expect(result.success).toBe(true)
      }
    })
  })

  describe('recoveryTools', () => {
    it('exports all tools', () => {
      expect(recoveryTools.findMeetings).toBe(findMeetings)
      expect(recoveryTools.logMood).toBe(logMood)
      expect(recoveryTools.getCrisisResources).toBe(getCrisisResources)
      expect(recoveryTools.getResources).toBe(getResources)
    })

    it('has 4 tools', () => {
      expect(Object.keys(recoveryTools)).toHaveLength(4)
    })
  })
})
