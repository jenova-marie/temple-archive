#!/usr/bin/env node

/**
 * Pippa CLI
 *
 * Command-line interface for interacting with the Pippa Agent API
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { chatCommand, interactiveChat, type ChatOptions } from './commands/chat.js'
import { showConfig, setConfigValue, resetConfigCommand, newConversationCommand } from './commands/config.js'
import { healthCommand, metricsCommand } from './commands/health.js'

const program = new Command()

program
  .name('pippa')
  .description('CLI for the Pippa Agent API')
  .version('0.1.0')

// Chat command - send a single message
program
  .command('chat')
  .description('Send a message to Pippa')
  .argument('[message]', 'Message to send (omit for interactive mode)')
  .option('-a, --agent <name>', 'Agent/persona to use', 'pippa')
  .option('-v, --verbose', 'Show conversation ID')
  .option('-m, --metrics', 'Show execution metrics (timing, tokens, etc.)')
  .action(async (message: string | undefined, options: ChatOptions) => {
    if (message) {
      await chatCommand(message, options)
    } else {
      await interactiveChat(options)
    }
  })

// Interactive chat (default command)
program
  .command('interactive', { isDefault: true })
  .description('Start an interactive chat session')
  .option('-a, --agent <name>', 'Agent/persona to use', 'pippa')
  .option('-m, --metrics', 'Show execution metrics (timing, tokens, etc.)')
  .action(async (options: ChatOptions) => {
    await interactiveChat(options)
  })

// Health check
program
  .command('health')
  .description('Check API health status')
  .action(healthCommand)

// Metrics
program
  .command('metrics')
  .description('Show API metrics')
  .action(metricsCommand)

// Config commands
const configCmd = program
  .command('config')
  .description('Manage CLI configuration')

configCmd
  .command('show')
  .description('Show current configuration')
  .action(showConfig)

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (apiUrl, userId)')
  .action(setConfigValue)

configCmd
  .command('reset')
  .description('Reset configuration to defaults')
  .action(resetConfigCommand)

// Conversation management
program
  .command('new')
  .description('Start a new conversation')
  .action(newConversationCommand)

// Error handling
program.exitOverride()

try {
  await program.parseAsync(process.argv)
} catch (error) {
  if ((error as { code?: string }).code === 'commander.help') {
    process.exit(0)
  }
  if ((error as { code?: string }).code === 'commander.version') {
    process.exit(0)
  }
  console.error(chalk.red(`Error: ${(error as Error).message}`))
  process.exit(1)
}
