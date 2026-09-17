import { apiRequest } from '@/services/api-client'
import type { SessionProfile, SessionUser } from '@/services/auth-session'

export type SmsMode = 'LOGIN' | 'REGISTER'

export interface AuthResult {
  accessToken: string
  user: SessionUser
}

export async function sendSms(phone: string, mode: SmsMode): Promise<void> {
  await apiRequest('/api/v1/auth/sms/send', {
    method: 'POST',
    body: { phone, purpose: mode },
    retryAuth: false
  })
}

export async function verifySms(input: {
  phone: string
  code: string
  mode: SmsMode
  agreedToPrivacy: boolean
}): Promise<AuthResult> {
  const data = await apiRequest<{ accessToken?: string; token?: string; user?: SessionUser }>(
    '/api/v1/auth/sms/verify',
    {
      method: 'POST',
      body: input,
      retryAuth: false
    }
  )
  const accessToken = data.accessToken ?? data.token
  if (!accessToken || !data.user) throw new Error('登录响应缺少会话信息')
  return { accessToken, user: data.user }
}

export async function completeRegistrationProfile(
  accessToken: string,
  nickname: string
): Promise<SessionProfile> {
  return apiRequest<SessionProfile>('/api/v1/account/profile', {
    method: 'PUT',
    body: { nickname },
    headers: { Authorization: `Bearer ${accessToken}` },
    retryAuth: false
  })
}
