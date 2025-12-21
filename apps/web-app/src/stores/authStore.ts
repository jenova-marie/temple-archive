import { create } from 'zustand'
import type { User } from 'oidc-client-ts'

// Zitadel stores roles in this claim format
const ZITADEL_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  getAccessToken: () => string | null
  clearAuth: () => void
  hasRole: (role: string) => boolean
  getRoles: () => string[]
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  getAccessToken: () => {
    const { user } = get()
    return user?.access_token ?? null
  },

  clearAuth: () =>
    set({
      user: null,
      isAuthenticated: false,
      error: null,
    }),

  getRoles: () => {
    const { user } = get()
    if (!user?.profile) return []

    // Zitadel stores roles as an object with role names as keys
    // e.g., { "meeting_guide": { "org_id": "..." }, "admin": { ... } }
    const rolesObj = user.profile[ZITADEL_ROLES_CLAIM] as Record<string, unknown> | undefined
    if (!rolesObj || typeof rolesObj !== 'object') return []

    return Object.keys(rolesObj)
  },

  hasRole: (role: string) => {
    return get().getRoles().includes(role)
  },
}))
