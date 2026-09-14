export const ACCESS_TOKEN_KEY = 'mowo_token'
export const USER_CACHE_KEY = 'mowo_user'

export interface SessionUser {
  id: string
  staffRole?: 'OWNER' | 'CUSTOMER_SERVICE' | 'PRODUCTION' | 'COLLAB_OPS' | null
  profile?: { nickname?: string | null; avatarUrl?: string | null } | null
}

export function readAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function saveAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export function readCachedUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_CACHE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    localStorage.removeItem(USER_CACHE_KEY)
    return null
  }
}

export function saveCachedUser(user: SessionUser): void {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user))
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(USER_CACHE_KEY)
}
