export const ACCESS_TOKEN_KEY = 'mowo_token'
export const USER_CACHE_KEY = 'mowo_user'
export const SESSION_CLEARED_EVENT = 'mowo:session-cleared'

export type StaffRole = 'OWNER' | 'CUSTOMER_SERVICE' | 'PRODUCTION' | 'COLLAB_OPS'

export interface SessionProfile {
  nickname?: string | null
  avatarUrl?: string | null
  bio?: string | null
  gender?: number | null
  birthday?: string | null
  nicknameUpdatedAt?: string | null
  notifyOrder?: boolean
  notifySystem?: boolean
}

export interface SessionUser {
  id: string
  phone?: string
  maskedPhone?: string | null
  role?: number
  staffRole?: StaffRole | null
  status?: string
  createdAt?: string
  deletionRequest?: AccountDeletionRequest | null
  nickname?: string | null
  avatarUrl?: string | null
  profile?: SessionProfile | null
}

export interface AccountDeletionRequest {
  status: string
  requestedAt?: string
  scheduledAt?: string
  processingStartedAt?: string | null
  firstFailedAt?: string | null
  manualReviewAt?: string | null
  pauseUserMessage?: string | null
  protectionMinutesLeft?: number | null
  cleanupStarted?: boolean
  canCancel?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined
}

function normalizeProfile(value: unknown): SessionProfile | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  return {
    nickname: optionalString(value.nickname),
    avatarUrl: optionalString(value.avatarUrl),
    bio: optionalString(value.bio),
    gender: typeof value.gender === 'number' || value.gender === null ? value.gender : undefined,
    birthday: optionalString(value.birthday),
    nicknameUpdatedAt: optionalString(value.nicknameUpdatedAt),
    notifyOrder: typeof value.notifyOrder === 'boolean' ? value.notifyOrder : undefined,
    notifySystem: typeof value.notifySystem === 'boolean' ? value.notifySystem : undefined
  }
}

export function normalizeSessionUser(value: unknown): SessionUser | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null
  const staffRoles: StaffRole[] = ['OWNER', 'CUSTOMER_SERVICE', 'PRODUCTION', 'COLLAB_OPS']
  const staffRole = staffRoles.includes(value.staffRole as StaffRole)
    ? (value.staffRole as StaffRole)
    : value.staffRole === null
      ? null
      : undefined
  return {
    id: value.id,
    phone: typeof value.phone === 'string' ? value.phone : undefined,
    maskedPhone: optionalString(value.maskedPhone),
    role: typeof value.role === 'number' ? value.role : undefined,
    staffRole,
    status: typeof value.status === 'string' ? value.status : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    deletionRequest: normalizeDeletionRequest(value.deletionRequest),
    nickname: optionalString(value.nickname),
    avatarUrl: optionalString(value.avatarUrl),
    profile: normalizeProfile(value.profile)
  }
}

function normalizeDeletionRequest(value: unknown): AccountDeletionRequest | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || typeof value.status !== 'string') return undefined
  return {
    status: value.status,
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : undefined,
    scheduledAt: typeof value.scheduledAt === 'string' ? value.scheduledAt : undefined,
    processingStartedAt: optionalString(value.processingStartedAt),
    firstFailedAt: optionalString(value.firstFailedAt),
    manualReviewAt: optionalString(value.manualReviewAt),
    pauseUserMessage: optionalString(value.pauseUserMessage),
    protectionMinutesLeft:
      typeof value.protectionMinutesLeft === 'number' ? value.protectionMinutesLeft : undefined,
    cleanupStarted: typeof value.cleanupStarted === 'boolean' ? value.cleanupStarted : undefined,
    canCancel: typeof value.canCancel === 'boolean' ? value.canCancel : undefined
  }
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
    const user = normalizeSessionUser(JSON.parse(raw))
    if (!user) localStorage.removeItem(USER_CACHE_KEY)
    return user
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
  window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))
}
