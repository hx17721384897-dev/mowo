import { apiBlobRequest, apiRequest } from '@/services/api-client'

export type ScanBatch = {
  id: string
  status: string
  createdAt: string
  total: number
  frameCompleted: number
  materialPicked: number
  paired: number
  packaged: number
  exceptions: number
}
export type ScanOverview = {
  batches: ScanBatch[]
  waitingSessions: number
  recent: Array<{
    action: string | null
    targetId: string | null
    createdAt: string
    userId: string
  }>
}
export type QueueItem = {
  sequence: number
  productionUnitId: string
  productionNo: string
  salesOrderNo: string
  framePackCode: string | null
  groupCode: string | null
  groupName: string
  specification: string
  pageCount: number | null
  printCopies: number
  frameStatus: string
  fileName: string | null
  downloadUrl: string | null
}
export type FrameQueue = { queue: QueueItem[] }
export type LookupResult = {
  type: string
  productionNo?: string
  specification?: string
  skuCode?: string
  freeQty?: number
}
export type FrameCompleteResult = {
  reused: boolean
  advanced: boolean
  changed: boolean
  frame: { status: string }
}
export type MaterialPick = {
  id: string
  sourceCode: string
  quantity: number
  remainingQty: number
  consumedQty: number
  returnedQty: number
  status: string
}
export type MaterialSource = {
  code: string
  skuCode: string
  specification: string | null
  pickedQty: number
  remainingQty: number
  consumedQty: number
}
export type PairingResult = { reused: boolean; sourceCode?: string }
export type PackingData = {
  order: {
    id: string
    orderNo: string
    receiverName: string
    fulfillmentStatus: string
    batchId: string
  }
  units: Array<{
    productionUnitId: string
    productionNo: string
    specification: string
    paired: boolean
    scanned: boolean
  }>
  complete: boolean
}
export type PackingSession = {
  id: string
  trackingNo: string
  status: string
  orderNo: string
  receiverName: string
  scanned: number
  total: number
  updatedAt: string
}

const base = '/api/admin/production-workflow'
export const loadScanOverview = () => apiRequest<ScanOverview>(`${base}/scan-overview`)
export const loadFrameQueue = (batchId: string) =>
  apiRequest<FrameQueue>(`${base}/frame-print-queue?batchId=${encodeURIComponent(batchId)}`)
export const lookupCode = (code: string) =>
  apiRequest<LookupResult>(`${base}/pairing/lookup/${encodeURIComponent(code)}`)
export const completeFramePack = (code: string, batchId: string) =>
  apiRequest<FrameCompleteResult>(`${base}/frame-packs/${encodeURIComponent(code)}/complete`, {
    method: 'POST',
    body: { batchId }
  })
export const loadMaterialPicks = (batchId: string) =>
  apiRequest<MaterialPick[]>(`${base}/material-picks?batchId=${encodeURIComponent(batchId)}`)
export const createMaterialPick = (batchId: string, kitCode: string, quantity: number) =>
  apiRequest(`${base}/material-picks`, { method: 'POST', body: { batchId, kitCode, quantity } })
export const loadMaterialSource = (code: string, batchId: string) =>
  apiRequest<MaterialSource>(
    `${base}/pairing/material-source/${encodeURIComponent(code)}?batchId=${encodeURIComponent(batchId)}`
  )
export const pairUnit = (batchId: string, framePackCode: string, kitCode: string) =>
  apiRequest<PairingResult>(`${base}/pairing`, {
    method: 'POST',
    body: { batchId, framePackCode, kitCode }
  })
export const loadPacking = (trackingNo: string, batchId: string) =>
  apiRequest<PackingData>(
    `${base}/packing/${encodeURIComponent(trackingNo)}?batchId=${encodeURIComponent(batchId)}`
  )
export const scanPackingUnit = (trackingNo: string, batchId: string, framePackCode: string) =>
  apiRequest<{ complete: boolean; orderNo: string }>(
    `${base}/packing/${encodeURIComponent(trackingNo)}/scan`,
    { method: 'POST', body: { batchId, framePackCode } }
  )
export const shipPackingOrder = (trackingNo: string) =>
  apiRequest<{ orderNo: string; batchId: string }>(
    `${base}/packing/${encodeURIComponent(trackingNo)}/ship`,
    { method: 'POST' }
  )
export const loadPackingSessions = (batchId: string) =>
  apiRequest<PackingSession[]>(`${base}/packing-sessions?batchId=${encodeURIComponent(batchId)}`)
export const downloadProductionLedger = (batchId: string) =>
  apiBlobRequest(`${base}/batches/${encodeURIComponent(batchId)}/production-ledger`, {
    timeoutMs: 30_000
  })
