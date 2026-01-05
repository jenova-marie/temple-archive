/**
 * Chat command - Send a message to the API
 *
 * Uses the Vercel AI SDK UI Message Stream format.
 * Crisis detection, safety checks, and memory operations happen server-side.
 */

import chalk from 'chalk'
import ora from 'ora'
import { sendMessage, type ChatMetrics } from '../api.js'
import { getConversationId, getUserId } from '../config.js'

export interface ChatOptions {
  agent?: string
  verbose?: boolean
  metrics?: boolean
}

/**
 * Format and display metrics
 */
function displayMetrics(metrics: ChatMetrics): void {
  console.log(chalk.gray('─'.repeat(50)))
  console.log(chalk.cyan.bold('Metrics:'))
  console.log(chalk.gray(`  Preflight:     ${metrics.preflightMs}ms`))
  console.log(chalk.gray(`  Total:         ${metrics.totalMs}ms`))
  console.log(chalk.gray(`  Input tokens:  ${metrics.inputTokens}`))
  console.log(chalk.gray(`  Output tokens: ${metrics.outputTokens}`))
  console.log(chalk.gray(`  Crisis level:  ${metrics.crisisLevel}`))
  console.log(chalk.gray(`  Tools:         ${metrics.toolsEnabled}`))

  // Memory tier diagnostics
  console.log(chalk.cyan.bold('Memory:'))

  if (metrics.memory) {
    const { l1, l2, l3, l4, cacheHits, cacheMisses } = metrics.memory
    console.log(chalk.gray(`  Cache:         ${cacheHits} hits / ${cacheMisses} misses`))

    // L1 Redis (session state only, not messages)
    const l1Status = l1.hit
      ? chalk.green('✓ session state')
      : chalk.gray('○ no session')
    console.log(chalk.gray(`  L1 Redis:      ${l1Status}`))

    // L2 PostgreSQL
    const l2Status = l2.queried
      ? (l2.messageCount > 0
          ? chalk.green(`✓ ${l2.messageCount} msgs`)
          : chalk.yellow('○ empty'))
      : chalk.gray('- skipped')
    console.log(chalk.gray(`  L2 Postgres:   ${l2Status}`))

    // L3 Neo4j
    const l3Status = l3.queried
      ? (l3.entityCount > 0
          ? chalk.green(`✓ ${l3.entityCount} entities`)
          : chalk.gray('○ no entities'))
      : chalk.gray('- disabled')
    console.log(chalk.gray(`  L3 Neo4j:      ${l3Status}`))

    // L4 Qdrant
    const l4Status = l4.queried
      ? (l4.matchCount > 0
          ? chalk.green(`✓ ${l4.matchCount} matches`)
          : chalk.gray('○ no matches'))
      : chalk.gray('- disabled')
    console.log(chalk.gray(`  L4 Qdrant:     ${l4Status}`))
  }

  // Phase-shifted stats from previous exchange
  if (metrics.previousExchange) {
    const prev = metrics.previousExchange
    const age = Math.round((Date.now() - prev.timestamp) / 1000)

    console.log(chalk.cyan.bold('Previous Exchange:'))
    console.log(chalk.gray(`  Age:           ${age}s ago`))
    console.log(chalk.gray(`  Duration:      ${prev.durationMs}ms`))

    // Write operations
    const { writes } = prev
    console.log(chalk.gray(`  L2 persisted:  ${writes.l2.messageCount} msgs`))

    if (writes.l3.entitiesAdded > 0 || writes.l3.entitiesUpdated > 0) {
      console.log(chalk.gray(`  L3 entities:   +${writes.l3.entitiesAdded} / ~${writes.l3.entitiesUpdated}`))
    }

    if (writes.l4.embeddingsStored > 0) {
      console.log(chalk.gray(`  L4 embeddings: ${writes.l4.embeddingsStored}`))
    }
  }
}

export async function chatCommand(message: string, options: ChatOptions): Promise<void> {
  const spinner = ora('Sending message...').start()
  let firstDelta = true

  try {
    const response = await sendMessage(message, { agent: options.agent }, (delta) => {
      // Stop spinner on first text and print header
      if (firstDelta) {
        spinner.stop()
        process.stdout.write('\n' + chalk.magenta('Pippa: '))
        firstDelta = false
      }
      // Stream text in real-time
      process.stdout.write(delta)
    })

    // Ensure we end on a new line
    if (!firstDelta) {
      console.log('\n')
    } else {
      // No text received
      spinner.stop()
      console.log()
      console.log(chalk.magenta('Pippa:'), response.response || '(no response)')
      console.log()
    }

    // Verbose output
    if (options.verbose) {
      console.log(chalk.gray(`Conversation: ${response.conversationId}`))
    }

    // Display metrics if enabled
    if (options.metrics && response.metrics) {
      displayMetrics(response.metrics)
    }

  } catch (error) {
    spinner.fail('Failed to send message')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
}

export async function interactiveChat(options: ChatOptions = {}): Promise<void> {
  const { default: inquirer } = await import('inquirer')

  console.log()
  console.log(chalk.magenta.bold('Pippa Chat'))
  console.log(chalk.gray(`Conversation: ${getConversationId()}`))
  console.log(chalk.gray(`User: ${getUserId()}`))
  if (options.agent) {
    console.log(chalk.cyan(`Agent: ${options.agent}`))
  }
  if (options.metrics) {
    console.log(chalk.cyan('Metrics: enabled'))
  }
  console.log(chalk.gray('Type "exit" or "quit" to end the conversation'))
  console.log(chalk.gray('Type "new" to start a new conversation'))
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
      console.log(chalk.magenta('Goodbye! Take care of yourself.'))
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
    let firstDelta = true

    try {
      const response = await sendMessage(message, { agent: options.agent }, (delta) => {
        if (firstDelta) {
          spinner.stop()
          process.stdout.write('\n' + chalk.magenta('Pippa: '))
          firstDelta = false
        }
        process.stdout.write(delta)
      })

      if (!firstDelta) {
        console.log('\n')
      } else {
        spinner.stop()
        console.log()
      }

      // Display metrics if enabled
      if (options.metrics && response.metrics) {
        displayMetrics(response.metrics)
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
