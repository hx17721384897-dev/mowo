// src/routes/cart.js
// 服务端购物车 API
// 注册前缀：/api/cart

import crypto from 'crypto'

// ── 计算商品当前价格 ──
async function getItemCurrentPrice(prisma, item) {
  try {
    const sku = await prisma.machineModelSku.findUnique({
      where: { id: item.hardwareSkuId },
      select: { price: true }
    })
    return sku?.price ?? null
  } catch {
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

      // 检查库存（MARKET 类型）
      if (item.itemType === 'MARKET' && status !== 'invalid') {
        const inv = await prisma.skuInventory.findFirst({ where: { skuId: item.hardwareSkuId } })
        if (inv) {
          const available = inv.currentStock - inv.reservedStock
            - (inv.wipFrameQty || 0) - (inv.wipKitQty || 0)
          if (available < item.quantity && status === 'normal') {
            status = 'stock_out'
            await prisma.cartItem.update({ where: { id: item.id }, data: { status } })
          }
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

    if (!itemType || !contentId || !hardwareSkuId) {
      return reply.code(400).send({ success: false, message: '缺少必要参数' })
    }
    if (!['MARKET', 'CUSTOM'].includes(itemType)) {
      return reply.code(400).send({ success: false, message: 'itemType 必须是 MARKET 或 CUSTOM' })
    }

    // 查询 SKU
    const sku = await prisma.machineModelSku.findUnique({
      where: { id: hardwareSkuId },
      include: { model: { select: { name: true } } }
    })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU 不存在' })

    let snapshotTitle = ''
    let coverUrl = null
    let creatorId = null
    let customProductId = null
    let configSnapshotJson = null
    let snapshotPreviewUrl = null

    // ── 物理约束校验 ──
    if (itemType === 'CUSTOM') {
      const cp = await prisma.customProduct.findUnique({ where: { id: contentId } })
      if (!cp) return reply.code(404).send({ success: false, message: '定制草稿不存在' })
      if (cp.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作此草稿' })
      if (cp.status === 'ordered' || cp.status === 'removed') {
        return reply.code(400).send({ success: false, message: '该草稿已提交，不可再加入购物车' })
      }
      // 帧数兼容性校验（支持循环补帧：sku.frameCount 必须是 cp.frameCount 的整数倍）
      if (cp.frameCount && sku.frameCount && sku.frameCount % cp.frameCount !== 0) {
        return reply.code(400).send({
          success: false,
          message: `当前动画为 ${cp.frameCount} 帧，无法匹配 ${sku.frameCount} 帧底座（需整数倍才可循环补帧）`
        })
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

      // 更新草稿状态为 in_cart
      await prisma.customProduct.update({
        where: { id: contentId },
        data: { status: 'in_cart' }
      })

    } else {
      // MARKET 类型
      const work = await prisma.collabWork.findUnique({ where: { id: contentId } })
      if (!work) return reply.code(404).send({ success: false, message: '联名作品不存在' })

      // 规格兼容性校验（检查 hardwareSkuCode 在 supportedSkus 中）
      if (work.supportedSkus) {
        try {
          const supported = JSON.parse(work.supportedSkus)
          if (Array.isArray(supported) && supported.length > 0) {
            const skuCodeOrId = sku.skuCode || sku.id
            if (!supported.includes(skuCodeOrId) && !supported.includes(sku.id)) {
              return reply.code(400).send({ success: false, message: '所选外壳不支持此联名作品' })
            }
          }
        } catch {}
      }

      snapshotTitle = work.title || '联名作品'
      coverUrl = work.coverImageUrl || null
      creatorId = work.creatorId || null
    }

    const cart = await getOrCreateCart(prisma, userId)

    // 幂等：相同 contentId + hardwareSkuId 已存在则叠加数量
    const existing = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, contentId, hardwareSkuId, status: { not: 'invalid' } }
    })
    if (existing) {
      const updated = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + parseInt(quantity) }
      })
      return reply.send({ success: true, data: updated, merged: true })
    }

    // 价格快照
    const snapshotPrice = sku.price ?? null

    const item = await prisma.cartItem.create({
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
        snapshotPrice,
        quantity: parseInt(quantity),
        selected: true,
        creatorId,
        status: 'normal',
        customProductId,
        sessionGroupId: sessionGroupId || null
      }
    })

    // 更新 cart.updatedAt
    await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } })

    return reply.code(201).send({ success: true, data: item })
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
      const qty = parseInt(quantity)
      if (qty < 1) return reply.code(400).send({ success: false, message: '数量不能小于1' })
      if (qty > 100) return reply.code(400).send({ success: false, message: '单次最多购买100件' })
      updateData.quantity = qty
    }
    if (selected !== undefined) updateData.selected = Boolean(selected)

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

  // ── C.6 POST /api/cart/merge — 游客购物车合并 ──
  fastify.post('/merge', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { items: guestItems } = req.body // [{ itemType, contentId, hardwareSkuId, quantity }]

    if (!Array.isArray(guestItems) || guestItems.length === 0) {
      return reply.send({ success: true, message: '无需合并', mergedCount: 0 })
    }

    const cart = await getOrCreateCart(prisma, userId)
    const mergedItems = []
    const failedItems = []

    for (const gi of guestItems) {
      try {
        const { itemType, contentId, hardwareSkuId, quantity = 1 } = gi
        if (!itemType || !contentId || !hardwareSkuId) continue

        const sku = await prisma.machineModelSku.findUnique({ where: { id: hardwareSkuId } })
        if (!sku) { failedItems.push({ ...gi, reason: 'SKU不存在' }); continue }

        // 检查总件数限制
        const totalQty = cart.items.reduce((s, i) => s + i.quantity, 0)
        if (totalQty + parseInt(quantity) > 100) {
          failedItems.push({ ...gi, reason: '购物车已达100件上限' })
          continue
        }

        // 相同商品叠加
        const existing = cart.items.find(i => i.contentId === contentId && i.hardwareSkuId === hardwareSkuId)
        if (existing) {
          await prisma.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + parseInt(quantity) }
          })
        } else {
          let snapshotTitle = ''
          let coverUrl = null
          let creatorId = null
          if (itemType === 'MARKET') {
            const work = await prisma.collabWork.findUnique({ where: { id: contentId } })
            if (!work) { failedItems.push({ ...gi, reason: '联名作品不存在' }); continue }
            snapshotTitle = work.title || '联名作品'
            coverUrl = work.coverImageUrl || null
            creatorId = work.creatorId || null
          } else {
            snapshotTitle = `定制款 · ${sku.size || ''}`
          }

          await prisma.cartItem.create({
            data: {
              cartId: cart.id,
              itemType,
              contentId,
              hardwareSkuId,
              hardwareSkuCode: sku.skuCode || null,
              snapshotTitle,
              coverUrl,
              snapshotPrice: sku.price ?? null,
              quantity: parseInt(quantity),
              selected: true,
              creatorId,
              status: 'normal'
            }
          })
        }
        mergedItems.push(gi)
      } catch (e) {
        failedItems.push({ ...gi, reason: e.message })
      }
    }

    await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } })

    return reply.send({
      success: true,
      message: failedItems.length > 0 ? '部分商品价格或库存已更新，请检查' : '合并成功',
      mergedCount: mergedItems.length,
      unmergedItems: failedItems
    })
  })

  // ── C.7 POST /api/cart/checkout — 结算（幂等，库存预锁）──
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

    // 幂等 key
    const checkoutKey = idempotencyKey || crypto.createHash('sha256')
      .update(`${userId}_${cartItemIds.sort().join(',')}_${Date.now()}`)
      .digest('hex')

    // 幂等检查：相同 user + 相同 items 是否有 pending_payment 预订单
    const existingOrder = await prisma.preOrder.findFirst({
      where: { userId, checkoutIdempotencyKey: checkoutKey, status: 'pending_payment' }
    })
    if (existingOrder) {
      return reply.send({
        success: true,
        data: existingOrder,
        idempotent: true,
        message: '订单已存在，请完成支付'
      })
    }

    // 取出选定的购物车条目
    const items = await prisma.cartItem.findMany({
      where: {
        id: { in: cartItemIds },
        cart: { userId }
      }
    })
    if (items.length === 0) {
      return reply.code(400).send({ success: false, message: '购物车条目不存在' })
    }

    // 全量校验
    const problems = []
    for (const item of items) {
      if (item.status === 'invalid') problems.push({ id: item.id, reason: '商品已下架' })
      else if (item.status === 'stock_out') problems.push({ id: item.id, reason: '商品库存不足' })
      else if (item.status === 'price_changed') problems.push({ id: item.id, reason: '价格已变动，请确认后再结算' })
    }
    if (problems.length > 0) {
      return reply.code(400).send({ success: false, message: '部分商品有问题，请处理后再结算', problems })
    }

    // 计算总价
    let totalAmount = 0
    for (const item of items) {
      const price = await getItemCurrentPrice(prisma, item)
      totalAmount += (Number(price) || 0) * item.quantity
    }

    // 库存预锁（MARKET 普通品）
    const lockedSkus = []
    try {
      for (const item of items) {
        if (item.itemType === 'MARKET') {
          // 使用原子操作预锁
          const result = await prisma.$executeRaw`
            UPDATE sku_inventory
            SET reserved_stock = reserved_stock + ${item.quantity}
            WHERE sku_id = ${item.hardwareSkuId}
              AND (current_stock - reserved_stock - COALESCE(wip_frame_qty,0) - COALESCE(wip_kit_qty,0)) >= ${item.quantity}
          `
          if (result === 0) {
            // 回滚已锁定的 SKU
            for (const locked of lockedSkus) {
              await prisma.skuInventory.updateMany({
                where: { skuId: locked.skuId },
                data: { reservedStock: { decrement: locked.qty } }
              })
            }
            return reply.code(400).send({
              success: false,
              message: `商品「${item.snapshotTitle}」库存不足，请减少数量`,
              itemId: item.id
            })
          }
          lockedSkus.push({ skuId: item.hardwareSkuId, qty: item.quantity })
        }
      }
    } catch (e) {
      // 回滚
      for (const locked of lockedSkus) {
        await prisma.skuInventory.updateMany({
          where: { skuId: locked.skuId },
          data: { reservedStock: { decrement: locked.qty } }
        }).catch(() => {})
      }
      throw e
    }

    // 创建预订单
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10分钟
    const preOrder = await prisma.preOrder.create({
      data: {
        userId,
        cartItemIds: JSON.stringify(cartItemIds),
        checkoutIdempotencyKey: checkoutKey,
        status: 'pending_payment',
        totalAmount: totalAmount.toFixed(2),
        receiverName: receiverName || null,
        receiverPhone: receiverPhone || null,
        receiverAddress: receiverAddress || null,
        receiverCity: receiverCity || null,
        expiresAt
      }
    })

    // 生命周期保护：延长关联 CustomProduct 的 draft_expires_at
    for (const item of items) {
      if (item.customProductId) {
        const cp = await prisma.customProduct.findUnique({ where: { id: item.customProductId } })
        if (cp) {
          const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时
          const extended = cp.draftExpiresAt && cp.draftExpiresAt > newExpiry
            ? cp.draftExpiresAt : newExpiry
          await prisma.customProduct.update({
            where: { id: item.customProductId },
            data: { draftExpiresAt: extended }
          }).catch(() => {})
        }
      }
    }

    // TODO: 调用微信支付 API（预留，当前 mock）
    const wxPayParams = {
      mock: true,
      preOrderId: preOrder.id,
      totalAmount,
      expiresAt
    }

    await prisma.preOrder.update({
      where: { id: preOrder.id },
      data: { wxPayParams: JSON.stringify(wxPayParams) }
    })

    return reply.send({
      success: true,
      data: { ...preOrder, wxPayParams }
    })
  })

  // ── C.8 POST /api/cart/price-changes/confirm-all — 一键接受所有价格变动 ──
  fastify.post('/price-changes/confirm-all', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const cart = await prisma.cart.findUnique({ where: { userId } })
    if (!cart) return reply.send({ success: true, updatedCount: 0 })

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
  if (preOrder.status !== 'pending_payment') return

  // 释放库存
  try {
    const cartItemIds = JSON.parse(preOrder.cartItemIds)
    const items = await prisma.cartItem.findMany({
      where: { id: { in: cartItemIds } }
    })
    for (const item of items) {
      if (item.itemType === 'MARKET') {
        await prisma.skuInventory.updateMany({
          where: { skuId: item.hardwareSkuId },
          data: { reservedStock: { decrement: item.quantity } }
        }).catch(() => {})
      }
    }
  } catch {}

  await prisma.preOrder.update({
    where: { id: preOrder.id },
    data: { status: 'cancelled' }
  }).catch(() => {})
}
