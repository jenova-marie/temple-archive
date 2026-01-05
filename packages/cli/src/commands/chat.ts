/**
 * Chat command - Send a message to the API
 *
 * Uses the Vercel AI SDK UI Message Stream format.
 * Crisis detection, safety checks, and memory operations happen server-side.
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
  let firstDelta = true

  try {
    const response = await sendMessage(message, (delta) => {
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

  } catch (error) {
    spinner.fail('Failed to send message')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
}

export async function interactiveChat(): Promise<void> {
  const { default: inquirer } = await import('inquirer')

  console.log()
  console.log(chalk.magenta.bold('Pippa Chat'))
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
      await sendMessage(message, (delta) => {
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

    } catch (error) {
      spinner.stop()
      console.log(chalk.red(`Error: ${(error as Error).message}`))
      console.log()
    }

    return chatLoop()
  }

  await chatLoop()
}
