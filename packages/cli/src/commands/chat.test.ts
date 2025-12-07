import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock chalk to return strings
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    gray: (s: string) => s,
    red: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: (s: string) => s,
    blue: (s: string) => s,
    green: (s: string) => s,
    white: { bold: (s: string) => s },
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
  sendMessage: vi.fn(),
}))

// Mock config
vi.mock('../config.js', () => ({
  getConversationId: vi.fn(() => 'test-conv-id'),
  getUserId: vi.fn(() => 'test-user-id'),
  newConversation: vi.fn(() => 'new-conv-id'),
}))

// Mock console
const originalConsole = { ...console }
const mockConsoleLog = vi.fn()
const mockConsoleError = vi.fn()

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

// Import after mocks
import { chatCommand, displayDiagnostics, type ChatOptions, type DiagnosticsFlags } from './chat.js'
import { sendMessage } from '../api.js'
import type { ChatResponse } from '../api.js'

describe('chat command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    console.log = mockConsoleLog
    console.error = mockConsoleError
  })

  afterEach(() => {
    console.log = originalConsole.log
    console.error = originalConsole.error
  })

  const createMockResponse = (overrides: Partial<ChatResponse> = {}): ChatResponse => ({
    response: 'Hello! How can I help?',
    conversationId: 'test-conv-id',
    messageId: 'msg-123',
    crisisLevel: 1,
    emergencyTriggered: false,
    metrics: {
      totalDuration: 100,
      memoryDuration: 10,
      agentDuration: 80,
      tokensUsed: { input: 50, output: 100 },
      memorySource: 'L1',
    },
    ...overrides,
  })

  describe('chatCommand', () => {
    it('starts spinner when sending message', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createMockResponse())

      await chatCommand('Hello', {})

      expect(mockSpinner.start).toHaveBeenCalled()
    })

    it('stops spinner after response', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createMockResponse())

      await chatCommand('Hello', {})

      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('displays response text', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockResponse({ response: 'Test response' })
      )

      await chatCommand('Hello', {})

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Sky:'), 'Test response')
    })

    it('shows crisis level when elevated (4+)', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockResponse({ crisisLevel: 5 })
      )

      await chatCommand('Hello', {})

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('[Crisis Level: 5/10]'))
    })

    it('does not show crisis level when below 4', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockResponse({ crisisLevel: 3 })
      )

      await chatCommand('Hello', {})

      const calls = mockConsoleLog.mock.calls.flat()
      const hasCrisisLevel = calls.some((c: unknown) =>
        typeof c === 'string' && c.includes('Crisis Level')
      )
      expect(hasCrisisLevel).toBe(false)
    })

    it('shows emergency message when triggered', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockResponse({ emergencyTriggered: true, crisisLevel: 9 })
      )

      await chatCommand('Hello', {})

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('EMERGENCY PROTOCOL TRIGGERED')
      )
    })

    it('shows verbose metrics when --verbose flag', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createMockResponse())

      await chatCommand('Hello', { verbose: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('--- Metrics ---'))
    })

    it('handles API errors', async () => {
      ;(sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API failed'))

      await chatCommand('Hello', {})

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to send message')
      expect(mockConsoleError).toHaveBeenCalledWith('API failed')
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('calls displayDiagnostics with flags', async () => {
      const response = createMockResponse({
        diagnostics: {
          timing: {
            totalDuration: 100,
            crisisDuration: 5,
            memoryDuration: 10,
            agentDuration: 80,
            persistDuration: 5,
          },
          crisis: {
            level: 1,
            action: 'continue',
            processingTimeMs: 5,
            emergencyTriggered: false,
            patterns: [],
          },
          memory: {
            sourceTier: 'L1',
            cacheHits: 1,
            cacheMisses: 0,
            messagesRetrieved: 10,
            userProfileLoaded: true,
            previousSessionsCount: 0,
            semanticMatchesCount: 0,
            latencyMs: 10,
          },
          agent: {
            model: 'claude-sonnet-4',
            inputTokens: 50,
            outputTokens: 100,
            stopReason: 'end_turn',
            stepsCount: 1,
            toolCalls: [],
          },
        },
      })

      ;(sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(response)

      await chatCommand('Hello', { diagnostics: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Timing ==='))
    })
  })

  describe('displayDiagnostics', () => {
    const baseDiagnostics = {
      timing: {
        totalDuration: 100,
        crisisDuration: 5,
        memoryDuration: 10,
        agentDuration: 80,
        persistDuration: 5,
      },
      crisis: {
        level: 1,
        action: 'continue',
        processingTimeMs: 5,
        emergencyTriggered: false,
        patterns: [],
      },
      memory: {
        sourceTier: 'L1',
        cacheHits: 1,
        cacheMisses: 0,
        messagesRetrieved: 10,
        userProfileLoaded: true,
        previousSessionsCount: 0,
        semanticMatchesCount: 0,
        latencyMs: 10,
      },
      agent: {
        model: 'claude-sonnet-4',
        inputTokens: 50,
        outputTokens: 100,
        stopReason: 'end_turn',
        stepsCount: 1,
        toolCalls: [],
      },
    }

    it('shows message when no diagnostics available', () => {
      const response = createMockResponse()

      displayDiagnostics(response, { diagnostics: true })

      expect(mockConsoleLog).toHaveBeenCalledWith('No diagnostics available')
    })

    it('shows timing when --timing flag', () => {
      const response = createMockResponse({ diagnostics: baseDiagnostics })

      displayDiagnostics(response, { timing: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Timing ==='))
    })

    it('shows crisis when --crisis flag', () => {
      const response = createMockResponse({ diagnostics: baseDiagnostics })

      displayDiagnostics(response, { crisis: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Crisis Detection ==='))
    })

    it('shows memory when --memory flag', () => {
      const response = createMockResponse({ diagnostics: baseDiagnostics })

      displayDiagnostics(response, { memory: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Memory ==='))
    })

    it('shows agent when --agent flag', () => {
      const response = createMockResponse({ diagnostics: baseDiagnostics })

      displayDiagnostics(response, { agent: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Agent ==='))
    })

    it('shows all sections with --diagnostics flag', () => {
      const response = createMockResponse({ diagnostics: baseDiagnostics })

      displayDiagnostics(response, { diagnostics: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Timing ==='))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Crisis Detection ==='))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Memory ==='))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Agent ==='))
    })

    it('shows crisis patterns when detected', () => {
      const diagWithPatterns = {
        ...baseDiagnostics,
        crisis: {
          ...baseDiagnostics.crisis,
          level: 7,
          patterns: [
            { type: 'hopelessness', confidence: 0.8, matchedText: 'feeling hopeless' },
          ],
        },
      }
      const response = createMockResponse({ diagnostics: diagWithPatterns })

      displayDiagnostics(response, { crisis: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Patterns detected:'))
    })

    it('shows tool calls when present', () => {
      const diagWithTools = {
        ...baseDiagnostics,
        agent: {
          ...baseDiagnostics.agent,
          toolCalls: [
            { name: 'findMeetings', arguments: { location: 'NYC' } },
          ],
        },
      }
      const response = createMockResponse({ diagnostics: diagWithTools })

      displayDiagnostics(response, { agent: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Tool Calls:'))
    })

    it('shows safety section with --diagnostics', () => {
      const diagWithSafety = {
        ...baseDiagnostics,
        safety: {
          passed: true,
          processingTimeMs: 5,
          violations: [],
        },
      }
      const response = createMockResponse({ diagnostics: diagWithSafety })

      displayDiagnostics(response, { diagnostics: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Safety ==='))
    })

    it('shows evaluation section with --diagnostics', () => {
      const diagWithEval = {
        ...baseDiagnostics,
        evaluation: {
          qualityScore: 0.9,
          relevanceScore: 0.85,
          empathyScore: 0.88,
          recoveryScore: 0.82,
          overallScore: 0.86,
          feedback: 'Good response',
        },
      }
      const response = createMockResponse({ diagnostics: diagWithEval })

      displayDiagnostics(response, { diagnostics: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('=== Evaluation ==='))
    })
  })
})
