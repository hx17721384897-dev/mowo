import { apiEnvelopeRequest, apiRequest } from '@/services/api-client'

export type Issue = { code: string; message: string }
export type Progress = {
  total: number
  frameCompleted: number
  materialPicked: number
  paired: number
  packaged: number
  exceptions: number
}
export type BatchSummary = {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  salesOrderCount: number
  productionUnitCount: number
  skuCount: number
  warningCount: number
  progress: Progress
  legacy: boolean
}
export type Candidate = {
  id: string
  orderNo: string
  receiverName: string
  itemCount: number
  productionUnitCount: number
  estimatedPrintPages: number
  unconfiguredPrintUnitCount: number
  ready: boolean
  hardBlocks: Issue[]
  warnings: Issue[]
  matchedUnitCount: number
  extraUnitCount: number
  includesUnmatchedItems: boolean
}
export type CandidateMeta = {
  totalOrders: number
  totalUnits: number
  models: { id: string; name: string }[]
  skus: {
    id: string
    code: string | null
    modelId: string
    modelName: string
    size: string
    frameCount: number
  }[]
  sizes: string[]
  frameCounts: number[]
  printGroups: { id: string; name: string; size: string }[]
}
export type CandidateFilters = {
  paidFrom: string
  paidTo: string
  orderNo: string
  platform: string
  modelId: string
  skuId: string
  size: string
  frameCount: string
  printGroupId: string
  readyOnly: boolean
  kitAvailableOnly: boolean
}
export type Workflow = {
  frameStatus: string
  materialStatus: string
  pairingStatus: string
  packageStatus: string
}
export type BatchUnit = {
  id: string
  productionNo: string
  specification: string
  workflow: Workflow | null
  framePack: { code: string } | null
}
export type BatchOrder = {
  id: string
  orderNo: string
  receiverName: string
  receiverPhone: string
  receiverCity: string
  receiverAddress: string
  fulfillmentStatus: string
  trackingNo: string | null
  trackingCompany: string | null
  items: { id: string; title: string; quantity: number; productionUnits: BatchUnit[] }[]
}
export type ProductionFile = {
  id: string
  displayName: string
  targetFrameCount: number
  sourceType: string
  createdAt: string
  downloadUrl: string
}
export type ReprintRow = {
  id: string
  revisionNo: number
  productionNo: string
  specification: string
  oldFramePackCode: string
  newFramePackCode: string
  requestedPages: number[]
  reason: string
  requestedByName: string
  createdAt: string
  newFramePackStatus: string
  pairingStatus: string
  packageStatus: string
  productionPrintFileId: string | null
}
export type BatchDetail = {
  batch: {
    id: string
    status: string
    createdAt: string
    salesOrderCount: number
    productionUnitCount: number
    skuCount: number
    warnings: Issue[]
  }
  progress: Progress
  ledgerCheck: { currentMarker: string; reprintCount: number }
  reprintTimeline: ReprintRow[]
  materialDemand: {
    skuId: string
    skuCode: string | null
    required: number
    available: number
    picked: number
  }[]
  productionFiles: ProductionFile[]
  printQueue: {
    productionUnitId: string
    productionNo: string
    sequence: number | null
    groupName: string | null
    pageCount: number | null
    rule: { size?: string; frameCount?: number } | null
  }[]
  orders: BatchOrder[]
  legacy: boolean
}

export async function listProductionBatches(): Promise<BatchSummary[]> {
  return apiRequest<BatchSummary[]>('/api/admin/production-batches')
}

export async function getProductionBatch(id: string): Promise<BatchDetail> {
  return apiRequest<BatchDetail>(`/api/admin/production-batches/${encodeURIComponent(id)}`)
}

export async function listBatchCandidates(
  filters: CandidateFilters
): Promise<{ candidates: Candidate[]; meta: CandidateMeta }> {
  const query = new URLSearchParams()
  for (const key of [
    'paidFrom',
    'paidTo',
    'orderNo',
    'platform',
    'modelId',
    'skuId',
    'size',
    'frameCount',
    'printGroupId'
  ] as const)
    if (filters[key]) query.set(key, filters[key])
  if (filters.readyOnly) query.set('readyOnly', 'true')
  if (filters.kitAvailableOnly) query.set('kitAvailableOnly', 'true')
  const result = await apiEnvelopeRequest<Candidate[], CandidateMeta>(
    `/api/admin/production-batches/candidates?${query}`
  )
  return { candidates: result.data, meta: result.meta }
}

export async function createProductionBatch(
  salesOrderIds: string[],
  acknowledgeWarnings: boolean,
  clientRequestId: string
): Promise<{
  batchId: string
  warnings: Issue[]
  artifactErrors: { productionNo: string; message: string }[]
  reused: boolean
}> {
  return apiRequest('/api/admin/production-batches', {
    method: 'POST',
    body: { salesOrderIds, acknowledgeWarnings, clientRequestId },
    timeoutMs: 120_000
  })
}
