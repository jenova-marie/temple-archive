# Phase 1: Real Agent Integration

## Summary

This phase replaces `MockAgentProvider` with a real Claude implementation using Vercel AI SDK (`@ai-sdk/anthropic`). The integration enables a full agentic tool loop with the existing recovery support tools.

## Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Model | `claude-sonnet-4-20250514` | 200K context (standard billing) |
| Max Steps | 5 | Agentic tool loop limit |
| Max Tokens | 4096 | Response token limit |
| Temperature | 0.7 | Balanced creativity |
| Streaming | No | Phase 1.5 will add streaming |

## Environment Variables

```bash
# Required when USE_STUBS=false
ANTHROPIC_API_KEY=sk-ant-xxx

# Toggle between mock and real agent
USE_STUBS=true    # Use MockAgentProvider
USE_STUBS=false   # Use VercelAIAgentProvider with Claude
```

## Files Modified

| File | Change |
|------|--------|
| `packages/agent/package.json` | Replaced `@anthropic-ai/sdk` with `@ai-sdk/anthropic` |
| `packages/agent/src/VercelAIAgentProvider.ts` | New provider implementation |
| `packages/agent/src/index.ts` | Export new provider |
| `packages/pipeline/package.json` | Added `@recoverysky/tools` dependency |
| `packages/pipeline/src/Pipeline.ts` | Pass tools to `agent.generate()` |
| `apps/api/src/container.ts` | Provider selection based on `USE_STUBS` |

## Implementation Details

### VercelAIAgentProvider

The new provider implements `IAgentProvider` interface:

```typescript
class VercelAIAgentProvider implements IAgentProvider {
  async generate(input: AgentInput, ctx: TraceContext): Promise<Result<AgentResponse, AgentError>>
  async *stream(input: AgentInput, ctx: TraceContext): AsyncGenerator<StreamChunk, AgentResponse>
}
```

Key features:
- Uses `generateText()` from Vercel AI SDK with `anthropic()` model
- Converts conversation history from `AssembledContext` to SDK message format
- Passes tools as `CoreTool` objects for agentic execution
- Maps SDK errors to our `AgentError` types
- Wraps all operations in `withSpan()` for observability
- Records token usage via `pipelineMetrics`

### Tool Integration

The pipeline now passes tools to the agent:

```typescript
const tools = this.convertToolsToDefinitions()
await this.deps.agent.generate({
  userMessage: input.message,
  context: ctx.memory!,
  crisisCheck: ctx.crisisCheck,
  systemPrompt,
  tools,  // Recovery tools passed here
}, ctx)
```

Available tools:
- `findMeetings` - Find AA/NA meetings
- `logMood` - Log user's emotional state
- `getCrisisResources` - Get crisis hotlines
- `getResources` - Get recovery educational materials

### Error Mapping

SDK errors are mapped to `AgentError` types:

| SDK Error | AgentError Kind |
|-----------|-----------------|
| 429 / rate limit | `RateLimitError` |
| context length exceeded | `ContextLengthError` |
| timeout / ETIMEDOUT | `TimeoutError` |
| tool execution failed | `ToolError` |
| other | `ProviderError` |

## Testing

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Test with mock agent (existing behavior)
USE_STUBS=true pnpm dev

# Test with real Claude
USE_STUBS=false ANTHROPIC_API_KEY=sk-ant-xxx pnpm dev

# Send a test message
curl -X POST http://localhost:3333/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Find me an AA meeting nearby",
    "conversationId": "test-123",
    "userId": "user-1"
  }'
```

## What's Next

### Phase 1.5: Streaming Support
- Implement real streaming via `streamText()` from Vercel AI SDK
- Add `POST /api/chat/stream` endpoint with SSE
- Stream tokens as they're generated

### Phase 2: PostgreSQL Memory
- Replace `InMemorySessionStore` with PostgreSQL
- Enable persistent conversation history

## Known Limitations

1. **Streaming**: The `stream()` method currently falls back to `generate()` and simulates streaming. Real streaming will be added in Phase 1.5.

2. **Memory Stores**: All memory tiers still use in-memory stubs. Messages don't persist between server restarts.

3. **Tool Results**: Tool execution results are tracked but not explicitly returned in the response structure. The agentic loop handles this internally.
