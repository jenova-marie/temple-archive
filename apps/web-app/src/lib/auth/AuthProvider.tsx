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
const DISABLE_AUTH = import.meta.env.VITE_DISABLE_AUTH === 'true'

const MOCK_DEV_USER: AuthUser = {
  access_token: 'dev-token',
  profile: {
    sub: 'dev-user',
    name: 'Development User',
    email: 'dev@localhost',
  },
}

function AuthStateSyncer({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0()
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
        if (!cancelled) setUser(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, user, getAccessTokenSilently, setUser])

  return <>{children}</>
}

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

function onRedirectCallback(appState?: AppState) {
  const returnTo =
    (appState?.returnTo as string | undefined) ||
    sessionStorage.getItem('auth_return_url') ||
    '/'
  sessionStorage.removeItem('auth_return_url')
  window.location.replace(returnTo)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (DISABLE_AUTH) {
    return <DevAuthBypass>{children}</DevAuthBypass>
  }

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

const MOCK_AUTH: UseAuthReturn = {
  isAuthenticated: true,
  isLoading: false,
  user: MOCK_DEV_USER,
  signinRedirect: () => Promise.resolve(),
  signoutRedirect: () => Promise.resolve(),
}

export function useAuth(): UseAuthReturn {
  if (DISABLE_AUTH) return MOCK_AUTH
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
