import { apiRequest } from '@/services/api-client'
import type {
  CustomizationDetail,
  CustomizationEvent,
  CustomizationMode,
  CustomizationPage,
  CustomizationStatus,
  CustomizationSummary
} from './types'

const STATUSES = new Set<CustomizationStatus>([
  'DRAFT',
  'EXPIRING',
  'SUBMITTED',
  'REVIEWING',
  'NEEDS_SUPPLEMENT',
  'OPTIONS_READY',
  'FRAME_ACCEPTED',
  'STYLE_SELECTED',
  'UNAVAILABLE',
  'CONFIRMED',
  'CLOSED'
])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('定制记录响应格式不正确')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('定制记录缺少必要字段')
  return value
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function status(value: unknown): CustomizationStatus {
  if (!STATUSES.has(value as CustomizationStatus)) throw new Error('定制记录状态无效')
  return value as CustomizationStatus
}

function mode(value: unknown): CustomizationMode {
  if (value !== 'SELF' && value !== 'HUMAN') throw new Error('定制处理方式无效')
  return value
}

function summary(value: unknown): CustomizationSummary {
  const row = record(value)
  const modelValue = row.model == null ? null : record(row.model)
  const skuValue = row.desiredSku == null ? null : record(row.desiredSku)
  return {
    id: requiredString(row.id),
    requestNo: nullableString(row.requestNo),
    mode: mode(row.mode),
    status: status(row.status),
    version: typeof row.version === 'number' ? row.version : 1,
    updatedAt: requiredString(row.updatedAt),
    model: modelValue
      ? { id: requiredString(modelValue.id), name: requiredString(modelValue.name) }
      : null,
    desiredSku: skuValue
      ? {
          id: requiredString(skuValue.id),
          size: requiredString(skuValue.size),
          material: requiredString(skuValue.material)
        }
      : null
  }
}

function event(value: unknown): CustomizationEvent {
  const row = record(value)
  return {
    id: requiredString(row.id),
    eventType: requiredString(row.eventType),
    toStatus: row.toStatus == null ? null : status(row.toStatus),
    publicMessage: nullableString(row.publicMessage),
    createdAt: requiredString(row.createdAt)
  }
}

export async function getMyCustomizations(): Promise<CustomizationPage> {
  const data = record(await apiRequest<unknown>('/api/customization-requests/mine?limit=50'))
  if (!Array.isArray(data.items)) throw new Error('定制列表响应格式不正确')
  return {
    items: data.items.map(summary),
    total: typeof data.total === 'number' ? data.total : data.items.length,
    page: typeof data.page === 'number' ? data.page : 1,
    hasMore: data.hasMore === true
  }
}

export async function getMyCustomization(id: string): Promise<CustomizationDetail> {
  const data = record(
    await apiRequest<unknown>(`/api/customization-requests/mine/${encodeURIComponent(id)}`)
  )
  const base = summary(data)
  return {
    ...base,
    events: Array.isArray(data.events) ? data.events.map(event) : []
  }
}
