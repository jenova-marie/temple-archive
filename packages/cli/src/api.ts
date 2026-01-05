/**
 * API Client for Pippa Agent
 *
 * Handles streaming responses from the Vercel AI SDK UI Message Stream format
 * (produced by pipeUIMessageStreamToResponse)
 */

import { getApiUrl, getConversationId, getUserId } from './config.js'

/**
 * Options for sendMessage
 */
export interface SendMessageOptions {
  agent?: string
}

/**
 * Vercel AI SDK UIMessage format for requests
 */
export interface ChatRequest {
  conversation_id: string
  messages: Array<{
    id?: string
    role: 'user' | 'assistant' | 'system'
    parts?: Array<{ type: 'text'; text: string }>
    content?: string
  }>
  agent?: string
}

export interface MemoryTierStats {
  l1: { hit: boolean; messageCount: number }
  l2: { queried: boolean; messageCount: number }
  l3: { queried: boolean; entityCount: number }
  l4: { queried: boolean; matchCount: number }
  cacheHits: number
  cacheMisses: number
}

export interface TierWriteStats {
  l1: { messageCount: number }
  l2: { messageCount: number }
  l3: { entitiesAdded: number; entitiesUpdated: number }
  l4: { embeddingsStored: number }
}

export interface PreviousExchange {
  timestamp: number
  durationMs: number
  writes: TierWriteStats
  safety: { passed: boolean; violationCount: number }
  evaluation: { score: number | null }
}

export interface SemanticSearchResult {
  query: string
  preprocessedQuery: string
  searched: boolean
  results: Array<{
    score: number
    content: string
    role?: string
    timestamp?: number
  }>
}

export interface MemoryPromptsStats {
  count: number
  totalChars: number
}

export interface ChatMetrics {
  preflightMs: number
  totalMs: number
  inputTokens: number
  outputTokens: number
  crisisLevel: number
  toolsEnabled: number
  memory?: MemoryTierStats
  previousExchange?: PreviousExchange | null
  semanticSearch?: SemanticSearchResult | null
  memoryPrompts?: MemoryPromptsStats
}

export interface ChatResponse {
  response: string
  conversationId: string
  metrics?: ChatMetrics
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
 *
 * @param message - The user message to send
 * @param options - Options including agent selection
 * @param onDelta - Optional callback for real-time text streaming
 */
export async function sendMessage(
  message: string,
  options: SendMessageOptions,
  onDelta?: (text: string) => void
): Promise<ChatResponse> {
  const apiUrl = getApiUrl()
  const conversationId = getConversationId()

  const response = await fetch(`${apiUrl}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // For local dev with DISABLE_AUTH=true, we pass userId as a header
      // In production, this would be a JWT token
      'X-User-Id': getUserId(),
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: message }],
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        },
      ],
      agent: options.agent,
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
  let metrics: ChatMetrics | undefined

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
          messageMetadata?: {
            metrics?: ChatMetrics
          }
        }

        switch (event.type) {
          case 'text-delta': {
            // Accumulate text deltas and stream to callback
            if (event.delta) {
              fullText += event.delta
              onDelta?.(event.delta)
            }
            break
          }
          case 'finish': {
            // Extract metrics from messageMetadata if present
            if (event.messageMetadata?.metrics) {
              metrics = event.messageMetadata.metrics
            }
            break
          }
          case 'error': {
            throw new Error(`Stream error: ${JSON.stringify(event)}`)
          }
          // Ignore other event types (start, start-step, finish-step, text-start, text-end)
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
    metrics,
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
