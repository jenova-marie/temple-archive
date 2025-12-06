/**
 * Config command - Manage CLI configuration
 */

import chalk from 'chalk'
import {
  config,
  getApiUrl,
  setApiUrl,
  getUserId,
  setUserId,
  getConversationId,
  newConversation,
  resetConfig,
} from '../config.js'

export function showConfig(): void {
  console.log()
  console.log(chalk.cyan.bold('Current Configuration'))
  console.log()
  console.log(`  ${chalk.gray('API URL:')}         ${getApiUrl()}`)
  console.log(`  ${chalk.gray('User ID:')}         ${getUserId()}`)
  console.log(`  ${chalk.gray('Conversation ID:')} ${getConversationId()}`)
  console.log(`  ${chalk.gray('Config Path:')}     ${config.path}`)
  console.log()
}

export function setConfigValue(key: string, value: string): void {
  switch (key.toLowerCase()) {
    case 'apiurl':
    case 'api-url':
    case 'url':
      setApiUrl(value)
      console.log(chalk.green(`API URL set to: ${value}`))
      break

    case 'userid':
    case 'user-id':
    case 'user':
      setUserId(value)
      console.log(chalk.green(`User ID set to: ${value}`))
      break

    default:
      console.log(chalk.red(`Unknown config key: ${key}`))
      console.log(chalk.gray('Available keys: apiUrl, userId'))
      process.exit(1)
  }
}

export function resetConfigCommand(): void {
  resetConfig()
  console.log(chalk.green('Configuration reset to defaults'))
  showConfig()
}

export function newConversationCommand(): void {
  const id = newConversation()
  console.log(chalk.green(`New conversation started: ${id}`))
}
