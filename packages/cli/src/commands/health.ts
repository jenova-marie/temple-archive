/**
 * Health command - Check API health status
 */

import chalk from 'chalk'
import ora from 'ora'
import { checkHealth, getMetrics } from '../api.js'
import { getApiUrl } from '../config.js'

export async function healthCommand(): Promise<void> {
  const spinner = ora('Checking API health...').start()

  try {
    const health = await checkHealth()
    spinner.succeed('API is healthy')

    console.log()
    console.log(chalk.cyan.bold('API Health'))
    console.log()
    console.log(`  ${chalk.gray('URL:')}       ${getApiUrl()}`)
    console.log(`  ${chalk.gray('Status:')}    ${chalk.green(health.status)}`)
    console.log(`  ${chalk.gray('Version:')}   ${health.version}`)
    console.log(`  ${chalk.gray('Uptime:')}    ${formatUptime(health.uptime)}`)
    console.log(`  ${chalk.gray('Timestamp:')} ${health.timestamp}`)
    console.log()

  } catch (error) {
    spinner.fail('API health check failed')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
}

export async function metricsCommand(): Promise<void> {
  const spinner = ora('Fetching metrics...').start()

  try {
    const metrics = await getMetrics()
    spinner.stop()

    console.log()
    console.log(chalk.cyan.bold('API Metrics'))
    console.log()
    console.log(metrics)

  } catch (error) {
    spinner.fail('Failed to fetch metrics')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${secs}s`)

  return parts.join(' ')
}
