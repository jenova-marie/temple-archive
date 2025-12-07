/**
 * Tool definitions for the RecoverySky agent
 *
 * These tools allow the AI to:
 * - Find AA/NA/CMA/RD meetings (live and scheduled)
 * - Log user's mood
 * - Get crisis resources
 * - Get recovery resources
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@recoverysky/observability'
import { getMeetingClient, type Meeting } from './clients/meetingClient.js'

/**
 * Day of week mapping for schedule queries
 */
const DAY_OF_WEEK_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/**
 * Format a meeting for display
 */
function formatMeeting(meeting: Meeting): {
  id: string
  name: string
  fellowship: string
  time: string | null
  day: string | null
  url: string | null
  description: string | null
  location: string | null
  language: string | null
  format: 'online' | 'in-person' | 'unknown'
} {
  // Determine format from URL or location
  let format: 'online' | 'in-person' | 'unknown' = 'unknown'
  if (meeting.url && (meeting.url.includes('zoom') || meeting.url.includes('meet.google') || meeting.url.includes('teams'))) {
    format = 'online'
  } else if (meeting.location && !meeting.url) {
    format = 'in-person'
  } else if (meeting.url) {
    format = 'online'
  }

  // Format time from TREX data
  let time: string | null = null
  let day: string | null = null

  if (meeting.trex) {
    if (meeting.trex.hour !== undefined && meeting.trex.minute !== undefined) {
      const hour = meeting.trex.hour
      const minute = meeting.trex.minute
      const ampm = hour >= 12 ? 'PM' : 'AM'
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      time = `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`
    }

    if (meeting.trex.dow !== undefined) {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      day = days[meeting.trex.dow - 1] || null // dow is 1-indexed (1=Monday)
    }
  }

  return {
    id: meeting.id,
    name: meeting.name,
    fellowship: meeting.fellowship,
    time,
    day,
    url: meeting.url || null,
    description: meeting.description || null,
    location: meeting.location || null,
    language: meeting.language || null,
    format,
  }
}

/**
 * Find AA/NA/CMA/RD meetings
 *
 * Connects to the RecoverySky Meeting Discovery API to find:
 * - Live meetings currently in session
 * - Scheduled meetings for today, tomorrow, or a specific day
 */
export const findMeetings = tool({
  description: `Find recovery meetings (AA, NA, CMA, RD) that are currently live or scheduled.
Can search for:
- Meetings happening RIGHT NOW (live)
- Meetings scheduled for today, tomorrow, or a specific day of the week
- Filter by fellowship type (AA, NA, CMA, RD, or all)
- Filter by format (online, in-person, or both)`,
  parameters: z.object({
    fellowship: z.enum(['aa', 'na', 'cma', 'rd', 'all'])
      .describe('Fellowship type to search for (AA=Alcoholics Anonymous, NA=Narcotics Anonymous, CMA=Crystal Meth Anonymous, RD=Recover Dharma)'),
    when: z.enum(['now', 'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
      .default('now')
      .describe('When to search for meetings: "now" for live meetings, or a day for scheduled meetings'),
    format: z.enum(['online', 'in-person', 'both'])
      .default('both')
      .describe('Meeting format preference'),
    timezone: z.string()
      .default('America/New_York')
      .describe('IANA timezone for schedule queries (e.g., America/New_York, America/Los_Angeles)'),
  }),
  execute: async ({ fellowship, when, format, timezone }) => {
    return withSpan('tool.findMeetings', async () => {
      const logger = getLogger().child({ tool: 'findMeetings' })

      logger.info({ fellowship, when, format, timezone }, 'Finding meetings')

      try {
        const client = getMeetingClient()
        let meetings: Meeting[] = []
        let source: 'live' | 'schedule' = 'schedule'

        // Fetch meetings based on 'when' parameter
        if (when === 'now') {
          // Get live meetings
          source = 'live'
          const response = await client.getLiveMeetings()
          meetings = response.meetings
          logger.info({ liveCount: response.liveCount }, 'Live meetings fetched')
        } else if (when === 'today') {
          const response = await client.getTodaysMeetings(timezone)
          meetings = response.meetings
        } else if (when === 'tomorrow') {
          const response = await client.getTomorrowsMeetings(timezone)
          meetings = response.meetings
        } else {
          // Specific day of week
          const dayOfWeek = DAY_OF_WEEK_MAP[when]
          if (dayOfWeek !== undefined) {
            const response = await client.getMeetingsForDay(dayOfWeek, timezone)
            meetings = response.meetings
          }
        }

        // Filter by fellowship
        if (fellowship !== 'all') {
          const fellowshipUpper = fellowship.toUpperCase()
          meetings = meetings.filter(m => m.fellowship === fellowshipUpper)
        }

        // Filter by format
        if (format !== 'both') {
          meetings = meetings.filter(m => {
            const hasUrl = !!m.url
            const hasLocation = !!m.location

            if (format === 'online') {
              return hasUrl
            } else {
              return hasLocation && !hasUrl
            }
          })
        }

        // Format meetings for display
        const formattedMeetings = meetings.map(formatMeeting)

        logger.info({ count: formattedMeetings.length, source }, 'Meetings found')

        // Build response message
        let message: string
        if (formattedMeetings.length === 0) {
          message = when === 'now'
            ? `No ${fellowship === 'all' ? '' : fellowship.toUpperCase() + ' '}meetings are currently live.`
            : `No ${fellowship === 'all' ? '' : fellowship.toUpperCase() + ' '}meetings found for ${when}.`
        } else {
          const prefix = when === 'now' ? 'live' : `scheduled for ${when}`
          message = `Found ${formattedMeetings.length} ${fellowship === 'all' ? '' : fellowship.toUpperCase() + ' '}meeting${formattedMeetings.length === 1 ? '' : 's'} ${prefix}.`
        }

        return {
          success: true,
          meetings: formattedMeetings,
          count: formattedMeetings.length,
          source,
          when,
          fellowship,
          format,
          timezone,
          message,
        }
      } catch (error) {
        logger.error({ error }, 'Failed to fetch meetings')

        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        return {
          success: false,
          meetings: [],
          count: 0,
          error: errorMessage,
          message: `Unable to fetch meetings: ${errorMessage}. Please try again later.`,
        }
      }
    })
  },
})

/**
 * Get live meetings happening right now
 *
 * Simpler tool specifically for finding meetings currently in session.
 */
export const getLiveMeetings = tool({
  description: 'Get recovery meetings that are happening RIGHT NOW. Returns all live meetings across all fellowships.',
  parameters: z.object({
    fellowship: z.enum(['aa', 'na', 'cma', 'rd', 'all'])
      .default('all')
      .describe('Optional: filter by fellowship type'),
  }),
  execute: async ({ fellowship }) => {
    return withSpan('tool.getLiveMeetings', async () => {
      const logger = getLogger().child({ tool: 'getLiveMeetings' })

      logger.info({ fellowship }, 'Getting live meetings')

      try {
        const client = getMeetingClient()
        const response = await client.getLiveMeetings()

        let meetings = response.meetings

        // Filter by fellowship if specified
        if (fellowship !== 'all') {
          const fellowshipUpper = fellowship.toUpperCase()
          meetings = meetings.filter(m => m.fellowship === fellowshipUpper)
        }

        const formattedMeetings = meetings.map(formatMeeting)

        logger.info({ count: formattedMeetings.length }, 'Live meetings retrieved')

        return {
          success: true,
          meetings: formattedMeetings,
          count: formattedMeetings.length,
          timestamp: response.timestamp,
          message: formattedMeetings.length > 0
            ? `Found ${formattedMeetings.length} live meeting${formattedMeetings.length === 1 ? '' : 's'} happening now!`
            : 'No meetings are currently live. Try searching for scheduled meetings.',
        }
      } catch (error) {
        logger.error({ error }, 'Failed to fetch live meetings')

        return {
          success: false,
          meetings: [],
          count: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
          message: 'Unable to fetch live meetings. Please try again later.',
        }
      }
    })
  },
})

/**
 * Log user's mood
 */
export const logMood = tool({
  description: 'Log the user\'s current mood or emotional state for tracking over time',
  parameters: z.object({
    mood: z.enum(['great', 'good', 'okay', 'struggling', 'bad', 'crisis'])
      .describe('Current mood level'),
    notes: z.string().optional().describe('Optional notes about the mood'),
    triggers: z.array(z.string()).optional().describe('Any triggers that affected mood'),
    copingStrategies: z.array(z.string()).optional().describe('Coping strategies used'),
  }),
  execute: async ({ mood, notes, triggers, copingStrategies }) => {
    return withSpan('tool.logMood', async () => {
      const logger = getLogger().child({ tool: 'logMood' })

      logger.info({ mood, triggers }, 'Logging mood')

      // Stub response - in production, this would persist to database
      const moodEntry = {
        id: `mood_${Date.now()}`,
        mood,
        notes,
        triggers: triggers || [],
        copingStrategies: copingStrategies || [],
        timestamp: new Date().toISOString(),
      }

      logger.info({ moodEntryId: moodEntry.id }, 'Mood logged successfully')

      return {
        success: true,
        entry: moodEntry,
        message: `Mood "${mood}" logged successfully`,
        encouragement: mood === 'great' || mood === 'good'
          ? 'That\'s wonderful! Keep up the great work on your journey.'
          : mood === 'okay'
            ? 'Thank you for checking in. Remember, every day is progress.'
            : 'Thank you for sharing. Remember, reaching out is a sign of strength.',
      }
    })
  },
})

/**
 * Get crisis resources
 */
export const getCrisisResources = tool({
  description: 'Get crisis hotlines and emergency resources for immediate support',
  parameters: z.object({
    type: z.enum(['general', 'suicide', 'substance', 'domestic-violence', 'all'])
      .optional()
      .describe('Type of crisis resources needed'),
  }),
  execute: async ({ type = 'all' }) => {
    return withSpan('tool.getCrisisResources', async () => {
      const logger = getLogger().child({ tool: 'getCrisisResources' })

      logger.info({ type }, 'Getting crisis resources')

      const resources = {
        general: [
          {
            name: '988 Suicide & Crisis Lifeline',
            description: 'Free, confidential 24/7 support',
            phone: '988',
            text: 'Text 988',
            available24x7: true,
          },
          {
            name: 'Crisis Text Line',
            description: 'Free crisis counseling via text',
            text: 'Text HOME to 741741',
            available24x7: true,
          },
        ],
        suicide: [
          {
            name: '988 Suicide & Crisis Lifeline',
            description: 'National Suicide Prevention',
            phone: '988',
            available24x7: true,
          },
        ],
        substance: [
          {
            name: 'SAMHSA National Helpline',
            description: 'Substance Abuse and Mental Health Services',
            phone: '1-800-662-4357',
            available24x7: true,
          },
        ],
        'domestic-violence': [
          {
            name: 'National Domestic Violence Hotline',
            description: 'Confidential support for domestic violence',
            phone: '1-800-799-7233',
            available24x7: true,
          },
        ],
      }

      let result
      if (type === 'all') {
        result = Object.values(resources).flat()
      } else {
        result = resources[type] || resources.general
      }

      logger.info({ count: result.length }, 'Crisis resources retrieved')

      return {
        success: true,
        resources: result,
        message: 'Here are resources available 24/7. Please reach out if you need immediate support.',
        urgent: true,
      }
    })
  },
})

/**
 * Get recovery resources
 */
export const getResources = tool({
  description: 'Get recovery resources, educational materials, and support information',
  parameters: z.object({
    topic: z.enum([
      'relapse-prevention',
      'coping-strategies',
      'meditation',
      'exercise',
      'nutrition',
      'sleep',
      'relationships',
      'work-life',
      'general',
    ]).describe('Topic of resources to retrieve'),
  }),
  execute: async ({ topic }) => {
    return withSpan('tool.getResources', async () => {
      const logger = getLogger().child({ tool: 'getResources' })

      logger.info({ topic }, 'Getting recovery resources')

      const resources: Record<string, Array<{ title: string; description: string; type: string }>> = {
        'relapse-prevention': [
          {
            title: 'Understanding Triggers',
            description: 'Learn to identify and manage your personal triggers',
            type: 'article',
          },
          {
            title: 'HALT: Hungry, Angry, Lonely, Tired',
            description: 'Recognize vulnerability states that increase relapse risk',
            type: 'guide',
          },
          {
            title: 'Building a Relapse Prevention Plan',
            description: 'Step-by-step guide to creating your personal prevention strategy',
            type: 'worksheet',
          },
        ],
        'coping-strategies': [
          {
            title: 'Grounding Techniques',
            description: '5-4-3-2-1 sensory grounding and other methods',
            type: 'exercise',
          },
          {
            title: 'Deep Breathing Exercises',
            description: 'Calming breathing techniques for anxiety and cravings',
            type: 'exercise',
          },
          {
            title: 'Urge Surfing',
            description: 'Riding out cravings without acting on them',
            type: 'guide',
          },
        ],
        meditation: [
          {
            title: 'Mindfulness for Recovery',
            description: 'Introduction to mindfulness meditation',
            type: 'guide',
          },
          {
            title: '5-Minute Meditation',
            description: 'Quick meditation for stressful moments',
            type: 'audio',
          },
        ],
        general: [
          {
            title: 'Recovery Basics',
            description: 'Understanding the stages of recovery',
            type: 'article',
          },
          {
            title: 'Building Your Support Network',
            description: 'How to create and maintain supportive relationships',
            type: 'guide',
          },
        ],
      }

      const result = resources[topic] || resources.general

      logger.info({ count: result.length, topic }, 'Resources retrieved')

      return {
        success: true,
        resources: result,
        topic,
        message: `Here are some ${topic.replace('-', ' ')} resources for you.`,
      }
    })
  },
})

/**
 * All available tools
 */
export const recoveryTools = {
  findMeetings,
  getLiveMeetings,
  logMood,
  getCrisisResources,
  getResources,
}
