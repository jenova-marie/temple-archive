import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { Thread } from '@/components/assistant-ui/thread'
import { useMeetingGuideRuntime } from '@/lib/chat/runtime'

export function MeetingGuide() {
  let runtime
  try {
    runtime = useMeetingGuideRuntime()
  } catch (error) {
    return (
      <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
        <p className="text-destructive font-medium">Chat Error</p>
        <p className="text-sm text-muted-foreground">{String(error)}</p>
      </div>
    )
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* Dynamic viewport unit (dvh) tracks the *visible* viewport height
          on mobile — `vh` includes the URL bar's slot, which would push
          the composer past the bottom edge. Mobile also stacks the hero
          vertically (sm: breakpoint), so subtract a touch more there. */}
      <div className="h-[calc(100dvh-15rem)] pb-[env(safe-area-inset-bottom)] sm:h-[calc(100dvh-12rem)]">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  )
}
