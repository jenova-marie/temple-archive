#!/usr/bin/env node

/**
 * Siri CLI
 *
 * Command-line interface for interacting with the Siri Agent API
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { chatCommand, interactiveChat, type ChatOptions } from './commands/chat.js'
import { showConfig, setConfigValue, resetConfigCommand, newConversationCommand } from './commands/config.js'
import { healthCommand, metricsCommand } from './commands/health.js'
import { loginCommand, logoutCommand, whoamiCommand, type LoginOptions } from './commands/auth.js'

const program = new Command()

program
  .name('siri')
  .description('CLI for the Siri Agent API')
  .version('0.1.0')

// Chat command - send a single message
program
  .command('chat')
  .description('Send a message to Siri')
  .argument('[message]', 'Message to send (omit for interactive mode)')
  .option('-a, --agent <name>', 'Agent/persona to use', 'siri')
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
  .option('-a, --agent <name>', 'Agent/persona to use', 'siri')
  .option('-m, --metrics', 'Show execution metrics (timing, tokens, etc.)')
  .action(async (options: ChatOptions) => {
    await interactiveChat(options)
  })

// Auth commands
program
  .command('login')
  .description('Sign in via Auth0 device authorization')
  .option('--no-browser', 'Do not auto-open the verification URL')
  .action(async (options: LoginOptions) => {
    await loginCommand(options)
  })

program
  .command('logout')
  .description('Clear stored auth tokens')
  .action(logoutCommand)

program
  .command('whoami')
  .description('Show the currently authenticated identity')
  .action(whoamiCommand)

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
  .description('Set a configuration value')
  .addHelpText('after', `
Available keys:
  apiUrl   API server URL (e.g., https://siri.example.com)
  userId   Your user identifier

Examples:
  siri config set apiUrl https://siri.example.com
  siri config set apiUrl http://localhost:3000
  siri config set userId my-user-id
`)
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
