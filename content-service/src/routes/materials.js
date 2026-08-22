// src/routes/materials.js
// 零件与分装管理：采购实收、散装零件分装及 SKU 材料清单的基础数据。
// role >= 2 （管理员）

export default async function materialsRoutes(fastify) {

  const makeNo = prefix => {
    const now = new Date()
    const date = now.toISOString().slice(0, 10).replaceAll('-', '')
    return `${prefix}-${date}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  }

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
        type: { in: ['preparation_consumed', 'kit_assembly_consumed'] },
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

    const itemMap = Object.fromEntries(items.map(item => [item.id, item]))
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
        boundSkuCount: bindingMap[item.id] || 0,
        sourceMaterialName: item.sourceMaterialId ? itemMap[item.sourceMaterialId]?.name ?? null : null
      }
    })

    return reply.send({ success: true, data: result })
  })

  // ─────────────────────────────────────────────
  // POST /api/materials
  // 新建物品
  // Body: { name, itemCode?, itemType?, specification?, unit?, sourceMaterialId?, sourceQtyPerUnit?, ... }
  // ─────────────────────────────────────────────
  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, itemCode, itemType = 'RAW', specification, unit, safetyStock, leadTime, note, sourceMaterialId, sourceQtyPerUnit } = req.body
    const operatorId = req.user.userId

    if (!name?.trim()) return reply.code(400).send({ success: false, message: '物品名称不能为空' })
    if (!['RAW', 'PACKED', 'CONSUMABLE'].includes(itemType))
      return reply.code(400).send({ success: false, message: '零件类型无效' })
    if (itemType === 'PACKED' && (!sourceMaterialId || !Number.isInteger(Number(sourceQtyPerUnit)) || Number(sourceQtyPerUnit) <= 0))
      return reply.code(400).send({ success: false, message: '已分装零件必须选择来源零件并填写每包用量' })

    const item = await fastify.prisma.materialItem.create({
      data: {
        name: name.trim(),
        itemCode:      itemCode?.trim() || makeNo('MAT'),
        itemType,
        specification: specification?.trim() || null,
        unit:         unit         ?? '个',
        safetyStock:  safetyStock  ?? 10,
        leadTime:     leadTime     ?? 7,
        note:         note         ?? null,
        sourceMaterialId: itemType === 'PACKED' ? sourceMaterialId : null,
        sourceQtyPerUnit: itemType === 'PACKED' ? Number(sourceQtyPerUnit) : null,
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
    const { name, itemCode, itemType, specification, unit, safetyStock, leadTime, note, sourceMaterialId, sourceQtyPerUnit } = req.body

    const item = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!item || !item.isActive) return reply.code(404).send({ success: false, message: '物品不存在' })

    const data = {}
    if (name        !== undefined) data.name        = name.trim()
    if (itemCode    !== undefined) data.itemCode    = itemCode?.trim() || null
    if (itemType    !== undefined) {
      if (!['RAW', 'PACKED', 'CONSUMABLE'].includes(itemType))
        return reply.code(400).send({ success: false, message: '零件类型无效' })
      data.itemType = itemType
    }
    if (specification !== undefined) data.specification = specification?.trim() || null
    if (unit        !== undefined) data.unit        = unit
    if (safetyStock !== undefined) data.safetyStock = safetyStock
    if (leadTime    !== undefined) data.leadTime    = leadTime
    if (note        !== undefined) data.note        = note
    const nextType = itemType ?? item.itemType
    if (nextType === 'PACKED') {
      const nextSource = sourceMaterialId ?? item.sourceMaterialId
      const nextQty = sourceQtyPerUnit ?? item.sourceQtyPerUnit
      if (!nextSource || !Number.isInteger(Number(nextQty)) || Number(nextQty) <= 0)
        return reply.code(400).send({ success: false, message: '已分装零件必须选择来源零件并填写每包用量' })
      if (nextSource === id) return reply.code(400).send({ success: false, message: '零件不能把自己设为分装来源' })
      data.sourceMaterialId = nextSource
      data.sourceQtyPerUnit = Number(nextQty)
    } else {
      data.sourceMaterialId = null
      data.sourceQtyPerUnit = null
    }

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
  // 采购以现场清点为准。orderedSpec 只记录订购描述，不参与库存换算。
  // Body: { quantity? (兼容旧页面), actualQty?, acceptedQty?, rejectedQty?, orderedSpec?, supplierName?, supplierLotNo?, type?, note? }
  // ─────────────────────────────────────────────
  fastify.post('/:id/restock', { preHandler: requireAdmin }, async (req, reply) => {
    const { id }         = req.params
    const {
      quantity, actualQty, acceptedQty, rejectedQty = 0,
      orderedSpec, supplierName, supplierLotNo,
      type = 'purchase_in', note
    } = req.body
    const operatorId     = req.user.userId
    const accepted = Number(acceptedQty ?? quantity)
    const rejected = Number(rejectedQty || 0)
    const actual = Number(actualQty ?? (accepted + rejected))

    if (!Number.isInteger(accepted) || accepted <= 0) return reply.code(400).send({ success: false, message: '合格入库数量必须为正整数' })
    if (!Number.isInteger(rejected) || rejected < 0) return reply.code(400).send({ success: false, message: '次品数量不能为负数' })
    if (!Number.isInteger(actual) || actual !== accepted + rejected)
      return reply.code(400).send({ success: false, message: '实际清点数量必须等于合格数量加次品数量' })
    if (!['purchase_in', 'opening_stock'].includes(type))
      return reply.code(400).send({ success: false, message: '入库类型无效' })

    const item = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!item || !item.isActive) return reply.code(404).send({ success: false, message: '物品不存在' })

    const beforeQty = item.currentStock
    const afterQty  = beforeQty + accepted
    const receiptNo = makeNo(type === 'opening_stock' ? 'OPEN' : 'RCV')

    await fastify.prisma.$transaction([
      fastify.prisma.materialItem.update({
        where: { id },
        data:  { currentStock: afterQty }
      }),
      fastify.prisma.materialLog.create({
        data: { materialId: id, type, quantity: accepted, beforeQty, afterQty, operatorId, referenceNo: receiptNo, note: note || null }
      }),
      fastify.prisma.materialReceipt.create({
        data: {
          receiptNo, materialId: id, orderedSpec: orderedSpec?.trim() || null,
          actualQty: actual, acceptedQty: accepted, rejectedQty: rejected,
          supplierName: supplierName?.trim() || null,
          supplierLotNo: supplierLotNo?.trim() || null,
          operatorId, note: note?.trim() || null
        }
      })
    ])

    return reply.send({
      success: true,
      message: `✓ 合格入库 ${accepted} ${item.unit}${rejected ? `，另记录次品 ${rejected} ${item.unit}` : ''}，当前库存 ${afterQty}`,
      data: { currentStock: afterQty, receiptNo }
    })
  })

  // POST /api/materials/:id/prepare
  // 将来源散装零件分装成当前零件；损耗单独记录，但与正常用量一起扣减来源库存。
  fastify.post('/:id/prepare', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const { outputQty, lossQty = 0, note } = req.body
    const operatorId = req.user.userId
    const output = Number(outputQty)
    const loss = Number(lossQty || 0)

    if (!Number.isInteger(output) || output <= 0)
      return reply.code(400).send({ success: false, message: '分装成品数量必须为正整数' })
    if (!Number.isInteger(loss) || loss < 0)
      return reply.code(400).send({ success: false, message: '分装损耗不能为负数' })

    const packed = await fastify.prisma.materialItem.findUnique({ where: { id } })
    if (!packed || !packed.isActive) return reply.code(404).send({ success: false, message: '已分装零件不存在' })
    if (packed.itemType !== 'PACKED' || !packed.sourceMaterialId || !packed.sourceQtyPerUnit)
      return reply.code(400).send({ success: false, message: '该零件没有配置分装来源和每包用量' })

    const source = await fastify.prisma.materialItem.findUnique({ where: { id: packed.sourceMaterialId } })
    if (!source || !source.isActive) return reply.code(400).send({ success: false, message: '分装来源零件不存在或已停用' })

    const usedQty = output * packed.sourceQtyPerUnit
    const totalDeduct = usedQty + loss
    if (source.currentStock < totalDeduct)
      return reply.code(400).send({ success: false, message: `来源库存不足，需要 ${totalDeduct} ${source.unit}，当前 ${source.currentStock} ${source.unit}` })

    const batchNo = makeNo('PREP')
    await fastify.prisma.$transaction(async tx => {
      const deducted = await tx.materialItem.updateMany({
        where: { id: source.id, currentStock: { gte: totalDeduct } },
        data: { currentStock: { decrement: totalDeduct } }
      })
      if (deducted.count !== 1) throw new Error('来源库存刚刚发生变化，请刷新后重试')
      const sourceAfter = await tx.materialItem.findUnique({ where: { id: source.id } })
      const packedAfter = await tx.materialItem.update({ where: { id }, data: { currentStock: { increment: output } } })
      const batch = await tx.materialPreparationBatch.create({
        data: { batchNo, outputMaterialId: id, outputQty: output, operatorId, note: note?.trim() || null }
      })
      await tx.materialPreparationInput.create({
        data: { prepBatchId: batch.id, materialId: source.id, usedQty, lossQty: loss }
      })
      await tx.materialLog.createMany({ data: [
        {
          materialId: source.id, type: 'preparation_consumed', quantity: totalDeduct,
          beforeQty: sourceAfter.currentStock + totalDeduct, afterQty: sourceAfter.currentStock,
          operatorId, referenceNo: batchNo,
          note: `分装为${packed.name} ${output}${packed.unit}；正常使用${usedQty}${source.unit}，损耗${loss}${source.unit}`
        },
        {
          materialId: id, type: 'preparation_produced', quantity: output,
          beforeQty: packedAfter.currentStock - output, afterQty: packedAfter.currentStock,
          operatorId, referenceNo: batchNo, note: note?.trim() || null
        }
      ] })
    })

    return reply.send({
      success: true,
      message: `✓ 已分装 ${output} ${packed.unit}，使用 ${usedQty} ${source.unit}${loss ? `，另记录损耗 ${loss} ${source.unit}` : ''}`,
      data: { batchNo, outputQty: output, usedQty, lossQty: loss }
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
    return reply.code(409).send({ success: false, message: '请到款式管理页面编辑该 SKU 的完整材料清单' })
  })

  // ─────────────────────────────────────────────
  // DELETE /api/materials/:id/bindings/:skuId
  // 删除绑定
  // ─────────────────────────────────────────────
  fastify.delete('/:id/bindings/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    return reply.code(409).send({ success: false, message: '请到款式管理页面编辑该 SKU 的完整材料清单' })
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
