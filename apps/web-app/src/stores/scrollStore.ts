import { create } from 'zustand'

interface ScrollStore {
  positions: Record<string, number>
  savePosition: (route: string, position: number) => void
  getPosition: (route: string) => number
}

export const useScrollStore = create<ScrollStore>((set, get) => ({
  positions: {},

  savePosition: (route: string, position: number) => {
    set((state) => ({
      positions: {
        ...state.positions,
        [route]: position,
      },
    }))
  },

  getPosition: (route: string) => {
    return get().positions[route] ?? 0
  },
}))
