import { apiRequest } from '@/services/api-client'

export type FrameCategory =
  'all' | 'private' | 'collab' | 'company' | 'internal' | 'incomplete' | 'user_deleted' | 'archived'

export interface FrameTag {
  id?: string
  name: string
  color?: string | null
  _count?: { assets: number }
}

export interface FrameStats {
  all: number
  private: number
  collab: number
  company: number
  internal: number
  incomplete: number
  userDeleted: number
  archived: number
  tags: FrameTag[]
}

export interface ProductionFile {
  id: string
  displayName: string
  createdAt: string
  downloadUrl: string | null
  targetFrameCount?: number
  fileVersionNo?: number
  sourceType?: string
  productionBatchId?: string | null
  status?: string
  animationVersionNo?: number
  groupName?: string
  templateVersionNo?: number
  renderedFrameCount?: number
  renderSize?: string
  canDelete?: boolean
  deleteBlockedReason?: string | null
}

export interface FrameAssetListItem {
  id: string
  assetNo: string
  title: string
  sourceType: string
  sourceChannel: string
  usageType: string
  assetType: string
  status: string
  collabStatus: string
  rightsHolderType: string
  rightsHolderName: string | null
  authorizationStatus: string
  currentVersionNo: number
  baseFrameCount: number
  coverUrl: string | null
  createdAt: string
  updatedAt: string
  owner: { nickname: string; phone: string | null } | null
  tags: FrameTag[]
  counts: Record<string, number>
  productionFiles: ProductionFile[]
  canDelete: boolean
}

export interface FrameVersionSummary {
  id: string
  versionNo: number
  sourceType: string
  baseFrameCount: number
  manifestHash: string
  createdAt: string
}

export interface FrameAssetDetail extends FrameAssetListItem {
  owner: { id: string; nickname: string; phone: string | null } | null
  rightsHolderContact: string | null
  rightsHolderContactMasked: string | null
  internalNotes: string | null
  createdByStaffName: string | null
  versions: FrameVersionSummary[]
  customizationRequests: Array<{
    id: string
    requestNo: string | null
    mode: string
    status: string
    createdAt: string
  }>
  salesOrderItems: Array<{
    id: string
    itemNo: string
    skuCode: string | null
    quantity: number
    salesOrder: { orderNo: string; status: string }
  }>
  collabWorks: Array<{
    id: string
    title: string
    status: string
    shelfStatus: string
    createdAt: string
  }>
  _count: {
    customProducts: number
    versions: number
    customizationRequests: number
    salesOrderItems: number
    collabWorks: number
  }
}

export interface FrameVersion {
  id: string
  versionNo: number
  sourceType: string
  baseFrameCount: number
  manifestHash: string
  editorData: unknown
  createdAt: string
  frames: Array<{ index: number; url: string | null }>
}

export interface ProductionOptions {
  versions: Array<{ id: string; versionNo: number; baseFrameCount: number }>
  templates: Array<{
    id: string
    templateVersionNo: number
    groupId: string
    groupName: string
    size: string
    paperSize: string
    paperType: string
    orientation: string
    framesPerSheet: number
    renderDpi: number
  }>
}

export interface RenderedFrames {
  fileId: string
  displayName: string
  animationVersionNo: number
  size: string
  widthPx: number
  heightPx: number
  markerEnabled: boolean
  frames: Array<{ index: number; name: string; url: string | null }>
}

export interface FrameAssetInput {
  title: string
  sourceChannel: string
  usageType: string
  rightsHolderType: string
  authorizationStatus: string
  rightsHolderName: string
  rightsHolderContact: string
  ownerPhone: string
  tags: string[]
  internalNotes: string
}

const base = '/api/admin/frame-library'
const assetPath = (id: string): string => `${base}/${encodeURIComponent(id)}`

export function listFrameStats(): Promise<FrameStats> {
  return apiRequest(`${base}/stats`)
}

export function listFrameAssets(input: {
  page: number
  category: FrameCategory
  keyword: string
  tag: string
}): Promise<{
  items: FrameAssetListItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}> {
  const query = new URLSearchParams({
    page: String(input.page),
    limit: '24',
    category: input.category
  })
  if (input.keyword) query.set('keyword', input.keyword)
  if (input.tag) query.set('tag', input.tag)
  return apiRequest(`${base}?${query}`)
}

export function getFrameAsset(id: string): Promise<FrameAssetDetail> {
  return apiRequest(assetPath(id))
}

export function getFrameVersion(id: string, versionNo: number): Promise<FrameVersion> {
  return apiRequest(`${assetPath(id)}/versions/${versionNo}`)
}

export function updateFrameAsset(
  id: string,
  input: FrameAssetInput
): Promise<{ id: string; assetNo: string }> {
  return apiRequest(assetPath(id), { method: 'PATCH', body: { ...input } })
}

export async function archiveFrameAsset(id: string): Promise<void> {
  await apiRequest(`${assetPath(id)}/archive`, { method: 'POST', body: {} })
}

export async function restoreFrameAsset(id: string): Promise<void> {
  await apiRequest(`${assetPath(id)}/restore`, { method: 'POST', body: {} })
}

export async function deleteFrameAsset(id: string): Promise<void> {
  await apiRequest(assetPath(id), { method: 'DELETE' })
}

export function getProductionOptions(id: string): Promise<ProductionOptions> {
  return apiRequest(`${assetPath(id)}/production-options`)
}

export function createProductionFile(
  id: string,
  input: {
    animationVersionId: string
    templateVersionId: string
    targetFrameCount: number
    markerEnabled: boolean
  }
): Promise<{ id: string; displayName: string; downloadUrl: string | null }> {
  return apiRequest(`${assetPath(id)}/production-files`, { method: 'POST', body: { ...input } })
}

export function getRenderedFrames(id: string, fileId: string): Promise<RenderedFrames> {
  return apiRequest(`${assetPath(id)}/production-files/${encodeURIComponent(fileId)}/frames`)
}

export async function deleteProductionFile(id: string, fileId: string): Promise<void> {
  await apiRequest(`${assetPath(id)}/production-files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE'
  })
}
