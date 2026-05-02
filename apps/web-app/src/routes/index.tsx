import { createFileRoute, Navigate } from "@tanstack/react-router";
import { MeetingGuide } from "@/components/chat/MeetingGuide";
import { MessageCircleIcon } from "lucide-react";
import { useChatStore, GUIDES } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/")({
  component: ChatPage,
});

function ChatPage() {
  const selectedGuideId = useChatStore((s) => s.selectedGuideId);
  const setGuide = useChatStore((s) => s.setGuide);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" search={{ returnUrl: "/" }} />;
  }

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8">
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <MessageCircleIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Siri
                </h1>
                <p className="text-sm text-muted-foreground">
                  Chat to help you find recovery meetings and explore
                  literature.
                </p>
              </div>
            </div>

            {/* Guide selector */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="guide-select"
                className="text-sm text-muted-foreground"
              >
                Guide:
              </label>
              <select
                id="guide-select"
                value={selectedGuideId}
                onChange={(e) => setGuide(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {GUIDES.map((guide) => (
                  <option key={guide.id} value={guide.id}>
                    {guide.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-primary/5 blur-xl" />
      </div>

      <MeetingGuide />
    </div>
  );
}
