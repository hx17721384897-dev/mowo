// src/routes/payment.js
// 支付回调与状态查询
// 注册前缀：/api/payment

import {
  createProductionUnitNo,
  createSalesOrderItemNo,
  createSalesOrderNo
} from '../lib/sales-orders.js'
import { closePreOrderAndRelease, readCheckoutSnapshot } from '../lib/checkout-snapshot.js'

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
      if (salesOrder) return reply.send({ success: true, message: '已处理', data: salesOrder })
      return reply.code(409).send({ success: false, message: `预订单当前状态为 ${preOrder.status}，尚未生成正式订单` })
    }

    if (paySuccess === false || paySuccess === 'false') {
      await closePreOrderAndRelease(prisma, preOrder, 'cancelled')
      return reply.send({ success: true, message: '支付失败已记录' })
    }

    let checkoutSnapshot
    try {
      checkoutSnapshot = readCheckoutSnapshot(preOrder.checkoutSnapshot)
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
    if (Math.abs(Number(checkoutSnapshot.totalAmount) - Number(preOrder.totalAmount)) > 0.01) {
      return reply.code(409).send({ success: false, message: '付款金额与结算快照不一致' })
    }

    // 支付成功：只读取付款前冻结快照，不再依赖可变的购物车。
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

      for (let itemIndex = 0; itemIndex < checkoutSnapshot.items.length; itemIndex += 1) {
        const item = checkoutSnapshot.items[itemIndex]
        const sku = item.sku
        const unitPrice = Number(item.unitPrice)
        const quantity = Number(item.quantity)
        if (!sku?.id || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !Number.isFinite(unitPrice)) {
          throw new Error('结算快照中的商品数据不完整')
        }
        const orderItem = await tx.salesOrderItem.create({
          data: {
            itemNo: createSalesOrderItemNo(orderNo, itemIndex + 1),
            salesOrderId: order.id,
            cartItemId: item.cartItemId || null,
            itemType: item.itemType,
            contentId: item.contentId,
            customProductId: item.customProductId,
            animationAssetId: item.animationAssetId,
            animationVersionId: item.animationVersionId,
            skuId: sku.id,
            skuCode: sku.code || null,
            snapshotTitle: item.title,
            snapshotPreviewUrl: item.previewUrl || null,
            configSnapshotJson: item.config ? JSON.stringify(item.config) : null,
            unitPrice: unitPrice.toFixed(2),
            baseUnitPrice: Number(item.baseUnitPrice).toFixed(2),
            priceAdjustment: Number(item.priceAdjustment).toFixed(2),
            quantity,
            lineTotal: (unitPrice * quantity).toFixed(2),
            productNo: item.productNo || null,
            fulfillmentMode: item.fulfillmentMode || null,
            leadTimeDays: item.leadTimeDays ?? null,
            status: 'paid'
          }
        })

        for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) {
          // CustomizeOrder 继续承载现有生产后台，但现在一条记录明确代表一件实物。
          const newOrder = await tx.customizeOrder.create({
            data: {
              orderNo: createProductionUnitNo(),
              userId: preOrder.userId,
              skuId: sku.id,
              modelId: sku.modelId || '',
              modelName: sku.modelName || '',
              frameCount: sku.frameCount || 0,
              size: sku.size || '',
              material: sku.material || '',
              color: sku.colorHex || '',
              colorName: sku.colorName || '',
              ossPath: '',
              status: 'paid',
              sourceType: item.itemType === 'MARKET' ? 'collab' : 'custom',
              collabWorkId: item.itemType === 'MARKET' ? item.contentId : null,
              frameUrls: JSON.stringify(item.frameKeys || []),
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
        if (item.itemType === 'CUSTOM' && item.customProductId) {
          await tx.customProduct.update({
            where: { id: item.customProductId },
            data: { status: 'ordered' }
          }).catch(() => {})
        }
      }

      // 支付成功：从购物车直接删除已下单的条目
      const cartItemIds = checkoutSnapshot.items.map(item => item.cartItemId).filter(Boolean)
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
    const callbackBody = callbackRes.json()
    if (callbackRes.statusCode >= 400 || !callbackBody?.success || !callbackBody?.data?.id) {
      return reply.code(callbackRes.statusCode >= 400 ? callbackRes.statusCode : 500).send({
        success: false,
        message: callbackBody?.message || '模拟支付未能创建正式订单'
      })
    }

    return reply.send({
      success: true,
      message: 'Mock 支付成功',
      callbackStatus: callbackRes.statusCode,
      data: callbackBody.data
    })
  })
}
