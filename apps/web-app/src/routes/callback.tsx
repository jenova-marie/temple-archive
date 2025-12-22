import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useAuthStore } from '@/stores/authStore'

export const Route = createFileRoute('/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    // Log state for debugging
    console.log('[Callback] Auth state:', {
      isAuthenticated: auth.isAuthenticated,
      isLoading: auth.isLoading,
      hasUser: !!user,
      authUser: !!auth.user,
    })

    // Wait for auth to complete and user to be synced
    if (auth.isAuthenticated && user) {
      const returnUrl = sessionStorage.getItem('auth_return_after_callback') || '/'
      sessionStorage.removeItem('auth_return_after_callback')

      console.log('[Callback] ✓ Auth complete, redirecting to:', returnUrl)
      // Use TanStack Router navigation to properly sync state
      navigate({ to: returnUrl as any })
    } else if (!auth.isLoading && !auth.isAuthenticated && auth.user) {
      // Auth has completed but user is not authenticated - this shouldn't happen
      // unless there's an auth error
      console.error('[Callback] ✗ Unexpected state: auth.user exists but not authenticated')
    } else if (!auth.isLoading && !auth.isAuthenticated && !auth.user) {
      // Auth failed - redirect back to login
      console.warn('[Callback] ✗ Auth failed, redirecting to login')
      navigate({ to: '/login', search: { returnUrl: '/' } })
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.user, user, navigate])

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">
          {auth.isLoading ? 'Authenticating...' : 'Completing sign in...'}
        </p>
      </div>
    </div>
  )
}
