/**
 * Chat command - Send a message to the API
 */

import chalk from 'chalk'
import ora from 'ora'
import { sendMessage } from '../api.js'
import { getConversationId, getUserId } from '../config.js'

export interface ChatOptions {
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

    // Verbose output
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

  } catch (error) {
    spinner.fail('Failed to send message')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
}

export async function interactiveChat(): Promise<void> {
  const { default: inquirer } = await import('inquirer')

  console.log()
  console.log(chalk.cyan.bold('RecoverySky Chat'))
  console.log(chalk.gray(`Conversation: ${getConversationId()}`))
  console.log(chalk.gray(`User: ${getUserId()}`))
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

    } catch (error) {
      spinner.stop()
      console.log(chalk.red(`Error: ${(error as Error).message}`))
      console.log()
    }

    return chatLoop()
  }

  await chatLoop()
}
