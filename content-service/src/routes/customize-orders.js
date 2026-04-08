// src/routes/customize-orders.js
// 定制订单相关接口

export default async function customizeOrderRoutes(fastify) {

  // ─────────────────────────────────────────
  // POST /api/customize-orders
  // 创建定制订单（帧图片已上传OSS后调用）
  // ─────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.userId
    const {
      modelId, modelName,
      frameCount, size, material,
      color, colorName, skuId,
      ossPath, frameUrls
    } = request.body

    // 生成订单号：ORD + 时间戳 + 随机3位
    const rand    = Math.floor(Math.random() * 900 + 100)
    const orderNo = `ORD${Date.now()}${rand}`

    // ── 库存检查 + 锁定（事务保证原子性）──
    let order
    try {
      order = await fastify.prisma.$transaction(async (tx) => {

        // 检查库存
        if (skuId) {
          const inv = await tx.skuInventory.findUnique({ where: { skuId } })
          if (inv) {
            const available = inv.currentStock - inv.reservedStock
            if (available <= 0) {
              throw new Error('该规格库存不足，暂时无法下单')
            }
            if (available <= inv.safetyStock) {
              // 低库存不阻止，但后续可以前端弹提示（通过 inventoryStatus 字段）
            }
            // 锁定库存
            await tx.skuInventory.update({
              where: { skuId },
              data:  { reservedStock: { increment: 1 } }
            })
          }
        }

        // 创建订单
        return tx.customizeOrder.create({
          data: {
            orderNo,
            userId,
            modelId:   modelId   || '',
            modelName: modelName || '常规机型',
            frameCount: parseInt(frameCount),
            size:      size      || '',
            material:  material  || '',
            color:     color     || '',
            colorName: colorName || '',
            skuId:     skuId     || '',
            ossPath:   ossPath   || '',
            frameUrls: JSON.stringify(frameUrls || []),
            status:    'pending',
            sourceType: 'custom',
          }
        })
      })
    } catch (e) {
      return reply.code(400).send({ success: false, message: e.message || '下单失败，请重试' })
    }

    return reply.send({
      success: true,
      message: '订单创建成功',
      data: {
        orderNo:   order.orderNo,
        orderId:   order.id,
        createdAt: order.createdAt
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/customize-orders
  // 获取当前用户的定制订单列表
  // ─────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.userId
    const { page = 1, limit = 10 } = request.query
    const skip = (page - 1) * limit

    const [orders, total] = await Promise.all([
      fastify.prisma.customizeOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip, take: parseInt(limit),
        select: {
          id: true, orderNo: true, modelName: true,
          frameCount: true, size: true, material: true,
          colorName: true, status: true, createdAt: true
        }
      }),
      fastify.prisma.customizeOrder.count({ where: { userId } })
    ])

    return reply.send({
      success: true,
      data: { orders, pagination: { page: parseInt(page), limit: parseInt(limit), total } }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/customize-orders/:orderNo
  // 获取单个订单详情（用订单号查询）
  // ─────────────────────────────────────────
  fastify.get('/:orderNo', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { orderNo } = request.params
    const userId      = request.user.userId

    const order = await fastify.prisma.customizeOrder.findUnique({
      where: { orderNo }
    })

    if (!order) {
      return reply.code(404).send({ success: false, message: '订单不存在' })
    }
    if (order.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权访问此订单' })
    }

    return reply.send({
      success: true,
      data: {
        ...order,
        frameUrls: JSON.parse(order.frameUrls || '[]')
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/customize-orders/:orderNo/cancel
  // 取消订单（仅 pending 状态可取消，释放锁定库存）
  // ─────────────────────────────────────────
  fastify.post('/:orderNo/cancel', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { orderNo } = request.params
    const userId      = request.user.userId

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { orderNo } })
    if (!order)                  return reply.code(404).send({ success: false, message: '订单不存在' })
    if (order.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作此订单' })
    if (order.status !== 'pending') return reply.code(400).send({ success: false, message: '只有未付款的订单可以取消' })

    await fastify.prisma.$transaction([
      fastify.prisma.customizeOrder.update({
        where: { orderNo },
        data:  { status: 'cancelled' }
      }),
      ...(order.skuId ? [fastify.prisma.skuInventory.update({
        where: { skuId: order.skuId },
        data:  { reservedStock: { decrement: 1 } }
      })] : [])
    ])

    return reply.send({ success: true, message: '订单已取消，库存已释放' })
  })
}