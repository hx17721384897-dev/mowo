// src/routes/payment.js
// 支付回调与状态查询
// 注册前缀：/api/payment

import {
  createProductionUnitNo,
  createSalesOrderItemNo,
  createSalesOrderNo
} from '../lib/sales-orders.js'

export default async function paymentRoutes(fastify) {
  const { prisma } = fastify

  // ── POST /api/payment/callback — 微信支付结果回调（验签）──
  // 生产环境需验证微信签名，当前预留 mock 模式
  fastify.post('/callback', async (req, reply) => {
    const body = req.body || {}

    // TODO: 验证微信签名
    // const signature = req.headers['wechatpay-signature']
    // verifyWxPaySignature(signature, rawBody)

    const { preOrderId, success: paySuccess } = body

    if (!preOrderId) {
      return reply.code(400).send({ success: false, message: '缺少 preOrderId' })
    }

    const preOrder = await prisma.preOrder.findUnique({ where: { id: preOrderId } })
    if (!preOrder) {
      return reply.code(404).send({ success: false, message: '预订单不存在' })
    }

    if (preOrder.status !== 'pending_payment') {
      // 幂等：已处理过直接返回 OK
      const salesOrder = await prisma.salesOrder.findUnique({ where: { preOrderId } })
      return reply.send({ success: true, message: '已处理', data: salesOrder })
    }

    if (paySuccess === false || paySuccess === 'false') {
      // 支付失败
      await prisma.preOrder.update({
        where: { id: preOrderId },
        data: { status: 'cancelled' }
      })
      return reply.send({ success: true, message: '支付失败已记录' })
    }

    // 支付成功：一次支付创建一个用户订单，商品按数量展开为单件生产任务。
    let salesOrder
    try {
      salesOrder = await prisma.$transaction(async tx => {
      // 更新预订单状态
      const claimed = await tx.preOrder.updateMany({
        where: { id: preOrderId, status: 'pending_payment' },
        data: { status: 'paid' }
      })
      if (claimed.count !== 1) {
        const processing = new Error('支付通知已由其他请求处理')
        processing.code = 'PAYMENT_ALREADY_PROCESSING'
        throw processing
      }

      // 取出 CartItem
      let cartItemIds = []
      try { cartItemIds = JSON.parse(preOrder.cartItemIds) } catch {}

      const items = await tx.cartItem.findMany({
        where: { id: { in: cartItemIds } }
      })
      if (!items.length || items.length !== cartItemIds.length) {
        throw new Error('结算商品已变化，无法创建完整订单')
      }

      const orderNo = createSalesOrderNo()
      const order = await tx.salesOrder.create({
        data: {
          orderNo,
          userId: preOrder.userId,
          preOrderId: preOrder.id,
          status: 'paid',
          totalAmount: preOrder.totalAmount,
          receiverName: preOrder.receiverName,
          receiverPhone: preOrder.receiverPhone,
          receiverAddress: preOrder.receiverAddress,
          receiverCity: preOrder.receiverCity,
          platform: 'SELF',
          paidAt: new Date()
        }
      })

      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex]

        // 查询 SKU + 关联 model，补全 CustomizeOrder 必填字段
        const sku = await tx.machineModelSku.findUnique({
          where: { id: item.hardwareSkuId },
          include: { model: true }
        })

        // 帧图 URL：优先从 customProduct 取 animationFrames
        let frameUrls = '[]'
        let customProduct = null
        if (item.customProductId) {
          customProduct = await tx.customProduct.findUnique({ where: { id: item.customProductId } })
          if (customProduct?.animationFrames) frameUrls = customProduct.animationFrames
        }

        const unitPrice = Number(item.snapshotPrice || sku?.price || 0)
        const quantity = Math.max(1, Number(item.quantity || 1))
        const orderItem = await tx.salesOrderItem.create({
          data: {
            itemNo: createSalesOrderItemNo(orderNo, itemIndex + 1),
            salesOrderId: order.id,
            cartItemId: item.id,
            itemType: item.itemType,
            contentId: item.contentId,
            customProductId: item.customProductId,
            animationAssetId: customProduct?.animationAssetId || null,
            animationVersionId: customProduct?.animationVersionId || null,
            skuId: item.hardwareSkuId,
            skuCode: item.hardwareSkuCode || sku?.skuCode || null,
            snapshotTitle: item.snapshotTitle,
            snapshotPreviewUrl: item.snapshotPreviewUrl || item.coverUrl || null,
            configSnapshotJson: item.configSnapshotJson,
            unitPrice: unitPrice.toFixed(2),
            quantity,
            lineTotal: (unitPrice * quantity).toFixed(2),
            status: 'paid'
          }
        })

        for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) {
          // CustomizeOrder 继续承载现有生产后台，但现在一条记录明确代表一件实物。
          const newOrder = await tx.customizeOrder.create({
            data: {
              orderNo: createProductionUnitNo(),
              userId: preOrder.userId,
              skuId: item.hardwareSkuId,
              modelId: sku?.modelId || '',
              modelName: sku?.model?.name || '',
              frameCount: sku?.frameCount || 0,
              size: sku?.size || '',
              material: sku?.material || '',
              color: sku?.colorHex || '',
              colorName: sku?.colorName || '',
              ossPath: '',
              status: 'paid',
              sourceType: item.itemType === 'MARKET' ? 'collab' : 'custom',
              collabWorkId: item.itemType === 'MARKET' ? item.contentId : null,
              frameUrls,
              receiverName: preOrder.receiverName || '',
              receiverPhone: preOrder.receiverPhone || '',
              receiverAddress: preOrder.receiverAddress || '',
              receiverCity: preOrder.receiverCity || '',
              platform: 'SELF',
              salesOrderItemId: orderItem.id,
              unitIndex
            }
          })

          // 分红系统首发关闭；未来启用时必须按每件生产任务建立成交快照。
          if (fastify.config.features.creatorFinance && item.itemType === 'MARKET' && newOrder) {
            fastify.log.warn('creatorFinance 已开启，但新订单结构的联名分红快照尚未启用')
          }
        }

        // CUSTOM 品状态 → ordered
        if (item.customProductId) {
          await tx.customProduct.update({
            where: { id: item.customProductId },
            data: { status: 'ordered' }
          }).catch(() => {})
        }
      }

      // 支付成功：从购物车直接删除已下单的条目
      await tx.cartItem.deleteMany({
        where: { id: { in: cartItemIds } }
      }).catch(() => {})
        return order
      })
    } catch (error) {
      // 支付平台可能并发或重复通知；preOrderId 唯一约束保证只落一个用户订单。
      if (error.code === 'P2002' || error.code === 'PAYMENT_ALREADY_PROCESSING') {
        const existing = await prisma.salesOrder.findUnique({ where: { preOrderId } })
        if (existing) return reply.send({ success: true, message: '支付成功，订单已创建', data: existing, reused: true })
      }
      throw error
    }

    return reply.send({ success: true, message: '支付成功，订单已创建', data: salesOrder })
  })

  // ── GET /api/payment/status/:preOrderId — 前端轮询支付状态 ──
  fastify.get('/status/:preOrderId', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const { preOrderId } = req.params
    const userId = req.user.userId

    const preOrder = await prisma.preOrder.findUnique({ where: { id: preOrderId } })
    if (!preOrder) return reply.code(404).send({ success: false, message: '预订单不存在' })
    if (preOrder.userId !== userId) return reply.code(403).send({ success: false, message: '无权访问' })

    // 检查是否已超时
    if (preOrder.status === 'pending_payment' && preOrder.expiresAt < new Date()) {
      await prisma.preOrder.update({
        where: { id: preOrderId },
        data: { status: 'expired' }
      }).catch(() => {})
      return reply.send({ success: true, data: { status: 'expired', expired: true } })
    }

    return reply.send({
      success: true,
      data: {
        id: preOrder.id,
        status: preOrder.status,
        totalAmount: preOrder.totalAmount,
        expiresAt: preOrder.expiresAt,
        expired: preOrder.expiresAt < new Date()
      }
    })
  })

  // ── POST /api/payment/mock-pay/:preOrderId — 开发模式 mock 支付 ──
  fastify.post('/mock-pay/:preOrderId', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ success: false, message: '生产环境不允许 mock 支付' })
    }

    const { preOrderId } = req.params
    const userId = req.user.userId

    const preOrder = await prisma.preOrder.findUnique({ where: { id: preOrderId } })
    if (!preOrder) return reply.code(404).send({ success: false, message: '预订单不存在' })
    if (preOrder.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作' })

    // 模拟回调
    const callbackRes = await fastify.inject({
      method: 'POST',
      url: '/api/payment/callback',
      payload: { preOrderId, success: true }
    })

    return reply.send({
      success: true,
      message: 'Mock 支付成功',
      callbackStatus: callbackRes.statusCode
    })
  })
}
