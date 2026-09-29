import { apiRequest } from '@/services/api-client'

export const customizationStatuses = {
  SUBMITTED: '等待处理',
  REVIEWING: '正在处理',
  NEEDS_SUPPLEMENT: '需要补充素材',
  OPTIONS_READY: '待用户确认筛帧',
  FRAME_ACCEPTED: '用户已确认筛帧',
  STYLE_SELECTED: '用户已选择款式',
  UNAVAILABLE: '暂时无法制作',
  CONFIRMED: '已确认',
  CLOSED: '已关闭'
} as const

export type CustomizationStatus = keyof typeof customizationStatuses
export type CustomizationMode = 'SELF' | 'HUMAN'

export interface CustomizationListItem {
  id: string
  requestNo: string
  mode: CustomizationMode
  status: CustomizationStatus
  version: number
  submittedAt: string | null
  modelName: string
  assignedStaffName: string | null
  canEdit: boolean
  user: { nickname: string; phoneTail: string | null }
}

export interface CustomizationFile {
  key: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
  expiresIn: number
}

export interface CustomizationEvent {
  id: string
  eventType: string
  toStatus: string | null
  publicMessage: string | null
  createdAt: string
}

export interface CustomizationDetail extends CustomizationListItem {
  userNote: string | null
  creatorDeclared: boolean
  screeningData: Record<string, unknown> | null
  sourceFiles: CustomizationFile[]
  selectedFrames: CustomizationFile[]
  events: CustomizationEvent[]
  model: { id: string; name: string } | null
}

export interface CustomizationFilters {
  status: CustomizationStatus | ''
  mode: CustomizationMode | ''
  keyword: string
}

export interface CustomizationStats {
  waiting: number
  reviewing: number
  userAction: number
  finished: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeUser(value: unknown): CustomizationListItem['user'] {
  const user = record(value)
  return { nickname: text(user.nickname) || '未设置昵称', phoneTail: nullableText(user.phoneTail) }
}

function normalizeListItem(value: unknown): CustomizationListItem {
  const item = record(value)
  const status = text(item.status)
  const mode = text(item.mode)
  if (
    !text(item.id) ||
    !text(item.requestNo) ||
    !Object.hasOwn(customizationStatuses, status) ||
    !['SELF', 'HUMAN'].includes(mode)
  ) {
    throw new Error('定制处理列表响应格式无效')
  }
  return {
    id: text(item.id),
    requestNo: text(item.requestNo),
    mode: mode as CustomizationMode,
    status: status as CustomizationStatus,
    version: Number(item.version) || 1,
    submittedAt: nullableText(item.submittedAt),
    modelName: text(item.modelName) || text(record(item.model).name) || '未知款式',
    assignedStaffName: nullableText(item.assignedStaffName),
    canEdit: item.canEdit === true,
    user: normalizeUser(item.user)
  }
}

function normalizeFile(value: unknown): CustomizationFile | null {
  const file = record(value)
  if (!text(file.key) || !text(file.url)) return null
  return {
    key: text(file.key),
    filename: text(file.filename) || '未命名素材',
    mimeType: text(file.mimeType),
    sizeBytes: Number(file.sizeBytes) || 0,
    url: text(file.url),
    expiresIn: Number(file.expiresIn) || 0
  }
}

function normalizeEvent(value: unknown): CustomizationEvent {
  const event = record(value)
  return {
    id: text(event.id),
    eventType: text(event.eventType),
    toStatus: nullableText(event.toStatus),
    publicMessage: nullableText(event.publicMessage),
    createdAt: text(event.createdAt)
  }
}

export async function listCustomizationRequests(
  filters: CustomizationFilters
): Promise<{ items: CustomizationListItem[]; total: number }> {
  const query = new URLSearchParams({ limit: '50' })
  if (filters.status) query.set('status', filters.status)
  if (filters.mode) query.set('mode', filters.mode)
  if (filters.keyword) query.set('keyword', filters.keyword)
  const raw = record(await apiRequest<unknown>(`/api/admin/customization-requests?${query}`))
  if (!Array.isArray(raw.items)) throw new Error('定制处理列表响应格式无效')
  return { items: raw.items.map(normalizeListItem), total: Number(raw.total) || 0 }
}

export async function getCustomizationStats(): Promise<CustomizationStats> {
  const raw = record(await apiRequest<unknown>('/api/admin/customization-requests/stats'))
  const count = (status: CustomizationStatus): number => Number(raw[status]) || 0
  return {
    waiting: count('SUBMITTED'),
    reviewing: count('REVIEWING'),
    userAction:
      count('NEEDS_SUPPLEMENT') +
      count('OPTIONS_READY') +
      count('FRAME_ACCEPTED') +
      count('STYLE_SELECTED'),
    finished: count('UNAVAILABLE') + count('CONFIRMED') + count('CLOSED')
  }
}

export async function getCustomizationRequest(id: string): Promise<CustomizationDetail> {
  const raw = record(
    await apiRequest<unknown>(`/api/admin/customization-requests/${encodeURIComponent(id)}`)
  )
  const listItem = normalizeListItem(raw)
  const sourceFiles = Array.isArray(raw.sourceFiles) ? raw.sourceFiles : []
  const selectedFrames = Array.isArray(raw.selectedFrames) ? raw.selectedFrames : []
  const events = Array.isArray(raw.events) ? raw.events : []
  const model = record(raw.model)
  return {
    ...listItem,
    userNote: nullableText(raw.userNote),
    creatorDeclared: raw.creatorDeclared === true,
    screeningData: Object.keys(record(raw.screeningData)).length ? record(raw.screeningData) : null,
    sourceFiles: sourceFiles.map(normalizeFile).filter((file): file is CustomizationFile => !!file),
    selectedFrames: selectedFrames
      .map(normalizeFile)
      .filter((file): file is CustomizationFile => !!file),
    events: events.map(normalizeEvent),
    model: text(model.id) ? { id: text(model.id), name: text(model.name) || '未知款式' } : null
  }
}

export async function claimCustomizationRequest(id: string): Promise<void> {
  await apiRequest(`/api/admin/customization-requests/${encodeURIComponent(id)}/claim`, {
    method: 'POST'
  })
}

export async function claimNextCustomizationRequest(): Promise<{ id: string } | null> {
  const raw = await apiRequest<unknown>('/api/admin/customization-requests/claim-next', {
    method: 'POST'
  })
  if (raw == null) return null
  const item = record(raw)
  return text(item.id) ? { id: text(item.id) } : null
}

export function safeCustomizationMediaUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
