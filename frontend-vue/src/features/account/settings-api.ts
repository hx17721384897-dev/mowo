import { apiRequest } from '@/services/api-client'
import type { SessionProfile } from '@/services/auth-session'

export interface ProfileInput {
  nickname: string
  bio: string
  gender: 0 | 1 | 2
  birthday: string | null
}

export interface PasswordStatus {
  hasPassword: boolean
  passwordLoginEnabled: boolean
}

export interface DeactivationCheck {
  canProceed: boolean
  issues: string[]
  blockers: Array<{ code?: string; message?: string }>
}

export interface DeactivationResult {
  scheduledAt: string
  graceMinutes: number
}

export async function checkNickname(nickname: string): Promise<boolean> {
  const data = await apiRequest<{ available?: boolean }>(
    `/api/v1/account/nickname-check?nickname=${encodeURIComponent(nickname)}`
  )
  if (typeof data.available !== 'boolean') throw new Error('昵称校验响应格式不正确')
  return data.available
}

export async function updateProfile(input: ProfileInput): Promise<SessionProfile> {
  return apiRequest<SessionProfile>('/api/v1/account/profile', {
    method: 'PUT',
    body: { ...input }
  })
}

export async function getPasswordStatus(): Promise<PasswordStatus> {
  const data = await apiRequest<Partial<PasswordStatus>>('/api/v1/account/password-status')
  if (typeof data.hasPassword !== 'boolean' || typeof data.passwordLoginEnabled !== 'boolean') {
    throw new Error('密码状态响应格式不正确')
  }
  return data as PasswordStatus
}

export async function updatePassword(input: {
  currentPassword?: string
  newPassword: string
}): Promise<void> {
  await apiRequest('/api/v1/account/password', { method: 'POST', body: { ...input } })
}

export async function sendCurrentPhoneCode(): Promise<void> {
  await apiRequest('/api/v1/account/phone/send-old-otp', { method: 'POST' })
}

export async function verifyCurrentPhone(code: string): Promise<string> {
  const data = await apiRequest<{ actionToken?: string }>('/api/v1/account/phone/verify-old', {
    method: 'POST',
    body: { code }
  })
  if (!data.actionToken) throw new Error('手机号验证响应缺少操作凭证')
  return data.actionToken
}

export async function sendNewPhoneCode(newPhone: string): Promise<void> {
  await apiRequest('/api/v1/account/phone/send-new-otp', {
    method: 'POST',
    body: { newPhone }
  })
}

export async function changePhone(input: {
  newPhone: string
  newOtp: string
  actionToken: string
}): Promise<void> {
  await apiRequest('/api/v1/account/phone/change', { method: 'POST', body: { ...input } })
}

export async function checkDeactivation(): Promise<DeactivationCheck> {
  const data = await apiRequest<DeactivationCheck>('/api/v1/account/deactivate/check')
  if (!Array.isArray(data.issues) || typeof data.canProceed !== 'boolean') {
    throw new Error('注销检查响应格式不正确')
  }
  return { ...data, blockers: Array.isArray(data.blockers) ? data.blockers : [] }
}

export async function sendDeactivationCode(): Promise<void> {
  await apiRequest('/api/v1/account/deactivate/send-otp', { method: 'POST' })
}

export async function applyDeactivation(otp: string): Promise<DeactivationResult> {
  const data = await apiRequest<Partial<DeactivationResult>>('/api/v1/account/deactivate/apply', {
    method: 'POST',
    body: { otp }
  })
  if (typeof data.scheduledAt !== 'string' || typeof data.graceMinutes !== 'number') {
    throw new Error('注销申请响应格式不正确')
  }
  return data as DeactivationResult
}

export async function cancelDeactivation(): Promise<void> {
  await apiRequest('/api/v1/account/deactivate/cancel', { method: 'POST' })
}
