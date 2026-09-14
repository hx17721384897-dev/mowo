import { defineStore } from 'pinia'
import {
  clearSession,
  readAccessToken,
  readCachedUser,
  saveAccessToken,
  saveCachedUser,
  type SessionUser
} from '@/services/auth-session'

export const useSessionStore = defineStore('session', {
  state: () => ({
    accessToken: readAccessToken() as string | null,
    user: readCachedUser() as SessionUser | null
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.accessToken),
    staffRole: (state) => state.user?.staffRole ?? null
  },
  actions: {
    establish(token: string, user: SessionUser) {
      saveAccessToken(token)
      saveCachedUser(user)
      this.accessToken = token
      this.user = user
    },
    reset() {
      clearSession()
      this.accessToken = null
      this.user = null
    }
  }
})
