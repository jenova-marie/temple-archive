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
  IAgentProvider,
  ISafetyValidator,
  IEvaluator,
  IEmbeddingProvider,
  CrisisCheckResult,
} from '@recoverysky/types'
import { ok, err, getDefaultPipelineConfig } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import { MemoryOrchestrator } from '@recoverysky/memory'
import { buildSystemPrompt } from '@recoverysky/agent'

export interface PipelineError {
  kind: 'CrisisError' | 'MemoryError' | 'AgentError' | 'SafetyError' | 'ValidationError' | 'TimeoutError' | 'UnexpectedError'
  message: string
  stage?: string
  context: Record<string, unknown>
  cause?: unknown
}

export interface PipelineDependencies {
  crisisDetector: ICrisisDetector
  crisisHandler: ICrisisHandler
  memory: MemoryOrchestrator
  agent: IAgentProvider
  safety: ISafetyValidator
  evaluator: IEvaluator
  embedding?: IEmbeddingProvider
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

        // STAGE 3: Agent processing
        const agentResult = await this.runAgentProcessing(input, ctx)
        if (!agentResult.ok) {
          return err({
            kind: 'AgentError',
            message: 'Agent processing failed',
            stage: 'agent',
            context: { conversationId: input.conversationId },
            cause: agentResult.error,
          })
        }

        // STAGE 4 & 5: Safety validation and evaluation (parallel)
        const [safetyResult, _evaluationResult] = await Promise.all([
          this.deps.safety.validate(agentResult.value.content, ctx.memory!, ctx),
          this.deps.evaluator.evaluate(input.message, agentResult.value.content, ctx.memory!, ctx),
        ])

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
            crisisLevel: crisisResult.value.level,
          },
        }

        // STAGE 6: Persist messages
        await this.persistMessages(userMessage, assistantMessage, ctx)

        const totalDuration = Date.now() - startTime

        pipelineMetrics.stageDuration.record(totalDuration, { stage: 'total' })

        logger.info(
          {
            totalDuration,
            crisisLevel: crisisResult.value.level,
            tokensUsed: agentResult.value.usage,
          },
          'Pipeline processing completed'
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
          crisisLevel: crisisResult.value.level,
          emergencyTriggered: false,
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
  ): Promise<Result<{ context: PipelineContext['memory']; source: string }, { kind: string; message: string }>> {
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
      ctx
    )

    ctx.metrics.stageDurations.memory = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.memory, { stage: 'memory' })

    if (!result.ok) {
      return err({ kind: result.error.kind, message: result.error.message })
    }

    return ok({
      context: result.value.context,
      source: result.value.source,
    })
  }

  private async runAgentProcessing(
    input: PipelineInput,
    ctx: PipelineContext
  ): Promise<Result<{ content: string; usage: { inputTokens: number; outputTokens: number } }, { kind: string; message: string }>> {
    const stageStart = Date.now()

    const systemPrompt = buildSystemPrompt(ctx.memory!, ctx.crisisCheck)

    const result = await this.deps.agent.generate(
      {
        userMessage: input.message,
        context: ctx.memory!,
        crisisCheck: ctx.crisisCheck,
        systemPrompt,
      },
      ctx
    )

    ctx.metrics.stageDurations.agent = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.agent, { stage: 'agent' })

    if (!result.ok) {
      return err({ kind: result.error.kind, message: result.error.message })
    }

    // Record token usage
    pipelineMetrics.tokensUsed.add(result.value.usage.inputTokens, { direction: 'input' })
    pipelineMetrics.tokensUsed.add(result.value.usage.outputTokens, { direction: 'output' })

    return ok({
      content: result.value.content,
      usage: result.value.usage,
    })
  }

  private async persistMessages(
    userMessage: Message,
    assistantMessage: Message,
    ctx: PipelineContext
  ): Promise<void> {
    const stageStart = Date.now()

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

    ctx.metrics.stageDurations.persist = Date.now() - stageStart
    pipelineMetrics.stageDuration.record(ctx.metrics.stageDurations.persist, { stage: 'persist' })
  }
}
