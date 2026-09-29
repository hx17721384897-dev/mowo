import { parseJsonArray } from './collab-storefront.js'

export const COLLAB_FULFILLMENT_MODE = Object.freeze({
  STOCK_ONLY: 'STOCK_ONLY',
  MAKE_TO_ORDER: 'MAKE_TO_ORDER',
})

export function isCollabSkuFrameCompatible(baseFrameCount, targetFrameCount) {
  return Number.isInteger(baseFrameCount)
    && baseFrameCount > 0
    && Number.isInteger(targetFrameCount)
    && targetFrameCount >= baseFrameCount
    && targetFrameCount % baseFrameCount === 0
}

export function isLegacyInlineCollabCover(value) {
  return /^data:/i.test(String(value || '').trim())
}

export function normalizeSaleConfigInput(body) {
  const summary = String(body?.storefrontSummary || '').trim()
  const storefrontSortOrder = Number.parseInt(body?.storefrontSortOrder, 10)
  const rows = Array.isArray(body?.skus) ? body.skus : []
  return {
    storefrontSummary: summary || null,
    storefrontSortOrder: Number.isInteger(storefrontSortOrder) ? storefrontSortOrder : 0,
    skus: rows.map((row, index) => ({
      skuId: String(row?.skuId || '').trim(),
      finalPrice: Number(row?.finalPrice),
      fulfillmentMode: String(row?.fulfillmentMode || ''),
      leadTimeDays: Number.parseInt(row?.leadTimeDays, 10),
      sortOrder: index,
      isEnabled: row?.isEnabled !== false,
    })),
  }
}

export async function getCollabSaleReadiness(prisma, workId) {
  const work = await prisma.collabWork.findUnique({
    where: { id: workId },
    select: {
      id: true,
      status: true,
      coverUrl: true,
      storefrontTitle: true,
      description: true,
      storefrontDescription: true,
      storefrontCoverUrl: true,
      storefrontMedia: true,
      animationFrames: true,
      animationAssetId: true,
      animationVersionId: true,
      storefrontSummary: true,
      storefrontSortOrder: true,
      animationVersion: { select: { baseFrameCount: true } },
      saleSkus: {
        where: { isEnabled: true },
        orderBy: { sortOrder: 'asc' },
        include: { sku: { include: { model: true } } },
      },
    },
  })
  if (!work) return { work: null, ready: false, blockers: ['作品不存在'], baseFrameCount: 0, offers: [] }

  const fallbackFrameCount = parseJsonArray(work.animationFrames).length
  const baseFrameCount = work.animationVersion?.baseFrameCount || fallbackFrameCount
  const blockers = []
  if (work.status !== 'approved') blockers.push('作品尚未完成线下合作确认')
  if (!work.animationAssetId || !work.animationVersionId) blockers.push('尚未关联正式动画资产与版本')
  if (!baseFrameCount) blockers.push('没有可用的核心帧')
  const effectiveCover = work.storefrontCoverUrl || work.coverUrl
  if (!effectiveCover) blockers.push('尚未设置商品封面')
  else if (isLegacyInlineCollabCover(effectiveCover)) blockers.push('旧版内嵌封面不能用于正式商品，请重新上传商品封面')
  if (!work.storefrontTitle?.trim()) blockers.push('尚未填写顾客看到的商品标题')
  if (!work.storefrontSummary?.trim()) blockers.push('尚未填写商品卖点简介')
  if (!(work.storefrontDescription || work.description)?.trim()) blockers.push('尚未填写商品详情')
  if (!work.saleSkus.length) blockers.push('尚未配置可售 SKU')

  for (const offer of work.saleSkus) {
    const sku = offer.sku
    if (!sku?.isActive || !sku.model?.isActive) blockers.push(`SKU ${sku?.skuCode || sku?.id || offer.skuId} 已停用`)
    if (!isCollabSkuFrameCompatible(baseFrameCount, sku?.frameCount)) {
      blockers.push(`SKU ${sku?.skuCode || sku?.id || offer.skuId} 的帧数不兼容`)
    }
    if (Number(offer.finalPrice) < Number(sku?.price)) blockers.push(`SKU ${sku?.skuCode || sku?.id || offer.skuId} 的最终售价低于基础价`)
    if (!Object.values(COLLAB_FULFILLMENT_MODE).includes(offer.fulfillmentMode)) blockers.push(`SKU ${sku?.skuCode || sku?.id || offer.skuId} 的履约方式无效`)
    if (offer.leadTimeDays < 1 || offer.leadTimeDays > 60) blockers.push(`SKU ${sku?.skuCode || sku?.id || offer.skuId} 的发货天数无效`)
  }

  return {
    work,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    baseFrameCount,
    offers: work.saleSkus,
  }
}
