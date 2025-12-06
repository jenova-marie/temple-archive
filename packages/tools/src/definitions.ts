/**
 * Tool definitions for the RecoverySky agent
 *
 * These tools allow the AI to:
 * - Find AA/NA meetings
 * - Log user's mood
 * - Get crisis resources
 * - Get recovery resources
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@recoverysky/observability'

/**
 * Find local AA/NA meetings
 */
export const findMeetings = tool({
  description: 'Find local AA (Alcoholics Anonymous) or NA (Narcotics Anonymous) meetings near the user',
  parameters: z.object({
    type: z.enum(['aa', 'na', 'both']).describe('Type of meeting to search for'),
    location: z.string().optional().describe('Location to search near (city, zip, or address)'),
    day: z.enum(['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
      .optional()
      .describe('Day to search for meetings'),
    format: z.enum(['in-person', 'online', 'both']).optional().describe('Meeting format preference'),
  }),
  execute: async ({ type, location, day, format }) => {
    return withSpan('tool.findMeetings', async () => {
      const logger = getLogger().child({ tool: 'findMeetings' })

      logger.info({ type, location, day, format }, 'Finding meetings')

      // Stub response - in production, this would call a real meetings API
      const meetings = [
        {
          name: 'Early Birds AA Meeting',
          type: 'aa',
          time: '7:00 AM',
          day: day || 'today',
          location: location || 'Community Center, 123 Main St',
          format: format || 'in-person',
          description: 'Open meeting, all are welcome',
        },
        {
          name: 'Serenity Now NA Meeting',
          type: 'na',
          time: '6:00 PM',
          day: day || 'today',
          location: location || 'Church Hall, 456 Oak Ave',
          format: format || 'in-person',
          description: 'Closed meeting for addicts only',
        },
        {
          name: 'Online Recovery NA',
          type: 'na',
          time: '8:00 PM',
          day: day || 'today',
          location: 'Zoom (link provided upon request)',
          format: 'online',
          description: 'Open online meeting',
        },
      ]

      // Filter by type
      const filtered = meetings.filter(m => type === 'both' || m.type === type)

      logger.info({ count: filtered.length }, 'Meetings found')

      return {
        success: true,
        meetings: filtered,
        message: `Found ${filtered.length} ${type === 'both' ? '' : type.toUpperCase() + ' '}meetings`,
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
  logMood,
  getCrisisResources,
  getResources,
}
