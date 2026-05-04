import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MeetingGuide } from "@/components/chat/MeetingGuide";
import { Rosette } from "@/components/ui/rosette";
import { useChatStore } from "@/stores/chatStore";

export const Route = createFileRoute("/")({
  component: ChatPage,
});

function ChatPage() {
  const selectedGuideId = useChatStore((s) => s.selectedGuideId);
  const setGuide = useChatStore((s) => s.setGuide);
  const guides = useChatStore((s) => s.guides);
  const guidesLoading = useChatStore((s) => s.guidesLoading);
  const loadGuides = useChatStore((s) => s.loadGuides);

  // Load the live guides list from the API when the chat page mounts.
  // Auth is enforced by __root.tsx; this component only renders when authenticated.
  useEffect(() => {
    void loadGuides();
  }, [loadGuides]);

  const activeGuide =
    guides.find((g) => g.id === selectedGuideId) ?? guides[0];

  return (
    <div className="space-y-5">
      {/* Hero — the active guide presents themselves. Gold rosette ornament
          on the left, guide name in the temple-archive serif, description
          below in muted body text. Tight padding (p-5) so the chat thread
          dominates the page. */}
      <section className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-card via-card to-background/80 p-5 shadow-sm">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/10 ring-1 ring-gold/30">
              <Rosette className="h-5 w-5 text-gold" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-[1.75rem]">
                {activeGuide?.name ?? "Guide"}
              </h1>
              {activeGuide?.description && (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {activeGuide.description}
                </p>
              )}
            </div>
          </div>

          {/* Guide selector — labelless, compact pill */}
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            <label
              htmlFor="guide-select"
              className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70"
            >
              Guide
            </label>
            <select
              id="guide-select"
              value={selectedGuideId}
              onChange={(e) => setGuide(e.target.value)}
              disabled={guidesLoading}
              className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1 text-sm font-medium text-foreground shadow-none transition-colors hover:border-gold/40 hover:bg-background focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/30 disabled:opacity-60"
            >
              {guides.map((guide) => (
                <option key={guide.id} value={guide.id}>
                  {guide.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Subtle radial glow — pulled toward the right where the
            controls sit, like sunlight through a temple window. */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gold/[0.06] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-28 w-28 rounded-full bg-primary/[0.06] blur-2xl" />
      </section>

      <MeetingGuide />
    </div>
  );
}
