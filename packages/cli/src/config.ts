/**
 * CLI Configuration
 *
 * Stores user preferences and API settings
 */

import Conf from 'conf'

export interface CLIConfig {
  apiUrl: string
  userId: string
  conversationId: string | null
}

const defaults: CLIConfig = {
  apiUrl: 'http://localhost:3333',
  userId: `user_${Date.now().toString(36)}`,
  conversationId: null,
}

export const config = new Conf<CLIConfig>({
  projectName: 'recoverysky-cli',
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
    convId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    config.set('conversationId', convId)
  }
  return convId
}

export function newConversation(): string {
  const convId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  config.set('conversationId', convId)
  return convId
}

export function resetConfig(): void {
  config.clear()
}
