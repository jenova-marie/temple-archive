/**
 * Meeting API Client
 *
 * Client for the RecoverySky Meeting Discovery API.
 * Supports finding live meetings, scheduled meetings, and meeting schedules.
 */

import { getLogger } from '@pippa/observability'

/**
 * Meeting data from the API
 */
export interface Meeting {
  id: string
  name: string
  fellowship: 'AA' | 'NA' | 'CMA' | 'RD'
  url?: string
  description?: string
  location?: string
  language?: string
  status?: string
  trex?: {
    coordinate: number
    timezone: string
    periodicity: number
    hour?: number
    minute?: number
    dow?: number
    duration_ms: number
  }
}

/**
 * Live meetings response
 */
export interface LiveMeetingsResponse {
  timestamp: string
  count: number
  liveCount: number
  meetings: Meeting[]
}

/**
 * Schedule response
 */
export interface ScheduleResponse {
  timezone: string
  range: {
    start: string
    end: string
  }
  timestamp: string
  count: number
  wrapped: boolean
  meetings: Meeting[]
}

/**
 * Periodicity filter options
 */
export type Periodicity = 'CONTINUOUS' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

/**
 * Meeting client configuration
 */
export interface MeetingClientConfig {
  /** Base URL for the meeting API (default: http://localhost:4000) */
  baseUrl: string
  /** Bearer token for authentication (optional if AUTH_DISABLED=true on server) */
  authToken?: string
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<MeetingClientConfig, 'authToken'>> & { authToken?: string } = {
  baseUrl: 'http://localhost:4000',
  timeout: 10000,
  authToken: undefined,
}

/**
 * Meeting API client
 */
export class MeetingClient {
  private readonly config: Required<Omit<MeetingClientConfig, 'authToken'>> & { authToken?: string }
  private readonly logger = getLogger().child({ component: 'MeetingClient' })

  constructor(config: Partial<MeetingClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger.debug({ baseUrl: this.config.baseUrl }, 'MeetingClient initialized')
  }

  /**
   * Make an authenticated request to the API
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    }

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText })) as { message?: string }
        throw new Error(errorBody.message || `HTTP ${response.status}`)
      }

      return await response.json() as T
    } catch (error: unknown) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`)
      }

      throw error
    }
  }

  /**
   * Get currently live meetings
   *
   * @param periodicities - Filter by periodicity types (optional)
   * @returns Live meetings response
   */
  async getLiveMeetings(periodicities?: Periodicity[]): Promise<LiveMeetingsResponse> {
    this.logger.debug({ periodicities }, 'Getting live meetings')

    const body = periodicities ? { periodicities } : undefined

    const response = await this.request<LiveMeetingsResponse>('/meetings/live', {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })

    this.logger.info(
      { count: response.count, liveCount: response.liveCount },
      'Live meetings retrieved'
    )

    return response
  }

  /**
   * Get meetings in a time range
   *
   * @param start - Start of time range (ISO 8601)
   * @param end - End of time range (ISO 8601)
   * @param timezone - IANA timezone identifier (optional)
   * @returns Schedule response
   */
  async getSchedule(
    start: string,
    end: string,
    timezone?: string
  ): Promise<ScheduleResponse> {
    this.logger.debug({ start, end, timezone }, 'Getting schedule')

    const params = new URLSearchParams({
      start,
      end,
    })

    if (timezone) {
      params.set('tz', timezone)
    }

    const response = await this.request<ScheduleResponse>(
      `/meetings/schedule?${params.toString()}`
    )

    this.logger.info({ count: response.count }, 'Schedule retrieved')

    return response
  }

  /**
   * Get meetings happening today
   *
   * @param timezone - IANA timezone identifier
   * @returns Schedule response
   */
  async getTodaysMeetings(timezone: string = 'America/New_York'): Promise<ScheduleResponse> {
    const now = new Date()

    // Get start and end of today in the specified timezone
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)

    const end = new Date(now)
    end.setHours(23, 59, 59, 999)

    return this.getSchedule(start.toISOString(), end.toISOString(), timezone)
  }

  /**
   * Get meetings happening tomorrow
   *
   * @param timezone - IANA timezone identifier
   * @returns Schedule response
   */
  async getTomorrowsMeetings(timezone: string = 'America/New_York'): Promise<ScheduleResponse> {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    const start = new Date(tomorrow)
    start.setHours(0, 0, 0, 0)

    const end = new Date(tomorrow)
    end.setHours(23, 59, 59, 999)

    return this.getSchedule(start.toISOString(), end.toISOString(), timezone)
  }

  /**
   * Get meetings for a specific day of the week
   *
   * @param dayOfWeek - Day of week (0=Sunday, 1=Monday, etc.)
   * @param timezone - IANA timezone identifier
   * @returns Schedule response
   */
  async getMeetingsForDay(
    dayOfWeek: number,
    timezone: string = 'America/New_York'
  ): Promise<ScheduleResponse> {
    const now = new Date()
    const currentDay = now.getDay()

    // Calculate days until target day
    let daysUntil = dayOfWeek - currentDay
    if (daysUntil <= 0) {
      daysUntil += 7 // Next week
    }

    const targetDate = new Date(now)
    targetDate.setDate(targetDate.getDate() + daysUntil)

    const start = new Date(targetDate)
    start.setHours(0, 0, 0, 0)

    const end = new Date(targetDate)
    end.setHours(23, 59, 59, 999)

    return this.getSchedule(start.toISOString(), end.toISOString(), timezone)
  }
}

/**
 * Singleton client instance
 */
let clientInstance: MeetingClient | null = null

/**
 * Get or create the meeting client
 */
export function getMeetingClient(config?: Partial<MeetingClientConfig>): MeetingClient {
  if (!clientInstance || config) {
    clientInstance = new MeetingClient({
      baseUrl: process.env.MEETING_API_URL || 'http://localhost:4000',
      authToken: process.env.MEETING_API_TOKEN,
      ...config,
    })
  }
  return clientInstance
}

/**
 * Reset the client instance (for testing)
 */
export function resetMeetingClient(): void {
  clientInstance = null
}
