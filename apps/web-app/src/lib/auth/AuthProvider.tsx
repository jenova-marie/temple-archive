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
    if (auth.user?.profile) {
      console.log('[Auth] User profile claims:', auth.user.profile)
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
