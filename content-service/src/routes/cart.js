// src/routes/cart.js
// 服务端购物车 API
// 注册前缀：/api/cart

import crypto from 'crypto'
import {
  CollabStorefrontError,
  resolveCollabOffer,
} from '../lib/collab-storefront.js'
import {
  buildCheckoutItemSnapshot,
  closePreOrderAndRelease,
  createCheckoutSnapshot,
  reserveCheckoutInventory,
} from '../lib/checkout-snapshot.js'
import {
  CustomProductSelectionError,
  resolveConfirmedCustomProductSelection,
} from '../lib/custom-product-selection.js'

function validateCheckoutAddress({ receiverName, receiverPhone, receiverAddress, receiverCity }) {
  const name = String(receiverName || '').trim()
  const phone = String(receiverPhone || '').trim()
  const address = String(receiverAddress || '').trim()
  const city = String(receiverCity || '').trim()
  if (name.length < 1 || name.length > 50) return '收件人姓名需为 1 至 50 个字符'
  if (!/^1[3-9]\d{9}$/.test(phone)) return '收件手机号格式不正确'
  if (city.length < 1 || city.length > 80) return '请填写正确的收件城市'
  if (address.length < 5 || address.length > 500) return '收件地址需为 5 至 500 个字符'
  return null
}

function preOrderResponse(preOrder) {
  return {
    id: preOrder.id,
    status: preOrder.status,
    totalAmount: preOrder.totalAmount,
    expiresAt: preOrder.expiresAt,
    createdAt: preOrder.createdAt,
  }
}

// ── 计算商品当前价格 ──
async function getItemCurrentPrice(prisma, item) {
  try {
    if (item.itemType === 'MARKET') {
      const offer = await resolveCollabOffer(prisma, item.contentId, item.hardwareSkuId)
      return offer.finalPrice
    }
    const sku = await prisma.machineModelSku.findUnique({
      where: { id: item.hardwareSkuId },
      select: { price: true, isActive: true, model: { select: { isActive: true } } }
    })
    return sku?.isActive && sku.model?.isActive ? sku.price : null
  } catch (error) {
    if (!(error instanceof CollabStorefrontError)) throw error
    return null
  }
}

// ── 获取或创建购物车 ──
async function getOrCreateCart(prisma, userId) {
  let cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { orderBy: { createdAt: 'asc' } } }
  })
  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId },
      include: { items: { orderBy: { createdAt: 'asc' } } }
    })
  }
  return cart
}

export default async function cartRoutes(fastify) {
  const { prisma } = fastify

  // ── C.1 GET /api/cart — 获取购物车 ──
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const cart = await getOrCreateCart(prisma, userId)

    // 实时校验每个商品的价格和库存状态
    const items = await Promise.all(cart.items.map(async item => {
      const currentPrice = await getItemCurrentPrice(prisma, item)
      let status = item.status

      // 作品、款式或关联关系失效后，旧购物车条目不可继续结算。
      if (currentPrice === null && status !== 'invalid') {
        status = 'invalid'
        await prisma.cartItem.update({ where: { id: item.id }, data: { status } })
      }

      // 检测价格变动
      if (currentPrice !== null && item.snapshotPrice !== null) {
        const diff = Math.abs(Number(currentPrice) - Number(item.snapshotPrice))
        if (diff > 0.01 && status === 'normal') {
          status = 'price_changed'
          await prisma.cartItem.update({ where: { id: item.id }, data: { status } })
        } else if (diff <= 0.01 && status === 'price_changed') {
          status = 'normal'
          await prisma.cartItem.update({ where: { id: item.id }, data: { status } })
        }
      }

      // 两类实物都要占用对应 SKU 材料包库存。
      if (status !== 'invalid') {
        const inv = await prisma.skuInventory.findFirst({ where: { skuId: item.hardwareSkuId } })
        const available = inv
          ? inv.currentStock - inv.reservedStock - (inv.wipFrameQty || 0) - (inv.wipKitQty || 0)
          : 0
        if (available < item.quantity && status === 'normal') {
          status = 'stock_out'
          await prisma.cartItem.update({ where: { id: item.id }, data: { status } })
        } else if (available >= item.quantity && status === 'stock_out') {
          status = 'normal'
          await prisma.cartItem.update({ where: { id: item.id }, data: { status } })
        }
      }

      return { ...item, status, currentPrice }
    }))

    // 批量查询联名款创作者信息（nickname + avatarUrl）
    const creatorIds = [...new Set(items.filter(i => i.creatorId).map(i => i.creatorId))]
    let creatorProfiles = {}
    if (creatorIds.length > 0) {
      const profiles = await prisma.userProfile.findMany({
        where: { userId: { in: creatorIds } },
        select: { userId: true, nickname: true, avatarUrl: true }
      })
      creatorProfiles = Object.fromEntries(profiles.map(p => [p.userId, p]))
    }

    const selectedItems = items.filter(i => i.selected && i.status !== 'invalid' && i.status !== 'stock_out')
    const totalPrice = selectedItems.reduce((sum, i) => {
      const price = i.currentPrice ?? Number(i.snapshotPrice ?? 0)
      return sum + price * i.quantity
    }, 0)

    return reply.send({
      success: true,
      data: {
        cartId: cart.id,
        items,
        creatorProfiles,
        totalSelected: selectedItems.reduce((s, i) => s + i.quantity, 0),
        totalPrice: totalPrice.toFixed(2)
      }
    })
  })

  // ── C.2 POST /api/cart/add — 加入购物车（幂等）──
  fastify.post('/add', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { itemType, contentId, hardwareSkuId, quantity = 1, sessionGroupId = null } = req.body
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim()
    const requestedQuantity = Number(quantity)

    if (!itemType || !contentId || !hardwareSkuId) {
      return reply.code(400).send({ success: false, message: '缺少必要参数' })
    }
    if (!['MARKET', 'CUSTOM'].includes(itemType)) {
      return reply.code(400).send({ success: false, message: 'itemType 必须是 MARKET 或 CUSTOM' })
    }
    if (idempotencyKey.length > 100) {
      return reply.code(400).send({ success: false, message: '加购标识无效，请刷新后重试' })
    }
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 10) {
      return reply.code(400).send({ success: false, message: '单个商品购买数量需为 1 至 10 件' })
    }

    const replayMutation = async () => {
      if (!idempotencyKey) return null
      const mutation = await prisma.cartMutation.findUnique({ where: { idempotencyKey } })
      if (!mutation) return null
      if (
        mutation.userId !== userId ||
        mutation.itemType !== itemType ||
        mutation.contentId !== contentId ||
        mutation.hardwareSkuId !== hardwareSkuId
      ) {
        return { conflict: true }
      }
      const item = await prisma.cartItem.findUnique({ where: { id: mutation.cartItemId } })
      return item ? { item } : { conflict: true }
    }
    const replay = await replayMutation()
    if (replay?.conflict) {
      return reply.code(409).send({ success: false, message: '加购标识冲突，请刷新后重试' })
    }
    if (replay?.item) {
      return reply.send({ success: true, data: replay.item, idempotent: true })
    }

    // 查询 SKU
    const sku = await prisma.machineModelSku.findUnique({
      where: { id: hardwareSkuId },
      include: { model: { select: { name: true } } }
    })
    if (!sku || !sku.isActive) return reply.code(404).send({ success: false, message: 'SKU 不存在或已停用' })

    let snapshotTitle = ''
    let coverUrl = null
    let creatorId = null
    let customProductId = null
    let configSnapshotJson = null
    let snapshotPreviewUrl = null
    let resolvedPrice = Number(sku.price)

    // ── 物理约束校验 ──
    if (itemType === 'CUSTOM') {
      let cp
      try {
        const selection = await resolveConfirmedCustomProductSelection(prisma, {
          userId,
          customProductId: contentId,
          sku,
        })
        cp = selection.product
      } catch (error) {
        if (error instanceof CustomProductSelectionError) {
          return reply.code(error.statusCode).send({ success: false, message: error.message })
        }
        throw error
      }

      // 拼完整规格快照：合并 customProduct 级别配置 + 当前 SKU 的规格
      const cpConfig = (() => { try { return JSON.parse(cp.configJson || '{}') } catch { return {} } })()
      // 用第一帧图作预览兜底（OSS 私有桶 URL，前端读取时走预签名）
      const firstFrame = (() => { try { return JSON.parse(cp.animationFrames || '[]')[0] || null } catch { return null } })()

      configSnapshotJson = JSON.stringify({
        modelId:        cpConfig.modelId   || null,
        modelName:      sku.model?.name    || cpConfig.modelName || null,
        userFrameCount: cpConfig.frameCount || null,   // 用户实际上传帧数（循环基准）
        skuFrameCount:  sku.frameCount      || null,   // SKU 目标帧数（12/24 等）
        size:           sku.size            || null,
        material:       sku.material        || null,
        colorName:      sku.colorName       || null,
      })
      snapshotTitle = [
        '定制款',
        sku.model?.name || null,
        sku.size        || null,
        sku.frameCount  ? sku.frameCount + '帧' : null,
        sku.material    || null,
        sku.colorName   || null,
      ].filter(Boolean).join(' · ')
      snapshotPreviewUrl = cp.previewUrl || firstFrame || null
      customProductId = cp.id

    } else {
      // MARKET 类型
      let offer
      try {
        offer = await resolveCollabOffer(prisma, contentId, hardwareSkuId)
      } catch (error) {
        if (error instanceof CollabStorefrontError) {
          return reply.code(error.statusCode).send({ success: false, message: error.message, code: error.code })
        }
        throw error
      }
      const work = offer.work

      snapshotTitle = work.storefrontTitle || work.title || '联名作品'
      coverUrl = work.storefrontCoverUrl || work.coverUrl || null
      creatorId = work.creatorId || null
      resolvedPrice = offer.finalPrice
    }

    const cart = await getOrCreateCart(prisma, userId)

    try {
      const saved = await prisma.$transaction(async tx => {
        if (itemType === 'CUSTOM') {
          await tx.customProduct.update({ where: { id: contentId }, data: { status: 'in_cart' } })
        }

        const existing = await tx.cartItem.findFirst({
          where: { cartId: cart.id, contentId, hardwareSkuId, status: { not: 'invalid' } }
        })
        let item
        let merged = false
        if (existing) {
          if (existing.quantity + requestedQuantity > 10) {
            const error = new Error('同一商品在购物车中最多保留 10 件')
            error.statusCode = 400
            throw error
          }
          await cancelPendingPreOrdersForItems(tx, userId, [existing.id])
          item = await tx.cartItem.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + requestedQuantity,
              snapshotPrice: resolvedPrice,
              status: 'normal',
            }
          })
          merged = true
        } else {
          item = await tx.cartItem.create({
            data: {
              cartId: cart.id,
              itemType,
              contentId,
              hardwareSkuId,
              hardwareSkuCode: sku.skuCode || null,
              snapshotTitle,
              snapshotPreviewUrl,
              coverUrl,
              configSnapshotJson,
              snapshotPrice: resolvedPrice,
              quantity: requestedQuantity,
              selected: true,
              creatorId,
              status: 'normal',
              customProductId,
              sessionGroupId: sessionGroupId || null
            }
          })
        }
        if (idempotencyKey) {
          await tx.cartMutation.create({ data: {
            userId, idempotencyKey, itemType, contentId, hardwareSkuId, cartItemId: item.id
          } })
        }
        await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } })
        return { item, merged }
      })
      return reply.code(saved.merged ? 200 : 201).send({
        success: true,
        data: saved.item,
        ...(saved.merged ? { merged: true } : {})
      })
    } catch (error) {
      if (idempotencyKey && error.code === 'P2002') {
        const repeated = await replayMutation()
        if (repeated?.item) {
          return reply.send({ success: true, data: repeated.item, idempotent: true })
        }
        return reply.code(409).send({ success: false, message: '加购标识冲突，请刷新后重试' })
      }
      if (error.statusCode === 400) {
        return reply.code(400).send({ success: false, message: error.message })
      }
      throw error
    }
  })

  // ── C.3 POST /api/cart/item/:id/update — 修改数量/选中状态 ──
  fastify.post('/item/:id/update', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params
    const { quantity, selected } = req.body

    const item = await prisma.cartItem.findUnique({
      where: { id },
      include: { cart: { select: { userId: true } } }
    })
    if (!item) return reply.code(404).send({ success: false, message: '购物车条目不存在' })
    if (item.cart.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作' })

    const updateData = {}
    if (quantity !== undefined) {
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
        return reply.code(400).send({ success: false, message: '单个商品数量需为 1 至 10 件' })
      }
      updateData.quantity = qty
    }
    if (selected !== undefined) updateData.selected = Boolean(selected)

    await cancelPendingPreOrdersForItems(prisma, userId, [item.id])
    const updated = await prisma.cartItem.update({ where: { id }, data: updateData })
    return reply.send({ success: true, data: updated })
  })

  // ── C.4 DELETE /api/cart/item/:id — 删除购物车条目 ──
  fastify.delete('/item/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const item = await prisma.cartItem.findUnique({
      where: { id },
      include: { cart: { select: { userId: true } } }
    })
    if (!item) return reply.code(404).send({ success: false, message: '购物车条目不存在' })
    if (item.cart.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作' })

    // 检查是否有 pending_payment 的 PreOrder 关联该 item
    // （通过 cartItemIds JSON 字段匹配）
    const pendingOrders = await prisma.preOrder.findMany({
      where: { userId, status: 'pending_payment' }
    })
    const linkedOrder = pendingOrders.find(po => {
      try {
        const ids = JSON.parse(po.cartItemIds)
        return ids.includes(id)
      } catch { return false }
    })

    if (linkedOrder) {
      // 取消关联的预订单，释放库存
      await cancelPreOrder(prisma, linkedOrder)
    }

    // 联动：CUSTOM 品 status 回退为 draft
    if (item.customProductId) {
      await prisma.customProduct.update({
        where: { id: item.customProductId },
        data: { status: 'draft' }
      }).catch(() => {})
    }

    await prisma.cartItem.delete({ where: { id } })

    return reply.send({ success: true, message: '已从购物车移除' })
  })

  // ── C.5 POST /api/cart/clear — 清空购物车 ──
  fastify.post('/clear', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: true }
    })
    if (!cart) return reply.send({ success: true, message: '购物车已为空' })

    // 取消所有 pending_payment 的预订单
    const pendingOrders = await prisma.preOrder.findMany({
      where: { userId, status: 'pending_payment' }
    })
    for (const po of pendingOrders) {
      await cancelPreOrder(prisma, po)
    }

    // 联动：所有 CUSTOM 品状态回退
    for (const item of cart.items) {
      if (item.customProductId) {
        await prisma.customProduct.update({
          where: { id: item.customProductId },
          data: { status: 'draft' }
        }).catch(() => {})
      }
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })

    return reply.send({ success: true, message: '购物车已清空' })
  })

  // ── C.6 POST /api/cart/checkout — 结算（幂等，库存预锁）──
  fastify.post('/checkout', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const {
      cartItemIds, // 要结算的 CartItem ID 数组
      receiverName,
      receiverPhone,
      receiverAddress,
      receiverCity,
      idempotencyKey // 前端传入，防重复提交
    } = req.body

    if (!Array.isArray(cartItemIds) || cartItemIds.length === 0) {
      return reply.code(400).send({ success: false, message: '请选择要结算的商品' })
    }
    // 相同定制配置会在购物车中合并数量，结算只传一次条目 ID。
    const uniqueCartItemIds = [...new Set(cartItemIds.map(id => String(id || '').trim()).filter(Boolean))]
    if (!uniqueCartItemIds.length) {
      return reply.code(400).send({ success: false, message: '请选择要结算的商品' })
    }

    const addressProblem = validateCheckoutAddress({ receiverName, receiverPhone, receiverAddress, receiverCity })
    if (addressProblem) return reply.code(400).send({ success: false, message: addressProblem })

    // 幂等 key
    const checkoutKey = idempotencyKey || crypto.createHash('sha256')
      .update(`${userId}_${[...uniqueCartItemIds].sort().join(',')}_${Date.now()}`)
      .digest('hex')

    // 幂等检查：相同 user + 相同 items 是否有 pending_payment 预订单
    const existingOrder = await prisma.preOrder.findFirst({
      where: { userId, checkoutIdempotencyKey: checkoutKey, status: 'pending_payment' }
    })
    if (existingOrder) {
      return reply.send({
        success: true,
        data: preOrderResponse(existingOrder),
        idempotent: true,
        message: '订单已存在，请完成支付'
      })
    }

    try {
      const preOrder = await prisma.$transaction(async tx => {
        const items = await tx.cartItem.findMany({
          where: { id: { in: uniqueCartItemIds }, cart: { userId } },
        })
        if (items.length !== uniqueCartItemIds.length) {
          const error = new Error('部分购物车条目不存在或不属于当前账号')
          error.code = 'INVALID_CART_ITEMS'
          throw error
        }

        const snapshotItems = []
        const problems = []
        for (const item of items) {
          try {
            const snapshotItem = await buildCheckoutItemSnapshot(tx, item, userId)
            if (item.snapshotPrice === null || Math.abs(snapshotItem.unitPrice - Number(item.snapshotPrice)) > 0.01) {
              problems.push({ id: item.id, reason: '价格已变动，请返回购物车确认' })
            } else {
              snapshotItems.push(snapshotItem)
            }
          } catch (error) {
            problems.push({ id: item.id, reason: error.message })
          }
        }
        if (problems.length) {
          const error = new Error('部分商品无法结算')
          error.code = 'CHECKOUT_VALIDATION_FAILED'
          error.problems = problems
          throw error
        }

        const checkoutSnapshot = createCheckoutSnapshot(snapshotItems)
        const id = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
        await reserveCheckoutInventory(tx, checkoutSnapshot, id, checkoutKey)
        const created = await tx.preOrder.create({ data: {
          id,
          userId,
          cartItemIds: JSON.stringify(uniqueCartItemIds),
          checkoutSnapshot,
          checkoutIdempotencyKey: checkoutKey,
          status: 'pending_payment',
          totalAmount: checkoutSnapshot.totalAmount.toFixed(2),
          receiverName: String(receiverName).trim(),
          receiverPhone: String(receiverPhone).trim(),
          receiverAddress: String(receiverAddress).trim(),
          receiverCity: String(receiverCity).trim(),
          expiresAt,
          wxPayParams: JSON.stringify({ mock: true, preOrderId: id, totalAmount: checkoutSnapshot.totalAmount, expiresAt }),
        } })

        const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
        for (const item of snapshotItems.filter(row => row.customProductId)) {
          await tx.customProduct.updateMany({
            where: { id: item.customProductId, OR: [{ draftExpiresAt: null }, { draftExpiresAt: { lt: newExpiry } }] },
            data: { draftExpiresAt: newExpiry },
          })
        }
        return created
      }, { timeout: 15000 })

      return reply.send({ success: true, data: preOrderResponse(preOrder) })
    } catch (error) {
      if (error.code === 'P2002') {
        const reused = await prisma.preOrder.findUnique({ where: { checkoutIdempotencyKey: checkoutKey } })
        if (reused?.userId === userId && reused.status === 'pending_payment') {
          return reply.send({ success: true, data: preOrderResponse(reused), idempotent: true, message: '订单已存在' })
        }
        return reply.code(409).send({ success: false, message: '本次提交已结束，请返回购物车重新提交' })
      }
      if (error.code === 'CHECKOUT_VALIDATION_FAILED') {
        return reply.code(400).send({
          success: false,
          code: error.code,
          message: error.message,
          data: { problems: error.problems }
        })
      }
      if (['INVALID_CART_ITEMS', 'INVALID_QUANTITY', 'INSUFFICIENT_STOCK'].includes(error.code)) {
        return reply.code(400).send({ success: false, message: error.message })
      }
      throw error
    }
  })

  // ── C.7 POST /api/cart/price-changes/confirm-all — 一键接受所有价格变动 ──
  fastify.post('/price-changes/confirm-all', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const cart = await prisma.cart.findUnique({ where: { userId } })
    if (!cart) return reply.send({ success: true, updatedCount: 0 })

    const changed = await prisma.cartItem.findMany({
      where: { cartId: cart.id, status: 'price_changed' }, select: { id: true },
    })
    await cancelPendingPreOrdersForItems(prisma, userId, changed.map(item => item.id))

    const result = await prisma.cartItem.updateMany({
      where: { cartId: cart.id, status: 'price_changed' },
      data: { status: 'normal' }
    })

    // 同步更新快照价格
    const priceChangedItems = await prisma.cartItem.findMany({
      where: { cartId: cart.id, status: 'normal' }
    })
    for (const item of priceChangedItems) {
      const currentPrice = await getItemCurrentPrice(prisma, item)
      if (currentPrice !== null) {
        await prisma.cartItem.update({
          where: { id: item.id },
          data: { snapshotPrice: currentPrice }
        })
      }
    }

    return reply.send({ success: true, updatedCount: result.count })
  })

  // ── C.9 GET /api/cart/item/:id/preview/regenerate — 重新生成预览图 ──
  fastify.get('/item/:id/preview/regenerate', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const { id } = req.params
    const userId = req.user.userId

    const item = await prisma.cartItem.findUnique({
      where: { id },
      include: { cart: { select: { userId: true } } }
    })
    if (!item) return reply.code(404).send({ success: false, message: '条目不存在' })
    if (item.cart.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作' })

    // TODO: 接入实际预览图生成
    return reply.send({ success: true, message: '预览图生成任务已投递' })
  })
}

// ── 取消预订单并释放库存（内部函数）──
async function cancelPreOrder(prisma, preOrder) {
  await closePreOrderAndRelease(prisma, preOrder, 'cancelled')
}

async function cancelPendingPreOrdersForItems(prisma, userId, itemIds) {
  if (!itemIds.length) return
  const pending = await prisma.preOrder.findMany({ where: { userId, status: 'pending_payment' } })
  for (const preOrder of pending) {
    let linkedIds = []
    try { linkedIds = JSON.parse(preOrder.cartItemIds) } catch {}
    if (itemIds.some(id => linkedIds.includes(id))) await cancelPreOrder(prisma, preOrder)
  }
}
