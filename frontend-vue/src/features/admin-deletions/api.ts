import { apiRequest } from '@/services/api-client'

export type DeletionStatus =
  | 'REQUESTED'
  | 'PROCESSING'
  | 'FAILED'
  | 'MANUAL_REVIEW'
  | 'PAUSED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'COMPLETED'
export interface DeletionTask {
  id: string
  userId: string
  user: { nickname: string | null; phone: string | null } | null
  status: DeletionStatus
  requestedAt: string
  elapsedHours: number
  attemptCount: number
  lastError: string | null
  blockers: Array<{ message: string }> | null
  pauseReason: string | null
  pauseUserMessage: string | null
  protectionMinutesLeft: number
  canUserCancel: boolean
  alertLevel: 'NORMAL' | 'ATTENTION' | 'URGENT' | 'OVERDUE'
}
export interface DeletionPage {
  items: DeletionTask[]
  summary: Partial<Record<DeletionStatus | 'PROTECTION', number>>
  canManage: boolean
  pagination: { page: number; limit: number; total: number }
}
export async function listDeletionTasks(
  page: number,
  status: DeletionStatus | '',
  search: string
): Promise<DeletionPage> {
  const query = new URLSearchParams({ page: String(page), limit: '20' })
  if (status) query.set('status', status)
  if (search.trim()) query.set('search', search.trim())
  return apiRequest<DeletionPage>(`/api/admin/account-deletions?${query}`)
}
export async function actOnDeletion(
  id: string,
  action: 'retry' | 'pause' | 'resume',
  body?: { reason: string; userMessage: string }
): Promise<void> {
  await apiRequest(`/api/admin/account-deletions/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    ...(body ? { body } : {})
  })
}
