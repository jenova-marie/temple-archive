# @pippa/tools

AI tool definitions for the RecoverySky Agent, built with Vercel AI SDK.

## Installation

```bash
pnpm add @pippa/tools
```

## Overview

This package defines tools that the AI agent can invoke to:

- Find AA/NA meetings
- Log user mood
- Get crisis resources
- Get recovery resources

## Quick Start

```typescript
import { recoveryTools } from '@pippa/tools'

// Use with Vercel AI SDK
import { generateText } from 'ai'

const result = await generateText({
  model: anthropic('claude-3-5-sonnet-20241022'),
  tools: recoveryTools,
  messages: [
    { role: 'user', content: 'Find me an AA meeting nearby' }
  ],
})
```

## Available Tools

### findMeetings

Search for local AA or NA meetings.

```typescript
findMeetings({
  type: 'aa' | 'na' | 'both',
  location?: string,       // City, zip, or address
  day?: 'today' | 'tomorrow' | 'monday' | ... | 'sunday',
  format?: 'in-person' | 'online' | 'both',
})

// Returns
{
  success: true,
  meetings: [
    {
      name: 'Early Birds AA Meeting',
      type: 'aa',
      time: '7:00 AM',
      day: 'today',
      location: 'Community Center, 123 Main St',
      format: 'in-person',
      description: 'Open meeting, all are welcome',
    },
    // ...
  ],
  message: 'Found 3 AA meetings',
}
```

### logMood

Track the user's emotional state over time.

```typescript
logMood({
  mood: 'great' | 'good' | 'okay' | 'struggling' | 'bad' | 'crisis',
  notes?: string,
  triggers?: string[],
  copingStrategies?: string[],
})

// Returns
{
  success: true,
  entry: {
    id: 'mood_1234567890',
    mood: 'okay',
    notes: 'Feeling anxious about tomorrow',
    triggers: ['work stress'],
    copingStrategies: ['deep breathing'],
    timestamp: '2024-01-15T10:30:00.000Z',
  },
  message: 'Mood "okay" logged successfully',
  encouragement: 'Thank you for checking in. Remember, every day is progress.',
}
```

### getCrisisResources

Get crisis hotlines and emergency resources.

```typescript
getCrisisResources({
  type?: 'general' | 'suicide' | 'substance' | 'domestic-violence' | 'all',
})

// Returns
{
  success: true,
  resources: [
    {
      name: '988 Suicide & Crisis Lifeline',
      description: 'Free, confidential 24/7 support',
      phone: '988',
      text: 'Text 988',
      available24x7: true,
    },
    // ...
  ],
  message: 'Here are resources available 24/7...',
  urgent: true,
}
```

### getResources

Get recovery resources and educational materials.

```typescript
getResources({
  topic: 'relapse-prevention' | 'coping-strategies' | 'meditation' |
         'exercise' | 'nutrition' | 'sleep' | 'relationships' |
         'work-life' | 'general',
})

// Returns
{
  success: true,
  resources: [
    {
      title: 'Understanding Triggers',
      description: 'Learn to identify and manage your personal triggers',
      type: 'article',
    },
    // ...
  ],
  topic: 'relapse-prevention',
  message: 'Here are some relapse prevention resources for you.',
}
```

## Tool Schema

Each tool is defined using Zod schemas and the Vercel AI SDK `tool()` function:

```typescript
import { z } from 'zod'
import { tool } from 'ai'

export const findMeetings = tool({
  description: 'Find local AA or NA meetings near the user',
  parameters: z.object({
    type: z.enum(['aa', 'na', 'both']),
    location: z.string().optional(),
    // ...
  }),
  execute: async ({ type, location }) => {
    // Implementation
  },
})
```

## Integration Example

```typescript
import { recoveryTools } from '@pippa/tools'
import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

async function chat(userMessage: string) {
  const result = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    system: 'You are Sky, a supportive recovery companion...',
    tools: recoveryTools,
    maxSteps: 5, // Allow multiple tool calls
    messages: [{ role: 'user', content: userMessage }],
  })

  return result.text
}

// User: "I'm feeling anxious, can you log that and find me a meeting?"
// Agent will:
// 1. Call logMood({ mood: 'struggling', triggers: ['anxiety'] })
// 2. Call findMeetings({ type: 'both' })
// 3. Respond with combined information
```

## Observability

All tools are instrumented with tracing:

```typescript
execute: async (params) => {
  return withSpan('tool.findMeetings', async () => {
    const logger = getLogger().child({ tool: 'findMeetings' })
    logger.info(params, 'Finding meetings')
    // ...
  })
}
```

## Development

```bash
# Build
pnpm build

# Type check
pnpm typecheck
```

## Dependencies

- [ai](https://sdk.vercel.ai/docs) - Vercel AI SDK
- [zod](https://zod.dev) - Schema validation
