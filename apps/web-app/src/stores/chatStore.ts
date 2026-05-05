import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Guide } from "@siri/shared";
import { fetchGuides } from "@/lib/api/guides";

interface ChatStore {
  selectedGuideId: string;
  guides: Guide[];
  guidesLoading: boolean;
  guidesError: string | null;
  totalPrivacy: boolean;
  setGuide: (guideId: string) => void;
  setTotalPrivacy: (value: boolean) => void;
  loadGuides: () => Promise<void>;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      selectedGuideId: "",
      guides: [],
      guidesLoading: false,
      guidesError: null,
      totalPrivacy: false,
      setGuide: (guideId) => set({ selectedGuideId: guideId }),
      setTotalPrivacy: (value) => set({ totalPrivacy: value }),
      loadGuides: async () => {
        if (get().guidesLoading) return;
        set({ guidesLoading: true, guidesError: null });
        try {
          const guides = await fetchGuides();
          set((state) => ({
            guides,
            guidesLoading: false,
            // If the persisted selection isn't in the freshly-loaded list
            // (or nothing was selected), fall back to the first guide so
            // the UI has something to render.
            selectedGuideId:
              state.selectedGuideId &&
              guides.some((g) => g.id === state.selectedGuideId)
                ? state.selectedGuideId
                : guides[0]?.id ?? "",
          }));
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
      partialize: (state) => ({
        selectedGuideId: state.selectedGuideId,
        totalPrivacy: state.totalPrivacy,
      }),
    },
  ),
);

export type { Guide };
