// src/routes/payment.js
// 支付回调与状态查询
// 注册前缀：/api/payment

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
      return reply.send({ success: true, message: '已处理' })
    }

    if (paySuccess === false || paySuccess === 'false') {
      // 支付失败
      await prisma.preOrder.update({
        where: { id: preOrderId },
        data: { status: 'cancelled' }
      })
      return reply.send({ success: true, message: '支付失败已记录' })
    }

    // 支付成功：事务内创建生产订单
    await prisma.$transaction(async tx => {
      // 更新预订单状态
      await tx.preOrder.update({
        where: { id: preOrderId },
        data: { status: 'paid' }
      })

      // 取出 CartItem
      let cartItemIds = []
      try { cartItemIds = JSON.parse(preOrder.cartItemIds) } catch {}

      const items = await tx.cartItem.findMany({
        where: { id: { in: cartItemIds } }
      })

      for (const item of items) {
        const orderNo = `ORD${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`

        // 从 configSnapshotJson 解析定制参数
        let configData = {}
        try { configData = JSON.parse(item.configSnapshotJson || '{}') } catch {}

        // 创建 CustomizeOrder（进入现有生产流程）
        const newOrder = await tx.customizeOrder.create({
          data: {
            orderNo,
            userId:        preOrder.userId,
            skuId:         item.hardwareSkuId,
            status:        'paid',
            sourceType:    item.itemType === 'MARKET' ? 'collab' : 'custom',
            collabWorkId:  item.itemType === 'MARKET' ? item.contentId : null,
            frameUrls:     item.configSnapshotJson || '[]',
            quantity:      item.quantity,
            // 收件信息（字段名与 customize_orders 统一）
            receiverName:    preOrder.receiverName  || '',
            receiverPhone:   preOrder.receiverPhone || '',
            receiverAddress: preOrder.receiverAddress || '',
            receiverCity:    preOrder.receiverCity || '',
            // 平台来源
            platform:         'SELF'
          }
        }).catch(e => {
          fastify.log.warn(`创建 CustomizeOrder 失败: ${e.message}`)
          return null
        })

        // MARKET 类型：创建 CollabOrder（创作者分成流程）
        if (item.itemType === 'MARKET' && newOrder) {
          await tx.collabOrder.create({
            data: {
              orderId:       newOrder.id,
              collabWorkId:  item.contentId,
              buyerId:       preOrder.userId,
              status:        'pending',
              coolingEndAt:  new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 15天冷静期
            }
          }).catch(e => {
            fastify.log.warn(`创建 CollabOrder 失败: ${e.message}`)
          })

          // 正式扣减 reservedStock（库存预锁→正式占用，currentStock 不变，等发货时 deduct）
          // reservedStock 已在 checkout 时递增，此处不再重复操作
        }

        // CUSTOM 品状态 → ordered
        if (item.customProductId) {
          await tx.customProduct.update({
            where: { id: item.customProductId },
            data: { status: 'ordered' }
          }).catch(() => {})
        }
      }

      // 标记 CartItem 已下单（从购物车移除视角）
      await tx.cartItem.updateMany({
        where: { id: { in: cartItemIds } },
        data: { status: 'invalid' }
      }).catch(() => {})
    })

    return reply.send({ success: true, message: '支付成功，订单已创建' })
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
