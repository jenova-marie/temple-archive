import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

// Color presets with names and hue values
export const COLOR_PRESETS = [
  { name: 'Teal', hue: 195 },
  { name: 'Blue', hue: 240 },
  { name: 'Indigo', hue: 265 },
  { name: 'Purple', hue: 285 },
  { name: 'Pink', hue: 330 },
  { name: 'Rose', hue: 350 },
  { name: 'Orange', hue: 45 },
  { name: 'Amber', hue: 60 },
  { name: 'Green', hue: 145 },
  { name: 'Emerald', hue: 160 },
] as const

export const DEFAULT_HUE = 330 // Pink

interface ThemeState {
  theme: Theme
  primaryHue: number
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setPrimaryHue: (hue: number) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      primaryHue: DEFAULT_HUE,
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme, get().primaryHue)
      },
      toggleTheme: () => {
        const newTheme = get().theme === 'light' ? 'dark' : 'light'
        set({ theme: newTheme })
        applyTheme(newTheme, get().primaryHue)
      },
      setPrimaryHue: (hue) => {
        set({ primaryHue: hue })
        applyPrimaryHue(hue)
      },
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        // Apply theme after rehydration from localStorage
        if (state) {
          applyTheme(state.theme, state.primaryHue)
        }
      },
    }
  )
)

function applyTheme(theme: Theme, hue: number) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  applyPrimaryHue(hue)
}

function applyPrimaryHue(hue: number) {
  document.documentElement.style.setProperty('--primary-hue', hue.toString())
}

// Initialize theme on module load
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('theme-storage')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      applyTheme(state.theme ?? 'dark', state.primaryHue ?? DEFAULT_HUE)
    } catch {
      applyTheme('dark', DEFAULT_HUE)
    }
  } else {
    applyTheme('dark', DEFAULT_HUE)
  }
}
