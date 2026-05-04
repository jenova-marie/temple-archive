import { create } from 'zustand'

const ROLES_CLAIM = 'https://siri.app/roles'

/**
 * Provider-agnostic auth user model the rest of the app reads from.
 * Mirrors OIDC convention: a profile blob plus the active access token.
 */
export interface AuthUserProfile {
  sub: string
  name?: string
  given_name?: string
  family_name?: string
  nickname?: string
  email?: string
  email_verified?: boolean
  picture?: string
  locale?: string
  [ROLES_CLAIM]?: string[]
  [key: string]: unknown
}

export interface AuthUser {
  access_token: string
  profile: AuthUserProfile
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  setUser: (user: AuthUser | null) => void
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

    const roles = user.profile[ROLES_CLAIM]
    return Array.isArray(roles) ? roles : []
  },

  hasRole: (role: string) => {
    return get().getRoles().includes(role)
  },
}))
