# @pippa/types

Shared TypeScript type definitions for the RecoverySky Agent system.

## Installation

```bash
pnpm add @pippa/types
```

## Overview

This package provides all shared interfaces, types, and utility functions used across the RecoverySky monorepo. It includes:

- **Context types**: TraceContext, PipelineContext, AssembledContext
- **Message types**: Message, StreamChunk, PipelineInput/Result
- **Memory types**: UserProfile, SessionState, store interfaces
- **Crisis types**: CrisisLevel, CrisisCheckResult, detector interfaces
- **Pipeline types**: StageResult, PipelineConfig
- **Provider interfaces**: IAgentProvider, ISafetyValidator, IEvaluator
- **Result types**: Type-safe error handling with Result<T, E>

## Usage

```typescript
import type {
  TraceContext,
  PipelineInput,
  Message,
  CrisisLevel,
  Result,
} from '@pippa/types'

import { ok, err, isOk, unwrap } from '@pippa/types'

// Create a successful result
const success = ok({ data: 'value' })

// Create an error result
const failure = err({ kind: 'NotFound', message: 'Resource not found', context: {} })

// Pattern matching on results
if (isOk(result)) {
  console.log(unwrap(result))
}
```

## Type Categories

### Context Types

```typescript
interface TraceContext {
  traceId: string
  spanId: string
  requestId: string
  userId?: string
  sessionId?: string
  startTime: number
}

interface PipelineContext extends TraceContext {
  input: PipelineInput
  metrics: PipelineMetrics
  memory?: AssembledContext
  crisisCheck?: CrisisCheckResult
}
```

### Message Types

```typescript
interface Message {
  id: string
  conversationId: string
  userId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: MessageMetadata
}

interface PipelineInput {
  message: string
  conversationId: string
  userId: string
}
```

### Crisis Types

```typescript
type CrisisLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

interface CrisisCheckResult {
  level: CrisisLevel
  patterns: DetectedPattern[]
  triggerEmergency: boolean
  action: 'none' | 'monitor' | 'inject_resources' | 'emergency_protocol'
  processingTimeMs: number
}
```

### Provider Interfaces

```typescript
interface ICrisisDetector {
  detect(message: string, ctx: TraceContext): Promise<Result<CrisisCheckResult, CrisisError>>
}

interface IAgentProvider {
  generate(input: AgentInput, ctx: TraceContext): Promise<Result<AgentResponse, AgentError>>
}

interface ISafetyValidator {
  validate(output: string, context: AssembledContext, ctx: TraceContext): Promise<Result<SafetyValidationResult, SafetyError>>
}
```

### Result Type

Type-safe error handling without exceptions:

```typescript
type Result<T, E> = Ok<T> | Err<E>

// Helper functions
ok<T>(value: T): Ok<T>
err<E>(error: E): Err<E>
isOk<T, E>(result: Result<T, E>): result is Ok<T>
isErr<T, E>(result: Result<T, E>): result is Err<E>
unwrap<T, E>(result: Result<T, E>): T
unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T
map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>
andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E>
```

### Observability Converters

```typescript
import { toLogContext, toSpanAttributes, toMetricLabels } from '@pippa/types'

// Convert domain errors for logging
logger.error(toLogContext(error), 'Operation failed')

// Convert to span attributes for tracing
span.setAttributes(toSpanAttributes(error))

// Convert to metric labels
metrics.counter.add(1, toMetricLabels(error))
```

## Exports

The package uses explicit exports:

```typescript
// Main export
import { ok, err, type Result } from '@pippa/types'
```

## Development

```bash
# Build
pnpm build

# Type check
pnpm typecheck

# Clean
pnpm clean
```
