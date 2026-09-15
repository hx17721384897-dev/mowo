export type CollabSort = 'recommended' | 'latest' | 'popular'

export interface CollabCreator {
  userId: string
  nickname: string
  avatarUrl: string | null
}

export interface CollabCreatorFilter {
  id: string
  name: string
}

export interface CollabWorkSummary {
  id: string
  creatorId: string
  title: string
  description: string
  coverUrl: string | null
  hoverGifUrl: string | null
  approvedAt: string | null
  creator: CollabCreator
  minPrice: number | null
  availableSkuCount: number
  availableSizes: string[]
  minLeadTimeDays: number | null
  previewFrames: string[]
}

export interface CollabWorkPage {
  works: CollabWorkSummary[]
  total: number
  page: number
  limit: number
  hasMore: boolean
  sort: CollabSort
  creators: CollabCreatorFilter[]
}

export interface CollabMedia {
  url: string
  kind: 'image' | 'video'
}

export interface CollabSku {
  id: string
  modelId: string
  modelName: string
  size: string
  material: string
  frameCount: number
  colorName: string | null
  colorHex: string | null
  previewImage: string | null
  finalPrice: number
  fulfillmentMode: string
  leadTimeDays: number
  exampleMedia: string[]
}

export interface CollabWorkDetail {
  id: string
  creatorId: string
  title: string
  description: string
  storefrontSummary: string | null
  storefrontMedia: CollabMedia[]
  storefrontTags: string[]
  storefrontSeries: string | null
  animationFrames: string[]
  hoverGifUrl: string | null
  coverUrl: string | null
  supportedSkus: CollabSku[]
  approvedAt: string | null
  creator: CollabCreator
}
