import { apiRequest } from '@/services/api-client'
import { uploadRegisteredPrivateFile } from '@/services/private-upload'

export type FulfillmentMode = 'MAKE_TO_ORDER' | 'STOCK_ONLY'
export interface ProductCandidate {
  id: string
  skuCode: string
  modelName: string
  size: string
  material: string
  frameCount: number
  colorName: string
  basePrice: number
  previewImage: string | null
  compatible: boolean
  isActive: boolean
  inventory: { status: string; available: number; current: number; reserved: number }
}
export interface ProductSelection {
  skuId: string
  finalPrice: number
  fulfillmentMode: FulfillmentMode
  leadTimeDays: number
  sortOrder: number
  isEnabled: boolean
}
export interface ProductMedia {
  key: string
  url: string
  kind: 'image' | 'video'
}
export interface ProductWorkspace {
  productNo: string | null
  reviewStatus: string
  shelfStatus: string | null
  isOnShelf: boolean
  sourceTitle: string
  storefrontTitle: string
  storefrontSummary: string | null
  storefrontDescription: string | null
  storefrontMedia: ProductMedia[]
  storefrontTags: string[]
  storefrontSeries: string | null
  storefrontKeywords: string | null
  storefrontSortOrder: number
  coverUrl: string | null
  coverKey: string | null
  asset: { assetNo: string; versionNo: number | null } | null
  baseFrameCount: number
  readinessGroups: { content: string[]; asset: string[]; sale: string[] }
  selected: ProductSelection[]
  candidates: ProductCandidate[]
}
export interface ProductPayload {
  storefrontTitle: string
  storefrontSummary: string
  storefrontDescription: string
  storefrontSeries: string
  storefrontTags: string[]
  storefrontKeywords: string
  storefrontSortOrder: number
  storefrontMedia: string[]
  coverKey: string
  skus: ProductSelection[]
}
export interface ProductHistory {
  id: string
  action: string
  operatorName: string
  createdAt: string
}
export function getProductWorkspace(id: string): Promise<ProductWorkspace> {
  return apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/product-workspace`)
}
export function getProductHistory(id: string): Promise<ProductHistory[]> {
  return apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/product-history`)
}
export function saveProductWorkspace(
  id: string,
  body: ProductPayload
): Promise<{ ready: boolean; blockers: string[] }> {
  return apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/product-workspace`, {
    method: 'PUT',
    body: { ...body }
  })
}
export async function publishProductWorkspace(id: string): Promise<void> {
  await apiRequest(`/api/admin/collab/${encodeURIComponent(id)}/relist`, {
    method: 'PUT',
    body: {}
  })
}
export function uploadStorefrontMedia(file: File): Promise<string> {
  return uploadRegisteredPrivateFile(file, 'COLLAB_STOREFRONT_MEDIA')
}
