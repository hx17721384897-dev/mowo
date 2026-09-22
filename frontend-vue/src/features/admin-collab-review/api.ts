import { apiRequest } from '@/services/api-client'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface ReviewWork {
  id: string
  title: string
  orderNo?: string | null
  description?: string | null
  status: ReviewStatus
  createdAt: string
  approvedAt?: string | null
  rejectReason?: string | null
  coverUrl?: string | null
  animationFrames?: string[]
  hoverGifUrl?: string | null
  isOnShelf?: boolean
  creator?: { nickname?: string | null } | null
}

export interface ReviewPage {
  works: ReviewWork[]
  total: number
  page: number
  limit: number
}

export function safeReviewImage(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function listReviewWorks(
  status: ReviewStatus | '',
  page = 1,
  limit = 15
): Promise<ReviewPage> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) query.set('status', status)
  return apiRequest<ReviewPage>(`/api/admin/collab/works?${query}`)
}

export function getReviewWork(id: string): Promise<ReviewWork> {
  return apiRequest<ReviewWork>(`/api/admin/collab/works/${encodeURIComponent(id)}`)
}

export async function reviewWork(
  id: string,
  action: 'approve' | 'reject',
  rejectReason?: string
): Promise<void> {
  await apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/approve`, {
    method: 'PUT',
    body: { action, ...(action === 'reject' ? { rejectReason } : {}) }
  })
}

export async function regenerateReviewGif(id: string): Promise<void> {
  await apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/regen-gif`, { method: 'POST' })
}

export async function takeReviewWorkOffShelf(id: string): Promise<void> {
  await apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/shelf`, {
    method: 'PUT',
    body: { action: 'off' }
  })
}
