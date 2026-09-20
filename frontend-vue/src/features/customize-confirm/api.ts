import { apiRequest } from '@/services/api-client'
import type { MachineSku } from '@/features/customize-start/types'
import type { ConfirmationContext, ConfirmationEntry, SelectedVariant } from './types'

function record(value: unknown, message = '确认页数据格式不正确'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function text(value: unknown, message = '确认页数据缺少必要字段'): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapSku(value: unknown): MachineSku {
  const row = record(value, '规格数据格式不正确')
  const colorHex =
    typeof row.colorHex === 'string' && /^#[0-9a-f]{3,8}$/i.test(row.colorHex)
      ? row.colorHex
      : '#c4c3bf'
  return {
    id: text(row.id),
    size: text(row.size),
    material: text(row.material),
    frameCount: number(row.frameCount),
    colorName: text(row.colorName),
    colorHex,
    price: number(row.price),
    previewUrl: null
  }
}

async function skus(modelId: string): Promise<MachineSku[]> {
  const data = await apiRequest<unknown>(`/api/machine-models/${encodeURIComponent(modelId)}/skus`)
  if (!Array.isArray(data)) throw new Error('规格列表格式不正确')
  return data.map(mapSku)
}

export function parseConfirmationEntry(query: Record<string, unknown>): ConfirmationEntry {
  const requestId = typeof query.requestId === 'string' ? query.requestId : null
  const humanRequestId = typeof query.humanRequestId === 'string' ? query.humanRequestId : null
  const assetId = typeof query.assetId === 'string' ? query.assetId : null
  const modelId = typeof query.modelId === 'string' ? query.modelId : null
  const count =
    Number(Boolean(requestId)) + Number(Boolean(humanRequestId)) + Number(Boolean(assetId))
  if (count !== 1 || (assetId && !modelId))
    throw new Error('确认页入口参数无效，请从定制流程重新进入')
  return {
    mode: assetId ? 'asset' : humanRequestId ? 'human' : 'self',
    requestId: humanRequestId ?? requestId,
    assetId,
    modelId
  }
}

export async function loadConfirmation(entry: ConfirmationEntry): Promise<ConfirmationContext> {
  if (entry.mode !== 'asset') {
    const data = record(
      await apiRequest<unknown>(
        `/api/customization-requests/mine/${encodeURIComponent(entry.requestId!)}/confirmation`
      )
    )
    const request = record(data.request)
    const model = record(data.model)
    const baseFrameCount = number(data.baseFrameCount)
    const validTargets = Array.isArray(data.validTargets)
      ? data.validTargets.map(number).filter(Boolean)
      : []
    const modelId = text(model.id)
    return {
      mode: entry.mode,
      requestId: text(request.id),
      assetId: null,
      customProductId: text(request.customProductId),
      requestStatus: text(request.status),
      model: {
        id: modelId,
        name: text(model.name),
        modelType: String(model.modelType || 'single')
      },
      baseFrameCount,
      validTargets,
      skus: await skus(modelId)
    }
  }
  const [assetRaw, modelRaw, modelSkus] = await Promise.all([
    apiRequest<unknown>(`/api/animation-assets/${encodeURIComponent(entry.assetId!)}`),
    apiRequest<unknown>(`/api/machine-models/${encodeURIComponent(entry.modelId!)}`),
    skus(entry.modelId!)
  ])
  const asset = record(assetRaw)
  const model = record(modelRaw)
  const versions = Array.isArray(asset.versions) ? asset.versions.map((item) => record(item)) : []
  const current = versions.find((item) => number(item.versionNo) === number(asset.currentVersionNo))
  const baseFrameCount = number(current?.baseFrameCount)
  if (asset.assetType !== 'PRIVATE' || !baseFrameCount)
    throw new Error('动画当前版本不可用于再次制作')
  const validTargets = [
    ...new Set(
      modelSkus
        .map((sku) => sku.frameCount)
        .filter((target) => target >= baseFrameCount && target % baseFrameCount === 0)
    )
  ].sort((a, b) => a - b)
  if (!validTargets.length) throw new Error('当前没有兼容且可售的规格')
  return {
    mode: 'asset',
    requestId: null,
    assetId: text(asset.id),
    customProductId: null,
    requestStatus: null,
    model: {
      id: text(model.id),
      name: text(model.name),
      modelType: String(model.modelType || 'single')
    },
    baseFrameCount,
    validTargets,
    skus: modelSkus
  }
}

function requestedOptions(variants: SelectedVariant[]) {
  return variants.map((item) => ({
    skuId: item.skuId,
    frame: item.frame,
    size: item.size,
    material: item.material,
    colorName: item.colorName,
    referencePrice: item.price
  }))
}

export async function confirmSelection(
  context: ConfirmationContext,
  variants: SelectedVariant[],
  note: string,
  flowKey: string
): Promise<string> {
  const primary = variants[variants.length - 1]!
  if (context.mode === 'asset') {
    const data = record(
      await apiRequest<unknown>(
        `/api/animation-assets/${encodeURIComponent(context.assetId!)}/reuse`,
        {
          method: 'POST',
          body: {
            clientRequestKey: `confirm-${flowKey}`.slice(0, 80),
            machineModelId: context.model.id,
            desiredSkuId: primary.skuId,
            userNote: note,
            requestedOptions: requestedOptions(variants)
          }
        }
      )
    )
    return text(data.customProductId, '复购响应缺少定制品编号')
  }
  const path =
    context.mode === 'human'
      ? `/api/customization-requests/mine/${encodeURIComponent(context.requestId!)}/choose-sku`
      : `/api/customization-requests/${encodeURIComponent(context.requestId!)}/submit`
  await apiRequest(path, {
    method: 'POST',
    body: {
      desiredSkuId: primary.skuId,
      userNote: note,
      editorData: { requestedOptions: requestedOptions(variants) }
    }
  })
  return context.customProductId!
}

export async function addCustomizationToCart(input: {
  customProductId: string
  variant: SelectedVariant
  flowKey: string
  groupId: string
}): Promise<string> {
  const data = record(
    await apiRequest<unknown>('/api/cart/add', {
      method: 'POST',
      body: {
        itemType: 'CUSTOM',
        contentId: input.customProductId,
        hardwareSkuId: input.variant.skuId,
        quantity: 1,
        sessionGroupId: input.groupId,
        idempotencyKey: `confirm-cart-${input.flowKey}-${input.variant.id}`.slice(0, 100)
      }
    })
  )
  return text(data.id, '购物车响应缺少条目编号')
}
