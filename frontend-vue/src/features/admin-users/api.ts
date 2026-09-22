import { apiRequest } from '@/services/api-client'
import type { StaffRole } from '@/services/auth-session'

export interface ManagedUser {
  id: string
  phone: string | null
  role: number
  staffRole: StaffRole | null
  isBanned: boolean
  status: string
  createdAt: string
  profile: { nickname: string | null; avatarUrl: string | null } | null
}

export interface UserPage {
  users: ManagedUser[]
  pagination: { page: number; limit: number; total: number }
}

export async function listManagedUsers(
  page: number,
  staffRole: StaffRole | 'USER' | ''
): Promise<UserPage> {
  const query = new URLSearchParams({ page: String(page), limit: '20' })
  if (staffRole === 'USER') query.set('role', '0')
  else if (staffRole) query.set('staffRole', staffRole)
  return apiRequest<UserPage>(`/api/admin/users?${query}`)
}

export async function setManagedStaffRole(id: string, staffRole: StaffRole | null): Promise<void> {
  await apiRequest(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PUT',
    body: { staffRole }
  })
}

export async function setManagedBan(id: string, isBanned: boolean): Promise<void> {
  await apiRequest(`/api/admin/users/${encodeURIComponent(id)}/ban`, {
    method: 'PUT',
    body: { isBanned }
  })
}
