/**
 * Auth commands: login, logout, whoami
 *
 * Login uses the Auth0 Device Authorization Grant. The CLI prints the
 * verification URL + short user code, optionally opens a browser, then
 * polls until the user authorizes (or the device code expires).
 */

import { exec } from 'node:child_process'
import { platform } from 'node:os'
import chalk from 'chalk'
import ora from 'ora'
import {
  AUTH_CONFIG,
  persistTokens,
  pollForToken,
  requestDeviceCode,
  logout as clearTokens,
} from '../auth.js'
import { getAuth } from '../config.js'

export interface LoginOptions {
  /** When true, do not attempt to open the browser automatically. */
  noBrowser?: boolean
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  const existing = getAuth()
  if (existing) {
    const subject = existing.claims?.sub ?? existing.claims?.email ?? 'unknown'
    console.log(
      chalk.yellow(
        `Already logged in as ${chalk.bold(String(subject))}. Run \`siri logout\` first to switch accounts.`,
      ),
    )
    return
  }

  const spinner = ora('Requesting device code…').start()
  let device
  try {
    device = await requestDeviceCode()
  } catch (error) {
    spinner.fail('Failed to request device code')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  }
  spinner.succeed('Device code received')

  console.log()
  console.log(chalk.cyan.bold('To finish signing in:'))
  console.log()
  console.log(`  1. Open: ${chalk.underline(device.verification_uri)}`)
  console.log(`  2. Enter the code: ${chalk.bold.white(device.user_code)}`)
  console.log()
  console.log(
    chalk.gray(
      `Or use this one-tap link: ${device.verification_uri_complete}`,
    ),
  )
  console.log()

  if (!options.noBrowser) {
    openInBrowser(device.verification_uri_complete).catch(() => {
      // Browser open is best-effort; the URL is already printed above.
    })
  }

  const polling = ora('Waiting for you to authorize…').start()
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on('SIGINT', onSigint)

  try {
    const tokens = await pollForToken(device, { signal: controller.signal })
    persistTokens(tokens)
    polling.succeed('Logged in')

    const subject = tokens.claims?.sub ?? tokens.claims?.email ?? 'unknown'
    console.log()
    console.log(chalk.green(`Welcome, ${chalk.bold(String(subject))} 💜`))
  } catch (error) {
    polling.fail('Login failed')
    console.error(chalk.red((error as Error).message))
    process.exit(1)
  } finally {
    process.off('SIGINT', onSigint)
  }
}

export function logoutCommand(): void {
  const existing = getAuth()
  if (!existing) {
    console.log(chalk.gray('Not logged in.'))
    return
  }
  clearTokens()
  console.log(chalk.green('Logged out. Tokens cleared.'))
}

export function whoamiCommand(): void {
  const auth = getAuth()
  if (!auth) {
    console.log(chalk.yellow('Not logged in. Run `siri login` to sign in.'))
    process.exit(1)
  }

  const claims = auth.claims ?? {}
  const expiresIn = Math.max(0, Math.round((auth.expiresAt - Date.now()) / 1000))
  const expiresLabel =
    expiresIn > 0
      ? `${expiresIn}s (≈${Math.round(expiresIn / 60)}m)`
      : chalk.red('expired')

  console.log()
  console.log(chalk.cyan.bold('Current Identity'))
  console.log()
  printClaim('Subject (sub)', claims.sub)
  printClaim('Email', claims.email)
  printClaim('Name', claims.name)
  printClaim('Nickname', claims.nickname)
  console.log(`  ${chalk.gray('Audience:')}      ${AUTH_CONFIG.audience}`)
  console.log(`  ${chalk.gray('Issuer:')}        ${AUTH_CONFIG.issuer}`)
  console.log(`  ${chalk.gray('Token expires:')} ${expiresLabel}`)
  console.log(
    `  ${chalk.gray('Refresh token:')} ${auth.refreshToken ? chalk.green('present') : chalk.yellow('none')}`,
  )
  console.log()
}

function printClaim(label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  const padded = `${label}:`.padEnd(15)
  console.log(`  ${chalk.gray(padded)} ${String(value)}`)
}

function openInBrowser(url: string): Promise<void> {
  const command =
    platform() === 'darwin'
      ? `open "${url}"`
      : platform() === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`

  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
