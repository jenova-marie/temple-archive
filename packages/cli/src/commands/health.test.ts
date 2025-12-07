import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    gray: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
  },
}))

// Mock ora
const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
}
vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}))

// Mock api
vi.mock('../api.js', () => ({
  checkHealth: vi.fn(),
  getMetrics: vi.fn(),
}))

// Mock config
vi.mock('../config.js', () => ({
  getApiUrl: vi.fn(() => 'http://localhost:3333'),
}))

// Mock console and process.exit
const originalConsole = { ...console }
const mockConsoleLog = vi.fn()
const mockConsoleError = vi.fn()
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

// Import after mocks
import { healthCommand, metricsCommand } from './health.js'
import { checkHealth, getMetrics } from '../api.js'

describe('health commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    console.log = mockConsoleLog
    console.error = mockConsoleError
  })

  afterEach(() => {
    console.log = originalConsole.log
    console.error = originalConsole.error
  })

  describe('healthCommand', () => {
    it('starts spinner when checking health', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 3600,
        version: '0.1.0',
      })

      await healthCommand()

      expect(mockSpinner.start).toHaveBeenCalled()
    })

    it('shows success spinner on healthy response', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 3600,
        version: '0.1.0',
      })

      await healthCommand()

      expect(mockSpinner.succeed).toHaveBeenCalledWith('API is healthy')
    })

    it('displays health information', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 3600,
        version: '0.1.0',
      })

      await healthCommand()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('API Health'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('healthy'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('0.1.0'))
    })

    it('displays formatted uptime', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 90061, // 1d 1h 1m 1s
        version: '0.1.0',
      })

      await healthCommand()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('1d 1h 1m 1s'))
    })

    it('formats uptime with only seconds', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 45,
        version: '0.1.0',
      })

      await healthCommand()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('45s'))
    })

    it('formats uptime with hours and minutes', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 7265, // 2h 1m 5s
        version: '0.1.0',
      })

      await healthCommand()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('2h 1m 5s'))
    })

    it('handles health check errors', async () => {
      ;(checkHealth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'))

      await healthCommand()

      expect(mockSpinner.fail).toHaveBeenCalledWith('API health check failed')
      expect(mockConsoleError).toHaveBeenCalledWith('Connection refused')
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe('metricsCommand', () => {
    it('starts spinner when fetching metrics', async () => {
      ;(getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue('# HELP test\n# TYPE test gauge')

      await metricsCommand()

      expect(mockSpinner.start).toHaveBeenCalled()
    })

    it('stops spinner after fetching metrics', async () => {
      ;(getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue('# HELP test\n# TYPE test gauge')

      await metricsCommand()

      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('displays metrics text', async () => {
      const metricsText = '# HELP recoverysky_uptime_seconds Uptime\nrecoverysky_uptime_seconds 12345'
      ;(getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue(metricsText)

      await metricsCommand()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('API Metrics'))
      expect(mockConsoleLog).toHaveBeenCalledWith(metricsText)
    })

    it('handles metrics fetch errors', async () => {
      ;(getMetrics as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Metrics unavailable'))

      await metricsCommand()

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to fetch metrics')
      expect(mockConsoleError).toHaveBeenCalledWith('Metrics unavailable')
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })
})
