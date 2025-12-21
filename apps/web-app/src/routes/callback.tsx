import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  // react-oidc-context handles the callback automatically via onSigninCallback in config
  // This page just shows a loading spinner while that happens
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  )
}
