# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
pnpm build       # Build TypeScript to dist/
pnpm typecheck   # Type check without emitting
pnpm clean       # Remove dist/
```

## Package Overview

This is `@pippa/evaluation`, a response quality evaluation package for the RecoverySky Agent system. It evaluates AI-generated responses for quality, relevance, empathy, and recovery-appropriateness.

## Architecture

**Current Implementation**: `StubEvaluator` - Heuristic-based scoring placeholder

The package uses a simple interface (`IEvaluator`) with four scoring dimensions:
- **qualityScore**: Response length, punctuation, completeness (0.0-1.0)
- **relevanceScore**: Keyword overlap between user message and response (0.0-1.0)
- **empathyScore**: Detection of empathetic phrases (0.0-1.0)
- **recoveryScore**: Recovery-appropriate language, penalizes harmful phrases (0.0-1.0)
- **overallScore**: Weighted average (quality 20%, relevance 30%, empathy 30%, recovery 20%)

**Dependencies**: Uses `@pippa/types` for interfaces and `@pippa/observability` for tracing/logging.

## Key Interfaces (from @pippa/types)

```typescript
interface IEvaluator {
  evaluate(
    userMessage: string,
    assistantResponse: string,
    context: AssembledContext,
    ctx: TraceContext,
  ): Promise<Result<EvaluationResult, EvaluationError>>
}
```

## Testing Support

`StubEvaluator` provides `setMockScores()` and `clearMockScores()` for overriding scores in tests.

## Future Direction

Production evaluator will use LLM-based evaluation for contextual relevance, empathy authenticity, and therapeutic alignment.
