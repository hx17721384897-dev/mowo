import { CollabStorefrontError, resolveCollabOffer } from './collab-storefront.js'

const SNAPSHOT_VERSION = 1

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function money(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error('商品价格异常')
  return Number(number.toFixed(2))
}

function skuSnapshot(sku) {
  return {
    id: sku.id,
    code: sku.skuCode || null,
    modelId: sku.modelId,
    modelName: sku.model?.name || '',
    frameCount: Number(sku.frameCount || 0),
    size: sku.size || '',
    material: sku.material || '',
    colorHex: sku.colorHex || '',
    colorName: sku.colorName || '',
  }
}

function assertQuantity(item) {
  const quantity = Number(item.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    const error = new Error('单个商品数量需为 1 至 10 件')
    error.code = 'INVALID_QUANTITY'
    throw error
  }
  return quantity
}

export async function buildCheckoutItemSnapshot(prisma, item, userId) {
  const quantity = assertQuantity(item)
  const sku = await prisma.machineModelSku.findUnique({
    where: { id: item.hardwareSkuId },
    include: { model: true },
  })
  if (!sku?.isActive || !sku.model?.isActive) throw new Error('商品规格已停用')

  if (item.itemType === 'MARKET') {
    let offer
    try {
      offer = await resolveCollabOffer(prisma, item.contentId, item.hardwareSkuId)
    } catch (error) {
      if (error instanceof CollabStorefrontError) throw new Error(error.message)
      throw error
    }
    if (!offer.work.animationAssetId || !offer.work.animationVersionId) {
      throw new Error('联名商品缺少可生产的动画版本')
    }
    const unitPrice = money(offer.finalPrice)
    const baseUnitPrice = money(sku.price)
    return {
      cartItemId: item.id,
      itemType: 'MARKET',
      contentId: item.contentId,
      customProductId: null,
      animationAssetId: offer.work.animationAssetId,
      animationVersionId: offer.work.animationVersionId,
      frameKeys: Array.isArray(offer.work.animationVersion?.frameKeys) ? offer.work.animationVersion.frameKeys : [],
      sku: skuSnapshot(sku),
      title: offer.work.storefrontTitle || offer.work.title || '联名作品',
      previewUrl: offer.work.storefrontCoverUrl || offer.work.coverUrl || null,
      config: null,
      productNo: offer.work.productNo || null,
      fulfillmentMode: offer.saleConfig.fulfillmentMode,
      leadTimeDays: offer.saleConfig.leadTimeDays,
      baseUnitPrice,
      priceAdjustment: money(unitPrice - baseUnitPrice),
      unitPrice,
      quantity,
      lineTotal: money(unitPrice * quantity),
    }
  }

  if (item.itemType !== 'CUSTOM') throw new Error('购物车商品类型异常')
  const product = await prisma.customProduct.findUnique({
    where: { id: item.customProductId || item.contentId },
    include: { animationVersion: true },
  })
  if (!product || product.userId !== userId) throw new Error('私人定制不存在或不属于当前账号')
  if (['ordered', 'removed'].includes(product.status)) throw new Error('私人定制已失效或已下单')
  if (product.hardwareSkuId !== sku.id) throw new Error('私人定制的款式与购物车不一致')
  if (!product.animationAssetId || !product.animationVersionId || !product.animationVersion) {
    throw new Error('私人定制尚未生成可生产的动画版本')
  }
  if (product.frameCount && sku.frameCount && sku.frameCount % product.frameCount !== 0) {
    throw new Error('私人定制动画与所选帧数不兼容')
  }

  const unitPrice = money(sku.price)
  const frames = parseJson(product.animationFrames, [])
  return {
    cartItemId: item.id,
    itemType: 'CUSTOM',
    contentId: product.id,
    customProductId: product.id,
    animationAssetId: product.animationAssetId,
    animationVersionId: product.animationVersionId,
    frameKeys: Array.isArray(product.animationVersion.frameKeys) && product.animationVersion.frameKeys.length
      ? product.animationVersion.frameKeys
      : (Array.isArray(frames) ? frames : []),
    sku: skuSnapshot(sku),
    title: item.snapshotTitle || '私人定制',
    previewUrl: item.snapshotPreviewUrl || item.coverUrl || product.previewUrl || null,
    config: parseJson(item.configSnapshotJson || product.configJson, {}),
    productNo: null,
    fulfillmentMode: 'MAKE_TO_ORDER',
    leadTimeDays: null,
    baseUnitPrice: unitPrice,
    priceAdjustment: 0,
    unitPrice,
    quantity,
    lineTotal: money(unitPrice * quantity),
  }
}

export function createCheckoutSnapshot(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('结算商品为空')
  const totalAmount = money(items.reduce((sum, item) => sum + item.lineTotal, 0))
  return { version: SNAPSHOT_VERSION, createdAt: new Date().toISOString(), totalAmount, items }
}

export function readCheckoutSnapshot(value) {
  const snapshot = parseJson(value, null)
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.items) || !snapshot.items.length) {
    throw new Error('付款前订单快照缺失，请返回购物车重新结算')
  }
  return snapshot
}

export function checkoutReservations(snapshot) {
  const totals = new Map()
  for (const item of snapshot.items) {
    const skuId = item?.sku?.id
    const quantity = Number(item?.quantity)
    if (!skuId || !Number.isInteger(quantity) || quantity < 1) throw new Error('库存快照异常')
    totals.set(skuId, (totals.get(skuId) || 0) + quantity)
  }
  return [...totals.entries()].map(([skuId, quantity]) => ({ skuId, quantity }))
}

export async function reserveCheckoutInventory(tx, snapshot, preOrderId, checkoutKey) {
  for (const reservation of checkoutReservations(snapshot)) {
    const before = await tx.skuInventory.findUnique({ where: { skuId: reservation.skuId } })
    const result = await tx.$executeRaw`
      UPDATE sku_inventory
      SET reserved_stock = reserved_stock + ${reservation.quantity}, updated_at = NOW()
      WHERE sku_id = ${reservation.skuId}
        AND (current_stock - reserved_stock - wip_frame_qty - wip_kit_qty) >= ${reservation.quantity}
    `
    if (result !== 1) {
      const error = new Error('部分商品材料包库存不足，请调整数量')
      error.code = 'INSUFFICIENT_STOCK'
      throw error
    }
    const beforeAvailable = before
      ? before.currentStock - before.reservedStock - before.wipFrameQty - before.wipKitQty
      : 0
    await tx.inventoryLog.create({ data: {
      skuId: reservation.skuId,
      type: 'reserved',
      quantity: reservation.quantity,
      orderId: preOrderId,
      operatorId: 'system',
      idempotencyKey: `checkout_reserve_${checkoutKey}_${reservation.skuId}`.slice(0, 100),
      beforeQty: beforeAvailable,
      afterQty: beforeAvailable - reservation.quantity,
      note: '混合购物车结算预锁',
    } })
  }
}

export async function closePreOrderAndRelease(prisma, preOrder, nextStatus) {
  if (!preOrder || preOrder.status !== 'pending_payment') return false
  return prisma.$transaction(async tx => {
    const claimed = await tx.preOrder.updateMany({
      where: { id: preOrder.id, status: 'pending_payment' },
      data: { status: nextStatus },
    })
    if (claimed.count !== 1) return false
    const snapshot = readCheckoutSnapshot(preOrder.checkoutSnapshot)
    for (const reservation of checkoutReservations(snapshot)) {
      const before = await tx.skuInventory.findUnique({ where: { skuId: reservation.skuId } })
      await tx.$executeRaw`
        UPDATE sku_inventory
        SET reserved_stock = GREATEST(0, reserved_stock - ${reservation.quantity}), updated_at = NOW()
        WHERE sku_id = ${reservation.skuId}
      `
      const beforeAvailable = before
        ? before.currentStock - before.reservedStock - before.wipFrameQty - before.wipKitQty
        : 0
      await tx.inventoryLog.create({ data: {
        skuId: reservation.skuId,
        type: 'released',
        quantity: reservation.quantity,
        orderId: preOrder.id,
        operatorId: 'system',
        idempotencyKey: `checkout_${nextStatus}_${preOrder.id}_${reservation.skuId}`.slice(0, 100),
        beforeQty: beforeAvailable,
        afterQty: beforeAvailable + reservation.quantity,
        note: nextStatus === 'expired' ? '付款前订单超时释放' : '付款前订单取消释放',
      } })
    }
    return true
  })
}
