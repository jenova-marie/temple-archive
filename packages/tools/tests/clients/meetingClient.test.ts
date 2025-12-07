import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MeetingClient, getMeetingClient, resetMeetingClient } from '../../src/clients/meetingClient.js'

// Mock observability
vi.mock('@recoverysky/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('MeetingClient', () => {
  let client: MeetingClient

  beforeEach(() => {
    vi.clearAllMocks()
    resetMeetingClient()
    client = new MeetingClient({ baseUrl: 'http://test-api:4000' })
  })

  afterEach(() => {
    resetMeetingClient()
  })

  describe('constructor', () => {
    it('should use default config when not provided', () => {
      const defaultClient = new MeetingClient()
      expect(defaultClient).toBeDefined()
    })

    it('should merge provided config with defaults', () => {
      const customClient = new MeetingClient({
        baseUrl: 'http://custom:5000',
        timeout: 5000,
      })
      expect(customClient).toBeDefined()
    })
  })

  describe('getLiveMeetings', () => {
    it('should fetch live meetings successfully', async () => {
      const mockResponse = {
        timestamp: '2025-12-07T12:00:00Z',
        count: 2,
        liveCount: 2,
        meetings: [
          {
            id: 'meeting-1',
            name: 'Test AA Meeting',
            fellowship: 'AA',
            url: 'https://zoom.us/j/123',
          },
          {
            id: 'meeting-2',
            name: 'Test NA Meeting',
            fellowship: 'NA',
            location: 'Community Center',
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.getLiveMeetings()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:4000/meetings/live',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(result.meetings).toHaveLength(2)
      expect(result.liveCount).toBe(2)
    })

    it('should filter by periodicities when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ meetings: [], count: 0, liveCount: 0 }),
      })

      await client.getLiveMeetings(['WEEKLY', 'DAILY'])

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:4000/meetings/live',
        expect.objectContaining({
          body: JSON.stringify({ periodicities: ['WEEKLY', 'DAILY'] }),
        })
      )
    })

    it('should include auth token when configured', async () => {
      const authClient = new MeetingClient({
        baseUrl: 'http://test-api:4000',
        authToken: 'test-token',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ meetings: [], count: 0, liveCount: 0 }),
      })

      await authClient.getLiveMeetings()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Database error' }),
      })

      await expect(client.getLiveMeetings()).rejects.toThrow('Database error')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(client.getLiveMeetings()).rejects.toThrow('Network error')
    })
  })

  describe('getSchedule', () => {
    it('should fetch schedule for time range', async () => {
      const mockResponse = {
        timezone: 'America/New_York',
        range: {
          start: '2025-12-07T00:00:00Z',
          end: '2025-12-07T23:59:59Z',
        },
        count: 5,
        meetings: [],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.getSchedule(
        '2025-12-07T00:00:00Z',
        '2025-12-07T23:59:59Z',
        'America/New_York'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:4000/meetings/schedule?start=2025-12-07T00%3A00%3A00Z&end=2025-12-07T23%3A59%3A59Z&tz=America%2FNew_York',
        expect.any(Object)
      )
      expect(result.count).toBe(5)
    })

    it('should work without timezone', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ meetings: [], count: 0 }),
      })

      await client.getSchedule('2025-12-07T00:00:00Z', '2025-12-07T23:59:59Z')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('schedule?start='),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining('tz='),
        expect.any(Object)
      )
    })
  })

  describe('getTodaysMeetings', () => {
    it('should fetch meetings for today', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ meetings: [], count: 0 }),
      })

      await client.getTodaysMeetings('America/Los_Angeles')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/meetings/schedule'),
        expect.any(Object)
      )
    })
  })

  describe('getTomorrowsMeetings', () => {
    it('should fetch meetings for tomorrow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ meetings: [], count: 0 }),
      })

      await client.getTomorrowsMeetings()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/meetings/schedule'),
        expect.any(Object)
      )
    })
  })

  describe('getMeetingsForDay', () => {
    it('should fetch meetings for specific day of week', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ meetings: [], count: 0 }),
      })

      // Monday = 1
      await client.getMeetingsForDay(1, 'America/Chicago')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/meetings/schedule'),
        expect.any(Object)
      )
    })
  })
})

describe('getMeetingClient', () => {
  beforeEach(() => {
    resetMeetingClient()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    resetMeetingClient()
  })

  it('should return singleton instance', () => {
    const client1 = getMeetingClient()
    const client2 = getMeetingClient()

    expect(client1).toBe(client2)
  })

  it('should use environment variables for config', () => {
    vi.stubEnv('MEETING_API_URL', 'http://env-api:5000')
    vi.stubEnv('MEETING_API_TOKEN', 'env-token')

    resetMeetingClient()
    const client = getMeetingClient()

    expect(client).toBeDefined()
  })

  it('should create new instance when config provided', () => {
    const client1 = getMeetingClient()
    const client2 = getMeetingClient({ baseUrl: 'http://new-api:6000' })

    expect(client1).not.toBe(client2)
  })
})
