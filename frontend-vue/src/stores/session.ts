import { defineStore } from 'pinia'
import { getCurrentAccount } from '@/features/account/api'
import { ApiError } from '@/services/api-client'
import {
  clearSession,
  readAccessToken,
  readCachedUser,
  saveAccessToken,
  saveCachedUser,
  SESSION_CLEARED_EVENT,
  type SessionUser
} from '@/services/auth-session'

export type SessionStatus = 'unknown' | 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

let bootstrapPromise: Promise<void> | null = null

export const useSessionStore = defineStore('session', {
  state: () => ({
    accessToken: readAccessToken() as string | null,
    user: readCachedUser() as SessionUser | null,
    status: 'unknown' as SessionStatus,
    synchronizationStarted: false
  }),
  getters: {
    isAuthenticated: (state) => state.status === 'authenticated',
    staffRole: (state) => state.user?.staffRole ?? null
  },
  actions: {
    establish(token: string, user: SessionUser) {
      saveAccessToken(token)
      saveCachedUser(user)
      this.accessToken = token
      this.user = user
      this.status = 'authenticated'
    },
    updateUser(user: SessionUser) {
      saveCachedUser(user)
      this.user = user
    },
    markAnonymous() {
      this.accessToken = null
      this.user = null
      this.status = 'anonymous'
    },
    reset() {
      clearSession()
      this.markAnonymous()
    },
    startSynchronization() {
      if (this.synchronizationStarted) return
      window.addEventListener(SESSION_CLEARED_EVENT, () => this.markAnonymous())
      this.synchronizationStarted = true
    },
    async bootstrap(force = false): Promise<void> {
      if (!force && ['authenticated', 'anonymous'].includes(this.status)) return
      if (bootstrapPromise) return bootstrapPromise

      const token = readAccessToken()
      if (!token) {
        this.markAnonymous()
        return
      }

      this.status = 'checking'
      bootstrapPromise = (async () => {
        try {
          const user = await getCurrentAccount()
          const calibratedToken = readAccessToken()
          if (!calibratedToken) {
            this.markAnonymous()
            return
          }
          saveCachedUser(user)
          this.accessToken = calibratedToken
          this.user = user
          this.status = 'authenticated'
        } catch (cause) {
          if (cause instanceof ApiError && [401, 404].includes(cause.status)) {
            this.reset()
            return
          }
          this.accessToken = readAccessToken()
          this.status = 'unavailable'
        } finally {
          bootstrapPromise = null
        }
      })()
      return bootstrapPromise
    }
  }
})
