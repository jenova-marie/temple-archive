import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GUIDES, DEFAULT_GUIDE_ID } from '@pippa/shared'
import type { Guide } from '@pippa/shared'

// Re-export for convenience
export { GUIDES, DEFAULT_GUIDE_ID }
export type { Guide }

interface ChatStore {
  selectedGuideId: string
  setGuide: (guideId: string) => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      selectedGuideId: DEFAULT_GUIDE_ID,
      setGuide: (guideId) => set({ selectedGuideId: guideId }),
    }),
    {
      name: 'chat-store',
    }
  )
)
