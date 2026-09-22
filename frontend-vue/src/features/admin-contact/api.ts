import { apiRequest } from '@/services/api-client'

export const contactTypes = {
  artist: '画师联名',
  channel: '线下渠道',
  media: '媒体合作',
  join: '加入哞屋',
  feedback: '反馈创意',
  factory: '厂家合作'
} as const

export const contactStatuses = {
  pending: '待处理',
  processing: '处理中',
  done: '已处理',
  spam: '垃圾信息'
} as const

export const messageLabels = {
  artist: 'IP/作品介绍',
  channel: '合作想法',
  media: '合作方向',
  join: '自我介绍',
  feedback: '反馈内容',
  factory: '补充说明'
} as const

export type ContactType = keyof typeof contactTypes
export type ContactStatus = keyof typeof contactStatuses

export interface ContactItem {
  id: string
  type: ContactType
  name: string
  contact: string
  message: string
  status: ContactStatus
  isStarred: boolean
  createdAt: string
  note: string | null
  extra: Record<string, unknown> | null
  attachmentUrls: Array<{ url: string; filename: string }>
  submitterUserId: string | null
  ip: string | null
  isBlocked: boolean
  handledAt: string | null
}

export interface ContactStats {
  pendingTotal: number
  starredTotal: number
  byStatus: Partial<Record<ContactStatus, number>>
  byType: Partial<Record<ContactType, number>>
}

export interface ContactFilters {
  page: number
  status: ContactStatus | ''
  starred: boolean
  type: ContactType | ''
  keyword: string
}

export interface ContactList {
  items: ContactItem[]
  pagination: { page: number; limit: number; total: number }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizedItem(value: unknown): ContactItem {
  const item = record(value)
  if (
    !string(item.id) ||
    !Object.hasOwn(contactTypes, string(item.type)) ||
    !Object.hasOwn(contactStatuses, string(item.status))
  ) {
    throw new Error('联络留言响应格式无效')
  }
  const attachmentUrls = Array.isArray(item.attachmentUrls) ? item.attachmentUrls : []
  return {
    id: string(item.id),
    type: item.type as ContactType,
    name: string(item.name),
    contact: string(item.contact),
    message: string(item.message),
    status: item.status as ContactStatus,
    isStarred: item.isStarred === true,
    createdAt: string(item.createdAt),
    note: typeof item.note === 'string' ? item.note : null,
    extra: Object.keys(record(item.extra)).length ? record(item.extra) : null,
    attachmentUrls: attachmentUrls.map((file) => ({
      url: string(record(file).url),
      filename: string(record(file).filename)
    })),
    submitterUserId: typeof item.submitterUserId === 'string' ? item.submitterUserId : null,
    ip: typeof item.ip === 'string' ? item.ip : null,
    isBlocked: item.isBlocked === true,
    handledAt: typeof item.handledAt === 'string' ? item.handledAt : null
  }
}

export async function getContactStats(): Promise<ContactStats> {
  const raw = record(await apiRequest<unknown>('/api/admin/contact/stats'))
  return {
    pendingTotal: Number(raw.pendingTotal) || 0,
    starredTotal: Number(raw.starredTotal) || 0,
    byStatus: record(raw.byStatus) as ContactStats['byStatus'],
    byType: record(raw.byType) as ContactStats['byType']
  }
}

export async function listContacts(filters: ContactFilters): Promise<ContactList> {
  const query = new URLSearchParams({
    page: String(filters.page),
    limit: '20',
    status: filters.status,
    ...(filters.starred ? { starred: '1' } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.keyword ? { keyword: filters.keyword } : {})
  })
  const raw = record(await apiRequest<unknown>(`/api/admin/contact?${query}`))
  const pagination = record(raw.pagination)
  if (!Array.isArray(raw.items)) throw new Error('联络留言列表响应格式无效')
  return {
    items: raw.items.map(normalizedItem),
    pagination: {
      page: Number(pagination.page) || filters.page,
      limit: Number(pagination.limit) || 20,
      total: Number(pagination.total) || 0
    }
  }
}

export async function getContact(id: string): Promise<ContactItem> {
  return normalizedItem(await apiRequest<unknown>(`/api/admin/contact/${encodeURIComponent(id)}`))
}

export async function setContactStatus(id: string, status: ContactStatus): Promise<void> {
  await apiRequest(`/api/admin/contact/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: { status }
  })
}

export async function setContactStar(id: string, isStarred: boolean): Promise<void> {
  await apiRequest(`/api/admin/contact/${encodeURIComponent(id)}/star`, {
    method: 'PUT',
    body: { isStarred }
  })
}

export async function saveContactNote(id: string, note: string): Promise<void> {
  await apiRequest(`/api/admin/contact/${encodeURIComponent(id)}/note`, {
    method: 'PUT',
    body: { note }
  })
}

export function safeExternalLink(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
