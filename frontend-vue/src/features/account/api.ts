import { apiRequest } from '@/services/api-client'
import { normalizeSessionUser, type SessionUser } from '@/services/auth-session'

export async function getCurrentAccount(): Promise<SessionUser> {
  const data = await apiRequest<unknown>('/api/v1/account/me')
  const user = normalizeSessionUser(data)
  if (!user) throw new Error('账户响应缺少有效的用户信息')
  return user
}

export async function logoutCurrentDevice(): Promise<void> {
  await apiRequest('/api/v1/auth/logout', { method: 'POST', retryAuth: false })
}

export async function logoutAllDevices(): Promise<void> {
  await apiRequest('/api/v1/auth/logout-all', { method: 'POST', retryAuth: false })
}
