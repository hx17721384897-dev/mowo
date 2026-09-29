import { apiBlobRequest, apiRequest } from '@/services/api-client'

export const orderStages = {
  all: {
    label: '订单总览',
    status: '',
    description: '所有正式订单都以总订单为单位展示；生产状态只能通过对应环节操作推进。'
  },
  paid: {
    label: '已付款',
    status: 'PAID',
    description: '用户已经付款，但尚未进入生产批次。请前往生产批次页选择完整总订单。'
  },
  pending: {
    label: '待处理',
    status: 'PENDING_ADDRESS_EXPORT',
    description: '已经进入生产批次，等待导出收件地址。导出后进入处理中。'
  },
  locked: {
    label: '处理中',
    status: 'WAITING_TRACKING',
    description: '地址已经导出，等待绑定快递面单。绑定后进入待生产。'
  },
  processing: {
    label: '待生产',
    status: 'READY_FOR_PRODUCTION',
    description: '面单已经绑定。导出生产资料后，打印线与材料线同时开始，订单进入生产中。'
  },
  producing: {
    label: '生产中',
    status: 'PRODUCING',
    description: '查看每件产品的帧包码与生产进度；打印损坏时从这里按页返工。'
  },
  ready: {
    label: '待发货',
    status: 'READY_TO_SHIP',
    description: '整单所有产品已经完成配对和装箱，可在扫码生产页确认发货。'
  },
  shipped: {
    label: '已发货',
    status: 'SHIPPED',
    description: '已经确认发货的正式订单，只读留档。'
  }
} as const

export type OrderStage = keyof typeof orderStages
export type FulfillmentStatus = Exclude<(typeof orderStages)[OrderStage]['status'], ''>

export const fulfillmentLabels: Record<FulfillmentStatus, string> = {
  PAID: '已付款',
  PENDING_ADDRESS_EXPORT: '待处理',
  WAITING_TRACKING: '处理中',
  READY_FOR_PRODUCTION: '待生产',
  PRODUCING: '生产中',
  READY_TO_SHIP: '待发货',
  SHIPPED: '已发货'
}

export interface ProductionWorkflow {
  frameStatus: string | null
  materialStatus: string | null
  pairingStatus: string | null
  packageStatus: string | null
  exceptionStatus: string | null
}

export interface FramePack {
  code: string
  status: string
  isActive: boolean
  voidReason: string | null
}

export interface ProductionUnit {
  id: string
  productionNo: string
  skuId: string
  skuCode: string | null
  title: string
  specification: string
  printPageCount: number | null
  workflow: ProductionWorkflow | null
  framePacks: FramePack[]
  reprintCount: number
}

export interface AdminOrder {
  id: string
  orderNo: string
  fulfillmentStatus: FulfillmentStatus
  paidAt: string | null
  createdAt: string | null
  receiverName: string | null
  receiverPhone: string | null
  receiverCity: string | null
  receiverAddress: string | null
  trackingNo: string | null
  trackingCompany: string | null
  batchId: string | null
  batchStatus: string | null
  itemCount: number
  units: ProductionUnit[]
}

export interface AdminOrderResult {
  orders: AdminOrder[]
  counts: Partial<Record<FulfillmentStatus, number>>
}

export interface TrackingEntry {
  orderNo: string
  trackingNo: string
  trackingCompany: string
}

export interface ReprintResult {
  framePackCode: string
  oldFramePackCode: string
  pages: number[]
  fileName: string
  downloadUrl: string
  reprintId: string
  message: string
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}响应格式无效`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeWorkflow(value: unknown): ProductionWorkflow | null {
  if (value === null || value === undefined) return null
  const raw = record(value)
  return {
    frameStatus: optionalString(raw.frameStatus),
    materialStatus: optionalString(raw.materialStatus),
    pairingStatus: optionalString(raw.pairingStatus),
    packageStatus: optionalString(raw.packageStatus),
    exceptionStatus: optionalString(raw.exceptionStatus)
  }
}

function normalizeFramePack(value: unknown): FramePack {
  const raw = record(value)
  return {
    code: requiredString(raw.code, '帧包'),
    status: optionalString(raw.status) ?? 'UNKNOWN',
    isActive: raw.isActive === true,
    voidReason: optionalString(raw.voidReason)
  }
}

function normalizeUnit(value: unknown): ProductionUnit {
  const raw = record(value)
  return {
    id: requiredString(raw.id, '生产件'),
    productionNo: requiredString(raw.productionNo, '生产件编号'),
    skuId: requiredString(raw.skuId, 'SKU'),
    skuCode: optionalString(raw.skuCode),
    title: optionalString(raw.title) ?? '定制商品',
    specification: optionalString(raw.specification) ?? '规格待确认',
    printPageCount:
      typeof raw.printPageCount === 'number' && Number.isInteger(raw.printPageCount)
        ? raw.printPageCount
        : null,
    workflow: normalizeWorkflow(raw.workflow),
    framePacks: Array.isArray(raw.framePacks) ? raw.framePacks.map(normalizeFramePack) : [],
    reprintCount: Array.isArray(raw.reprints) ? raw.reprints.length : 0
  }
}

function normalizeOrder(value: unknown): AdminOrder {
  const raw = record(value)
  const status = requiredString(raw.fulfillmentStatus, '订单状态') as FulfillmentStatus
  if (!(status in fulfillmentLabels)) throw new Error('订单状态响应格式无效')
  return {
    id: requiredString(raw.id, '订单'),
    orderNo: requiredString(raw.orderNo, '订单编号'),
    fulfillmentStatus: status,
    paidAt: optionalString(raw.paidAt),
    createdAt: optionalString(raw.createdAt),
    receiverName: optionalString(raw.receiverName),
    receiverPhone: optionalString(raw.receiverPhone),
    receiverCity: optionalString(raw.receiverCity),
    receiverAddress: optionalString(raw.receiverAddress),
    trackingNo: optionalString(raw.trackingNo),
    trackingCompany: optionalString(raw.trackingCompany),
    batchId: optionalString(raw.batchId),
    batchStatus: optionalString(raw.batchStatus),
    itemCount: finiteNumber(raw.itemCount),
    units: Array.isArray(raw.units) ? raw.units.map(normalizeUnit) : []
  }
}

export async function listAdminOrders(
  stage: OrderStage,
  keyword: string
): Promise<AdminOrderResult> {
  const query = new URLSearchParams()
  const status = orderStages[stage].status
  if (status) query.set('status', status)
  if (keyword.trim()) query.set('q', keyword.trim())
  const raw = record(
    await apiRequest<unknown>(`/api/admin/production-workflow/orders?${query.toString()}`)
  )
  if (!Array.isArray(raw.orders)) throw new Error('订单列表响应格式无效')
  const countsRaw = record(raw.counts)
  const counts: Partial<Record<FulfillmentStatus, number>> = {}
  for (const statusKey of Object.keys(fulfillmentLabels) as FulfillmentStatus[]) {
    counts[statusKey] = finiteNumber(countsRaw[statusKey])
  }
  return { orders: raw.orders.map(normalizeOrder), counts }
}

export function exportBatchAddresses(batchId: string): Promise<Blob> {
  return apiBlobRequest(
    `/api/admin/production-workflow/batches/${encodeURIComponent(batchId)}/export-addresses`,
    { method: 'POST', timeoutMs: 60_000 }
  )
}

export async function bindBatchTracking(batchId: string, entries: TrackingEntry[]): Promise<void> {
  await apiRequest<unknown>(
    `/api/admin/production-workflow/batches/${encodeURIComponent(batchId)}/tracking`,
    { method: 'POST', body: { entries }, timeoutMs: 30_000 }
  )
}

export function exportBatchProduction(batchId: string): Promise<Blob> {
  return apiBlobRequest(
    `/api/admin/production-workflow/batches/${encodeURIComponent(batchId)}/export-production`,
    { method: 'POST', timeoutMs: 120_000 }
  )
}

export async function createFrameReprint(
  productionUnitId: string,
  pages: number[],
  reason: string,
  clientRequestId: string
): Promise<ReprintResult> {
  const raw = record(
    await apiRequest<unknown>(
      `/api/admin/production-workflow/units/${encodeURIComponent(productionUnitId)}/reprint`,
      { method: 'POST', body: { pages, reason, clientRequestId }, timeoutMs: 120_000 }
    )
  )
  return {
    framePackCode: requiredString(raw.framePackCode, '新帧包'),
    oldFramePackCode: requiredString(raw.oldFramePackCode, '旧帧包'),
    pages: Array.isArray(raw.pages) ? raw.pages.map(Number).filter(Number.isInteger) : [],
    fileName: requiredString(raw.fileName, '返工文件'),
    downloadUrl: requiredString(raw.downloadUrl, '返工下载地址'),
    reprintId: requiredString(raw.reprintId, '返工记录'),
    message: optionalString(raw.message) ?? '返工文件已生成'
  }
}

export async function downloadSignedFile(url: string): Promise<Blob> {
  const parsed = new URL(url, window.location.origin)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('下载地址不安全')
  const response = await fetch(parsed.toString(), { credentials: 'omit' })
  if (!response.ok) throw new Error('返工文件下载失败，请刷新后重试')
  return response.blob()
}
