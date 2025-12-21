# @pippa/evaluation

Response quality evaluation for the RecoverySky Agent system.

## Installation

```bash
pnpm add @pippa/evaluation
```

## Overview

This package evaluates AI-generated responses for quality, relevance, empathy, and recovery-appropriateness. It provides metrics for monitoring and improving agent performance.

## Quick Start

```typescript
import { StubEvaluator } from '@pippa/evaluation'

const evaluator = new StubEvaluator()

const result = await evaluator.evaluate(
  "I'm feeling anxious today",      // User message
  "I hear you - anxiety can be...",  // Assistant response
  assembledContext,
  traceContext,
)

if (result.ok) {
  console.log('Quality:', result.value.qualityScore)     // 0.0-1.0
  console.log('Relevance:', result.value.relevanceScore) // 0.0-1.0
  console.log('Empathy:', result.value.empathyScore)     // 0.0-1.0
  console.log('Recovery:', result.value.recoveryScore)  // 0.0-1.0
  console.log('Overall:', result.value.overallScore)    // Weighted average
}
```

## Evaluation Scores

### Quality Score

Measures response quality based on:

- **Length**: Not too short, not too long (50-2000 chars)
- **Punctuation**: Proper sentence structure
- **Completeness**: Ends with proper punctuation

### Relevance Score

Measures how relevant the response is to the user's message:

- **Keyword overlap**: Significant words (>3 chars) shared between messages
- **Topic alignment**: Response addresses user's concerns

### Empathy Score

Detects empathetic language patterns:

```typescript
const empathyPhrases = [
  'i understand',
  'i hear you',
  'that must be',
  'it sounds like',
  'thank you for sharing',
  "i'm here",
  "you're not alone",
  'it takes courage',
]
```

### Recovery Score

Evaluates recovery-appropriateness:

**Positive indicators** (increase score):
- support, recovery, progress, strength
- coping, help, meeting, sponsor

**Negative indicators** (decrease score):
- "just one drink"
- "you deserve to"
- "it's okay to use"

### Overall Score

Weighted average of all scores:

```typescript
overallScore =
  qualityScore * 0.2 +
  relevanceScore * 0.3 +
  empathyScore * 0.3 +
  recoveryScore * 0.2
```

## API Reference

### IEvaluator Interface

```typescript
interface IEvaluator {
  evaluate(
    userMessage: string,
    assistantResponse: string,
    context: AssembledContext,
    ctx: TraceContext,
  ): Promise<Result<EvaluationResult, EvaluationError>>
}

interface EvaluationResult {
  qualityScore: number    // 0.0-1.0
  relevanceScore: number  // 0.0-1.0
  empathyScore: number    // 0.0-1.0
  recoveryScore: number   // 0.0-1.0
  overallScore: number    // Weighted average
  feedback?: string       // Optional feedback text
}
```

### StubEvaluator

```typescript
class StubEvaluator implements IEvaluator {
  // Evaluate response quality
  evaluate(userMessage, assistantResponse, context, ctx): Promise<Result<EvaluationResult, EvaluationError>>

  // Set mock scores for testing
  setMockScores(scores: Partial<EvaluationResult>): void

  // Clear mock scores
  clearMockScores(): void
}
```

## Testing

```typescript
const evaluator = new StubEvaluator()

// Override scores for testing
evaluator.setMockScores({
  qualityScore: 0.9,
  empathyScore: 0.95,
})

const result = await evaluator.evaluate(userMsg, response, context, ctx)

// Clean up
evaluator.clearMockScores()
```

## Usage in Pipeline

The evaluator runs in parallel with safety validation:

```typescript
const [safetyResult, evaluationResult] = await Promise.all([
  safety.validate(response, context, ctx),
  evaluator.evaluate(userMessage, response, context, ctx),
])

// Log evaluation metrics for monitoring
if (evaluationResult.ok) {
  logger.info({
    quality: evaluationResult.value.qualityScore,
    empathy: evaluationResult.value.empathyScore,
    overall: evaluationResult.value.overallScore,
  }, 'Response evaluation')
}
```

## Monitoring

Track evaluation metrics over time to:

- Identify response quality trends
- Detect empathy score degradation
- Flag low recovery-appropriateness responses
- A/B test prompt changes

## Development

```bash
# Build
pnpm build

# Type check
pnpm typecheck
```

## Future Implementations

The production evaluator will use LLM-based evaluation for:

- **Contextual relevance**: Deep understanding of conversation context
- **Empathy authenticity**: Detecting performative vs. genuine empathy
- **Recovery guidance quality**: Expert-level assessment of recovery advice
- **Safety boundary compliance**: Verification of safety guidelines
- **Therapeutic alignment**: Alignment with evidence-based approaches

### Planned Metrics

- Response coherence score
- Conversation flow score
- Crisis handling appropriateness
- Resource recommendation quality
- User engagement prediction
