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
import { MemoryOrchestrator } from '@recoverysky/memory'
import { buildSystemPrompt } from '@recoverysky/agent'
import { recoveryTools } from '@recoverysky/tools'

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
  crisisEvaluator?: ICrisisEvaluator
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
      cacheHits: result.value.cacheHits,
      cacheMisses: result.value.cacheMisses,
    })
  }

  private async runAgentProcessing(
    input: PipelineInput,
    ctx: PipelineContext
  ): Promise<Result<AgentResponse, { kind: string; message: string }>> {
    const stageStart = Date.now()

    const systemPrompt = buildSystemPrompt(ctx.memory!, ctx.crisisCheck)

    // Convert Vercel AI SDK tools to ToolDefinition format
    const tools = this.convertToolsToDefinitions()

    const result = await this.deps.agent.generate(
      {
        userMessage: input.message,
        context: ctx.memory!,
        crisisCheck: ctx.crisisCheck,
        systemPrompt,
        tools,
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

    // Return full agent response for diagnostics
    return ok(result.value)
  }

  /**
   * Convert Vercel AI SDK tool definitions to our ToolDefinition format
   */
  private convertToolsToDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = []

    for (const [name, tool] of Object.entries(recoveryTools)) {
      const t = tool as {
        description?: string
        parameters?: unknown
        execute?: (args: Record<string, unknown>) => Promise<unknown>
      }

      tools.push({
        name,
        description: t.description || `Tool: ${name}`,
        parameters: t.parameters as Record<string, unknown>,
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
