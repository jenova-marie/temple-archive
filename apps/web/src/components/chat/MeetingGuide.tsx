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
      <div className="h-[calc(100vh-12rem)]">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  )
}
