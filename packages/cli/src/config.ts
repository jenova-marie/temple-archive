/**
 * CLI Configuration
 *
 * Stores user preferences and API settings
 */

import Conf from 'conf'
import { randomUUID } from 'node:crypto'

export interface AuthTokens {
  accessToken: string
  refreshToken: string | null
  /** Unix epoch ms when the access token expires */
  expiresAt: number
  /** Cached subset of the JWT payload (sub, email, name, …) for `whoami` */
  claims: Record<string, unknown> | null
}

export interface CLIConfig {
  apiUrl: string
  userId: string
  conversationId: string | null
  auth: AuthTokens | null
}

const defaults: CLIConfig = {
  apiUrl: 'http://localhost:61664',
  userId: randomUUID(),
  conversationId: null,
  auth: null,
}

export const config = new Conf<CLIConfig>({
  projectName: 'siri-cli',
  defaults,
})

export function getApiUrl(): string {
  return config.get('apiUrl')
}

export function setApiUrl(url: string): void {
  config.set('apiUrl', url)
}

export function getUserId(): string {
  return config.get('userId')
}

export function setUserId(id: string): void {
  config.set('userId', id)
}

export function getConversationId(): string {
  let convId = config.get('conversationId')
  if (!convId) {
    convId = randomUUID()
    config.set('conversationId', convId)
  }
  return convId
}

export function newConversation(): string {
  const convId = randomUUID()
  config.set('conversationId', convId)
  return convId
}

export function resetConfig(): void {
  config.clear()
}

export function getAuth(): AuthTokens | null {
  return config.get('auth')
}

export function setAuth(tokens: AuthTokens): void {
  config.set('auth', tokens)
}

export function clearAuth(): void {
  config.set('auth', null)
}
