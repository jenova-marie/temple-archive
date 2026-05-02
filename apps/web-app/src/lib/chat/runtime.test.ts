import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuthStore } from '@/stores/authStore'
import { useChatStore } from '@/stores/chatStore'

// Track constructor calls
const transportConstructorCalls: any[] = []

// Mock the assistant-ui modules with proper class mock
vi.mock('@assistant-ui/react-ai-sdk', () => {
  return {
    useChatRuntime: vi.fn(() => ({ runtime: 'mocked' })),
    AssistantChatTransport: class MockAssistantChatTransport {
      config: any
      constructor(config: any) {
        this.config = config
        transportConstructorCalls.push(config)
      }
    },
  }
})

// Import after mocking
import { useMeetingGuideRuntime } from './runtime'

describe('useMeetingGuideRuntime', () => {
  const mockAccessToken = 'test-access-token-12345'

  beforeEach(() => {
    vi.clearAllMocks()
    transportConstructorCalls.length = 0 // Clear constructor calls
    // Reset stores to initial state
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({
      selectedGuideId: 'sky',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws error when user is not authenticated', () => {
    // User is not authenticated (default state)
    expect(() => {
      renderHook(() => useMeetingGuideRuntime())
    }).toThrow('Authentication required for chat')
  })

  it('creates transport with correct config when authenticated', () => {
    // Set up authenticated user
    useAuthStore.setState({
      user: {
        access_token: mockAccessToken,
        profile: { sub: 'user-123' },
      } as any,
      isAuthenticated: true,
      isLoading: false,
    })

    renderHook(() => useMeetingGuideRuntime())

    // Verify transport was created with correct config
    expect(transportConstructorCalls.length).toBeGreaterThan(0)
    const config = transportConstructorCalls[0]
    expect(config.api).toContain('/api/v1/chat')
    expect(config.headers.Authorization).toBe(`Bearer ${mockAccessToken}`)
    expect(config.body.guide).toBe('sky')
    expect(config.body.conversation_id).toBeDefined()
  })

  it('uses VITE_AUTH_CHAT_API_URL environment variable', () => {
    // Set up authenticated user
    useAuthStore.setState({
      user: {
        access_token: mockAccessToken,
        profile: { sub: 'user-123' },
      } as any,
      isAuthenticated: true,
    })

    renderHook(() => useMeetingGuideRuntime())

    expect(transportConstructorCalls.length).toBeGreaterThan(0)
    const config = transportConstructorCalls[0]
    // Should use env var or fallback
    expect(config.api).toMatch(/localhost.*\/api\/v1\/chat/)
  })

  it('includes selected guide in request body', () => {
    useAuthStore.setState({
      user: { access_token: mockAccessToken } as any,
      isAuthenticated: true,
    })
    useChatStore.setState({ selectedGuideId: 'siri' })

    renderHook(() => useMeetingGuideRuntime())

    expect(transportConstructorCalls.length).toBeGreaterThan(0)
    expect(transportConstructorCalls[0].body.guide).toBe('siri')
  })

  it('generates unique conversation ID per hook instance', () => {
    useAuthStore.setState({
      user: { access_token: mockAccessToken } as any,
      isAuthenticated: true,
    })

    renderHook(() => useMeetingGuideRuntime())
    const firstConversationId = transportConstructorCalls[0].body.conversation_id

    // Clear and render again
    transportConstructorCalls.length = 0
    renderHook(() => useMeetingGuideRuntime())
    const secondConversationId = transportConstructorCalls[0].body.conversation_id

    // Each hook instance should have a different conversation ID
    expect(firstConversationId).not.toBe(secondConversationId)
    expect(firstConversationId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
  })
})

describe('authStore.getAccessToken', () => {
  it('returns null when user is not set', () => {
    useAuthStore.setState({ user: null })
    expect(useAuthStore.getState().getAccessToken()).toBeNull()
  })

  it('returns access token when user is set', () => {
    const token = 'my-access-token'
    useAuthStore.setState({
      user: { access_token: token } as any,
    })
    expect(useAuthStore.getState().getAccessToken()).toBe(token)
  })
})
