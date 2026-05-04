import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  // Auth0Provider exchanges the code and fires onRedirectCallback in AuthProvider.tsx;
  // this page just shows a loading spinner during that exchange.
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  )
}
