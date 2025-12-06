/**
 * Dependency Injection Container
 *
 * Sets up all dependencies for the pipeline, using stubs or real implementations
 * based on configuration.
 */

import type { PipelineConfig, IAgentProvider } from '@recoverysky/types'
import { getDefaultPipelineConfig } from '@recoverysky/types'
import {
  MemoryOrchestrator,
  InMemoryContextStore,
  InMemorySessionStore,
  InMemoryKnowledgeStore,
  InMemoryVectorStore,
} from '@recoverysky/memory'
import { KeywordCrisisDetector, StubCrisisHandler } from '@recoverysky/crisis'
import { StubSafetyValidator } from '@recoverysky/safety'
import { MockAgentProvider, VercelAIAgentProvider } from '@recoverysky/agent'
import { StubEvaluator } from '@recoverysky/evaluation'
import { Pipeline, type PipelineDependencies } from '@recoverysky/pipeline'
import { getLogger } from '@recoverysky/observability'

export interface Container {
  pipeline: Pipeline
  config: PipelineConfig
}

export interface ContainerConfig {
  useStubs?: boolean
}

/**
 * Create and configure the dependency container
 */
export function createContainer(options: ContainerConfig = {}): Container {
  const useStubs = options.useStubs ?? process.env.USE_STUBS === 'true'
  const logger = getLogger().child({ component: 'container' })

  logger.info({ useStubs }, 'Creating container')

  // Pipeline configuration
  const pipelineConfig: PipelineConfig = {
    ...getDefaultPipelineConfig(),
    useStubs,
  }

  // Create stores (stubs for now)
  const contextStore = new InMemoryContextStore()
  const sessionStore = new InMemorySessionStore()
  const knowledgeStore = new InMemoryKnowledgeStore()
  const vectorStore = new InMemoryVectorStore()

  // Create memory orchestrator
  const memory = new MemoryOrchestrator(
    contextStore,
    sessionStore,
    knowledgeStore,
    vectorStore,
    {
      l1MessageLimit: pipelineConfig.memory.l1MessageLimit,
      l2MessageLimit: pipelineConfig.memory.l2MessageLimit,
      semanticSearchDays: pipelineConfig.memory.semanticSearchDays,
    }
  )

  // Create crisis detection components
  const crisisDetector = new KeywordCrisisDetector({
    emergencyThreshold: pipelineConfig.crisis.criticalThreshold as 9,
    resourceThreshold: pipelineConfig.crisis.highThreshold as 7,
  })
  const crisisHandler = new StubCrisisHandler()

  // Create agent - real or mock based on USE_STUBS
  let agent: IAgentProvider
  if (useStubs) {
    logger.info('Using MockAgentProvider (USE_STUBS=true)')
    agent = new MockAgentProvider({ delayMs: 100 })
  } else {
    logger.info('Using VercelAIAgentProvider with Claude')
    agent = new VercelAIAgentProvider({
      model: 'claude-sonnet-4-20250514',
      maxSteps: 5,
      maxTokens: 4096,
      temperature: 0.7,
    })
  }

  // Create safety and evaluation components
  const safety = new StubSafetyValidator()
  const evaluator = new StubEvaluator()

  // Assemble dependencies
  const deps: PipelineDependencies = {
    crisisDetector,
    crisisHandler,
    memory,
    agent,
    safety,
    evaluator,
    // embedding: undefined - would be real embedding provider in production
  }

  // Create pipeline
  const pipeline = new Pipeline(deps, pipelineConfig)

  return {
    pipeline,
    config: pipelineConfig,
  }
}
