import { useEffect, type ReactNode } from 'react'
import { AuthProvider as OidcAuthProvider, useAuth as useOidcAuth } from 'react-oidc-context'
import { oidcConfig } from './config'
import { useAuthStore } from '@/stores/authStore'

const ZITADEL_AUTHORITY = import.meta.env.VITE_ZITADEL_AUTHORITY

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

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <OidcAuthProvider {...oidcConfig}>
      <AuthStateSyncer>{children}</AuthStateSyncer>
    </OidcAuthProvider>
  )
}

// Re-export the useAuth hook for convenience
export { useOidcAuth as useAuth }
