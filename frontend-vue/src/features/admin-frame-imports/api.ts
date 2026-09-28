import { apiRequest } from '@/services/api-client'
import { runtimeConfig } from '@/config/runtime'

export interface ImportIssue {
  level: 'ERROR' | 'WARNING'
  code?: string
  message: string
}

export interface ImportItem {
  id: string
  folderName: string
  status: string
  title: string
  usageType: string
  rightsHolderName: string | null
  tags: string[]
  frameCount: number
  duplicateAssetId: string | null
  allowDuplicate: boolean
  issues: ImportIssue[]
  assetNo: string | null
  previewUrl: string | null
}

export interface ImportBatchSummary {
  id: string
  batchNo: string
  batchType: 'COMPANY' | 'CUSTOMER'
  status: string
  totalItems: number
  totalFiles: number
  totalBytes: number
  createdAt: string
}

export interface ImportBatch extends ImportBatchSummary {
  defaults: Record<string, unknown> | null
  items: ImportItem[]
}

export interface LocalImportGroup {
  localId: string
  folderName: string
  relativePath: string
  title: string
  files: Array<File & { _mime?: string; _order?: number }>
  previewUrl: string
  tags: string[]
  sourceChannel: string
  usageType: string
  rightsHolderType: string
  rightsHolderName: string
  rightsHolderContact: string
  authorizationStatus: string
  internalNotes: string
  issues: ImportIssue[]
  status: string
}

interface UploadJob {
  itemId: string
  folderName: string
  fileId: string
  name: string
  order: number
  uploadUrl: string
  completeUrl: string
}

function trustedApiPath(value: string): string {
  const url = new URL(value, window.location.origin)
  const apiOrigin = new URL(runtimeConfig.apiBase || window.location.origin, window.location.origin)
    .origin
  if (url.origin !== apiOrigin || !/^\/api\/upload\/files\/[^/]+\/complete$/.test(url.pathname)) {
    throw new Error('服务器返回的文件确认地址不受信任')
  }
  return `${url.pathname}${url.search}`
}

export function listImportBatches(): Promise<ImportBatchSummary[]> {
  return apiRequest('/api/admin/frame-imports')
}

export function getImportBatch(id: string): Promise<ImportBatch> {
  return apiRequest(`/api/admin/frame-imports/${encodeURIComponent(id)}`)
}

export function createImportBatch(input: Record<string, unknown>): Promise<{
  id: string
  batchNo: string
  uploads: UploadJob[]
}> {
  return apiRequest('/api/admin/frame-imports', { method: 'POST', body: input, timeoutMs: 30_000 })
}

export async function uploadImportFile(job: UploadJob, file: File): Promise<void> {
  const uploadUrl = new URL(job.uploadUrl, window.location.origin)
  if (!['http:', 'https:'].includes(uploadUrl.protocol)) throw new Error('上传地址不受信任')
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'omit'
  })
  if (!response.ok) throw new Error(`${file.name} 上传失败`)
  await apiRequest(trustedApiPath(job.completeUrl), { method: 'POST', timeoutMs: 30_000 })
}

export function patchImportItem(
  batchId: string,
  itemId: string,
  body: Record<string, unknown>
): Promise<ImportItem> {
  return apiRequest(
    `/api/admin/frame-imports/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'PATCH', body }
  )
}

export function patchImportItems(
  batchId: string,
  body: Record<string, unknown>
): Promise<{ updated: number }> {
  return apiRequest(`/api/admin/frame-imports/${encodeURIComponent(batchId)}/items`, {
    method: 'PATCH',
    body
  })
}

export function preflightImportBatch(id: string): Promise<{ ready: number; blocked: number }> {
  return apiRequest(`/api/admin/frame-imports/${encodeURIComponent(id)}/preflight`, {
    method: 'POST',
    body: {},
    timeoutMs: 120_000
  })
}

export function commitImportBatch(
  id: string,
  itemIds: string[]
): Promise<{ batch: ImportBatchSummary; results: Array<Record<string, unknown>> }> {
  return apiRequest(`/api/admin/frame-imports/${encodeURIComponent(id)}/commit`, {
    method: 'POST',
    body: { itemIds },
    timeoutMs: 120_000
  })
}
