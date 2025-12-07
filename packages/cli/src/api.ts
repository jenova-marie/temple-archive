/**
 * API Client for RecoverySky Agent
 */

import { getApiUrl, getUserId, getConversationId } from './config.js'
import type { PipelineDiagnostics, SafetyViolation } from '@recoverysky/types'

export interface ChatRequest {
  message: string
  conversationId: string
  userId: string
}

export interface ChatResponse {
  response: string
  conversationId: string
  messageId: string
  crisisLevel: number
  emergencyTriggered: boolean
  metrics: {
    totalDuration: number
    memoryDuration: number
    agentDuration: number
    tokensUsed: {
      input: number
      output: number
    }
    memorySource: string
  }
  safetyViolations?: SafetyViolation[]
  diagnostics?: PipelineDiagnostics
}

export interface HealthResponse {
  status: string
  timestamp: string
  uptime: number
  version: string
}

export interface ApiError {
  error: string
  message: string
  statusCode: number
}

export async function sendMessage(message: string): Promise<ChatResponse> {
  const apiUrl = getApiUrl()
  const userId = getUserId()
  const conversationId = getConversationId()

  const response = await fetch(`${apiUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      conversationId,
      userId,
    } satisfies ChatRequest),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'Unknown error',
      message: response.statusText,
      statusCode: response.status,
    })) as ApiError
    throw new Error(`API Error (${error.statusCode}): ${error.message}`)
  }

  return response.json() as Promise<ChatResponse>
}

export async function checkHealth(): Promise<HealthResponse> {
  const apiUrl = getApiUrl()

  const response = await fetch(`${apiUrl}/health`)

  if (!response.ok) {
    throw new Error(`Health check failed: ${response.statusText}`)
  }

  return response.json() as Promise<HealthResponse>
}

export async function getMetrics(): Promise<string> {
  const apiUrl = getApiUrl()

  const response = await fetch(`${apiUrl}/health/metrics`)

  if (!response.ok) {
    throw new Error(`Metrics request failed: ${response.statusText}`)
  }

  return response.text()
}
