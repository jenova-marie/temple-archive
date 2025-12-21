import { useEffect, type ReactNode } from 'react'
import { AuthProvider as OidcAuthProvider, useAuth as useOidcAuth } from 'react-oidc-context'
import { oidcConfig, isAuthEnabled } from './config'
import { useAuthStore } from '@/stores/authStore'

function AuthStateSyncer({ children }: { children: ReactNode }) {
  const auth = useOidcAuth()
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(auth.isLoading)
  }, [auth.isLoading, setLoading])

  useEffect(() => {
    setUser(auth.user ?? null)

    // Debug: Check if access token is a JWT
    if (auth.user?.access_token) {
      const token = auth.user.access_token
      const isJwt = token.split('.').length === 3
      console.log('[Auth] Access token type:', isJwt ? 'JWT' : 'Opaque')
      console.log('[Auth] Token preview:', token.substring(0, 50) + '...')
      if (isJwt) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]))
          console.log('[Auth] JWT payload:', payload)
        } catch (e) {
          console.log('[Auth] Failed to decode JWT payload')
        }
      }
    }
  }, [auth.user, setUser])

  return <>{children}</>
}

function NoAuthProvider({ children }: { children: ReactNode }) {
  // Set default dev user when auth is disabled
  const setUser = useAuthStore((s) => s.setUser)

  useEffect(() => {
    setUser({
      // Required IdTokenClaims fields
      sub: 'dev-user',
      iss: 'dev-issuer',
      aud: 'dev-audience',
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
      iat: Math.floor(Date.now() / 1000),
      // Optional profile fields
      profile: {
        name: 'Dev User',
        email: 'dev@local',
      },
    } as any)
  }, [setUser])

  return <>{children}</>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!isAuthEnabled) {
    console.log('[Auth] Auth disabled - using dev mode')
    return <NoAuthProvider>{children}</NoAuthProvider>
  }

  return (
    <OidcAuthProvider {...oidcConfig}>
      <AuthStateSyncer>{children}</AuthStateSyncer>
    </OidcAuthProvider>
  )
}

// Custom hook that handles both auth-enabled and auth-disabled modes
export function useAuth() {
  if (!isAuthEnabled) {
    // Return mock auth object when auth is disabled
    return {
      isLoading: false,
      isAuthenticated: true,
      user: null,
      activeNavigator: null,
      signinSilent: async () => {},
      signinPopup: async () => {},
      signinRedirect: async () => {},
      signoutRedirect: async () => {},
      signoutPopup: async () => {},
      signinSilentCallback: async () => {},
      removeUser: async () => {},
    }
  }

  return useOidcAuth()
}
