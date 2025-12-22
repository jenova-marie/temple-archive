import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Guide } from "@pippa/shared";

const GUIDES: Guide[] = [
  {
    id: "pippa",
    name: "Pippa",
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
      selectedGuideId: "pippa",
      setGuide: (guideId) => set({ selectedGuideId: guideId }),
    }),
    {
      name: "chat-store",
    },
  ),
);

export { GUIDES };
export type { Guide };
