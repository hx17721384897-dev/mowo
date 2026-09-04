export class CollabStorefrontError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message)
    this.name = 'CollabStorefrontError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function publicCollabWorkWhere(extra = {}) {
  return {
    status: 'approved',
    isOnShelf: true,
    shelfStatus: 'on_sale',
    isRevision: false,
    ...extra,
  }
}

export function isPubliclySaleableCollabWork(work) {
  return Boolean(
    work &&
    work.status === 'approved' &&
    work.isOnShelf === true &&
    work.shelfStatus === 'on_sale' &&
    work.isRevision !== true
  )
}

export function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return fallback
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (value == null || value === '') return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function collabFinalPrice(work, sku) {
  const basePrice = Number(sku?.price)
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    throw new CollabStorefrontError('INVALID_SKU_PRICE', '商品价格配置异常', 409)
  }

  const markups = parseJsonObject(work?.creatorMarkups)
  const rawMarkup = markups[sku.id] ?? 0
  const markup = Number(rawMarkup)
  if (!Number.isFinite(markup) || markup < 0) {
    throw new CollabStorefrontError('INVALID_COLLAB_PRICE', '联名商品价格配置异常', 409)
  }

  return Number((basePrice + markup).toFixed(2))
}

export function isSkuSupportedByCollabWork(work, sku) {
  if (!sku?.id) return false
  const supported = parseJsonArray(work?.supportedSkus)
  return supported.includes(sku.id) || Boolean(sku.skuCode && supported.includes(sku.skuCode))
}

export async function resolveCollabOffer(prisma, workId, skuId) {
  const work = await prisma.collabWork.findUnique({
    where: { id: workId },
    select: {
      id: true,
      creatorId: true,
      title: true,
      coverUrl: true,
      supportedSkus: true,
      creatorMarkups: true,
      status: true,
      isOnShelf: true,
      shelfStatus: true,
      isRevision: true,
      animationAssetId: true,
      animationVersionId: true,
    },
  })
  if (!isPubliclySaleableCollabWork(work)) {
    throw new CollabStorefrontError('COLLAB_NOT_FOR_SALE', '联名商品不存在或已停止销售', 404)
  }

  const sku = await prisma.machineModelSku.findUnique({
    where: { id: skuId },
    include: { model: { select: { id: true, name: true, isActive: true } } },
  })
  if (!sku || !sku.isActive || !sku.model?.isActive) {
    throw new CollabStorefrontError('SKU_NOT_FOR_SALE', '商品规格不存在或已停止销售', 404)
  }
  if (!isSkuSupportedByCollabWork(work, sku)) {
    throw new CollabStorefrontError('SKU_NOT_SUPPORTED', '该联名商品不支持所选规格', 409)
  }

  return {
    work,
    sku,
    finalPrice: collabFinalPrice(work, sku),
  }
}
