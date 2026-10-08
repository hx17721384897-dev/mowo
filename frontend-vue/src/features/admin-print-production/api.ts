import { apiRequest } from '@/services/api-client'

export type PrintTemplate = {
  id: string
  groupId: string
  versionNo: number
  originalName: string
  status: string
  createdAt: string
}
export type PrintSku = {
  id: string
  skuCode: string | null
  size: string
  material: string
  frameCount: number
  colorName: string
  colorHex: string
  isActive: boolean
  modelId: string
  modelName: string
  modelActive: boolean
  previewUrl: string | null
  assignment: { ruleId: string; groupId: string; groupName: string; active: boolean } | null
}
export type PrintRule = {
  id: string
  groupId: string
  skuId: string
  pagesPerUnit: number
  sortOrder: number
  isActive: boolean
  sku: PrintSku & { model?: { name?: string; isActive?: boolean } }
}
export type PrintGroup = {
  id: string
  code: string
  name: string
  size: string
  paperSize: string
  paperType: string
  orientation: 'PORTRAIT' | 'LANDSCAPE'
  frameWidthMm: number | null
  frameHeightMm: number | null
  framesPerSheet: number
  renderDpi: number
  separatorMicrons: number
  cuttingTool: string | null
  isActive: boolean
  sortOrder: number
  templates: PrintTemplate[]
  rules: PrintRule[]
}
export type PrintConfig = { groups: PrintGroup[]; skus: PrintSku[] }
export type GroupInput = {
  name: string
  size: string
  framesPerSheet: number
  paperSize: string
  paperType: string
  orientation: 'PORTRAIT' | 'LANDSCAPE'
  renderDpi: number
  frameWidthMm: number
  frameHeightMm: number
  separatorMicrons: number
  cuttingTool: string
  isActive?: boolean
  clientRequestId?: string
}

const base = '/api/admin/print-production'
export const loadPrintConfig = () => apiRequest<PrintConfig>(`${base}/`)
export const savePrintGroup = (id: string | null, input: GroupInput) =>
  apiRequest<PrintGroup & { reused?: boolean }>(
    id ? `${base}/groups/${encodeURIComponent(id)}` : `${base}/groups`,
    {
      method: id ? 'PUT' : 'POST',
      body: input
    }
  )
export const reorderPrintGroups = (groupIds: string[]) =>
  apiRequest(`${base}/groups/reorder`, { method: 'PUT', body: { groupIds } })
export const addPrintRules = (groupId: string, skuIds: string[]) =>
  apiRequest(`${base}/rules`, { method: 'POST', body: { groupId, skuIds } })
export const reorderPrintRules = (ruleIds: string[]) =>
  apiRequest(`${base}/rules/reorder`, { method: 'PUT', body: { ruleIds } })
export const movePrintRule = (ruleId: string, groupId: string) =>
  apiRequest(`${base}/rules/${encodeURIComponent(ruleId)}/move`, {
    method: 'PUT',
    body: { groupId }
  })
export const removePrintRule = (ruleId: string) =>
  apiRequest(`${base}/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' })
export const uploadPrintTemplate = (groupId: string, file: File, clientRequestId: string) => {
  const body = new FormData()
  body.append('file', file)
  return apiRequest<PrintTemplate & { reused?: boolean }>(
    `${base}/groups/${encodeURIComponent(groupId)}/templates`,
    { method: 'POST', body, headers: { 'Idempotency-Key': clientRequestId }, timeoutMs: 30_000 }
  )
}
