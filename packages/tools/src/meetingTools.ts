/**
 * Meeting Tools for the RecoverySky Agent
 *
 * These tools allow the AI to find AA/NA/CMA/RD meetings:
 * - Live meetings currently in session
 * - Scheduled meetings for today, tomorrow, or a specific day
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
  inputSchema: z.object({
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
  inputSchema: z.object({
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
 * All meeting tools
 */
export const meetingTools = {
  findMeetings,
  getLiveMeetings,
}
