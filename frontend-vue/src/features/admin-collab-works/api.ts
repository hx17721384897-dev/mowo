import { apiRequest } from '@/services/api-client'
import type { ReviewWork } from '@/features/admin-collab-review/api'

export type ShelfStatus = 'on_sale' | 'suspended' | 'off_shelf'
export interface ManagedCollabWork extends ReviewWork {
  shelfStatus: ShelfStatus | null
  offShelfType?: string | null
  offShelfReason?: string | null
  offShelfNotice?: string | null
  suspendedAt?: string | null
  sizes?: string[] | string | null
  saleConfigCount?: number
  saleSkus?: unknown[]
  saleReadiness?: { ready: boolean; blockers?: string[] }
}
export interface FramePack {
  size: string
  stockType: 'on_demand' | 'stocked'
  currentStock: number
  reservedStock: number
}

export function sizesOf(work: ManagedCollabWork): string[] {
  try {
    const value = typeof work.sizes === 'string' ? JSON.parse(work.sizes) : work.sizes
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
export async function listManagedCollabWorks(): Promise<ManagedCollabWork[]> {
  const data = await apiRequest<{ works: ManagedCollabWork[] }>('/api/admin/collab/works?limit=200')
  return data.works.filter((work) => work.status === 'approved')
}
export function getManagedCollabWork(id: string): Promise<ManagedCollabWork> {
  return apiRequest(`/api/admin/collab/works/${encodeURIComponent(id)}`)
}
export function listFramePacks(id: string): Promise<FramePack[]> {
  return apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/frame-packs`)
}
export async function changeCollabShelf(
  id: string,
  action: 'suspend' | 'resume' | 'force-delist' | 'relist',
  body: Record<string, unknown> = {}
): Promise<void> {
  await apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/${action}`, { method: 'PUT', body })
}
export async function setFramePackType(
  id: string,
  size: string,
  stockType: FramePack['stockType']
): Promise<void> {
  await apiRequest(
    `/api/admin/collab/${encodeURIComponent(id)}/frame-packs/${encodeURIComponent(size)}`,
    { method: 'PUT', body: { stockType } }
  )
}
export async function restockFramePack(id: string, size: string, quantity: number): Promise<void> {
  await apiRequest(
    `/api/admin/collab/${encodeURIComponent(id)}/frame-packs/${encodeURIComponent(size)}/restock`,
    { method: 'POST', body: { quantity } }
  )
}
