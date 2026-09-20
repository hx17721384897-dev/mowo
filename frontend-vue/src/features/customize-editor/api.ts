import { apiRequest } from '@/services/api-client'
import { safeRemoteFrameUrl } from './source-validation'

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

export interface ExistingEditorFrame {
  key: string
  url: string
}

export interface AssetVersionEditorData {
  asset: { id: string; assetNo: string; title: string; currentVersionNo: number }
  version: { id: string; versionNo: number; frames: ExistingEditorFrame[] }
}

export interface ReviewEditorData {
  request: { id: string; requestNo: string; status: string; customProductId: string | null }
  selection: { version: number; staffMessage: string | null; frames: ExistingEditorFrame[] }
  model: { id: string; name: string; modelType: string; frameOptions: number[] }
}

export interface DraftEditorData {
  id: string
  requestId: string | null
  machineModelId: string | null
  frames: ExistingEditorFrame[]
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

function frameList(value: unknown): ExistingEditorFrame[] {
  if (!Array.isArray(value) || !value.length) throw new Error('动画帧图不完整')
  return value.map((item) => {
    const row = record(item)
    if (typeof row.key !== 'string' || typeof row.url !== 'string') {
      throw new Error('动画帧图不完整')
    }
    return { key: row.key, url: safeRemoteFrameUrl(row.url) }
  })
}

function numberList(value: unknown): number[] {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(parsed)
    ? parsed.map(Number).filter((item) => Number.isInteger(item) && item > 0)
    : []
}

export async function getAssetVersionEditor(assetId: string): Promise<AssetVersionEditorData> {
  const asset = record(
    await apiRequest<unknown>(`/api/animation-assets/${encodeURIComponent(assetId)}`)
  )
  if (asset.assetType !== 'PRIVATE') throw new Error('联名动画不能在这里直接修改')
  if (
    typeof asset.id !== 'string' ||
    typeof asset.assetNo !== 'string' ||
    typeof asset.title !== 'string' ||
    typeof asset.currentVersionNo !== 'number'
  ) {
    throw new Error('动画资产响应不完整')
  }
  const versions = Array.isArray(asset.versions) ? asset.versions : []
  const version = versions.map(record).find((item) => item.versionNo === asset.currentVersionNo)
  if (!version || typeof version.id !== 'string' || typeof version.versionNo !== 'number') {
    throw new Error('当前动画版本不存在')
  }
  return {
    asset: {
      id: asset.id,
      assetNo: asset.assetNo,
      title: asset.title,
      currentVersionNo: asset.currentVersionNo
    },
    version: { id: version.id, versionNo: version.versionNo, frames: frameList(version.frames) }
  }
}

export async function saveAssetVersion(input: {
  assetId: string
  baseVersionId: string
  clientVersionKey: string
  frameKeys: string[]
  selectedIndexes: number[]
}): Promise<number> {
  const data = record(
    await apiRequest<unknown>(
      `/api/animation-assets/${encodeURIComponent(input.assetId)}/versions`,
      {
        method: 'POST',
        body: {
          baseVersionId: input.baseVersionId,
          clientVersionKey: input.clientVersionKey,
          frameKeys: input.frameKeys,
          editorData: {
            selectedIndexes: input.selectedIndexes,
            selectedFrameCount: input.frameKeys.length
          }
        }
      }
    )
  )
  const version = record(data.version)
  if (typeof version.versionNo !== 'number') throw new Error('新动画版本响应不完整')
  return version.versionNo
}

export async function getReviewEditor(requestId: string): Promise<ReviewEditorData> {
  const data = record(
    await apiRequest<unknown>(
      `/api/customization-requests/mine/${encodeURIComponent(requestId)}/frame-selection`
    )
  )
  const request = record(data.request)
  const selection = record(data.selection)
  const model = record(data.model)
  if (
    typeof request.id !== 'string' ||
    typeof request.requestNo !== 'string' ||
    typeof request.status !== 'string' ||
    typeof selection.version !== 'number' ||
    typeof model.id !== 'string' ||
    typeof model.name !== 'string'
  ) {
    throw new Error('筛帧确认响应不完整')
  }
  const frameOptions = numberList(model.frameOptions)
  return {
    request: {
      id: request.id,
      requestNo: request.requestNo,
      status: request.status,
      customProductId: typeof request.customProductId === 'string' ? request.customProductId : null
    },
    selection: {
      version: selection.version,
      staffMessage: typeof selection.staffMessage === 'string' ? selection.staffMessage : null,
      frames: frameList(selection.frames)
    },
    model: {
      id: model.id,
      name: model.name,
      modelType: typeof model.modelType === 'string' ? model.modelType : 'single',
      frameOptions
    }
  }
}

export async function acceptReview(requestId: string): Promise<void> {
  await apiRequest(
    `/api/customization-requests/mine/${encodeURIComponent(requestId)}/frame-selection/accept`,
    { method: 'POST' }
  )
}

export async function requestReviewRevision(requestId: string, message: string): Promise<void> {
  await apiRequest(
    `/api/customization-requests/mine/${encodeURIComponent(requestId)}/frame-selection/revision`,
    { method: 'POST', body: { message } }
  )
}

export async function getDraftEditor(draftId: string): Promise<DraftEditorData> {
  const data = record(
    await apiRequest<unknown>(`/api/custom-products/${encodeURIComponent(draftId)}/editor`)
  )
  const request = data.request && typeof data.request === 'object' ? record(data.request) : null
  if (typeof data.id !== 'string') throw new Error('草稿响应不完整')
  return {
    id: data.id,
    requestId: request && typeof request.id === 'string' ? request.id : null,
    machineModelId:
      request && typeof request.machineModelId === 'string' ? request.machineModelId : null,
    frames: frameList(data.frames)
  }
}

export async function updateDraftEditor(input: {
  draftId: string
  frameKeys: string[]
  selectedIndexes: number[]
}): Promise<string | null> {
  const data = record(
    await apiRequest<unknown>(`/api/custom-products/${encodeURIComponent(input.draftId)}/editor`, {
      method: 'PATCH',
      body: {
        frameKeys: input.frameKeys,
        editorData: {
          selectedIndexes: input.selectedIndexes,
          selectedFrameCount: input.frameKeys.length
        }
      }
    })
  )
  return typeof data.requestId === 'string' ? data.requestId : null
}
