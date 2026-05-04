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
    useChatStore.setState({ selectedGuideId: 'sky' })

    renderHook(() => useMeetingGuideRuntime())

    // Verify transport was created with correct config
    expect(transportConstructorCalls.length).toBeGreaterThan(0)
    const config = transportConstructorCalls[0]
    expect(config.api).toContain('/api/v1/chat')
    expect(config.headers.Authorization).toBe(`Bearer ${mockAccessToken}`)
    // Guide is read fresh from the store on every send via
    // prepareSendMessagesRequest, so exercise that callback.
    const built = config.prepareSendMessagesRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    expect(built.body.guide).toBe('sky')
    expect(built.body.conversation_id).toBeDefined()
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
    // Defaults to a relative path so the SPA hits same-origin and goes
    // through Vite's /api proxy in dev / the reverse proxy in prod.
    expect(config.api).toMatch(/\/api\/v1\/chat$/)
  })

  it('includes selected guide in request body — and reflects live store changes', () => {
    useAuthStore.setState({
      user: { access_token: mockAccessToken } as any,
      isAuthenticated: true,
    })
    useChatStore.setState({ selectedGuideId: 'siri' })

    renderHook(() => useMeetingGuideRuntime())

    expect(transportConstructorCalls.length).toBeGreaterThan(0)
    const config = transportConstructorCalls[0]

    // Fresh send picks up current store value
    const firstSend = config.prepareSendMessagesRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    expect(firstSend.body.guide).toBe('siri')

    // Switch guide AFTER the transport was constructed — the next send must
    // use the updated value, not the closure-captured one. This is the
    // dropdown-doesn't-take-effect bug we hit in production.
    useChatStore.setState({ selectedGuideId: 'archivist' })
    const secondSend = config.prepareSendMessagesRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi 2' }] }],
    })
    expect(secondSend.body.guide).toBe('archivist')
  })

  it('generates unique conversation ID per hook instance', () => {
    useAuthStore.setState({
      user: { access_token: mockAccessToken } as any,
      isAuthenticated: true,
    })

    const first = renderHook(() => useMeetingGuideRuntime())
    const firstSend = transportConstructorCalls[0].prepareSendMessagesRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    const firstConversationId = firstSend.body.conversation_id

    // Clear and render again as a separate hook instance
    transportConstructorCalls.length = 0
    first.unmount()
    renderHook(() => useMeetingGuideRuntime())
    const secondSend = transportConstructorCalls[0].prepareSendMessagesRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    const secondConversationId = secondSend.body.conversation_id

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
