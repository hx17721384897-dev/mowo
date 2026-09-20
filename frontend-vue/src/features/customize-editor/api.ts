import { apiRequest } from '@/services/api-client'

interface HumanCustomizationPayload {
  machineModelId: string
  sourceKeys: string[]
  clientRequestKey: string
  screeningData: Record<string, unknown>
  userNote: string
}

export interface SubmittedCustomization {
  id: string
  requestNo: string
}

export async function createSelfScreenedProduct(input: {
  clientDraftKey: string
  frameKeys: string[]
  frameCount: number
  modelId: string
  modelName: string
  selectedIndexes: number[]
  trimStart: number
  trimEnd: number
}): Promise<{ id: string; frameKeys: string[] }> {
  const row = record(
    await apiRequest<unknown>('/api/custom-products', {
      method: 'POST',
      body: {
        clientDraftKey: input.clientDraftKey,
        animationFrames: JSON.stringify(input.frameKeys),
        frameCount: input.frameCount,
        draftData: JSON.stringify({
          version: 1,
          source: 'customization-self',
          selectedIndexes: input.selectedIndexes,
          trimStart: input.trimStart,
          trimEnd: input.trimEnd
        }),
        configJson: JSON.stringify({
          frameCount: input.frameCount,
          modelId: input.modelId,
          modelName: input.modelName
        })
      }
    })
  )
  if (typeof row.id !== 'string') throw new Error('筛选草稿响应缺少编号')
  let frameKeys: unknown
  try {
    frameKeys =
      typeof row.animationFrames === 'string'
        ? JSON.parse(row.animationFrames)
        : row.animationFrames
  } catch {
    throw new Error('筛选草稿帧图数据无效')
  }
  if (!Array.isArray(frameKeys) || frameKeys.some((key) => typeof key !== 'string')) {
    throw new Error('筛选草稿帧图数据无效')
  }
  return { id: row.id, frameKeys: frameKeys as string[] }
}

export async function createSelfCustomizationDraft(input: {
  clientDraftKey: string
  customProductId: string
  machineModelId: string
  sourceKeys: string[]
  selectedFrameKeys: string[]
  selectedIndexes: number[]
  validTargets: number[]
  trimStart: number
  trimEnd: number
}): Promise<string> {
  const row = record(
    await apiRequest<unknown>('/api/customization-requests/draft', {
      method: 'POST',
      body: {
        clientDraftKey: input.clientDraftKey,
        customProductId: input.customProductId,
        machineModelId: input.machineModelId,
        sourceKeys: input.sourceKeys,
        selectedFrameKeys: input.selectedFrameKeys,
        screeningData: {
          selectedFrameCount: input.selectedFrameKeys.length,
          validTargets: input.validTargets
        },
        editorData: {
          trimStart: input.trimStart,
          trimEnd: input.trimEnd,
          selectedIndexes: input.selectedIndexes,
          selectedFrameCount: input.selectedFrameKeys.length
        }
      }
    })
  )
  if (typeof row.id !== 'string') throw new Error('定制草稿响应缺少编号')
  return row.id
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('定制申请响应格式不正确')
  }
  return value as Record<string, unknown>
}

export async function submitHumanCustomization(
  payload: HumanCustomizationPayload
): Promise<SubmittedCustomization> {
  const row = record(
    await apiRequest<unknown>('/api/customization-requests', {
      method: 'POST',
      body: { mode: 'HUMAN', ...payload }
    })
  )
  if (typeof row.id !== 'string' || typeof row.requestNo !== 'string') {
    throw new Error('定制申请响应缺少必要字段')
  }
  return { id: row.id, requestNo: row.requestNo }
}
