/**
 * Webhook-based crisis handler for alerting external systems
 *
 * Sends crisis alerts via HTTP POST to a configured endpoint.
 * Uses fire-and-forget pattern - webhook failures don't block response.
 */

import { createHmac } from 'crypto'
import type {
  ICrisisHandler,
  CrisisCheckResult,
  CrisisHandlerResponse,
  CrisisError,
  CrisisLevel,
  CrisisResource,
  DetectedPattern,
  TraceContext,
  Result,
} from '@siri/types'
import { ok } from '@siri/types'
import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'
import { CRISIS_RESOURCES } from './patterns.js'

export interface WebhookCrisisHandlerConfig {
  /** Webhook URL (required) */
  webhookUrl: string
  /** HMAC secret for signing payloads (optional) */
  webhookSecret?: string
  /** Minimum crisis level to trigger webhook (default: 7) */
  minLevelToAlert?: CrisisLevel
  /** Request timeout in milliseconds (default: 5000) */
  timeoutMs?: number
  /** Number of retry attempts (default: 2) */
  retries?: number
}

/**
 * Webhook payload sent to external systems
 */
export interface CrisisWebhookPayload {
  timestamp: string
  userId: string
  conversationId: string
  crisisLevel: number
  patterns: DetectedPattern[]
  action: string
  requestId: string
}

export class WebhookCrisisHandler implements ICrisisHandler {
  private readonly config: Required<Omit<WebhookCrisisHandlerConfig, 'webhookSecret'>> & {
    webhookSecret?: string
  }

  constructor(config: WebhookCrisisHandlerConfig) {
    if (!config.webhookUrl) {
      throw new Error('webhookUrl is required')
    }

    this.config = {
      webhookUrl: config.webhookUrl,
      webhookSecret: config.webhookSecret,
      minLevelToAlert: config.minLevelToAlert ?? 7,
      timeoutMs: config.timeoutMs ?? 5000,
      retries: config.retries ?? 2,
    }
  }

  async handle(
    result: CrisisCheckResult,
    userId: string,
    conversationId: string,
    ctx: TraceContext
  ): Promise<Result<CrisisHandlerResponse, CrisisError>> {
    return withSpan('WebhookCrisisHandler.handle', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      const response: CrisisHandlerResponse = {
        teamAlerted: false,
        actionsTaken: [],
      }

      // Determine resources and messages based on level
      if (result.level >= 9) {
        response.prependMessage =
          "🆘 I can see you're going through something really difficult right now. " +
          'Your safety is the most important thing. Please reach out to one of these resources immediately:'
        response.resources = [...CRISIS_RESOURCES.national]
        response.actionsTaken.push('emergency_resources_provided')
      } else if (result.level >= 7) {
        response.prependMessage =
          "💙 I hear that you're struggling. You don't have to face this alone. " +
          'Here are some resources that can help:'
        response.resources = [...CRISIS_RESOURCES.national, ...CRISIS_RESOURCES.recovery] as CrisisResource[]
        response.actionsTaken.push('resources_injected')
      } else if (result.level >= 4) {
        response.actionsTaken.push('flagged_for_review')
      }

      // Fire webhook if level meets threshold
      if (result.level >= this.config.minLevelToAlert) {
        const payload: CrisisWebhookPayload = {
          timestamp: new Date().toISOString(),
          userId,
          conversationId,
          crisisLevel: result.level,
          patterns: result.patterns,
          action: result.action,
          requestId: ctx.requestId,
        }

        // Fire webhook asynchronously (don't await)
        this.sendWebhookWithRetry(payload, logger).then((success) => {
          if (success) {
            pipelineMetrics.crisisDetections.add(1, {
              source: 'webhook',
              status: 'success',
            })
          } else {
            pipelineMetrics.crisisDetections.add(1, {
              source: 'webhook',
              status: 'failed',
            })
          }
        })

        response.teamAlerted = true
        response.actionsTaken.push('webhook_triggered')

        logger.info(
          {
            level: result.level,
            userId,
            conversationId,
            webhookUrl: this.config.webhookUrl,
          },
          'Crisis webhook triggered'
        )
      }

      return ok(response)
    })
  }

  private async sendWebhookWithRetry(
    payload: CrisisWebhookPayload,
    logger: ReturnType<typeof getLogger>
  ): Promise<boolean> {
    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add HMAC signature if secret is configured
    if (this.config.webhookSecret) {
      const signature = this.computeSignature(body, this.config.webhookSecret)
      headers['X-Crisis-Signature'] = `sha256=${signature}`
    }

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

        const response = await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          logger.debug(
            { attempt, status: response.status },
            'Webhook sent successfully'
          )
          return true
        }

        logger.warn(
          { attempt, status: response.status },
          'Webhook returned non-OK status'
        )
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'AbortError'
        logger.warn(
          { attempt, error: String(error), isTimeout },
          'Webhook request failed'
        )

        // Don't retry on timeout (already took too long)
        if (isTimeout && attempt < this.config.retries) {
          continue
        }
      }

      // Wait before retry (exponential backoff: 100ms, 200ms, 400ms...)
      if (attempt < this.config.retries) {
        await this.sleep(100 * Math.pow(2, attempt))
      }
    }

    logger.error(
      { retries: this.config.retries, url: this.config.webhookUrl },
      'Webhook failed after all retries'
    )
    return false
  }

  private computeSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
