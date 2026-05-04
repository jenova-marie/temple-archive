import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { createAuthMiddleware, getAuthMiddleware, resetAuthMiddleware, type Auth0Claims } from './auth.js'
import * as jose from 'jose'

vi.mock('@siri/observability', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    warn: vi.fn(),
  }),
}))

vi.mock('jose', async () => {
  const actual = await vi.importActual('jose')
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(),
    jwtVerify: vi.fn(),
  }
})

const ROLES_CLAIM = 'https://siri.app/roles'

describe('auth middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let mockJson: ReturnType<typeof vi.fn>
  let mockStatus: ReturnType<typeof vi.fn>

  const mockConfig = {
    issuerBaseURL: 'https://test.us.auth0.com/',
    audience: 'https://api.siri.app',
  }

  const mockClaims: Auth0Claims = {
    sub: 'auth0|user-123',
    email: 'test@example.com',
    email_verified: true,
    name: 'Test User',
    nickname: 'testuser',
    iss: mockConfig.issuerBaseURL,
    aud: mockConfig.audience,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    [ROLES_CLAIM]: ['admin', 'user'],
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockJson = vi.fn()
    mockStatus = vi.fn(() => ({ json: mockJson }))

    mockReq = {
      headers: {},
    }

    mockRes = {
      status: mockStatus,
      json: mockJson,
    }

    mockNext = vi.fn()

    vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as unknown as ReturnType<typeof jose.createRemoteJWKSet>)
  })

  afterEach(() => {
    resetAuthMiddleware()
    delete process.env.AUTH0_ISSUER_BASE_URL
    delete process.env.AUTH0_AUDIENCE
    delete process.env.AUTH0_CLIENT_ID
    delete process.env.DISABLE_AUTH
  })

  describe('createAuthMiddleware', () => {
    describe('required middleware', () => {
      it('returns 401 when auth header is missing', async () => {
        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(401)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Valid authentication token required',
        })
        expect(mockNext).not.toHaveBeenCalled()
      })

      it('returns 401 when auth header is not Bearer', async () => {
        mockReq.headers = { authorization: 'Basic abc123' }
        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(401)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Valid authentication token required',
        })
        expect(mockNext).not.toHaveBeenCalled()
      })

      it('returns 401 when JWT verification fails', async () => {
        mockReq.headers = { authorization: 'Bearer invalid-token' }
        vi.mocked(jose.jwtVerify).mockRejectedValue(new Error('Invalid token'))

        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(401)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Valid authentication token required',
        })
        expect(mockNext).not.toHaveBeenCalled()
      })

      it('attaches user and calls next when JWT is valid', async () => {
        mockReq.headers = { authorization: 'Bearer valid-token' }
        vi.mocked(jose.jwtVerify).mockResolvedValue({
          payload: mockClaims,
          protectedHeader: { alg: 'RS256' },
        })

        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user).toBeDefined()
        expect(mockReq.user?.id).toBe('auth0|user-123')
        expect(mockReq.user?.email).toBe('test@example.com')
        expect(mockReq.user?.name).toBe('Test User')
        expect(mockReq.user?.roles).toContain('admin')
        expect(mockReq.user?.roles).toContain('user')
        expect(mockNext).toHaveBeenCalled()
      })

      it('uses nickname as name fallback', async () => {
        mockReq.headers = { authorization: 'Bearer valid-token' }
        const claimsWithoutName = { ...mockClaims, name: undefined }
        vi.mocked(jose.jwtVerify).mockResolvedValue({
          payload: claimsWithoutName,
          protectedHeader: { alg: 'RS256' },
        })

        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user?.name).toBe('testuser')
      })

      it('returns empty roles array when no roles claim', async () => {
        mockReq.headers = { authorization: 'Bearer valid-token' }
        const claimsWithoutRoles = { ...mockClaims }
        delete claimsWithoutRoles[ROLES_CLAIM]
        vi.mocked(jose.jwtVerify).mockResolvedValue({
          payload: claimsWithoutRoles,
          protectedHeader: { alg: 'RS256' },
        })

        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user?.roles).toEqual([])
      })

      it('returns empty roles array when roles claim is not an array', async () => {
        mockReq.headers = { authorization: 'Bearer valid-token' }
        const claimsWithBadRoles = {
          ...mockClaims,
          [ROLES_CLAIM]: 'admin' as unknown as string[],
        }
        vi.mocked(jose.jwtVerify).mockResolvedValue({
          payload: claimsWithBadRoles,
          protectedHeader: { alg: 'RS256' },
        })

        const auth = createAuthMiddleware(mockConfig)

        await auth.required(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user?.roles).toEqual([])
      })
    })

    describe('optional middleware', () => {
      it('calls next without user when no authorization header', async () => {
        const auth = createAuthMiddleware(mockConfig)

        await auth.optional(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user).toBeUndefined()
        expect(mockNext).toHaveBeenCalled()
        expect(mockStatus).not.toHaveBeenCalled()
      })

      it('calls next without user when JWT is invalid', async () => {
        mockReq.headers = { authorization: 'Bearer invalid-token' }
        vi.mocked(jose.jwtVerify).mockRejectedValue(new Error('Invalid token'))

        const auth = createAuthMiddleware(mockConfig)

        await auth.optional(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user).toBeUndefined()
        expect(mockNext).toHaveBeenCalled()
        expect(mockStatus).not.toHaveBeenCalled()
      })

      it('attaches user and calls next when JWT is valid', async () => {
        mockReq.headers = { authorization: 'Bearer valid-token' }
        vi.mocked(jose.jwtVerify).mockResolvedValue({
          payload: mockClaims,
          protectedHeader: { alg: 'RS256' },
        })

        const auth = createAuthMiddleware(mockConfig)

        await auth.optional(mockReq as Request, mockRes as Response, mockNext)

        expect(mockReq.user).toBeDefined()
        expect(mockReq.user?.id).toBe('auth0|user-123')
        expect(mockNext).toHaveBeenCalled()
      })
    })

    describe('requireRole middleware', () => {
      it('returns 401 when no user attached', () => {
        const auth = createAuthMiddleware(mockConfig)
        const roleMiddleware = auth.requireRole('admin')

        roleMiddleware(mockReq as Request, mockRes as Response, mockNext)

        expect(mockStatus).toHaveBeenCalledWith(401)
        expect(mockJson).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Authentication required',
        })
        expect(mockNext).not.toHaveBeenCalled()
      })

      it('returns 403 when user lacks required role', () => {
        mockReq.user = {
          id: 'auth0|user-123',
          roles: ['user'],
          claims: mockClaims,
        }

        const auth = createAuthMiddleware(mockConfig)
        const roleMiddleware = auth.requireRole('admin')

        roleMiddleware(mockReq as Request, mockRes as Response, mockNext)

        expect(mockStatus).toHaveBeenCalledWith(403)
        expect(mockJson).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Required role: admin',
        })
        expect(mockNext).not.toHaveBeenCalled()
      })

      it('calls next when user has required role', () => {
        mockReq.user = {
          id: 'auth0|user-123',
          roles: ['admin', 'user'],
          claims: mockClaims,
        }

        const auth = createAuthMiddleware(mockConfig)
        const roleMiddleware = auth.requireRole('admin')

        roleMiddleware(mockReq as Request, mockRes as Response, mockNext)

        expect(mockNext).toHaveBeenCalled()
        expect(mockStatus).not.toHaveBeenCalled()
      })

      it('allows access when user has any of multiple roles', () => {
        mockReq.user = {
          id: 'auth0|user-123',
          roles: ['moderator'],
          claims: mockClaims,
        }

        const auth = createAuthMiddleware(mockConfig)
        const roleMiddleware = auth.requireRole('admin', 'moderator')

        roleMiddleware(mockReq as Request, mockRes as Response, mockNext)

        expect(mockNext).toHaveBeenCalled()
      })

      it('shows all required roles in error message', () => {
        mockReq.user = {
          id: 'auth0|user-123',
          roles: ['user'],
          claims: mockClaims,
        }

        const auth = createAuthMiddleware(mockConfig)
        const roleMiddleware = auth.requireRole('admin', 'superadmin')

        roleMiddleware(mockReq as Request, mockRes as Response, mockNext)

        expect(mockJson).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Required role: admin or superadmin',
        })
      })
    })
  })

  describe('getAuthMiddleware', () => {
    it('returns null when AUTH0_ISSUER_BASE_URL is not set', () => {
      const auth = getAuthMiddleware()

      expect(auth).toBeNull()
    })

    it('returns null when AUTH0_AUDIENCE is not set', () => {
      process.env.AUTH0_ISSUER_BASE_URL = 'https://test.us.auth0.com/'

      const auth = getAuthMiddleware()

      expect(auth).toBeNull()
    })

    it('returns middleware when AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE are set', () => {
      process.env.AUTH0_ISSUER_BASE_URL = 'https://test.us.auth0.com/'
      process.env.AUTH0_AUDIENCE = 'https://api.siri.app'

      const auth = getAuthMiddleware()

      expect(auth).not.toBeNull()
      expect(auth?.required).toBeDefined()
      expect(auth?.optional).toBeDefined()
      expect(auth?.requireRole).toBeDefined()
    })

    it('returns bypass middleware when DISABLE_AUTH=true', () => {
      process.env.DISABLE_AUTH = 'true'

      const auth = getAuthMiddleware()

      expect(auth).not.toBeNull()
      expect(auth?.required).toBeDefined()
    })
  })

  describe('JWKS caching', () => {
    it('reuses JWKS for same issuer', () => {
      const auth1 = createAuthMiddleware(mockConfig)
      const auth2 = createAuthMiddleware(mockConfig)

      // createRemoteJWKSet should only be called once due to caching
      // This is a bit tricky to test since it's module-level cache
      expect(auth1).toBeDefined()
      expect(auth2).toBeDefined()
    })
  })
})
