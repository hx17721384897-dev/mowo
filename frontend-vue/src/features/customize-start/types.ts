export interface MachineSku {
  id: string
  size: string
  material: string
  frameCount: number
  colorName: string
  colorHex: string
  price: number
  previewUrl: string | null
}

export interface MachineModel {
  id: string
  name: string
  description: string
  modelType: string
  previewUrl: string | null
  videoUrl: string | null
  ratios: string[]
  skus: MachineSku[]
}

export interface ReusableAnimation {
  id: string
  assetNo: string
  title: string
  currentVersionNo: number
  baseFrameCount: number
}

export interface DraftQuota {
  count: number
  limit: number
  canCreate: boolean
}
