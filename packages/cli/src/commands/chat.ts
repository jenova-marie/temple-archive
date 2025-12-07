/**
 * Chat command - Send a message to the API
 */

import chalk from 'chalk'
import ora from 'ora'
import { sendMessage, type ChatResponse } from '../api.js'
import { getConversationId, getUserId } from '../config.js'
import type { PipelineDiagnostics } from '@recoverysky/types'

export interface DiagnosticsFlags {
  diagnostics?: boolean
  timing?: boolean
  memory?: boolean
  crisis?: boolean
  agent?: boolean
}

export interface ChatOptions extends DiagnosticsFlags {
  verbose?: boolean
}

export async function chatCommand(message: string, options: ChatOptions): Promise<void> {
  const spinner = ora('Sending message...').start()

  try {
    const response = await sendMessage(message)

    spinner.stop()

    // Display response
    console.log()
    console.log(chalk.cyan('Sky:'), response.response)
    console.log()

    // Show crisis level if elevated
    if (response.crisisLevel >= 4) {
      const levelColor = response.crisisLevel >= 8
        ? chalk.red
        : response.crisisLevel >= 6
          ? chalk.yellow
          : chalk.blue

      console.log(levelColor(`[Crisis Level: ${response.crisisLevel}/10]`))
    }

    if (response.emergencyTriggered) {
      console.log(chalk.red.bold('*** EMERGENCY PROTOCOL TRIGGERED ***'))
    }

    // Verbose output (legacy, kept for backward compatibility)
    if (options.verbose) {
      console.log()
      console.log(chalk.gray('--- Metrics ---'))
      console.log(chalk.gray(`Total Duration: ${response.metrics.totalDuration}ms`))
      console.log(chalk.gray(`Memory Duration: ${response.metrics.memoryDuration}ms`))
      console.log(chalk.gray(`Agent Duration: ${response.metrics.agentDuration}ms`))
      console.log(chalk.gray(`Memory Source: ${response.metrics.memorySource}`))
      console.log(chalk.gray(`Tokens: ${response.metrics.tokensUsed.input} in / ${response.metrics.tokensUsed.output} out`))
      console.log(chalk.gray(`Conversation: ${response.conversationId}`))
    }

    // Diagnostics output
    const hasDiagFlags = options.diagnostics || options.timing || options.memory || options.crisis || options.agent
    if (hasDiagFlags) {
      displayDiagnostics(response, options)
    }

  } catch (error) {
    spinner.fail('Failed to send message')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
}

export async function interactiveChat(flags: DiagnosticsFlags = {}): Promise<void> {
  const { default: inquirer } = await import('inquirer')

  console.log()
  console.log(chalk.cyan.bold('RecoverySky Chat'))
  console.log(chalk.gray(`Conversation: ${getConversationId()}`))
  console.log(chalk.gray(`User: ${getUserId()}`))
  console.log(chalk.gray('Type "exit" or "quit" to end the conversation'))
  console.log(chalk.gray('Type "new" to start a new conversation'))
  if (flags.diagnostics || flags.timing || flags.memory || flags.crisis || flags.agent) {
    console.log(chalk.gray('Diagnostics: enabled'))
  }
  console.log()

  const chatLoop = async (): Promise<void> => {
    const { message } = await inquirer.prompt<{ message: string }>([
      {
        type: 'input',
        name: 'message',
        message: chalk.green('You:'),
        prefix: '',
      },
    ])

    const trimmed = message.trim().toLowerCase()

    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log(chalk.cyan('Goodbye! Take care of yourself.'))
      process.exit(0)
    }

    if (trimmed === 'new') {
      const { newConversation } = await import('../config.js')
      const newId = newConversation()
      console.log(chalk.gray(`Started new conversation: ${newId}`))
      console.log()
      return chatLoop()
    }

    if (!message.trim()) {
      return chatLoop()
    }

    const spinner = ora('').start()

    try {
      const response = await sendMessage(message)
      spinner.stop()

      console.log()
      console.log(chalk.cyan('Sky:'), response.response)
      console.log()

      if (response.crisisLevel >= 4) {
        const levelColor = response.crisisLevel >= 8
          ? chalk.red
          : response.crisisLevel >= 6
            ? chalk.yellow
            : chalk.blue

        console.log(levelColor(`[Crisis Level: ${response.crisisLevel}/10]`))
        console.log()
      }

      if (response.emergencyTriggered) {
        console.log(chalk.red.bold('*** EMERGENCY PROTOCOL TRIGGERED ***'))
        console.log()
      }

      // Diagnostics output
      const hasDiagFlags = flags.diagnostics || flags.timing || flags.memory || flags.crisis || flags.agent
      if (hasDiagFlags) {
        displayDiagnostics(response, flags)
        console.log()
      }

    } catch (error) {
      spinner.stop()
      console.log(chalk.red(`Error: ${(error as Error).message}`))
      console.log()
    }

    return chatLoop()
  }

  await chatLoop()
}

/**
 * Display diagnostics information based on flags
 */
export function displayDiagnostics(
  response: ChatResponse,
  flags: DiagnosticsFlags
): void {
  const diag = response.diagnostics
  if (!diag) {
    console.log(chalk.gray('No diagnostics available'))
    return
  }

  const showAll = flags.diagnostics
  const showTiming = showAll || flags.timing
  const showCrisis = showAll || flags.crisis
  const showMemory = showAll || flags.memory
  const showAgent = showAll || flags.agent

  if (showTiming) {
    displayTiming(diag)
  }

  if (showCrisis) {
    displayCrisis(diag)
  }

  if (showMemory) {
    displayMemory(diag)
  }

  if (showAgent) {
    displayAgent(diag)
  }

  // Safety and Evaluation are shown with --diagnostics (all)
  if (showAll && diag.safety) {
    displaySafety(diag)
  }

  if (showAll && diag.evaluation) {
    displayEvaluation(diag)
  }
}

function displayTiming(diag: PipelineDiagnostics): void {
  const t = diag.timing
  console.log()
  console.log(chalk.white.bold('=== Timing ==='))
  console.log(chalk.gray(`Total:      ${formatMs(t.totalDuration)}`))
  console.log(chalk.gray(`  Crisis:   ${formatMs(t.crisisDuration)}`))
  console.log(chalk.gray(`  Memory:   ${formatMs(t.memoryDuration)}`))
  console.log(chalk.gray(`  Agent:    ${formatMs(t.agentDuration)}`))
  console.log(chalk.gray(`  Persist:  ${formatMs(t.persistDuration)}`))
  if (t.safetyDuration !== undefined) {
    console.log(chalk.gray(`  Safety:   ${formatMs(t.safetyDuration)}`))
  }
  if (t.evaluationDuration !== undefined) {
    console.log(chalk.gray(`  Eval:     ${formatMs(t.evaluationDuration)}`))
  }
}

function displayCrisis(diag: PipelineDiagnostics): void {
  const c = diag.crisis
  console.log()
  console.log(chalk.white.bold('=== Crisis Detection ==='))

  const levelColor = c.level >= 8
    ? chalk.red
    : c.level >= 6
      ? chalk.yellow
      : c.level >= 4
        ? chalk.blue
        : chalk.green

  console.log(`Level: ${levelColor(`${c.level}/10`)}`)
  console.log(chalk.gray(`Action: ${c.action}`))
  console.log(chalk.gray(`Processing: ${formatMs(c.processingTimeMs)}`))

  if (c.emergencyTriggered) {
    console.log(chalk.red.bold('EMERGENCY TRIGGERED'))
  }

  if (c.patterns.length > 0) {
    console.log(chalk.gray('Patterns detected:'))
    for (const p of c.patterns) {
      const confidence = Math.round(p.confidence * 100)
      console.log(chalk.gray(`  - ${p.type} (${confidence}%)`))
      if (p.matchedText) {
        console.log(chalk.gray(`    "${truncate(p.matchedText, 40)}"`))
      }
    }
  }
}

function displayMemory(diag: PipelineDiagnostics): void {
  const m = diag.memory
  console.log()
  console.log(chalk.white.bold('=== Memory ==='))
  console.log(chalk.gray(`Source Tier: ${m.sourceTier}`))
  console.log(chalk.gray(`Cache: ${m.cacheHits} hits / ${m.cacheMisses} misses`))
  console.log(chalk.gray(`Messages Retrieved: ${m.messagesRetrieved}`))
  console.log(chalk.gray(`User Profile: ${m.userProfileLoaded ? 'Loaded' : 'Not loaded'}`))
  console.log(chalk.gray(`Previous Sessions: ${m.previousSessionsCount}`))
  if (m.semanticMatchesCount > 0) {
    console.log(chalk.gray(`Semantic Matches: ${m.semanticMatchesCount}`))
  }
  console.log(chalk.gray(`Latency: ${formatMs(m.latencyMs)}`))
}

function displayAgent(diag: PipelineDiagnostics): void {
  const a = diag.agent
  console.log()
  console.log(chalk.white.bold('=== Agent ==='))
  console.log(chalk.gray(`Model: ${a.model}`))
  console.log(chalk.gray(`Tokens: ${a.inputTokens} in / ${a.outputTokens} out`))
  console.log(chalk.gray(`Stop Reason: ${a.stopReason}`))
  console.log(chalk.gray(`Steps: ${a.stepsCount}`))

  if (a.toolCalls.length > 0) {
    console.log(chalk.gray('Tool Calls:'))
    for (const tc of a.toolCalls) {
      console.log(chalk.gray(`  - ${tc.name}`))
      if (Object.keys(tc.arguments).length > 0) {
        console.log(chalk.gray(`    Args: ${JSON.stringify(tc.arguments)}`))
      }
    }
  }
}

function displaySafety(diag: PipelineDiagnostics): void {
  const s = diag.safety
  if (!s) return

  console.log()
  console.log(chalk.white.bold('=== Safety ==='))
  const passColor = s.passed ? chalk.green : chalk.red
  console.log(`Status: ${passColor(s.passed ? 'PASSED' : 'FAILED')}`)
  console.log(chalk.gray(`Processing: ${formatMs(s.processingTimeMs)}`))

  if (s.violations.length > 0) {
    console.log(chalk.gray('Violations:'))
    for (const v of s.violations) {
      const sevColor = v.severity === 'high' ? chalk.red
        : v.severity === 'medium' ? chalk.yellow
          : chalk.gray
      console.log(`  - ${sevColor(`[${v.severity}]`)} ${v.type}`)
      console.log(chalk.gray(`    ${v.description}`))
    }
  }
}

function displayEvaluation(diag: PipelineDiagnostics): void {
  const e = diag.evaluation
  if (!e) return

  console.log()
  console.log(chalk.white.bold('=== Evaluation ==='))
  console.log(`Quality      ${renderBar(e.qualityScore)} ${Math.round(e.qualityScore * 100)}%`)
  console.log(`Relevance    ${renderBar(e.relevanceScore)} ${Math.round(e.relevanceScore * 100)}%`)
  console.log(`Empathy      ${renderBar(e.empathyScore)} ${Math.round(e.empathyScore * 100)}%`)
  console.log(`Recovery     ${renderBar(e.recoveryScore)} ${Math.round(e.recoveryScore * 100)}%`)
  console.log(chalk.gray('──────────────────────────────'))
  console.log(`Overall      ${renderBar(e.overallScore)} ${Math.round(e.overallScore * 100)}%`)

  if (e.feedback) {
    console.log()
    console.log(chalk.gray(`Feedback: ${e.feedback}`))
  }
}

// Helper functions
function formatMs(ms: number): string {
  return `${ms}ms`
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

function renderBar(score: number): string {
  const filled = Math.round(score * 10)
  const empty = 10 - filled
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty))
}
