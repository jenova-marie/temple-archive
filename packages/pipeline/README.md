# @recoverysky/pipeline

Main orchestrator for the RecoverySky Agent message processing pipeline.

## Installation

```bash
pnpm add @recoverysky/pipeline
```

## Overview

This package coordinates the complete message processing flow:

1. **Pre-flight crisis check** (<10ms target)
2. **Memory retrieval** (multi-tier)
3. **Agent processing** (Claude via Vercel AI SDK)
4. **Safety validation** (parallel with evaluation)
5. **Deep evaluation** (response quality)
6. **Persist + response**

## Quick Start

```typescript
import { Pipeline } from '@recoverysky/pipeline'
import { MemoryOrchestrator } from '@recoverysky/memory'
import { KeywordCrisisDetector } from '@recoverysky/crisis'
// ... other imports

const pipeline = new Pipeline({
  crisisDetector,
  crisisHandler,
  memory,
  agent,
  safety,
  evaluator,
  embedding,  // optional
})

const result = await pipeline.process({
  message: "I'm feeling anxious today",
  conversationId: 'conv_123',
  userId: 'user_456',
}, traceContext)

if (result.ok) {
  console.log('Response:', result.value.response)
  console.log('Crisis Level:', result.value.crisisLevel)
  console.log('Duration:', result.value.metrics.totalDuration)
}
```

## Architecture

```
[User Message]
     |
     v
+------------------------------------------------------------+
|                    Pipeline.process()                       |
|                                                             |
|  STAGE 1: Crisis Check (<10ms)                             |
|  +-----------------------+                                  |
|  | crisisDetector.detect |                                  |
|  +-----------+-----------+                                  |
|              |                                              |
|              +-- level >= 9 --> Emergency Response -------> |
|              |                                              |
|              v                                              |
|  STAGE 2: Memory Retrieval                                  |
|  +-----------------------+                                  |
|  | memory.retrieveContext|  L1 -> L2 -> L3 -> L4           |
|  +-----------+-----------+                                  |
|              |                                              |
|              v                                              |
|  STAGE 3: Agent Processing                                  |
|  +-----------------------+                                  |
|  | agent.generate        |  systemPrompt + context         |
|  +-----------+-----------+                                  |
|              |                                              |
|       +------+------+                                       |
|       |             |  PARALLEL                             |
|       v             v                                       |
|  STAGE 4       STAGE 5                                      |
|  +--------+   +----------+                                  |
|  | safety |   | evaluator|                                  |
|  +---+----+   +-----+----+                                  |
|      |              |                                       |
|      v              |                                       |
|  STAGE 6: Persist   |                                       |
|  +-----------------+|                                       |
|  | memory.store    <+                                       |
|  +-----------------+                                        |
+------------------------------------------------------------+
     |
     v
[PipelineResult]
```

## API Reference

### Pipeline

```typescript
interface PipelineDependencies {
  crisisDetector: ICrisisDetector
  crisisHandler: ICrisisHandler
  memory: MemoryOrchestrator
  agent: IAgentProvider
  safety: ISafetyValidator
  evaluator: IEvaluator
  embedding?: IEmbeddingProvider  // Optional for semantic search
}

class Pipeline {
  constructor(deps: PipelineDependencies, config?: Partial<PipelineConfig>)

  // Process a user message through the complete pipeline
  process(
    input: PipelineInput,
    traceCtx: TraceContext,
  ): Promise<Result<PipelineResult, PipelineError>>

  // Get current configuration
  get config(): PipelineConfig
}
```

### PipelineInput

```typescript
interface PipelineInput {
  message: string
  conversationId: string
  userId: string
}
```

### PipelineResult

```typescript
interface PipelineResult {
  response: string
  messages: {
    user: Message
    assistant: Message
  }
  metrics: {
    totalDuration: number
    memoryDuration: number
    agentDuration: number
    tokensUsed: { input: number; output: number }
    memorySource: string
  }
  safetyViolations?: SafetyViolation[]
  crisisLevel: CrisisLevel
  emergencyTriggered: boolean
}
```

### PipelineError

```typescript
interface PipelineError {
  kind: 'CrisisError' | 'MemoryError' | 'AgentError' |
        'SafetyError' | 'ValidationError' | 'TimeoutError' | 'UnexpectedError'
  message: string
  stage?: string
  context: Record<string, unknown>
  cause?: unknown
}
```

### PipelineConfig

```typescript
interface PipelineConfig {
  crisisEmergencyThreshold: CrisisLevel  // Default: 9
  crisisResourceThreshold: CrisisLevel   // Default: 7
  maxProcessingTimeMs: number            // Default: 30000
  enableEvaluation: boolean              // Default: true
}
```

## Stage Details

### Stage 1: Crisis Check

- **Target**: <10ms
- **Action**: Pattern matching for crisis indicators
- **Emergency**: Level >= 9 triggers immediate response

```typescript
const crisisResult = await this.deps.crisisDetector.detect(input.message, ctx)

if (crisisResult.value.triggerEmergency) {
  const handlerResult = await this.deps.crisisHandler.handle(
    crisisResult.value,
    input.userId,
    input.conversationId,
    ctx,
  )
  // Return emergency response immediately
}
```

### Stage 2: Memory Retrieval

- **Flow**: L1 (Redis) -> L2 (PostgreSQL) -> L3/L4 (Neo4j/Qdrant)
- **Output**: AssembledContext with messages, profile, entities

```typescript
const memoryResult = await this.deps.memory.retrieveContext(
  input.conversationId,
  input.userId,
  queryEmbedding,
  ctx,
)
```

### Stage 3: Agent Processing

- **Input**: System prompt + context + user message
- **Output**: Generated response + tool calls

```typescript
const systemPrompt = buildSystemPrompt(ctx.memory!, ctx.crisisCheck)
const agentResult = await this.deps.agent.generate({
  userMessage: input.message,
  context: ctx.memory!,
  crisisCheck: ctx.crisisCheck,
  systemPrompt,
}, ctx)
```

### Stages 4 & 5: Safety + Evaluation (Parallel)

```typescript
const [safetyResult, evaluationResult] = await Promise.all([
  this.deps.safety.validate(response, ctx.memory!, ctx),
  this.deps.evaluator.evaluate(input.message, response, ctx.memory!, ctx),
])

// Handle safety violations
if (!safetyResult.value.passed && safetyResult.value.sanitizedOutput) {
  finalContent = safetyResult.value.sanitizedOutput
}
```

### Stage 6: Persist

- **Store**: User message + assistant message
- **Embeddings**: Generated if provider available
- **Update**: Session state with crisis level

```typescript
await Promise.all([
  this.deps.memory.storeMessage(userMessage, userEmbedding, ctx),
  this.deps.memory.storeMessage(assistantMessage, assistantEmbedding, ctx),
])

await this.deps.memory.updateSessionState(conversationId, {
  lastActivity: Date.now(),
  crisisLevel: ctx.crisisCheck?.level ?? 1,
}, ctx)
```

## Metrics

The pipeline records:

- `pipeline_stage_duration_ms{stage}` - Duration per stage
- `agent_tokens_total{direction}` - Token usage (input/output)
- `crisis_detections_total{level}` - Crisis detections
- `safety_violations_total{type}` - Safety violations

## Error Handling

All errors are typed and include context:

```typescript
const result = await pipeline.process(input, ctx)

if (!result.ok) {
  switch (result.error.kind) {
    case 'CrisisError':
      logger.error(result.error, 'Crisis detection failed')
      break
    case 'AgentError':
      logger.error(result.error, 'Agent processing failed')
      // Return fallback response
      break
    // ...
  }
}
```

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Type check
pnpm typecheck
```

## Dependencies

- [@recoverysky/types](../types) - Shared types
- [@recoverysky/observability](../observability) - Logging/tracing
- [@recoverysky/memory](../memory) - Memory orchestration
- [@recoverysky/crisis](../crisis) - Crisis detection
- [@recoverysky/safety](../safety) - Safety validation
- [@recoverysky/agent](../agent) - Agent provider
- [@recoverysky/evaluation](../evaluation) - Response evaluation
