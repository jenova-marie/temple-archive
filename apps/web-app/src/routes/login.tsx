import { useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth/AuthProvider'

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    returnUrl: (search.returnUrl as string) || '/',
  }),
})

function LoginPage() {
  const auth = useAuth()
  const { returnUrl } = Route.useSearch()
  // Fire signinRedirect once on mount, gated by a ref rather than auth
  // state. Earlier versions of this page checked `!isLoading &&
  // !isAuthenticated` before redirecting, which led to stuck spinners
  // whenever the Auth0 SDK and our store disagreed about whether the user
  // was authenticated — e.g. when the SDK held a cached user with no
  // refresh token (`Missing Refresh Token` from getAccessTokenSilently)
  // and the cache hadn't yet propagated to the store, or vice versa.
  //
  // The login page exists to start a login flow. If the user landed here,
  // they want in. Calling signinRedirect when "already authenticated" is
  // safe — Auth0 just performs silent SSO and bounces back. The ref
  // prevents the effect from re-firing if React re-renders the page
  // (e.g. because `auth` is a new object reference each render) before
  // the browser navigates away.
  const triggered = useRef(false)
  useEffect(() => {
    if (triggered.current) return
    triggered.current = true
    sessionStorage.setItem('auth_return_url', returnUrl)
    auth.signinRedirect({ returnUrl }).catch((err) => {
      console.error('[Auth] signinRedirect failed:', err)
      // Allow a retry on the next render if the call rejected — better to
      // try again than to leave the user wedged on this page.
      triggered.current = false
    })
  }, [auth, returnUrl])

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Redirecting to login...</p>
      </div>
    </div>
  )
}
