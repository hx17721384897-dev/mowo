// src/routes/materials.js
// 材料包物品管理（辅助耗材，独立于机型SKU体系）
// role >= 2 （管理员）

export default async function materialsRoutes(fastify) {

  // ─────────────────────────────────────────────
  // GET /api/materials
  // 获取所有活跃物品列表，附带近30天消耗量
  // ─────────────────────────────────────────────
  fastify.get('/', { preHandler: requireAdmin }, async (req, reply) => {
    const items = await fastify.prisma.materialItem.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    })

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const consumed = await fastify.prisma.materialLog.groupBy({
      by: ['materialId'],
      where: {
        type: 'order_consumed',
        createdAt: { gte: thirtyDaysAgo }
      },
      _sum: { quantity: true }
    })
    const consumedMap = Object.fromEntries(consumed.map(c => [c.materialId, c._sum.quantity || 0]))

    // 绑定的 SKU 数量
    const bindings = await fastify.prisma.materialSkuBinding.groupBy({
      by: ['materialId'],
      _count: { skuId: true }
    })
    const bindingMap = Object.fromEntries(bindings.map(b => [b.materialId, b._count.skuId]))

    const result = items.map(item => {
      const consumed30d    = consumedMap[item.id] || 0
      const dailyConsumption = consumed30d / 30
      const availableDays  = dailyConsumption > 0
        ? item.currentStock / dailyConsumption
        : null

      let alertLevel = 'OK'
      if (availableDays !== null) {
        if (availableDays < item.leadTime)           alertLevel = 'CRITICAL'
        else if (availableDays < item.leadTime * 1.5) alertLevel = 'WARNING'
        else if (availableDays < item.leadTime * 2)   alertLevel = 'SUGGEST'
      } else if (item.currentStock <= item.safetyStock) {
        alertLevel = item.currentStock === 0 ? 'CRITICAL' : 'WARNING'
      }

      return {
        ...item,
        consumed30d,
        dailyConsumption: Math.round(dailyConsumption * 10) / 10,
        availableDays:    availableDays !== null ? Math.round(availableDays) : null,
        alertLevel,
        boundSkuCount: bindingMap[item.id] || 0
      }
    })

    return reply.send({ success: true, data: result })
  })

  // ─────────────────────────────────────────────
  // POST /api/materials
  // 新建物品
  // Body: { name, unit?, safetyStock?, leadTime?, note? }
  // ─────────────────────────────────────────────
  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, unit, safetyStock, leadTime, note } = req.body
    const operatorId = req.user.userId

    if (!name?.trim()) return reply.code(400).send({ success: false, message: '物品名称不能为空' })

    const item = await fastify.prisma.materialItem.create({
      data: {
        name: name.trim(),
        unit:         unit         ?? '个',
        safetyStock:  safetyStock  ?? 10,
        leadTime:     leadTime     ?? 7,
        note:         note         ?? null,
        createdBy:    operatorId
      }
    })
    return reply.send({ success: true, data: item })
  })

  // ─────────────────────────────────────────────
  // PUT /api/materials/:id
  // 编辑物品（名称/单位/安全库存/采购周期/备注）
  // ─────────────────────────────────────────────
  fastify.put('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const { name, unit, safetyStock, leadTime, note } = req.body

    const item = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!item || !item.isActive) return reply.code(404).send({ success: false, message: '物品不存在' })

    const data = {}
    if (name        !== undefined) data.name        = name.trim()
    if (unit        !== undefined) data.unit        = unit
    if (safetyStock !== undefined) data.safetyStock = safetyStock
    if (leadTime    !== undefined) data.leadTime    = leadTime
    if (note        !== undefined) data.note        = note

    const updated = await fastify.prisma.materialItem.update({ where: { id }, data })
    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────
  // DELETE /api/materials/:id
  // 软删除（isActive = false）
  // ─────────────────────────────────────────────
  fastify.delete('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    await fastify.prisma.materialItem.update({
      where: { id },
      data:  { isActive: false }
    })
    return reply.send({ success: true })
  })

  // ─────────────────────────────────────────────
  // GET /api/materials/:id/logs
  // 变动记录
  // ─────────────────────────────────────────────
  fastify.get('/:id/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const { page = 1, limit = 50 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const [logs, total] = await Promise.all([
      fastify.prisma.materialLog.findMany({
        where: { materialId: id },
        orderBy: { createdAt: 'desc' },
        skip, take: parseInt(limit)
      }),
      fastify.prisma.materialLog.count({ where: { materialId: id } })
    ])

    return reply.send({ success: true, data: { logs, total, page: parseInt(page) } })
  })

  // ─────────────────────────────────────────────
  // POST /api/materials/:id/restock
  // 入库（purchase_in 采购入库 / opening_stock 期初录入）
  // Body: { quantity, type?, note? }
  // ─────────────────────────────────────────────
  fastify.post('/:id/restock', { preHandler: requireAdmin }, async (req, reply) => {
    const { id }         = req.params
    const { quantity, type = 'purchase_in', note } = req.body
    const operatorId     = req.user.userId

    if (!quantity || quantity <= 0) return reply.code(400).send({ success: false, message: '数量必须大于0' })
    if (!['purchase_in', 'opening_stock'].includes(type))
      return reply.code(400).send({ success: false, message: '入库类型无效' })

    const item = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!item || !item.isActive) return reply.code(404).send({ success: false, message: '物品不存在' })

    const beforeQty = item.currentStock
    const afterQty  = beforeQty + quantity

    await fastify.prisma.$transaction([
      fastify.prisma.materialItem.update({
        where: { id },
        data:  { currentStock: afterQty }
      }),
      fastify.prisma.materialLog.create({
        data: { materialId: id, type, quantity, beforeQty, afterQty, operatorId, note: note || null }
      })
    ])

    return reply.send({
      success: true,
      message: `✓ 已入库 ${quantity} ${item.unit}，当前库存 ${afterQty}`,
      data: { currentStock: afterQty }
    })
  })

  // ─────────────────────────────────────────────
  // POST /api/materials/:id/defect
  // 报损（production_defect）
  // Body: { quantity, note }
  // ─────────────────────────────────────────────
  fastify.post('/:id/defect', { preHandler: requireAdmin }, async (req, reply) => {
    const { id }             = req.params
    const { quantity, note } = req.body
    const operatorId         = req.user.userId

    if (!quantity || quantity <= 0) return reply.code(400).send({ success: false, message: '数量必须大于0' })

    const item = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!item || !item.isActive) return reply.code(404).send({ success: false, message: '物品不存在' })
    if (item.currentStock < quantity) return reply.code(400).send({ success: false, message: `报损数量超出库存（当前：${item.currentStock}）` })

    const beforeQty = item.currentStock
    const afterQty  = beforeQty - quantity

    await fastify.prisma.$transaction([
      fastify.prisma.materialItem.update({ where: { id }, data: { currentStock: afterQty } }),
      fastify.prisma.materialLog.create({
        data: { materialId: id, type: 'production_defect', quantity, beforeQty, afterQty, operatorId, note: note || null }
      })
    ])

    return reply.send({
      success: true,
      message: `✓ 已登记报损 ${quantity} ${item.unit}，当前库存 ${afterQty}`,
      data: { currentStock: afterQty }
    })
  })

  // ─────────────────────────────────────────────
  // POST /api/materials/:id/adjust
  // 手动调减（manual_adjustment，支持正负数）
  // Body: { delta, note }
  // ─────────────────────────────────────────────
  fastify.post('/:id/adjust', { preHandler: requireAdmin }, async (req, reply) => {
    const { id }              = req.params
    const { delta, note }     = req.body
    const operatorId          = req.user.userId

    if (delta === undefined || delta === 0) return reply.code(400).send({ success: false, message: '调整量不能为0' })
    if (!note?.trim()) return reply.code(400).send({ success: false, message: '手动调整必须填写原因' })

    const item = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!item || !item.isActive) return reply.code(404).send({ success: false, message: '物品不存在' })

    const afterQty = item.currentStock + delta
    if (afterQty < 0) return reply.code(400).send({ success: false, message: `调减数量超出库存（当前：${item.currentStock}）` })

    const beforeQty = item.currentStock

    await fastify.prisma.$transaction([
      fastify.prisma.materialItem.update({ where: { id }, data: { currentStock: afterQty } }),
      fastify.prisma.materialLog.create({
        data: {
          materialId: id, type: 'manual_adjustment',
          quantity: Math.abs(delta), beforeQty, afterQty,
          operatorId, note: note.trim()
        }
      })
    ])

    return reply.send({
      success: true,
      message: `✓ 已调整 ${delta > 0 ? '+' : ''}${delta} ${item.unit}，当前库存 ${afterQty}`,
      data: { currentStock: afterQty }
    })
  })

  // ─────────────────────────────────────────────
  // GET /api/materials/:id/bindings
  // 绑定 SKU 列表
  // ─────────────────────────────────────────────
  fastify.get('/:id/bindings', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params

    const bindings = await fastify.prisma.materialSkuBinding.findMany({
      where: { materialId: id },
      orderBy: { createdAt: 'asc' }
    })

    const skuIds = bindings.map(b => b.skuId)
    const skus   = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const skuMap = Object.fromEntries(skus.map(s => [s.id, s]))

    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models   = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = bindings.map(b => {
      const sku  = skuMap[b.skuId] ?? {}
      const spec = [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
      return { ...b, modelName: modelMap[sku.modelId] ?? '—', skuSpec: spec }
    })

    return reply.send({ success: true, data: result })
  })

  // ─────────────────────────────────────────────
  // POST /api/materials/:id/bindings
  // 添加绑定
  // Body: { skuId, qtyPerUnit? }
  // ─────────────────────────────────────────────
  fastify.post('/:id/bindings', { preHandler: requireAdmin }, async (req, reply) => {
    const { id }                        = req.params
    const { skuId, qtyPerUnit = 1 }     = req.body

    if (!skuId) return reply.code(400).send({ success: false, message: '缺少 skuId' })

    const existing = await fastify.prisma.materialSkuBinding.findUnique({
      where: { materialId_skuId: { materialId: id, skuId } }
    })
    if (existing) return reply.code(409).send({ success: false, message: '该 SKU 已绑定' })

    const binding = await fastify.prisma.materialSkuBinding.create({
      data: { materialId: id, skuId, qtyPerUnit }
    })
    return reply.send({ success: true, data: binding })
  })

  // ─────────────────────────────────────────────
  // DELETE /api/materials/:id/bindings/:skuId
  // 删除绑定
  // ─────────────────────────────────────────────
  fastify.delete('/:id/bindings/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { id, skuId } = req.params
    await fastify.prisma.materialSkuBinding.deleteMany({
      where: { materialId: id, skuId }
    })
    return reply.send({ success: true })
  })

  // ─────────────────────────────────────────────
  // 内部：发货后自动扣减（由 inventory.js /ship 调用）
  // ─────────────────────────────────────────────
  fastify.decorate('deductMaterialsForSku', async (skuId, orderId, operatorId) => {
    const bindings = await fastify.prisma.materialSkuBinding.findMany({
      where: { materialId: { not: undefined }, skuId }
    })
    if (!bindings.length) return

    for (const binding of bindings) {
      const item = await fastify.prisma.materialItem.findUnique({ where: { id: binding.materialId } })
      if (!item || !item.isActive) continue

      const deduct    = binding.qtyPerUnit
      const beforeQty = item.currentStock
      const afterQty  = Math.max(0, beforeQty - deduct)

      await fastify.prisma.$transaction([
        fastify.prisma.materialItem.update({ where: { id: item.id }, data: { currentStock: afterQty } }),
        fastify.prisma.materialLog.create({
          data: {
            materialId: item.id, type: 'order_consumed',
            quantity: deduct, beforeQty, afterQty,
            operatorId, orderId, note: `发货自动扣减：订单 ${orderId}`
          }
        })
      ])
    }
  })

  // ─────────────────────────────────────────────
  // 权限中间件
  // ─────────────────────────────────────────────
  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || (user.role ?? 0) < 2)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}
