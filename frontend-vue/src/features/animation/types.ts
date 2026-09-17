export type AnimationFilter = 'all' | 'asset' | 'draft'
export type AnimationAssetType = 'PRIVATE' | 'COLLAB'
export type AnimationDraftStatus = 'draft' | 'in_cart' | 'ordered'

export interface AnimationAssetItem {
  kind: 'asset'
  id: string
  assetNo: string
  title: string
  assetType: AnimationAssetType
  currentVersionNo: number
  frameCount: number
  previewUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface AnimationDraftItem {
  kind: 'draft'
  id: string
  title: string
  modelName: string | null
  size: string | null
  material: string | null
  colorName: string | null
  frameCount: number
  status: AnimationDraftStatus
  draftExpiresAt: string | null
  previewUrl: string | null
  createdAt: string
  updatedAt: string
}

export type AnimationItem = AnimationAssetItem | AnimationDraftItem

export interface AnimationLibraryPage {
  items: AnimationItem[]
  total: number
}
