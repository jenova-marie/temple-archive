import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Guide } from "@siri/shared";

const GUIDES: Guide[] = [
  {
    id: "siri",
    name: "Siri",
    description: "Your personal AI companion",
  },
];

interface ChatStore {
  selectedGuideId: string;
  setGuide: (guideId: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      selectedGuideId: "siri",
      setGuide: (guideId) => set({ selectedGuideId: guideId }),
    }),
    {
      name: "chat-store",
    },
  ),
);

export { GUIDES };
export type { Guide };
