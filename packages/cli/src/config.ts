/**
 * CLI Configuration
 *
 * Stores user preferences and API settings
 */

import Conf from 'conf'
import { randomUUID } from 'node:crypto'

export interface CLIConfig {
  apiUrl: string
  userId: string
  conversationId: string | null
}

const defaults: CLIConfig = {
  apiUrl: 'http://localhost:61664',
  userId: randomUUID(),
  conversationId: null,
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
