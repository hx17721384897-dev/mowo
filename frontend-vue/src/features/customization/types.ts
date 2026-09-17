export type CustomizationStatus =
  | 'DRAFT'
  | 'EXPIRING'
  | 'SUBMITTED'
  | 'REVIEWING'
  | 'NEEDS_SUPPLEMENT'
  | 'OPTIONS_READY'
  | 'FRAME_ACCEPTED'
  | 'STYLE_SELECTED'
  | 'UNAVAILABLE'
  | 'CONFIRMED'
  | 'CLOSED'

export type CustomizationMode = 'SELF' | 'HUMAN'

export interface CustomizationModelSummary {
  id: string
  name: string
}

export interface CustomizationSkuSummary {
  id: string
  size: string
  material: string
}

export interface CustomizationEvent {
  id: string
  eventType: string
  toStatus: CustomizationStatus | null
  publicMessage: string | null
  createdAt: string
}

export interface CustomizationSummary {
  id: string
  requestNo: string | null
  mode: CustomizationMode
  status: CustomizationStatus
  version: number
  updatedAt: string
  model: CustomizationModelSummary | null
  desiredSku: CustomizationSkuSummary | null
}

export interface CustomizationDetail extends CustomizationSummary {
  events: CustomizationEvent[]
}

export interface CustomizationPage {
  items: CustomizationSummary[]
  total: number
  page: number
  hasMore: boolean
}

export const CUSTOMIZATION_STATUS_LABEL: Record<CustomizationStatus, string> = {
  DRAFT: '草稿',
  EXPIRING: '草稿清理中',
  SUBMITTED: '等待处理',
  REVIEWING: '正在处理',
  NEEDS_SUPPLEMENT: '需要补充素材',
  OPTIONS_READY: '待确认筛帧',
  FRAME_ACCEPTED: '筛帧已确认，请选款式',
  STYLE_SELECTED: '款式已选择，请提交订单',
  UNAVAILABLE: '暂时无法制作',
  CONFIRMED: '已进入订单',
  CLOSED: '已关闭'
}
