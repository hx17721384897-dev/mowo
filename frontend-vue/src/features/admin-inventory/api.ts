import { apiRequest } from '@/services/api-client'

export type AlertLevel = 'OK' | 'SUGGEST' | 'WARNING' | 'CRITICAL'
export type InventoryLog = {
  id: string
  type: string
  quantity: number
  beforeQty: number | null
  afterQty: number | null
  reason: string | null
  note: string | null
  createdAt: string
}
export type InventoryRow = {
  skuId: string
  skuName: string
  skuCode: string | null
  skuBarcode: string | null
  modelName: string
  size: string
  material: string
  frameCount: number | string
  colorName: string
  colorHex: string
  currentStock: number
  reservedStock: number
  wipFrameQty: number
  wipKitQty: number
  availableQty: number
  availableStock: number
  safetyStock: number
  maxOrderLimit: number
  safetyFactor: number
  dailySales: number
  alertLevel: AlertLevel
}
export type InventoryDetail = InventoryRow & { logs: InventoryLog[] }
export type ChannelQuota = {
  skuId: string
  available: number
  bufferPool: number
  allocatable: number
  taobaoQty: number
  douyinQty: number
  xhsQty: number
}

export const loadInventory = () => apiRequest<InventoryRow[]>('/api/inventory')
export const loadInventoryDetail = (skuId: string) =>
  apiRequest<InventoryDetail>(`/api/inventory/${encodeURIComponent(skuId)}`)
export const loadChannelQuotas = () => apiRequest<ChannelQuota[]>('/api/inventory/channel-quotas')
export const adjustInventory = (
  skuId: string,
  input: { quantity: number; note?: string; clientRequestId: string }
) =>
  apiRequest<InventoryRow & { reused: boolean }>(
    `/api/inventory/${encodeURIComponent(skuId)}/restock`,
    { method: 'POST', body: input }
  )
export const saveInventorySettings = (
  skuId: string,
  input: { safetyStock?: number; maxOrderLimit?: number; safetyFactor?: number }
) =>
  apiRequest<InventoryRow>(`/api/inventory/${encodeURIComponent(skuId)}/settings`, {
    method: 'PUT',
    body: input
  })
