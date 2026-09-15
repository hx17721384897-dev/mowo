import { apiRequest, ApiError } from '@/services/api-client'
import type {
  CollabCreator,
  CollabMedia,
  CollabSku,
  CollabSort,
  CollabWorkDetail,
  CollabWorkPage,
  CollabWorkSummary
} from './types'

type UnknownRecord = Record<string, unknown>

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(`${label}格式不正确`, 0, 'INVALID_RESPONSE', crypto.randomUUID())
  }
  return value as UnknownRecord
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function creator(value: unknown, fallbackId: string): CollabCreator {
  const row = object(value, '创作者信息')
  return {
    userId: string(row.userId, fallbackId),
    nickname: string(row.nickname, '创作者'),
    avatarUrl: nullableString(row.avatarUrl)
  }
}

function summary(value: unknown): CollabWorkSummary {
  const row = object(value, '联名商品')
  const id = string(row.id)
  const creatorId = string(row.creatorId)
  if (!id || !creatorId || !string(row.title)) {
    throw new ApiError('联名商品缺少必要公开字段', 0, 'INVALID_RESPONSE', crypto.randomUUID())
  }
  return {
    id,
    creatorId,
    title: string(row.title),
    description: string(row.description),
    coverUrl: nullableString(row.coverUrl),
    hoverGifUrl: nullableString(row.hoverGifUrl),
    approvedAt: nullableString(row.approvedAt),
    creator: creator(row.creator, creatorId),
    minPrice: nullableNumber(row.minPrice),
    availableSkuCount: number(row.availableSkuCount),
    availableSizes: strings(row.availableSizes),
    minLeadTimeDays: nullableNumber(row.minLeadTimeDays),
    previewFrames: strings(row.previewFrames)
  }
}

function sku(value: unknown): CollabSku {
  const row = object(value, '商品规格')
  const id = string(row.id)
  if (!id || !string(row.modelId) || !string(row.modelName)) {
    throw new ApiError('商品规格缺少必要公开字段', 0, 'INVALID_RESPONSE', crypto.randomUUID())
  }
  return {
    id,
    modelId: string(row.modelId),
    modelName: string(row.modelName),
    size: string(row.size),
    material: string(row.material),
    frameCount: number(row.frameCount),
    colorName: nullableString(row.colorName),
    colorHex: nullableString(row.colorHex),
    previewImage: nullableString(row.previewImage),
    finalPrice: number(row.finalPrice),
    fulfillmentMode: string(row.fulfillmentMode),
    leadTimeDays: number(row.leadTimeDays),
    exampleMedia: strings(row.exampleMedia)
  }
}

export async function getCollabWorks(input: {
  page: number
  limit?: number
  creatorId?: string
  q?: string
  sort: CollabSort
}): Promise<CollabWorkPage> {
  const query = new URLSearchParams({
    page: String(input.page),
    limit: String(input.limit ?? 12),
    sort: input.sort
  })
  if (input.creatorId) query.set('creatorId', input.creatorId)
  if (input.q) query.set('q', input.q.slice(0, 100))
  const row = object(await apiRequest<unknown>(`/api/collab/works?${query}`), '联名商品列表')
  const sort = ['recommended', 'latest', 'popular'].includes(string(row.sort))
    ? (row.sort as CollabSort)
    : 'recommended'
  return {
    works: Array.isArray(row.works) ? row.works.map(summary) : [],
    total: number(row.total),
    page: Math.max(1, number(row.page, input.page)),
    limit: Math.max(1, number(row.limit, input.limit ?? 12)),
    hasMore: row.hasMore === true,
    sort,
    creators: Array.isArray(row.creators)
      ? row.creators
          .map((value) => {
            const item = object(value, '创作者筛选项')
            return { id: string(item.id), name: string(item.name, '创作者') }
          })
          .filter((item) => item.id)
      : []
  }
}

export async function getCollabWork(id: string): Promise<CollabWorkDetail> {
  const row = object(
    await apiRequest<unknown>(`/api/collab/works/${encodeURIComponent(id)}`),
    '联名商品详情'
  )
  const creatorId = string(row.creatorId)
  if (string(row.id) !== id || !creatorId || !string(row.title)) {
    throw new ApiError('联名商品详情缺少必要公开字段', 0, 'INVALID_RESPONSE', crypto.randomUUID())
  }
  return {
    id,
    creatorId,
    title: string(row.title),
    description: string(row.description),
    storefrontSummary: nullableString(row.storefrontSummary),
    storefrontMedia: Array.isArray(row.storefrontMedia)
      ? row.storefrontMedia
          .map((value): CollabMedia | null => {
            const item = object(value, '商品媒体')
            const url = string(item.url)
            if (!url) return null
            return { url, kind: item.kind === 'video' ? 'video' : 'image' }
          })
          .filter((item): item is CollabMedia => item !== null)
      : [],
    storefrontTags: strings(row.storefrontTags),
    storefrontSeries: nullableString(row.storefrontSeries),
    animationFrames: strings(row.animationFrames),
    hoverGifUrl: nullableString(row.hoverGifUrl),
    coverUrl: nullableString(row.coverUrl),
    supportedSkus: Array.isArray(row.supportedSkus) ? row.supportedSkus.map(sku) : [],
    approvedAt: nullableString(row.approvedAt),
    creator: creator(row.creator, creatorId)
  }
}

export async function recordCollabView(id: string, visitorId: string): Promise<void> {
  await apiRequest(`/api/collab/works/${encodeURIComponent(id)}/view`, {
    method: 'POST',
    body: { visitorId },
    keepalive: true,
    retryAuth: false
  })
}
