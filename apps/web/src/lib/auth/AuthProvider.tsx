import { useEffect, type ReactNode } from 'react'
import { AuthProvider as OidcAuthProvider, useAuth as useOidcAuth } from 'react-oidc-context'
import { oidcConfig } from './config'
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

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <OidcAuthProvider {...oidcConfig}>
      <AuthStateSyncer>{children}</AuthStateSyncer>
    </OidcAuthProvider>
  )
}

// Re-export the useAuth hook for convenience
export { useOidcAuth as useAuth }
