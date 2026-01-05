import { useEffect, type ReactNode } from 'react'
import { AuthProvider as OidcAuthProvider, useAuth as useOidcAuth } from 'react-oidc-context'
import { oidcConfig } from './config'
import { useAuthStore } from '@/stores/authStore'
import type { User } from 'oidc-client-ts'

const ZITADEL_AUTHORITY = import.meta.env.VITE_ZITADEL_AUTHORITY
const DISABLE_AUTH = import.meta.env.VITE_DISABLE_AUTH === 'true'

// Mock user for development when auth is disabled
const MOCK_DEV_USER: User = {
  access_token: 'dev-token',
  token_type: 'Bearer',
  profile: {
    sub: 'dev-user',
    name: 'Development User',
    email: 'dev@localhost',
    iss: 'dev',
    aud: 'dev',
    exp: Math.floor(Date.now() / 1000) + 86400,
    iat: Math.floor(Date.now() / 1000),
  },
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  expired: false,
  scopes: ['openid', 'profile', 'email'],
  session_state: null,
  state: null,
  expires_in: 86400,
  toStorageString: () => JSON.stringify({}),
}

function AuthStateSyncer({ children }: { children: ReactNode }) {
  const auth = useOidcAuth()
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(auth.isLoading)
  }, [auth.isLoading, setLoading])

  useEffect(() => {
    if (!auth.user) {
      setUser(null)
      return
    }

    // Capture user to avoid potential null in async closure
    const user = auth.user

    // Fetch userinfo from Zitadel to get profile claims (name, email, etc)
    const fetchUserinfo = async () => {
      try {
        const userinfoUrl = `${ZITADEL_AUTHORITY?.replace(/\/$/, '') || 'https://auth.rso'}/oidc/v1/userinfo`

        const response = await fetch(userinfoUrl, {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
          },
        })

        if (response.ok) {
          const userinfo = await response.json()
          // Merge userinfo claims into the profile
          user.profile = {
            ...user.profile,
            ...userinfo,
          }
          console.log('[Auth] Userinfo fetched and merged:', user.profile)
        } else {
          console.warn('[Auth] Userinfo fetch failed:', response.status)
        }
      } catch (error) {
        console.error('[Auth] Failed to fetch userinfo:', error)
      } finally {
        setUser(user)
      }
    }

    fetchUserinfo()
  }, [auth.user, setUser])

  return <>{children}</>
}

// Bypass component that sets mock user when auth is disabled
function DevAuthBypass({ children }: { children: ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    console.warn('[Auth] ⚠️ VITE_DISABLE_AUTH=true - Using mock dev user')
    setLoading(false)
    setUser(MOCK_DEV_USER)
  }, [setUser, setLoading])

  return <>{children}</>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Bypass OIDC entirely when auth is disabled
  if (DISABLE_AUTH) {
    return <DevAuthBypass>{children}</DevAuthBypass>
  }

  return (
    <OidcAuthProvider {...oidcConfig}>
      <AuthStateSyncer>{children}</AuthStateSyncer>
    </OidcAuthProvider>
  )
}

// Re-export the useAuth hook - returns mock when auth disabled
export function useAuth() {
  if (DISABLE_AUTH) {
    return {
      isAuthenticated: true,
      isLoading: false,
      user: MOCK_DEV_USER,
      signinRedirect: () => Promise.resolve(),
      signoutRedirect: () => Promise.resolve(),
    }
  }
  return useOidcAuth()
}
