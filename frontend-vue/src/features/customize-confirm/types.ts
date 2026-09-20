import type { MachineSku } from '@/features/customize-start/types'

export type ConfirmationMode = 'self' | 'human' | 'asset'

export interface ConfirmationEntry {
  mode: ConfirmationMode
  requestId: string | null
  assetId: string | null
  modelId: string | null
}

export interface ConfirmationContext {
  mode: ConfirmationMode
  requestId: string | null
  assetId: string | null
  customProductId: string | null
  requestStatus: string | null
  model: { id: string; name: string; modelType: string }
  baseFrameCount: number
  validTargets: number[]
  skus: MachineSku[]
}

export interface SelectedVariant {
  id: string
  skuId: string
  frame: number
  size: string
  material: string
  colorName: string
  colorHex: string
  price: number
}
