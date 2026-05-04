import { useEffect } from 'react'
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

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      sessionStorage.setItem('auth_return_url', returnUrl)
      auth.signinRedirect({ returnUrl })
    }
  }, [auth.isLoading, auth.isAuthenticated, auth, returnUrl])

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Redirecting to login...</p>
      </div>
    </div>
  )
}
