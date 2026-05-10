import { useEffect, type ReactNode } from 'react'
import {
  Auth0Provider,
  useAuth0,
  type AppState,
} from '@auth0/auth0-react'
import { useAuthStore, type AuthUser } from '@/stores/authStore'

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE

if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_AUDIENCE) {
  throw new Error(
    'Auth0 configuration missing. Set VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, and VITE_AUTH0_AUDIENCE.',
  )
}

function AuthStateSyncer({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user, getAccessTokenSilently, logout } =
    useAuth0()
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(isLoading)
  }, [isLoading, setLoading])

  useEffect(() => {
    if (isLoading) return

    if (!isAuthenticated || !user) {
      setUser(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const accessToken = await getAccessTokenSilently()
        if (cancelled) return
        setUser({
          access_token: accessToken,
          profile: user as AuthUser['profile'],
        })
      } catch (error) {
        console.error('[Auth] Failed to acquire access token:', error)
        if (cancelled) return
        setUser(null)
        // CRITICAL: also clear the Auth0 SDK's own cache. Without this, the
        // SDK keeps reporting isAuthenticated=true (from its localStorage
        // copy of the stale user), while our store reports false. The two
        // diverge — __root.tsx (reading from the store) bounces to /login,
        // but LoginPage (reading from the SDK) sees isAuthenticated=true
        // and never fires loginWithRedirect, leaving the user stuck on a
        // "Redirecting to login..." spinner. Hitting logout({openUrl:false})
        // forces the SDK's cache into the same un-authenticated state our
        // store already holds, so loginWithRedirect can fire from /login.
        void logout({ openUrl: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, user, getAccessTokenSilently, setUser, logout])

  return <>{children}</>
}

function onRedirectCallback(appState?: AppState) {
  const returnTo =
    (appState?.returnTo as string | undefined) ||
    sessionStorage.getItem('auth_return_url') ||
    '/'
  sessionStorage.removeItem('auth_return_url')
  window.location.replace(returnTo)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: `${window.location.origin}/callback`,
        audience: AUTH0_AUDIENCE,
        scope: 'openid profile email offline_access',
      }}
      onRedirectCallback={onRedirectCallback}
      cacheLocation="localstorage"
      useRefreshTokens
    >
      <AuthStateSyncer>{children}</AuthStateSyncer>
    </Auth0Provider>
  )
}

interface UseAuthReturn {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  signinRedirect: (opts?: { returnUrl?: string }) => Promise<void>
  signoutRedirect: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const auth = useAuth0()
  const storeUser = useAuthStore((s) => s.user)

  return {
    isAuthenticated: auth.isAuthenticated,
    isLoading: auth.isLoading,
    user: storeUser,
    signinRedirect: (opts) =>
      auth.loginWithRedirect({
        appState: opts?.returnUrl ? { returnTo: opts.returnUrl } : undefined,
      }),
    signoutRedirect: () =>
      auth.logout({
        logoutParams: { returnTo: window.location.origin },
      }),
  }
}
