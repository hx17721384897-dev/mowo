import { apiRequest } from '@/services/api-client'
import type { DraftQuota, MachineModel, MachineSku, ReusableAnimation } from './types'

function record(value: unknown, message = '款式数据格式不正确'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, message = '款式数据缺少必要字段'): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function mediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function color(value: unknown): string {
  const candidate = optionalString(value)
  return /^#[0-9a-f]{3,8}$/i.test(candidate) ? candidate : '#c4c3bf'
}

function mapSku(value: unknown): MachineSku {
  const row = record(value)
  return {
    id: requiredString(row.id),
    size: requiredString(row.size),
    material: requiredString(row.material),
    frameCount: number(row.frameCount),
    colorName: requiredString(row.colorName),
    colorHex: color(row.colorHex),
    price: number(row.price),
    previewUrl: mediaUrl(row.previewUrl)
  }
}

function mapModel(value: unknown): Omit<MachineModel, 'skus'> {
  const row = record(value)
  return {
    id: requiredString(row.id),
    name: requiredString(row.name),
    description: optionalString(row.description),
    modelType: optionalString(row.modelType) || 'single',
    previewUrl: mediaUrl(row.previewUrl ?? row.previewImage),
    videoUrl: mediaUrl(row.videoUrl),
    ratios: Array.isArray(row.ratios)
      ? row.ratios.filter(
          (ratio): ratio is string => typeof ratio === 'string' && /^\d+:\d+$/.test(ratio)
        )
      : []
  }
}

export async function getMachineModels(): Promise<MachineModel[]> {
  const data = await apiRequest<unknown>('/api/machine-models')
  if (!Array.isArray(data)) throw new Error('款式列表响应格式不正确')
  const models = data.map(mapModel)
  return Promise.all(
    models.map(async (model) => {
      try {
        const skus = await apiRequest<unknown>(
          `/api/machine-models/${encodeURIComponent(model.id)}/skus`
        )
        return { ...model, skus: Array.isArray(skus) ? skus.map(mapSku) : [] }
      } catch {
        return { ...model, skus: [] }
      }
    })
  )
}

export async function getReusableAnimation(id: string): Promise<ReusableAnimation> {
  const row = record(
    await apiRequest<unknown>(`/api/animation-assets/${encodeURIComponent(id)}`),
    '动画资产响应格式不正确'
  )
  const versionNo = number(row.currentVersionNo)
  const versions = Array.isArray(row.versions) ? row.versions : []
  const current = versions
    .map((value) => record(value))
    .find((version) => number(version.versionNo) === versionNo)
  const baseFrameCount = number(current?.baseFrameCount)
  if (!current || !baseFrameCount) throw new Error('动画版本缺少帧数信息')
  return {
    id: requiredString(row.id, '动画资产缺少编号'),
    assetNo: requiredString(row.assetNo, '动画资产缺少业务编号'),
    title: requiredString(row.title, '动画资产缺少名称'),
    currentVersionNo: versionNo,
    baseFrameCount
  }
}

export async function getSkuSales(modelId: string): Promise<Record<string, number>> {
  const data = record(
    await apiRequest<unknown>(`/api/machine-models/${encodeURIComponent(modelId)}/sku-sales`)
  )
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => key && typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => [key, value as number])
  )
}

export async function getDraftQuota(): Promise<DraftQuota> {
  const row = record(await apiRequest<unknown>('/api/custom-products/quota'))
  return {
    count: number(row.count),
    limit: number(row.limit),
    canCreate: row.canCreate === true
  }
}
