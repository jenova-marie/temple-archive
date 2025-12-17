/**
 * Pipeline Orchestrator
 *
 * Coordinates the complete message processing flow:
 * 1. Pre-flight crisis check (<10ms)
 * 2. Memory retrieval
 * 3. Agent processing
 * 4. Safety validation (parallel with deep evaluation)
 * 5. Response + persist
 */

import type {
  PipelineConfig,
  PipelineContext,
  PipelineInput,
  PipelineResult,
  Message,
  TraceContext,
  Result,
  ICrisisDetector,
  ICrisisHandler,
  ICrisisEvaluator,
  IAgentProvider,
  ISafetyValidator,
  IEvaluator,
  IEmbeddingProvider,
  CrisisCheckResult,
  ToolDefinition,
  AgentResponse,
  PipelineDiagnostics,
  SafetyValidationResult,
  EvaluationResult,
} from '@recoverysky/types'
import { ok, err, getDefaultPipelineConfig } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import { MemoryOrchestrator, type EntityExtractor, type MemoryContextBuilder, type IBootstrapOrchestrator } from '@recoverysky/memory'
import { buildSystemPrompt } from '@recoverysky/agent'
import { recoveryTools, getMemoryTools, setMemoryToolTraceContext, clearMemoryToolTraceContext, refreshSystemPrompt, clearConversation, setGetConversationIdFn, type MemoryToolAccessLevel } from '@recoverysky/tools'

export interface PipelineError {
  kind: 'CrisisError' | 'MemoryError' | 'AgentError' | 'SafetyError' | 'ValidationError' | 'TimeoutError' | 'UnexpectedError'
  message: string
  stage?: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * Chunk types for streaming pipeline responses
 */
export type PipelineStreamChunk =
  | { type: 'text'; content: string }
  | { type: 'error'; error: string; kind?: string }
  | { type: 'done'; result: PipelineResult }

export interface PipelineDependencies {
  crisisDetector: ICrisisDetector
  crisisHandler: ICrisisHandler
  crisisEvaluator?: ICrisisEvaluator
  memory: MemoryOrchestrator
  agent: IAgentProvider
  safety: ISafetyValidator
  evaluator: IEvaluator
  embedding?: IEmbeddingProvider
  /** Entity extractor for knowledge graph (optional) */
  entityExtractor?: EntityExtractor
  /** Memory context builder for pre-agent memory injection (optional) */
  memoryContextBuilder?: MemoryContextBuilder
  /** Memory tool access level (default: 'off') */
  memoryToolAccess?: MemoryToolAccessLevel
  /** Bootstrap orchestrator for conversation memory priming (optional) */
  bootstrapOrchestrator?: IBootstrapOrchestrator
  /** Base identity prompt fetched from database (optional, falls back to default) */
  baseIdentity?: string
  /** Function to lookup a system prompt by name (optional, for custom guides) */
  getSystemPrompt?: (name: string) => Promise<{ id: string; name: string; content: string } | null>
  /** Function to get the default system prompt fresh from database */
  getDefaultSystemPrompt?: () => Promise<{ id: string; name: string; content: string } | null>
}

/**
 * Result from preflight checks before streaming
 */
export interface PreflightResult {
  /** Built system prompt with context */
  systemPrompt: string
  /** Tool definitions for the model */
  tools: ToolDefinition[]
  /** Assembled context from memory */
  context: PipelineContext['memory']
  /** Crisis check result */
  crisisCheck: CrisisCheckResult
  /** Memory context string (if configured) */
  memoryContext: string | null
  /** Memory retrieval stats */
  memoryStats: {
    source: 'L1_REDIS' | 'L2_POSTGRESQL' | 'L3_NEO4J_L4_QDRANT' | 'COMBINED' | 'NONE'
    cacheHits: number
    cacheMisses: number
  }
}

export class Pipeline {
  private readonly deps: PipelineDependencies
  private readonly pipelineConfig: PipelineConfig

  constructor(deps: PipelineDependencies, config?: Partial<PipelineConfig>) {
    this.deps = deps
    this.pipelineConfig = { ...getDefaultPipelineConfig(), ...config }
  }

  /** Get the pipeline configuration */
  get config(): PipelineConfig {
    return this.pipelineConfig
  }

  /**
   * Process a user message through the complete pipeline
   */
  async process(
    input: PipelineInput,
    traceCtx: TraceContext
  ): Promise<Result<PipelineResult, PipelineError>> {
    return withSpan('Pipeline.process', async () => {
      const startTime = Date.now()
      const logger = getLogger().child({
        conversationId: input.conversationId,
        userId: input.userId,
        requestId: traceCtx.requestId,
      })

      logger.info('Starting pipeline processing')

      // Initialize pipeline context
      const ctx: PipelineContext = {
        ...traceCtx,
        input,
        metrics: {
          stageDurations: {},
          cacheHits: 0,
          cacheMisses: 0,
        },
      }

      // Create user message
      const userMessage: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        conversationId: input.conversationId,
        userId: input.userId,
        role: 'user',
        content: input.message,
        timestamp: Date.now(),
      }

      try {
        // STAGE 1: Pre-flight crisis check (<10ms target)
        const crisisResult = await this.runCrisisCheck(input.message, ctx)
        if (!crisisResult.ok) {
          return err({
            kind: 'CrisisError',
            message: 'Crisis detection failed',
            stage: 'crisis_check',
            context: { conversationId: input.conversationId },
            cause: crisisResult.error,
          })
        }

        ctx.crisisCheck = crisisResult.value

        // Handle emergency if triggered
        if (crisisResult.value.triggerEmergency) {
          logger.warn(
            { crisisLevel: crisisResult.value.level },
            'Emergency crisis detected'
          )

          const handlerResult = await this.deps.crisisHandler.handle(
            crisisResult.value,
            input.userId,
            input.conversationId,
            ctx
          )

          if (handlerResult.ok && handlerResult.value.prependMessage) {
            // Emergency response - skip normal flow
            const assistantMessage: Message = {
              id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              conversationId: input.conversationId,
              userId: input.userId,
              role: 'assistant',
              content: handlerResult.value.prependMessage,
              timestamp: Date.now(),
              metadata: {
                crisisLevel: crisisResult.value.level,
              },
            }

            return ok({
              response: assistantMessage.content,
              messages: { user: userMessage, assistant: assistantMessage },
              metrics: {
                totalDuration: Date.now() - startTime,
                memoryDuration: 0,
                agentDuration: 0,
                tokensUsed: { input: 0, output: 0 },
                memorySource: 'none',
              },
              crisisLevel: crisisResult.value.level,
              emergencyTriggered: true,
            })
          }
        }

        // STAGE 2: Memory retrieval
        const memoryResult = await this.runMemoryRetrieval(input, ctx)
        if (!memoryResult.ok) {
          logger.warn({ error: memoryResult.error }, 'Memory retrieval failed, continuing with empty context')
        }

        ctx.memory = memoryResult.ok ? memoryResult.value.context : {
          messages: [],
          userProfile: null,
          sessionEntities: { people: [], places: [], events: [], emotions: [], medications: [] },
          sessionState: { startTime: Date.now(), lastActivity: Date.now(), messageCount: 0, crisisLevel: 1 },
          previousSessions: [],
        }

        // Update cache stats from memory retrieval
        if (memoryResult.ok) {
          ctx.metrics.cacheHits = memoryResult.value.cacheHits
          ctx.metrics.cacheMisses = memoryResult.value.cacheMisses
          ctx.metrics.memoryTier = memoryResult.value.source
        }

        // STAGE 3: Agent processing + deep crisis evaluation (parallel)
        // Run deep crisis evaluation in parallel with agent if:
        // - Evaluator is available
        // - Fast crisis check didn't trigger emergency (level < 7)
        // - Message is substantial enough (> 20 chars)
        const shouldRunDeepEval =
          this.deps.crisisEvaluator &&
          crisisResult.value.level < 7 &&
          input.message.length > 20

        // Build conversation history for deep evaluation
        const conversationHistory = ctx.memory?.messages
          .slice(-3)
          .map((m) => `${m.role}: ${m.content}`) ?? []

        const [agentResult, deepCrisisResult] = await Promise.all([
          this.runAgentProcessing(input, ctx),
          shouldRunDeepEval
            ? this.deps.crisisEvaluator!.evaluate(input.message, conversationHistory, ctx)
            : Promise.resolve(null),
        ])

        if (!agentResult.ok) {
          return err({
            kind: 'AgentError',
            message: 'Agent processing failed',
            stage: 'agent',
            context: { conversationId: input.conversationId },
            cause: agentResult.error,
          })
        }

        // Check if deep evaluation found a higher crisis level
        let effectiveCrisisLevel = crisisResult.value.level
        if (
          deepCrisisResult &&
          deepCrisisResult.ok &&
          deepCrisisResult.value.level > crisisResult.value.level
        ) {
          logger.info(
            {
              fastLevel: crisisResult.value.level,
              deepLevel: deepCrisisResult.value.level,
            },
            'Deep crisis evaluation detected elevated risk'
          )

          effectiveCrisisLevel = deepCrisisResult.value.level

          // Handle the escalated crisis
          if (deepCrisisResult.value.level >= 7) {
            await this.deps.crisisHandler.handle(
              deepCrisisResult.value,
              input.userId,
              input.conversationId,
              ctx
            )
          }
        }

        // STAGE 4 & 5: Safety validation and evaluation (parallel with timing)
        const safetyStart = Date.now()
        const [safetyResult, evaluationResult] = await Promise.all([
          this.deps.safety.validate(agentResult.value.content, ctx.memory!, ctx),
          this.deps.evaluator.evaluate(input.message, agentResult.value.content, ctx.memory!, ctx),
        ])
        // Note: Combined timing for parallel operations
        ctx.metrics.stageDurations.safety = Date.now() - safetyStart
        ctx.metrics.stageDurations.evaluation = Date.now() - safetyStart

        // Handle safety violations
        let finalContent = agentResult.value.content
        if (safetyResult.ok && !safetyResult.value.passed) {
          logger.warn(
            { violations: safetyResult.value.violations },
            'Safety violations detected'
          )

          if (safetyResult.value.sanitizedOutput) {
            finalContent = safetyResult.value.sanitizedOutput
          }
        }

        // Create assistant message
        const assistantMessage: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          conversationId: input.conversationId,
          userId: input.userId,
          role: 'assistant',
          content: finalContent,
          timestamp: Date.now(),
          metadata: {
            crisisLevel: effectiveCrisisLevel,
          },
        }

        // STAGE 6: Persist messages
        await this.persistMessages(userMessage, assistantMessage, ctx)

        const totalDuration = Date.now() - startTime

        pipelineMetrics.stageDuration.record(totalDuration, { stage: 'total' })

        logger.info(
          {
            totalDuration,
            crisisLevel: effectiveCrisisLevel,
            tokensUsed: agentResult.value.usage,
          },
          'Pipeline processing completed'
        )

        // Build diagnostics
        const diagnostics = this.buildDiagnostics(
          totalDuration,
          ctx,
          crisisResult.value,
          memoryResult.ok ? memoryResult.value.source : 'NONE',
          agentResult.value,
          safetyResult.ok ? safetyResult.value : undefined,
          evaluationResult.ok ? evaluationResult.value : undefined
        )

        return ok({
          response: finalContent,
          messages: { user: userMessage, assistant: assistantMessage },
          metrics: {
            totalDuration,
            memoryDuration: ctx.metrics.stageDurations.memory || 0,
            agentDuration: ctx.metrics.stageDurations.agent || 0,
            tokensUsed: {
              input: agentResult.value.usage.inputTokens,
              output: agentResult.value.usage.outputTokens,
            },
            memorySource: memoryResult.ok ? memoryResult.value.source : 'none',
          },
          safetyViolations: safetyResult.ok ? safetyResult.value.violations : [],
          crisisLevel: effectiveCrisisLevel,
          emergencyTriggered: false,
          diagnostics,
        })
      } catch (error) {
        logger.error({ error }, 'Unexpected pipeline error')
        return err({
          kind: 'UnexpectedError',
          message: 'Unexpected error during pipeline processing',
          context: { conversationId: input.conversationId },
          cause: error,
        })
      }
    })
  }

  /**
   * Process a user message with streaming response
   *
   * Yields text chunks as the agent generates them, then yields a final
   * 'done' chunk with the complete PipelineResult including metrics and diagnostics.
   */
  async *processStream(
    input: PipelineInput,
    traceCtx: TraceContext
  ): AsyncGenerator<PipelineStreamChunk, void, unknown> {
    const startTime = Date.now()
    const logger = getLogger().child({
      conversationId: input.conversationId,
      userId: input.userId,
      requestId: traceCtx.requestId,
    })

    logger.info('Starting streaming pipeline processing')

    // Initialize pipeline context
    const ctx: PipelineContext = {
      ...traceCtx,
      input,
      metrics: {
        stageDurations: {},
        cacheHits: 0,
        cacheMisses: 0,
      },
    }

    // Create user message
    const userMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      conversationId: input.conversationId,
      userId: input.userId,
      role: 'user',
      content: input.message,
      timestamp: Date.now(),
    }

    try {
      // STAGE 1: Pre-flight crisis check (<10ms target)
      const crisisResult = await this.runCrisisCheck(input.message, ctx)
      if (!crisisResult.ok) {
        yield {
          type: 'error',
          error: 'Crisis detection failed',
          kind: 'CrisisError',
        }
        return
      }

      ctx.crisisCheck = crisisResult.value

      // Handle emergency if triggered
      if (crisisResult.value.triggerEmergency) {
        logger.warn(
          { crisisLevel: crisisResult.value.level },
          'Emergency crisis detected'
        )

        const handlerResult = await this.deps.crisisHandler.handle(
          crisisResult.value,
          input.userId,
          input.conversationId,
          ctx
        )

        if (handlerResult.ok && handlerResult.value.prependMessage) {
          // Emergency response - yield the message and return early
          const assistantMessage: Message = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            conversationId: input.conversationId,
            userId: input.userId,
            role: 'assistant',
            content: handlerResult.value.prependMessage,
            timestamp: Date.now(),
            metadata: {
              crisisLevel: crisisResult.value.level,
            },
          }

          yield { type: 'text', content: handlerResult.value.prependMessage }
          yield {
            type: 'done',
            result: {
              response: assistantMessage.content,
              messages: { user: userMessage, assistant: assistantMessage },
              metrics: {
                totalDuration: Date.now() - startTime,
                memoryDuration: 0,
                agentDuration: 0,
                tokensUsed: { input: 0, output: 0 },
                memorySource: 'none',
              },
              crisisLevel: crisisResult.value.level,
              emergencyTriggered: true,
            },
          }
          return
        }
      }

      // STAGE 2: Memory retrieval
      const memoryResult = await this.runMemoryRetrieval(input, ctx)
      if (!memoryResult.ok) {
        logger.warn({ error: memoryResult.error }, 'Memory retrieval failed, continuing with empty context')
      }

      ctx.memory = memoryResult.ok ? memoryResult.value.context : {
        messages: [],
        userProfile: null,
        sessionEntities: { people: [], places: [], events: [], emotions: [], medications: [] },
        sessionState: { startTime: Date.now(), lastActivity: Date.now(), messageCount: 0, crisisLevel: 1 },
        previousSessions: [],
      }

      // Update cache stats from memory retrieval
      if (memoryResult.ok) {
        ctx.metrics.cacheHits = memoryResult.value.cacheHits
        ctx.metrics.cacheMisses = memoryResult.value.cacheMisses
        ctx.metrics.memoryTier = memoryResult.value.source
      }

      // STAGE 3: Build agent input and stream response
      const agentStageStart = Date.now()

      // Build memory context pre-agent (if configured)
      let memoryContext: string | null = null
      if (this.deps.memoryContextBuilder) {
        try {
          memoryContext = await this.deps.memoryContextBuilder.buildContext(
            input.message,
            input.userId,
            ctx
          )
        } catch (error) {
          logger.warn({ error }, 'Memory context builder failed, continuing without')
        }
      }

      const hasMemoryTools = this.deps.memoryToolAccess && this.deps.memoryToolAccess !== 'off'

      const systemPrompt = buildSystemPrompt({
        context: ctx.memory!,
        crisisCheck: ctx.crisisCheck,
        memoryContext,
        hasMemoryTools,
        baseIdentity: this.deps.baseIdentity,
      })

      const tools = this.convertToolsToDefinitions()

      // Set trace context for memory tools
      if (hasMemoryTools) {
        setMemoryToolTraceContext(ctx)
      }

      // Set conversation ID getter for system tools (clearConversation)
      setGetConversationIdFn(() => ctx.sessionId || ctx.requestId)

      let fullContent = ''
      let agentResponse: AgentResponse | undefined

      try {
        // Stream agent response
        const agentStream = this.deps.agent.stream(
          {
            userMessage: input.message,
            context: ctx.memory!,
            crisisCheck: ctx.crisisCheck,
            systemPrompt,
            tools,
          },
          ctx
        )

        // Yield text chunks as they arrive
        for await (const chunk of agentStream) {
          if (chunk.type === 'text' && chunk.content) {
            fullContent += chunk.content
            yield { type: 'text', content: chunk.content }
          } else if (chunk.type === 'error') {
            yield { type: 'error', error: chunk.error ?? 'Unknown agent error', kind: 'AgentError' }
            return
          }
        }

        // Get the return value from the generator (AgentResponse)
        // Note: When the generator completes naturally, we need to get the return value
        // This happens after the for-await loop exhausts the generator
        const generatorResult = await agentStream.next()
        if (generatorResult.done && generatorResult.value) {
          agentResponse = generatorResult.value
        }
      } finally {
        if (hasMemoryTools) {
          clearMemoryToolTraceContext()
        }
      }

      ctx.metrics.stageDurations.agent = Date.now() - agentStageStart

      // If we didn't get an agentResponse, create a minimal one from fullContent
      if (!agentResponse) {
        agentResponse = {
          content: fullContent,
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          model: 'unknown',
          stopReason: 'end_turn',
        }
      }

      // STAGE 4: Run deep crisis evaluation in parallel with safety/evaluation
      const shouldRunDeepEval =
        this.deps.crisisEvaluator &&
        crisisResult.value.level < 7 &&
        input.message.length > 20

      const conversationHistory = ctx.memory?.messages
        .slice(-3)
        .map((m) => `${m.role}: ${m.content}`) ?? []

      // STAGE 4 & 5: Safety validation, evaluation, and deep crisis (parallel)
      const safetyStart = Date.now()
      const [safetyResult, evaluationResult, deepCrisisResult] = await Promise.all([
        this.deps.safety.validate(agentResponse.content, ctx.memory!, ctx),
        this.deps.evaluator.evaluate(input.message, agentResponse.content, ctx.memory!, ctx),
        shouldRunDeepEval
          ? this.deps.crisisEvaluator!.evaluate(input.message, conversationHistory, ctx)
          : Promise.resolve(null),
      ])

      ctx.metrics.stageDurations.safety = Date.now() - safetyStart
      ctx.metrics.stageDurations.evaluation = Date.now() - safetyStart

      // Check if deep evaluation found a higher crisis level
      let effectiveCrisisLevel = crisisResult.value.level
      if (
        deepCrisisResult &&
        deepCrisisResult.ok &&
        deepCrisisResult.value.level > crisisResult.value.level
      ) {
        logger.info(
          {
            fastLevel: crisisResult.value.level,
            deepLevel: deepCrisisResult.value.level,
          },
          'Deep crisis evaluation detected elevated risk'
        )

        effectiveCrisisLevel = deepCrisisResult.value.level

        if (deepCrisisResult.value.level >= 7) {
          await this.deps.crisisHandler.handle(
            deepCrisisResult.value,
            input.userId,
            input.conversationId,
            ctx
          )
        }
      }

      // Handle safety violations
      let finalContent = agentResponse.content
      if (safetyResult.ok && !safetyResult.value.passed) {
        logger.warn(
          { violations: safetyResult.value.violations },
          'Safety violations detected'
        )

        if (safetyResult.value.sanitizedOutput) {
          finalContent = safetyResult.value.sanitizedOutput
        }
      }

      // Create assistant message
      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        conversationId: input.conversationId,
        userId: input.userId,
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
        metadata: {
          crisisLevel: effectiveCrisisLevel,
        },
      }

      // STAGE 6: Persist messages
      await this.persistMessages(userMessage, assistantMessage, ctx)

      const totalDuration = Date.now() - startTime

      pipelineMetrics.stageDuration.record(totalDuration, { stage: 'total' })

      logger.info(
        {
          totalDuration,
          crisisLevel: effectiveCrisisLevel,
          tokensUsed: agentResponse.usage,
        },
        'Streaming pipeline processing completed'
      )

      // Build diagnostics
      const diagnostics = this.buildDiagnostics(
        totalDuration,
        ctx,
        crisisResult.value,
        memoryResult.ok ? memoryResult.value.source : 'NONE',
        agentResponse,
        safetyResult.ok ? safetyResult.value : undefined,
        evaluationResult.ok ? evaluationResult.value : undefined
      )

      // Yield final result
      yield {
        type: 'done',
        result: {
          response: finalContent,
          messages: { user: userMessage, assistant: assistantMessage },
          metrics: {
            totalDuration,
            memoryDuration: ctx.metrics.stageDurations.memory || 0,
            agentDuration: ctx.metrics.stageDurations.agent || 0,
            tokensUsed: {
              input: agentResponse.usage.inputTokens,
              output: agentResponse.usage.outputTokens,
            },
            memorySource: memoryResult.ok ? memoryResult.value.source : 'none',
          },
          safetyViolations: safetyResult.ok ? safetyResult.value.violations : [],
          crisisLevel: effectiveCrisisLevel,
          emergencyTriggered: false,
          diagnostics,
        },
      }
    } catch (error) {
      logger.error({ error }, 'Unexpected streaming pipeline error')
      yield {
        type: 'error',
        error: 'Unexpected error during pipeline processing',
        kind: 'UnexpectedError',
      }
    }
  }

  private async runCrisisCheck(
    message: string,
    ctx: PipelineContext
  ): Promise<Result<CrisisCheckResult, { kind: string; message: string }>> {
    const stageStart = Date.now()

    const result = await this.deps.crisisDetector.detect(message, ctx)

    ctx.metrics.stageDurations.crisis = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.crisis, { stage: 'crisis' })

    if (!result.ok) {
      return err({ kind: result.error.kind, message: result.error.message })
    }

    return ok(result.value)
  }

  private async runMemoryRetrieval(
    input: PipelineInput,
    ctx: PipelineContext
  ): Promise<Result<{ context: PipelineContext['memory']; source: 'L1_REDIS' | 'L2_POSTGRESQL' | 'L3_NEO4J_L4_QDRANT' | 'COMBINED'; cacheHits: number; cacheMisses: number }, { kind: string; message: string }>> {
    const stageStart = Date.now()

    // Generate embedding for semantic search (if provider available)
    let queryEmbedding: number[] | null = null
    if (this.deps.embedding) {
      const embeddingResult = await this.deps.embedding.embed(input.message, ctx)
      if (embeddingResult.ok) {
        queryEmbedding = embeddingResult.value
      }
    }

    const result = await this.deps.memory.retrieveContext(
      input.conversationId,
      input.userId,
      queryEmbedding,
      ctx,
      input.userProfile
    )

    ctx.metrics.stageDurations.memory = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.memory, { stage: 'memory' })

    if (!result.ok) {
      return err({ kind: result.error.kind, message: result.error.message })
    }

    return ok({
      context: result.value.context,
      source: result.value.source,
      cacheHits: result.value.cacheHits,
      cacheMisses: result.value.cacheMisses,
    })
  }

  private async runAgentProcessing(
    input: PipelineInput,
    ctx: PipelineContext
  ): Promise<Result<AgentResponse, { kind: string; message: string }>> {
    const stageStart = Date.now()
    const logger = getLogger().child({ requestId: ctx.requestId })

    // Build memory context pre-agent (if configured)
    let memoryContext: string | null = null
    if (this.deps.memoryContextBuilder) {
      try {
        memoryContext = await this.deps.memoryContextBuilder.buildContext(
          input.message,
          input.userId,
          ctx
        )
        if (memoryContext) {
          logger.debug({ contextLength: memoryContext.length }, 'Memory context built')
        }
      } catch (error) {
        logger.warn({ error }, 'Memory context builder failed, continuing without')
      }
    }

    // Check if memory tools are available
    const hasMemoryTools = this.deps.memoryToolAccess && this.deps.memoryToolAccess !== 'off'

    const systemPrompt = buildSystemPrompt({
      context: ctx.memory!,
      crisisCheck: ctx.crisisCheck,
      memoryContext,
      hasMemoryTools,
      baseIdentity: this.deps.baseIdentity,
    })

    // Convert Vercel AI SDK tools to ToolDefinition format (including memory tools if enabled)
    const tools = this.convertToolsToDefinitions()

    // Set trace context for memory tools (so they have access to userId for database-per-user)
    if (hasMemoryTools) {
      setMemoryToolTraceContext(ctx)
    }

    // Set conversation ID getter for system tools (clearConversation)
    setGetConversationIdFn(() => ctx.sessionId || ctx.requestId)

    let result: Result<AgentResponse, { kind: string; message: string }>
    try {
      result = await this.deps.agent.generate(
        {
          userMessage: input.message,
          context: ctx.memory!,
          crisisCheck: ctx.crisisCheck,
          systemPrompt,
          tools,
        },
        ctx
      )
    } finally {
      // Always clear trace context after agent processing
      if (hasMemoryTools) {
        clearMemoryToolTraceContext()
      }
    }

    ctx.metrics.stageDurations.agent = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.agent, { stage: 'agent' })

    if (!result.ok) {
      return err({ kind: result.error.kind, message: result.error.message })
    }

    // Record token usage
    pipelineMetrics.tokensUsed.add(result.value.usage.inputTokens, { direction: 'input' })
    pipelineMetrics.tokensUsed.add(result.value.usage.outputTokens, { direction: 'output' })

    // Return full agent response for diagnostics
    return ok(result.value)
  }

  /**
   * Convert Vercel AI SDK tool definitions to our ToolDefinition format
   */
  private convertToolsToDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = []

    // Add recovery tools
    // Note: AI SDK v5 tools use inputSchema instead of parameters
    for (const [name, tool] of Object.entries(recoveryTools)) {
      const t = tool as unknown as {
        description?: string
        inputSchema?: unknown
        execute?: (args: Record<string, unknown>) => Promise<unknown>
      }

      tools.push({
        name,
        description: t.description || `Tool: ${name}`,
        parameters: t.inputSchema as Record<string, unknown>,
        execute: t.execute || (async () => ({ error: 'Not implemented' })),
      })
    }

    // Add memory tools based on access level
    const memoryToolAccess = this.deps.memoryToolAccess || 'off'
    if (memoryToolAccess !== 'off') {
      const memoryTools = getMemoryTools(memoryToolAccess)

      for (const [name, tool] of Object.entries(memoryTools)) {
        const t = tool as unknown as {
          description?: string
          inputSchema?: unknown
          execute?: (args: Record<string, unknown>) => Promise<unknown>
        }

        tools.push({
          name,
          description: t.description || `Memory Tool: ${name}`,
          parameters: t.inputSchema as Record<string, unknown>,
          execute: t.execute || (async () => ({ error: 'Not implemented' })),
        })
      }
    }

    // Add system tools (always available)
    const systemTools = [
      { name: 'refreshSystemPrompt', tool: refreshSystemPrompt },
      { name: 'clearConversation', tool: clearConversation },
    ]

    for (const { name, tool } of systemTools) {
      const t = tool as unknown as {
        description?: string
        inputSchema?: unknown
        execute?: (args: Record<string, unknown>) => Promise<unknown>
      }
      tools.push({
        name,
        description: t.description || `System Tool: ${name}`,
        parameters: t.inputSchema as Record<string, unknown>,
        execute: t.execute || (async () => ({ error: 'Not implemented' })),
      })
    }

    return tools
  }

  /**
   * Build comprehensive diagnostics from pipeline execution data
   */
  private buildDiagnostics(
    totalDuration: number,
    ctx: PipelineContext,
    crisisCheck: CrisisCheckResult,
    memorySource: string,
    agentResponse: AgentResponse,
    safetyResult?: SafetyValidationResult,
    evaluationResult?: EvaluationResult
  ): PipelineDiagnostics {
    return {
      timing: {
        totalDuration,
        crisisDuration: ctx.metrics.stageDurations.crisis || 0,
        memoryDuration: ctx.metrics.stageDurations.memory || 0,
        agentDuration: ctx.metrics.stageDurations.agent || 0,
        persistDuration: ctx.metrics.stageDurations.persist || 0,
        safetyDuration: ctx.metrics.stageDurations.safety,
        evaluationDuration: ctx.metrics.stageDurations.evaluation,
      },
      crisis: {
        level: crisisCheck.level,
        emergencyTriggered: crisisCheck.triggerEmergency,
        patterns: crisisCheck.patterns.map(p => ({
          type: p.type,
          confidence: p.confidence,
          matchedText: p.matchedText,
        })),
        action: crisisCheck.action,
        processingTimeMs: crisisCheck.processingTimeMs,
      },
      memory: {
        sourceTier: memorySource,
        cacheHits: ctx.metrics.cacheHits,
        cacheMisses: ctx.metrics.cacheMisses,
        messagesRetrieved: ctx.memory?.messages.length || 0,
        userProfileLoaded: ctx.memory?.userProfile !== null,
        previousSessionsCount: ctx.memory?.previousSessions.length || 0,
        semanticMatchesCount: ctx.memory?.semanticMatches?.length || 0,
        latencyMs: ctx.metrics.stageDurations.memory || 0,
      },
      agent: {
        model: agentResponse.model,
        inputTokens: agentResponse.usage.inputTokens,
        outputTokens: agentResponse.usage.outputTokens,
        toolCalls: agentResponse.toolCalls.map(tc => ({
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result,
        })),
        stopReason: agentResponse.stopReason,
        stepsCount: agentResponse.stepsCount ?? 1,
      },
      safety: safetyResult ? {
        passed: safetyResult.passed,
        violations: safetyResult.violations.map(v => ({
          type: v.type,
          severity: v.severity,
          description: v.description,
        })),
        processingTimeMs: safetyResult.processingTimeMs,
      } : undefined,
      evaluation: evaluationResult ? {
        qualityScore: evaluationResult.qualityScore,
        relevanceScore: evaluationResult.relevanceScore,
        empathyScore: evaluationResult.empathyScore,
        recoveryScore: evaluationResult.recoveryScore,
        overallScore: evaluationResult.overallScore,
        feedback: evaluationResult.feedback,
      } : undefined,
    }
  }

  private async persistMessages(
    userMessage: Message,
    assistantMessage: Message,
    ctx: PipelineContext
  ): Promise<void> {
    const stageStart = Date.now()
    const logger = getLogger().child({ requestId: ctx.requestId })

    // Generate embeddings if provider available
    let userEmbedding: number[] | null = null
    let assistantEmbedding: number[] | null = null

    if (this.deps.embedding) {
      const [userEmb, assistantEmb] = await Promise.all([
        this.deps.embedding.embed(userMessage.content, ctx),
        this.deps.embedding.embed(assistantMessage.content, ctx),
      ])

      userEmbedding = userEmb.ok ? userEmb.value : null
      assistantEmbedding = assistantEmb.ok ? assistantEmb.value : null
    }

    // Store both messages
    await Promise.all([
      this.deps.memory.storeMessage(userMessage, userEmbedding, ctx),
      this.deps.memory.storeMessage(assistantMessage, assistantEmbedding, ctx),
    ])

    // Update session state
    await this.deps.memory.updateSessionState(
      ctx.input.conversationId,
      {
        lastActivity: Date.now(),
        crisisLevel: ctx.crisisCheck?.level ?? 1,
      },
      ctx
    )

    // Entity extraction (fire and forget - don't block response)
    if (this.deps.entityExtractor) {
      this.deps.entityExtractor
        .extract(userMessage, assistantMessage, ctx.crisisCheck?.level ?? 1, ctx)
        .then((result) => {
          if (result.ok && (result.value.entities.length > 0 || result.value.relationships.length > 0)) {
            logger.info(
              {
                entities: result.value.entities.length,
                relationships: result.value.relationships.length,
              },
              'Entities extracted and stored'
            )
          }
        })
        .catch((err) => {
          logger.warn({ err }, 'Entity extraction failed')
        })
    }

    // Memory bootstrap (fire and forget - don't block response)
    // Extracts memories from exchange and handles bootstrap window logic
    if (this.deps.bootstrapOrchestrator) {
      this.deps.bootstrapOrchestrator
        .processExchange(
          {
            userMessage: userMessage.content,
            assistantResponse: assistantMessage.content,
          },
          ctx.input.conversationId,
          ctx.input.userId,
          ctx
        )
        .catch((err) => {
          logger.warn({ err }, 'Bootstrap processing failed')
        })
    }

    ctx.metrics.stageDurations.persist = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.persist, { stage: 'persist' })
  }

  /**
   * Pre-flight checks before streaming (blocking)
   *
   * Runs crisis detection, memory retrieval, and builds the system prompt.
   * Call this before starting to stream the response.
   */
  async preflight(
    input: PipelineInput,
    traceCtx: TraceContext
  ): Promise<Result<PreflightResult, PipelineError>> {
    return withSpan('Pipeline.preflight', async () => {
      const logger = getLogger().child({
        conversationId: input.conversationId,
        userId: input.userId,
        requestId: traceCtx.requestId,
      })

      logger.info('Starting preflight checks')

      // Initialize pipeline context
      const ctx: PipelineContext = {
        ...traceCtx,
        input,
        metrics: {
          stageDurations: {},
          cacheHits: 0,
          cacheMisses: 0,
        },
      }

      try {
        // STAGE 1: Pre-flight crisis check (<10ms target)
        const crisisResult = await this.runCrisisCheck(input.message, ctx)
        if (!crisisResult.ok) {
          return err({
            kind: 'CrisisError',
            message: crisisResult.error.message,
            stage: 'crisis',
            context: {},
          })
        }

        ctx.crisisCheck = crisisResult.value

        // STAGE 2: Memory retrieval
        const memoryResult = await this.runMemoryRetrieval(input, ctx)

        let memorySource: 'L1_REDIS' | 'L2_POSTGRESQL' | 'L3_NEO4J_L4_QDRANT' | 'COMBINED' | 'NONE' = 'NONE'
        let cacheHits = 0
        let cacheMisses = 0

        if (!memoryResult.ok) {
          logger.warn({ error: memoryResult.error }, 'Memory retrieval failed, continuing with empty context')
          ctx.memory = {
            messages: [],
            userProfile: null,
            sessionEntities: { people: [], places: [], events: [], emotions: [], medications: [] },
            sessionState: { startTime: Date.now(), lastActivity: Date.now(), messageCount: 0, crisisLevel: 1 },
            previousSessions: [],
          }
        } else {
          ctx.memory = memoryResult.value.context
          memorySource = memoryResult.value.source
          cacheHits = memoryResult.value.cacheHits
          cacheMisses = memoryResult.value.cacheMisses
        }

        ctx.metrics.cacheHits = cacheHits
        ctx.metrics.cacheMisses = cacheMisses
        ctx.metrics.memoryTier = memorySource

        // STAGE 3: Build memory context (if configured)
        let memoryContext: string | null = null
        if (this.deps.memoryContextBuilder) {
          try {
            memoryContext = await this.deps.memoryContextBuilder.buildContext(
              input.message,
              input.userId,
              ctx
            )
            if (memoryContext) {
              logger.debug({ contextLength: memoryContext.length }, 'Memory context built')
            }
          } catch (error) {
            logger.warn({ error }, 'Memory context builder failed, continuing without')
          }
        }

        // STAGE 4: Resolve base identity (always fetch fresh from database)
        let baseIdentity = this.deps.baseIdentity // fallback if no database
        if (input.systemPromptId && this.deps.getSystemPrompt) {
          // Custom guide requested - fetch by ID
          const customPrompt = await this.deps.getSystemPrompt(input.systemPromptId)
          if (customPrompt) {
            baseIdentity = customPrompt.content
            logger.debug({ promptId: customPrompt.id, promptName: customPrompt.name }, 'Using custom system prompt')
          } else {
            logger.warn({ guideName: input.systemPromptId }, 'Custom system prompt not found, using default')
          }
        } else if (this.deps.getDefaultSystemPrompt) {
          // No custom guide - fetch default fresh
          const defaultPrompt = await this.deps.getDefaultSystemPrompt()
          if (defaultPrompt) {
            baseIdentity = defaultPrompt.content
            logger.debug({ promptId: defaultPrompt.id, promptName: defaultPrompt.name }, 'Using fresh default system prompt')
          }
        }

        // STAGE 5: Build system prompt
        const hasMemoryTools = this.deps.memoryToolAccess && this.deps.memoryToolAccess !== 'off'
        const systemPrompt = buildSystemPrompt({
          context: ctx.memory!,
          crisisCheck: ctx.crisisCheck,
          memoryContext,
          hasMemoryTools,
          baseIdentity,
        })

        // STAGE 6: Get tools
        const tools = this.convertToolsToDefinitions()

        logger.info(
          {
            crisisLevel: crisisResult.value.level,
            memorySource,
            hasMemoryContext: !!memoryContext,
            toolCount: tools.length,
          },
          'Preflight checks completed'
        )

        return ok({
          systemPrompt,
          tools,
          context: ctx.memory!,
          crisisCheck: crisisResult.value,
          memoryContext,
          memoryStats: {
            source: memorySource,
            cacheHits,
            cacheMisses,
          },
        })
      } catch (error) {
        logger.error({ error }, 'Unexpected preflight error')
        return err({
          kind: 'UnexpectedError',
          message: 'Preflight checks failed unexpectedly',
          stage: 'preflight',
          context: {},
          cause: error,
        })
      }
    })
  }

  /**
   * Post-process after streaming completes (async)
   *
   * Runs safety validation, evaluation, and persists messages.
   * This should be called after the stream completes, and doesn't need to block the response.
   */
  async postProcess(
    input: PipelineInput,
    responseText: string,
    preflightResult: PreflightResult,
    traceCtx: TraceContext
  ): Promise<void> {
    return withSpan('Pipeline.postProcess', async () => {
      const logger = getLogger().child({
        conversationId: input.conversationId,
        userId: input.userId,
        requestId: traceCtx.requestId,
      })

      logger.info({ responseLength: responseText.length }, 'Starting post-process')

      const { context, crisisCheck } = preflightResult

      // Initialize pipeline context for post-processing
      const ctx: PipelineContext = {
        ...traceCtx,
        input,
        memory: context,
        crisisCheck,
        metrics: {
          stageDurations: {},
          cacheHits: preflightResult.memoryStats.cacheHits,
          cacheMisses: preflightResult.memoryStats.cacheMisses,
          memoryTier: preflightResult.memoryStats.source,
        },
      }

      try {
        // STAGE 1: Safety validation + Evaluation (parallel)
        const safetyStart = Date.now()
        const [safetyResult, evaluationResult] = await Promise.all([
          this.deps.safety.validate(responseText, context!, ctx),
          this.deps.evaluator.evaluate(input.message, responseText, context!, ctx),
        ])

        ctx.metrics.stageDurations.safety = Date.now() - safetyStart
        ctx.metrics.stageDurations.evaluation = Date.now() - safetyStart

        // Log safety issues
        if (safetyResult.ok && !safetyResult.value.passed) {
          logger.warn(
            { violations: safetyResult.value.violations },
            'Safety violations detected in response'
          )
        }

        // Log evaluation
        if (evaluationResult.ok) {
          logger.debug(
            { overallScore: evaluationResult.value.overallScore },
            'Evaluation completed'
          )
        }

        // STAGE 2: Deep crisis evaluation (if enabled and initial level < 7)
        if (this.deps.crisisEvaluator && crisisCheck.level < 7 && input.message.length > 20) {
          const conversationHistory = context?.messages
            .slice(-3)
            .map((m) => `${m.role}: ${m.content}`) ?? []

          const deepResult = await this.deps.crisisEvaluator.evaluate(
            input.message,
            conversationHistory,
            ctx
          )

          if (deepResult.ok && deepResult.value.level >= 7) {
            logger.warn(
              { fastLevel: crisisCheck.level, deepLevel: deepResult.value.level },
              'Deep crisis evaluation detected elevated risk'
            )
            await this.deps.crisisHandler.handle(
              deepResult.value,
              input.userId,
              input.conversationId,
              ctx
            )
          }
        }

        // STAGE 3: Persist messages
        const userMessage: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          conversationId: input.conversationId,
          userId: input.userId,
          role: 'user',
          content: input.message,
          timestamp: Date.now(),
        }

        const assistantMessage: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          conversationId: input.conversationId,
          userId: input.userId,
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
          metadata: {
            crisisLevel: crisisCheck.level,
          },
        }

        await this.persistMessages(userMessage, assistantMessage, ctx)

        logger.info(
          {
            safetyPassed: safetyResult.ok ? safetyResult.value.passed : false,
            evaluationScore: evaluationResult.ok ? evaluationResult.value.overallScore : null,
          },
          'Post-process completed'
        )
      } catch (error) {
        logger.error({ error }, 'Post-process failed')
        // Don't throw - post-process errors shouldn't affect the response
      }
    })
  }

  /**
   * Get pipeline dependencies (for direct access in routes)
   */
  getDeps(): PipelineDependencies {
    return this.deps
  }
}
