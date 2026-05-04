import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Guide } from "@siri/shared";
import { fetchGuides } from "@/lib/api/guides";

/**
 * Fallback list used until the server's `/api/v1/guides` responds — and
 * if that request fails entirely, we keep showing this so the dropdown
 * isn't empty.
 */
const FALLBACK_GUIDES: Guide[] = [
  {
    id: "siri",
    name: "Siri",
    description: "Your personal AI companion",
  },
];

interface ChatStore {
  selectedGuideId: string;
  guides: Guide[];
  guidesLoading: boolean;
  guidesError: string | null;
  setGuide: (guideId: string) => void;
  loadGuides: () => Promise<void>;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      selectedGuideId: "siri",
      guides: FALLBACK_GUIDES,
      guidesLoading: false,
      guidesError: null,
      setGuide: (guideId) => set({ selectedGuideId: guideId }),
      loadGuides: async () => {
        if (get().guidesLoading) return;
        set({ guidesLoading: true, guidesError: null });
        try {
          const guides = await fetchGuides();
          // Empty server list still beats the fallback if the user is
          // intentionally curating guides DB-side; but we keep a single
          // entry so the dropdown can never disappear entirely.
          set({
            guides: guides.length > 0 ? guides : FALLBACK_GUIDES,
            guidesLoading: false,
          });
        } catch (error) {
          console.warn("[chatStore] Failed to load guides:", error);
          set({
            guidesError:
              error instanceof Error ? error.message : "Failed to load guides",
            guidesLoading: false,
          });
        }
      },
    }),
    {
      name: "chat-store",
      // Only persist the user's selection; guides themselves come from the
      // server on mount so we don't show stale entries after a DB change.
      partialize: (state) => ({ selectedGuideId: state.selectedGuideId }),
    },
  ),
);

// Re-export the type and a `GUIDES` symbol for backward compatibility with
// any existing import sites. Reads come through the store instead.
export const GUIDES: Guide[] = FALLBACK_GUIDES;
export type { Guide };
