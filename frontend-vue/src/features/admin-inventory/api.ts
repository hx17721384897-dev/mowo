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
export type MaterialItem = {
  id: string
  name: string
  itemCode: string | null
  itemType: 'RAW' | 'PACKED' | 'CONSUMABLE'
  specification: string | null
  unit: string
  currentStock: number
  safetyStock: number
  leadTime: number
  note: string | null
  sourceMaterialId: string | null
  sourceQtyPerUnit: number | null
  sourceMaterialName: string | null
  consumed30d: number
  dailyConsumption: number
  availableDays: number | null
  alertLevel: AlertLevel
  boundSkuCount: number
}
export type MaterialLog = {
  id: string
  type: string
  quantity: number
  beforeQty: number
  afterQty: number
  referenceNo: string | null
  note: string | null
  createdAt: string
}
export type MaterialBinding = {
  id: string
  skuId: string
  qtyPerUnit: number
  modelName: string
  skuSpec: string
}
export type MaterialLot = {
  id: string
  batchNo?: string
  receiptNo?: string
  availableQty: number
  status: string
  location: string | null
  supplierName?: string | null
  supplierLotNo?: string | null
  outputQty?: number
  acceptedQty?: number
  createdAt: string
  note?: string | null
  inputs?: Array<{
    sourceBatchNo?: string | null
    sourceReceiptId?: string | null
    usedQty: number
    lossQty: number
  }>
}
export type MaterialAllocation = {
  sourceBatchId: string
  sourceType: 'RECEIPT' | 'PREPARATION'
  batchNo: string
  quantity: number
  availableQty: number
  location: string | null
}
export type MaterialPlan = {
  materialId: string
  materialName: string
  itemType: MaterialItem['itemType']
  unit: string
  requiredQty: number
  allocations: MaterialAllocation[]
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

export const loadMaterials = () => apiRequest<MaterialItem[]>('/api/materials')
export const loadMaterialLogs = (id: string) =>
  apiRequest<{ logs: MaterialLog[]; total: number; page: number }>(
    `/api/materials/${encodeURIComponent(id)}/logs`
  )
export const loadMaterialBindings = (id: string) =>
  apiRequest<MaterialBinding[]>(`/api/materials/${encodeURIComponent(id)}/bindings`)
export const loadMaterialLots = (materialId: string) =>
  apiRequest<{ material: MaterialItem; lots: MaterialLot[] }>(
    `/api/materials/lots?materialId=${encodeURIComponent(materialId)}`
  )
export const loadMaterialLot = (type: string, id: string) =>
  apiRequest<MaterialLot>(
    `/api/materials/lots/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  )
export const restockMaterial = (
  id: string,
  input: Record<string, unknown> & { clientRequestId: string }
) =>
  apiRequest<{ currentStock: number; receiptNo: string; reused: boolean }>(
    `/api/materials/${encodeURIComponent(id)}/restock`,
    { method: 'POST', body: input }
  )
export const previewPreparation = (
  id: string,
  input: {
    outputQty: number
    lossQty: number
    allocations?: Array<{ sourceBatchId: string; quantity: number }>
  }
) =>
  apiRequest<MaterialPlan & { outputQty: number; lossQty: number }>(
    `/api/materials/${encodeURIComponent(id)}/prepare-preview`,
    { method: 'POST', body: input }
  )
export const prepareMaterial = (
  id: string,
  input: Record<string, unknown> & { clientRequestId: string }
) =>
  apiRequest<{ batchNo: string; outputQty: number; reused: boolean }>(
    `/api/materials/${encodeURIComponent(id)}/prepare`,
    { method: 'POST', body: input }
  )
export const previewKitAssembly = (input: {
  skuId: string
  quantity: number
  allocations?: Array<{
    materialId: string
    allocations: Array<{ sourceBatchId: string; quantity: number }>
  }>
}) =>
  apiRequest<{ skuId: string; quantity: number; plan: MaterialPlan[] }>(
    '/api/inventory/kits/assemble-preview',
    { method: 'POST', body: input }
  )
export const assembleKit = (input: Record<string, unknown> & { clientRequestId: string }) =>
  apiRequest<{ batchNo: string; quantity: number; reused: boolean }>(
    '/api/inventory/kits/assemble',
    {
      method: 'POST',
      body: input
    }
  )
