/**
 * Tool definitions for Siri
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@siri/observability'

/**
 * Log user's mood
 */
export const logMood = tool({
  description: 'Log the user\'s current mood or emotional state for tracking over time',
  inputSchema: z.object({
    mood: z.enum(['great', 'good', 'okay', 'struggling', 'bad', 'crisis'])
      .describe('Current mood level'),
    notes: z.string().optional().describe('Optional notes about the mood'),
    triggers: z.array(z.string()).optional().describe('Any triggers that affected mood'),
  }),
  execute: async ({ mood, notes, triggers }) => {
    return withSpan('tool.logMood', async () => {
      const logger = getLogger().child({ tool: 'logMood' })

      logger.info({ mood, triggers }, 'Logging mood')

      // Stub response - in production, this would persist to database
      const moodEntry = {
        id: `mood_${Date.now()}`,
        mood,
        notes,
        triggers: triggers || [],
        timestamp: new Date().toISOString(),
      }

      logger.info({ moodEntryId: moodEntry.id }, 'Mood logged successfully')

      return {
        success: true,
        entry: moodEntry,
        message: `Mood "${mood}" logged successfully`,
      }
    })
  },
})

/**
 * All agent tools
 */
export const agentTools = {
  logMood,
}
