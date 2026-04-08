// src/routes/inventory.js
// 库存管理接口

export default async function inventoryRoutes(fastify) {

  // ─────────────────────────────────────────────
  // 管理员接口（role >= 2）
  // ─────────────────────────────────────────────

  // GET /api/inventory
  // 所有SKU库存列表（含款式/SKU信息）
  fastify.get('/', { preHandler: requireAdmin }, async (req, reply) => {
    const inventories = await fastify.prisma.skuInventory.findMany({
      orderBy: { createdAt: 'asc' }
    })

    const skuIds = inventories.map(i => i.skuId)
    const skus   = await fastify.prisma.machineModelSku.findMany({
      where: { id: { in: skuIds } }
    })
    const skuMap = Object.fromEntries(skus.map(s => [s.id, s]))

    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models   = await fastify.prisma.machineModel.findMany({
      where: { id: { in: modelIds } },
      select: { id: true, name: true }
    })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = inventories.map(inv => {
      const sku = skuMap[inv.skuId] ?? {}
      const skuSpec = sku.size
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : '—'
      return {
        ...inv,
        skuName:        skuSpec,
        skuBarcode:     sku.skuBarcode ?? '—',
        modelName:      modelMap[sku.modelId] ?? '—',
        size:           sku.size       ?? '',
        material:       sku.material   ?? '',
        frameCount:     sku.frameCount ?? '',
        colorName:      sku.colorName  ?? '',
        colorHex:       sku.colorHex   ?? '',
        availableStock: inv.currentStock - inv.reservedStock,
        isLow:          inv.currentStock - inv.reservedStock <= inv.safetyStock,
        isFull:         (inv.currentStock - inv.reservedStock) >= inv.maxOrderLimit,
      }
    })

    return reply.send({ success: true, data: result })
  })

  // GET /api/inventory/:skuId
  // 单个SKU库存详情 + 最近50条变动记录
  fastify.get('/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const logs = await fastify.prisma.inventoryLog.findMany({
      where: { skuId },
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    return reply.send({
      success: true,
      data: { ...inv, availableStock: inv.currentStock - inv.reservedStock, logs }
    })
  })

  // POST /api/inventory/:skuId/restock
  // 录入入库（生产端补货）
  // Body: { quantity, note? }
  fastify.post('/:skuId/restock', { preHandler: requireProduction }, async (req, reply) => {
    const { skuId }          = req.params
    const { quantity, note } = req.body
    const operatorId         = req.user.userId
    const userRole           = req.user.role ?? 0

    if (quantity === undefined || quantity === null || quantity === 0)
      return reply.code(400).send({ success: false, message: '数量不能为0' })

    // 生产端只能录正数，管理员可以录负数修正
    if (userRole < 2 && quantity < 0)
      return reply.code(403).send({ success: false, message: '生产端只能录入正数，负数调整请联系管理员' })

    // 负数调减时检查不能低于0
    if (quantity < 0) {
      const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
      if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })
      if (inv.currentStock + quantity < 0)
        return reply.code(400).send({ success: false, message: `调减数量超出当前库存（当前：${inv.currentStock}）` })
    }

    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const logType = quantity > 0 ? 'in' : 'adjust'
    await fastify.prisma.$transaction([
      fastify.prisma.skuInventory.update({
        where: { skuId },
        data:  { currentStock: { increment: quantity } }
      }),
      fastify.prisma.inventoryLog.create({
        data: { skuId, type: logType, quantity, operatorId, note: note ?? null }
      })
    ])

    const updated = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    const actionWord = quantity > 0 ? `入库 ${quantity} 个` : `调减 ${Math.abs(quantity)} 个`
    return reply.send({
      success: true,
      message: `✓ 已${actionWord}，当前库存 ${updated.currentStock}`,
      data:    updated
    })
  })

  // PUT /api/inventory/:skuId/settings
  // 修改预警设置（安全库存线 / 最大下单上限）
  // Body: { safetyStock?, maxOrderLimit? }
  fastify.put('/:skuId/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId }                      = req.params
    const { safetyStock, maxOrderLimit } = req.body

    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const data = {}
    if (safetyStock   !== undefined) data.safetyStock   = safetyStock
    if (maxOrderLimit !== undefined) data.maxOrderLimit = maxOrderLimit

    const updated = await fastify.prisma.skuInventory.update({ where: { skuId }, data })
    return reply.send({ success: true, data: updated })
  })

  // GET /api/inventory/logs — 全局变动记录（管理员）
  fastify.get('/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = 1, limit = 50, skuId, type } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (skuId) where.skuId = skuId
    if (type)  where.type  = type

    const [logs, total] = await Promise.all([
      fastify.prisma.inventoryLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit)
      }),
      fastify.prisma.inventoryLog.count({ where })
    ])

    // 补充 SKU 名称
    const skuIds   = [...new Set(logs.map(l => l.skuId))]
    const skus     = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models   = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const skuMap   = Object.fromEntries(skus.map(s => [s.id, s]))
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = logs.map(l => {
      const sku  = skuMap[l.skuId] ?? {}
      const spec = sku.size ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ') : '—'
      return {
        ...l,
        skuSpec:   spec,
        modelName: modelMap[sku.modelId] ?? '—',
      }
    })

    return reply.send({ success: true, data: { logs: result, total, page: parseInt(page), limit: parseInt(limit) } })
  })

  // ─────────────────────────────────────────────
  // 生产端扫码发货（role >= 1）
  // ─────────────────────────────────────────────

  // POST /api/inventory/ship
  // 扫码发货：订单码 + SKU条形码 + 快递单号，一次提交
  // Body: { orderNo, skuBarcode, trackingNo, trackingCompany }
  fastify.post('/ship', { preHandler: requireProduction }, async (req, reply) => {
    const { orderNo, skuBarcode, trackingNo, trackingCompany } = req.body
    const operatorId = req.user.userId

    if (!orderNo)         return reply.code(400).send({ success: false, message: '缺少订单号' })
    if (!skuBarcode)      return reply.code(400).send({ success: false, message: '缺少SKU条形码' })
    if (!trackingNo)      return reply.code(400).send({ success: false, message: '缺少快递单号' })
    if (!trackingCompany) return reply.code(400).send({ success: false, message: '缺少快递公司' })

    // 查订单
    const order = await fastify.prisma.customizeOrder.findUnique({ where: { orderNo } })
    if (!order)
      return reply.code(404).send({ success: false, message: `订单号 ${orderNo} 不存在` })
    if (order.status === 'shipped')
      return reply.code(400).send({ success: false, message: '该订单已发货' })
    if (!['paid', 'producing', 'done'].includes(order.status))
      return reply.code(400).send({ success: false, message: `订单状态「${order.status}」不可发货` })

    // 验证 SKU 条形码并匹配
    const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuBarcode } })
    if (!sku)
      return reply.code(404).send({ success: false, message: `SKU条形码 ${skuBarcode} 不存在` })
    if (sku.id !== order.skuId)
      return reply.code(400).send({ success: false, message: 'SKU不匹配，请检查材料包是否正确' })

    // 生成正版验证码：{年2位}{随机6位大写}{校验字母}
    const year      = new Date().getFullYear().toString().slice(2)
    const random    = Math.random().toString(36).slice(2, 8).toUpperCase()
    const checkChar = String.fromCharCode(65 + (orderNo.length + sku.id.length) % 26)
    const authCode  = `${year}${random}${checkChar}`

    // 事务：更新订单 + 出库 + 写日志 + 生成正版码
    await fastify.prisma.$transaction([
      fastify.prisma.customizeOrder.update({
        where: { orderNo },
        data:  { status: 'shipped', trackingNo, trackingCompany }
      }),
      fastify.prisma.skuInventory.update({
        where: { skuId: sku.id },
        data:  { currentStock: { decrement: 1 }, reservedStock: { decrement: 1 } }
      }),
      fastify.prisma.inventoryLog.create({
        data: {
          skuId:      sku.id,
          type:       'out',
          quantity:   1,
          orderId:    order.id,
          operatorId,
          note:       `发货：订单${orderNo}，快递${trackingCompany} ${trackingNo}`,
        }
      }),
      fastify.prisma.authCode.create({
        data: { code: authCode, orderId: order.id, skuId: sku.id, issuedAt: new Date() }
      })
    ])

    return reply.send({
      success: true,
      message: '✓ 发货成功',
      data: { orderNo, trackingNo, trackingCompany, authCode }
    })
  })

  // ─────────────────────────────────────────────
  // 公开接口（无需登录）
  // ─────────────────────────────────────────────

  // GET /api/inventory/verify/:code
  // 正版验证，用户输入验证码查询
  fastify.get('/verify/:code', async (req, reply) => {
    const { code } = req.params

    const auth = await fastify.prisma.authCode.findUnique({ where: { code } })
    if (!auth) {
      return reply.send({
        success: true,
        data: { valid: false, message: '未找到此验证码，请确认是否为正版哞屋动画机' }
      })
    }

    await fastify.prisma.authCode.update({
      where: { code },
      data:  { queriedCount: { increment: 1 }, lastQueriedAt: new Date() }
    })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { id: auth.orderId } })
    const sku   = await fastify.prisma.machineModelSku.findUnique({ where: { id: auth.skuId } })
    const model = sku
      ? await fastify.prisma.machineModel.findUnique({ where: { id: sku.modelId }, select: { name: true } })
      : null

    return reply.send({
      success: true,
      data: {
        valid:        true,
        code,
        issuedAt:     auth.issuedAt,
        modelName:    model?.name   ?? '—',
        skuName:      sku?.name     ?? '—',
        size:         sku?.size     ?? '—',
        material:     sku?.material ?? '—',
        shippedAt:    order?.updatedAt ?? null,
        queriedCount: auth.queriedCount,
      }
    })
  })

  // ─────────────────────────────────────────────
  // 辅助函数
  // ─────────────────────────────────────────────

  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || user.role < 2)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }

  function requireProduction(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || user.role < 1)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}
