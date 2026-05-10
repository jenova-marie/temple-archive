import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useAuthStore } from '@/stores/authStore'

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    returnUrl: (search.returnUrl as string) || '/',
  }),
})

function LoginPage() {
  const auth = useAuth()
  const { returnUrl } = Route.useSearch()
  // Read auth state from the store — the same source __root.tsx uses to
  // decide whether to bounce here. Reading from useAuth() (which proxies
  // the Auth0 SDK directly) can disagree with the store when the SDK still
  // holds a stale cached user but our token-refresh has failed; that
  // disagreement is exactly how this page used to get stuck on its spinner.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    sessionStorage.setItem('auth_return_url', returnUrl)
    auth.signinRedirect({ returnUrl }).catch((err) => {
      console.error('[Auth] signinRedirect failed:', err)
    })
  }, [isLoading, isAuthenticated, auth, returnUrl])

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Redirecting to login...</p>
      </div>
    </div>
  )
}
