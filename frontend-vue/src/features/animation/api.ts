import { apiRequest } from '@/services/api-client'
import type {
  AnimationAssetItem,
  AnimationAssetType,
  AnimationDraftItem,
  AnimationDraftStatus,
  AnimationLibraryPage
} from './types'

const ASSET_TYPES = new Set<AnimationAssetType>(['PRIVATE', 'COLLAB'])
const DRAFT_STATUSES = new Set<AnimationDraftStatus>(['draft', 'in_cart', 'ordered'])

function record(value: unknown, message = '动画数据格式不正确'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, message = '动画数据缺少必要字段'): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function assetType(value: unknown): AnimationAssetType {
  if (!ASSET_TYPES.has(value as AnimationAssetType)) throw new Error('动画资产类型无效')
  return value as AnimationAssetType
}

function draftStatus(value: unknown): AnimationDraftStatus {
  if (!DRAFT_STATUSES.has(value as AnimationDraftStatus)) throw new Error('动画草稿状态无效')
  return value as AnimationDraftStatus
}

function config(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {}
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

function mapAsset(value: unknown): AnimationAssetItem {
  const row = record(value)
  const currentVersion = row.currentVersion == null ? {} : record(row.currentVersion)
  return {
    kind: 'asset',
    id: requiredString(row.id),
    assetNo: requiredString(row.assetNo),
    title: requiredString(row.title),
    assetType: assetType(row.assetType),
    currentVersionNo: finiteNumber(row.currentVersionNo, 1),
    frameCount: finiteNumber(currentVersion.baseFrameCount),
    previewUrl: safePreviewUrl(currentVersion.previewFrameUrl),
    createdAt: requiredString(row.createdAt),
    updatedAt: requiredString(row.updatedAt)
  }
}

function mapDraft(value: unknown): AnimationDraftItem | null {
  const row = record(value)
  if (row.animationAssetId) return null
  const parsed = config(row.configJson)
  const frameCount = finiteNumber(row.frameCount, finiteNumber(parsed.frameCount))
  return {
    kind: 'draft',
    id: requiredString(row.id),
    title: optionalString(parsed.animName) || '',
    modelName: optionalString(parsed.modelName),
    size: optionalString(parsed.size),
    material: optionalString(parsed.material),
    colorName: optionalString(parsed.colorName),
    frameCount,
    status: draftStatus(row.status),
    draftExpiresAt: optionalString(row.draftExpiresAt),
    previewUrl: safePreviewUrl(row.previewFrameUrl),
    createdAt: requiredString(row.createdAt),
    updatedAt: requiredString(row.updatedAt)
  }
}

export async function getAnimationLibrary(): Promise<AnimationLibraryPage> {
  const [assetData, draftData] = await Promise.all([
    apiRequest<unknown>('/api/animation-assets?page=1&limit=50'),
    apiRequest<unknown>('/api/custom-products?page=1&limit=50')
  ])
  const assetPage = record(assetData)
  const draftPage = record(draftData)
  if (!Array.isArray(assetPage.items) || !Array.isArray(draftPage.items)) {
    throw new Error('动画列表响应格式不正确')
  }
  const assets = assetPage.items.map(mapAsset)
  const drafts = draftPage.items.map(mapDraft).filter((item): item is AnimationDraftItem => !!item)
  const items = [...assets, ...drafts].sort(
    (left, right) =>
      new Date(right.updatedAt || right.createdAt).getTime() -
      new Date(left.updatedAt || left.createdAt).getTime()
  )
  return { items, total: items.length }
}

export async function renameAnimation(
  item: AnimationAssetItem | AnimationDraftItem,
  title: string
) {
  const path =
    item.kind === 'asset'
      ? `/api/animation-assets/${encodeURIComponent(item.id)}`
      : `/api/custom-products/${encodeURIComponent(item.id)}/title`
  await apiRequest(path, { method: 'PATCH', body: { title } })
}

export async function deleteAnimation(item: AnimationAssetItem | AnimationDraftItem) {
  const resource = item.kind === 'asset' ? 'animation-assets' : 'custom-products'
  await apiRequest(`/api/${resource}/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
}
