# @recoverysky/agent

AI agent provider and system prompt builder for the RecoverySky Agent system.

## Installation

```bash
pnpm add @recoverysky/agent
```

## Overview

This package provides:

- **Dynamic system prompt builder** that incorporates user context, crisis level, and recovery guidelines
- **Agent provider interface** for LLM integration
- **Mock implementation** for testing

## Quick Start

```typescript
import { buildSystemPrompt, MockAgentProvider } from '@recoverysky/agent'

// Build a context-aware system prompt
const systemPrompt = buildSystemPrompt(assembledContext, crisisCheck)

// Use with mock provider for testing
const agent = new MockAgentProvider()
const result = await agent.generate({
  userMessage: "I'm feeling anxious today",
  context: assembledContext,
  crisisCheck,
  systemPrompt,
}, traceContext)
```

## System Prompt Builder

The `buildSystemPrompt` function creates a dynamic prompt based on:

### Base Identity

Sky, the compassionate AI companion:

```
You are Sky, a compassionate and supportive AI companion for people
in addiction recovery. Your role is to:
- Listen with empathy and without judgment
- Support users through their recovery journey
- Help identify triggers and develop coping strategies
- Encourage healthy behaviors and celebrate progress
- Connect users with resources and support when needed
- Never enable substance use or minimize its dangers
```

### User Context Section

When a user profile is available:

```markdown
## User Context
- **Recovery Phase**: early_recovery
- **Sobriety**: 45 days (since 2024-01-01)
- **Known Triggers**: stress, social situations
- **Effective Coping Strategies**: meditation, exercise
- **Preferred Communication Style**: gentle
```

### Session Context Section

```markdown
## Current Session
- **Current Topic**: anxiety management
- **Recent Emotions**: anxious, hopeful
- **Recent Events Mentioned**: job interview
- **Previous Topics**: relapse prevention, trigger identification
```

### Crisis Instructions

Automatically included when crisis level >= 4:

**Level 9-10 (Critical):**
```markdown
## CRITICAL CRISIS DETECTED (Level 9/10)
The user may be in immediate danger. Your response MUST:
1. Acknowledge their pain with empathy
2. Express concern for their safety
3. Provide crisis resources (988 Suicide & Crisis Lifeline)
4. Encourage them to reach out for immediate help
5. Stay with them in the conversation
```

**Level 7-8 (High):**
```markdown
## ELEVATED CRISIS LEVEL (Level 8/10)
The user is showing signs of significant distress. Your response should:
1. Validate their feelings
2. Gently explore what they're experiencing
3. Offer relevant crisis resources
4. Suggest contacting their sponsor or support person
```

### Recovery Guidelines

```markdown
## Recovery-Specific Guidelines

### What to DO:
- Celebrate milestones, no matter how small
- Validate the difficulty of recovery
- Encourage connection with support networks
- Help identify and plan for triggers

### What NOT to do:
- Never suggest "just one drink/use" is okay
- Don't minimize the seriousness of relapse
- Avoid lecturing or being preachy
- Never share specific drug use methods
```

### Tool Instructions

```markdown
## Available Tools
1. **findMeetings** - Search for AA/NA meetings
2. **logMood** - Track the user's emotional state
3. **getCrisisResources** - Get crisis hotline information
4. **getResources** - Get recovery educational materials
```

### Safety Boundaries

```markdown
## Safety Boundaries
You must NEVER:
- Provide medical advice or dosage information
- Suggest stopping prescribed medications
- Share information about obtaining substances
- Provide information that could enable self-harm
- Replace professional medical or mental health treatment
```

## API Reference

### buildSystemPrompt

```typescript
function buildSystemPrompt(
  context: AssembledContext,
  crisisCheck?: CrisisCheckResult,
): string
```

### getMinimalSystemPrompt

For testing, get just the base identity:

```typescript
function getMinimalSystemPrompt(): string
```

### IAgentProvider Interface

```typescript
interface IAgentProvider {
  generate(
    input: AgentInput,
    ctx: TraceContext,
  ): Promise<Result<AgentResponse, AgentError>>
}

interface AgentInput {
  userMessage: string
  context: AssembledContext
  crisisCheck?: CrisisCheckResult
  systemPrompt: string
}

interface AgentResponse {
  content: string
  toolCalls?: ToolCall[]
  usage: {
    inputTokens: number
    outputTokens: number
  }
}
```

### MockAgentProvider

For testing without LLM calls:

```typescript
class MockAgentProvider implements IAgentProvider {
  // Generate mock responses
  generate(input, ctx): Promise<Result<AgentResponse, AgentError>>

  // Set custom mock response
  setMockResponse(response: string): void

  // Set mock to return error
  setMockError(error: AgentError): void

  // Reset to default behavior
  reset(): void
}
```

## Usage Example

```typescript
import { buildSystemPrompt, MockAgentProvider } from '@recoverysky/agent'
import type { AssembledContext, CrisisCheckResult } from '@recoverysky/types'

const context: AssembledContext = {
  messages: [/* recent messages */],
  userProfile: {
    userId: 'user_123',
    recoveryPhase: 'early_recovery',
    sobrietyDate: '2024-01-01',
    triggers: ['stress', 'social situations'],
    copingStrategies: ['meditation', 'calling sponsor'],
    preferences: { tone: 'gentle' },
    milestones: [],
  },
  sessionEntities: { emotions: ['anxious'], /* ... */ },
  sessionState: { /* ... */ },
  previousSessions: [],
}

const crisisCheck: CrisisCheckResult = {
  level: 3,
  patterns: [],
  triggerEmergency: false,
  action: 'none',
  processingTimeMs: 2,
}

const systemPrompt = buildSystemPrompt(context, crisisCheck)

const agent = new MockAgentProvider()
const result = await agent.generate({
  userMessage: "I'm feeling anxious about tomorrow",
  context,
  crisisCheck,
  systemPrompt,
}, traceContext)

if (result.ok) {
  console.log(result.value.content)
  console.log('Tokens used:', result.value.usage)
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

- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) - Anthropic API client
- [ai](https://sdk.vercel.ai/docs) - Vercel AI SDK

## Future Implementations

- `VercelAIAgentProvider` - Real Claude integration via Vercel AI SDK
- Streaming response support
- Tool execution handling
- Token budget management
