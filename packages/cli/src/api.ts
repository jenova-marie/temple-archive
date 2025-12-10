/**
 * API Client for RecoverySky Agent
 *
 * Handles streaming responses from the Vercel AI SDK UI Message Stream format
 * (produced by pipeUIMessageStreamToResponse)
 */

import { getApiUrl, getConversationId } from './config.js'

/**
 * Vercel AI SDK UIMessage format for requests
 */
export interface ChatRequest {
  messages: Array<{
    id?: string
    role: 'user' | 'assistant' | 'system'
    parts?: Array<{ type: 'text'; text: string }>
    content?: string
  }>
}

export interface ChatResponse {
  response: string
  conversationId: string
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

/**
 * Send a message and receive a streaming response
 * Parses UI Message Stream format from pipeUIMessageStreamToResponse()
 *
 * UI Message Stream format (SSE with JSON payloads):
 * - `data: {"type":"text-delta","id":"0","delta":"text"}`
 * - `data: {"type":"finish","finishReason":"stop"}`
 * - `data: [DONE]`
 */
export async function sendMessage(message: string): Promise<ChatResponse> {
  const apiUrl = getApiUrl()
  const conversationId = getConversationId()

  const response = await fetch(`${apiUrl}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: message }],
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        },
      ],
    } satisfies ChatRequest),
  })

  if (!response.ok) {
    // Non-streaming error response (e.g., 400, 401)
    const error = await response.json().catch(() => ({
      error: 'Unknown error',
      message: response.statusText,
      statusCode: response.status,
    })) as ApiError
    throw new Error(`API Error (${error.statusCode}): ${error.message}`)
  }

  // Parse UI Message Stream format (SSE with JSON)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process complete lines
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Skip non-data lines
      if (!trimmed.startsWith('data: ')) continue

      const data = trimmed.slice(6) // Remove 'data: ' prefix

      // Handle [DONE] marker
      if (data === '[DONE]') {
        continue
      }

      // Parse JSON payload
      try {
        const event = JSON.parse(data) as {
          type: string
          id?: string
          delta?: string
          finishReason?: string
        }

        switch (event.type) {
          case 'text-delta': {
            // Accumulate text deltas
            if (event.delta) {
              fullText += event.delta
            }
            break
          }
          case 'error': {
            throw new Error(`Stream error: ${JSON.stringify(event)}`)
          }
          // Ignore other event types (start, start-step, finish-step, finish, text-start, text-end)
        }
      } catch (e) {
        // Ignore JSON parse errors for non-JSON lines
        if (e instanceof Error && e.message.startsWith('Stream error:')) {
          throw e
        }
        // Continue processing - might be a partial line
      }
    }
  }

  return {
    response: fullText,
    conversationId,
  }
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
