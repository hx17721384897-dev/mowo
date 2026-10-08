// src/routes/inventory.js
// 库存管理接口（v2：4态库存 + 三级预警 + 渠道配额 + 快照查询）

import crypto from 'node:crypto'

import {
  manualAdjust,
  calcAvailable,
  getInventoryWithAlert,
} from '../lib/inventory.js'
import {
  consumeMaterialAllocations,
  previewMaterialAllocation,
  presentAllocation
} from '../lib/inventory-lots.js'

export default async function inventoryRoutes(fastify) {

  const makeBatchNo = () => {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    return `KB-${date}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  }
  const makeNo = prefix => {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    return `${prefix}-${date}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  }

  // ─────────────────────────────────────────────
  // 管理员接口（role >= 2）
  // ─────────────────────────────────────────────

  // GET /api/inventory
  // 所有SKU库存列表（含款式/SKU信息 + 4态库存 + 三级预警）
  fastify.get('/', { preHandler: requireAdmin }, async (req, reply) => {
    const inventories = await fastify.prisma.skuInventory.findMany({
      orderBy: { createdAt: 'asc' }
    })

    const skuIds  = inventories.map(i => i.skuId)
    const skus    = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const skuMap  = Object.fromEntries(skus.map(s => [s.id, s]))
    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models  = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    // 批量查近30天出货量（用于预警计算）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const deductAggs = await fastify.prisma.inventoryLog.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds }, type: 'wip_deduct', createdAt: { gte: thirtyDaysAgo } },
      _sum: { quantity: true }
    })
    const deductMap = Object.fromEntries(deductAggs.map(a => [a.skuId, a._sum.quantity || 0]))

    const result = inventories.map(inv => {
      const sku       = skuMap[inv.skuId] ?? {}
      const skuSpec   = sku.size
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : '—'
      const available = calcAvailable(inv)
      const dailySales = (deductMap[inv.skuId] || 0) / 30
      const effectiveDailySales = dailySales * (inv.safetyFactor || 1.0)

      let alertLevel = 'OK'
      if (effectiveDailySales > 0) {
        const daysLeft = available / effectiveDailySales
        if (daysLeft < 7)  alertLevel = 'CRITICAL'
        else if (daysLeft < 14) alertLevel = 'WARNING'
        else if (daysLeft < 30) alertLevel = 'SUGGEST'
      } else if (available <= inv.safetyStock) {
        alertLevel = 'WARNING'  // 无销量时仍按安全库存线判断
      }

      return {
        ...inv,
        skuName:        skuSpec,
        skuCode:        sku.skuCode    ?? null,
        skuBarcode:     sku.skuBarcode ?? null,
        skuType:        sku.skuType ?? 'KIT',
        licenseStatus:  sku.licenseStatus ?? null,
        licenseExpireDate: sku.licenseExpireDate ?? null,
        modelName:      modelMap[sku.modelId] ?? '—',
        size:           sku.size       ?? '',
        material:       sku.material   ?? '',
        frameCount:     sku.frameCount ?? '',
        colorName:      sku.colorName  ?? '',
        colorHex:       sku.colorHex   ?? '',
        availableQty:   available,
        // 兼容旧字段名
        availableStock: available,
        isLow:          alertLevel !== 'OK',
        alertLevel,
        dailySales:     Math.round(dailySales * 10) / 10,
      }
    })

    return reply.send({ success: true, data: result })
  })

  // GET /api/inventory/kits/assemblies — 最近的材料包入库记录
  fastify.get('/kits/assemblies', { preHandler: requireAdmin }, async (req, reply) => {
    const rows = await fastify.prisma.kitAssemblyBatch.findMany({
      orderBy: { createdAt: 'desc' }, take: 100, include: { container: true }
    })
    return reply.send({ success: true, data: rows })
  })

  // GET /api/inventory/kits/containers — 可重复使用的材料包箱码
  fastify.get('/kits/containers', { preHandler: requireAdmin }, async (req, reply) => {
    const rows = await fastify.prisma.kitContainer.findMany({
      where: { isActive: true }, orderBy: { code: 'asc' }
    })
    return reply.send({ success: true, data: rows })
  })

  // 组装前先给员工看系统按先进先出推荐的来源批次。
  fastify.post('/kits/assemble-preview', { preHandler: requireProduction }, async (req, reply) => {
    const { skuId, quantity, allocations = [] } = req.body || {}
    const qty = Number(quantity)
    if (!skuId || !Number.isInteger(qty) || qty <= 0)
      return reply.code(400).send({ success: false, message: '请选择 SKU 并填写正确的组装数量' })
    const bindings = await fastify.prisma.materialSkuBinding.findMany({ where: { skuId } })
    if (!bindings.length) return reply.code(400).send({ success: false, message: '该 SKU 还没有材料清单' })
    const materials = await fastify.prisma.materialItem.findMany({ where: { id: { in: bindings.map(row => row.materialId) }, isActive: true } })
    const materialMap = Object.fromEntries(materials.map(row => [row.id, row]))
    try {
      const plan = []
      for (const binding of bindings) {
        const material = materialMap[binding.materialId]
        if (!material) throw new Error('材料清单中存在已停用零件')
        const requiredQty = binding.qtyPerUnit * qty
        const override = allocations.find(row => row.materialId === material.id)?.allocations
        const selected = await previewMaterialAllocation(fastify.prisma, material, requiredQty, override)
        plan.push({ requiredQty, qtyPerUnit: binding.qtyPerUnit, ...presentAllocation(material, selected) })
      }
      return reply.send({ success: true, data: { skuId, quantity: qty, plan } })
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }
  })

  // POST /api/inventory/kits/assemble
  // 员工只执行一次“材料包入库”：系统按当前 BOM 原子扣零件并增加材料包库存。
  fastify.post('/kits/assemble', { preHandler: requireProduction }, async (req, reply) => {
    const { skuId, quantity, boxCode, location, note, allocations = [] } = req.body || {}
    const qty = Number(quantity)
    const operatorId = req.user.userId
    if (!skuId) return reply.code(400).send({ success: false, message: '请选择材料包 SKU' })
    if (!Number.isInteger(qty) || qty <= 0)
      return reply.code(400).send({ success: false, message: '入库数量必须为正整数' })

    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })
    const bindings = await fastify.prisma.materialSkuBinding.findMany({ where: { skuId } })
    if (!bindings.length)
      return reply.code(400).send({ success: false, message: '该 SKU 还没有材料清单，请先到款式管理设置' })

    const materials = await fastify.prisma.materialItem.findMany({
      where: { id: { in: bindings.map(item => item.materialId) }, isActive: true }
    })
    const materialMap = Object.fromEntries(materials.map(item => [item.id, item]))
    if (materials.length !== bindings.length)
      return reply.code(400).send({ success: false, message: '材料清单中存在已停用零件，请先修正材料清单' })

    const requirements = bindings.map(binding => ({
      material: materialMap[binding.materialId],
      qtyPerUnit: binding.qtyPerUnit,
      requiredQty: binding.qtyPerUnit * qty
    }))
    const allocationPlan = []
    try {
      for (const row of requirements) {
        const override = allocations.find(item => item.materialId === row.material.id)?.allocations
        const selected = await previewMaterialAllocation(fastify.prisma, row.material, row.requiredQty, override)
        allocationPlan.push({ ...row, allocations: selected })
      }
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    const normalizedBoxCode = boxCode?.trim().toUpperCase() || null
    if (normalizedBoxCode) {
      const existingBox = await fastify.prisma.kitContainer.findUnique({ where: { code: normalizedBoxCode } })
      if (existingBox && existingBox.skuId !== skuId)
        return reply.code(400).send({ success: false, message: '该箱码已经用于另一种 SKU；一个箱子只能存放一种材料包' })
    }

    const batchNo = makeBatchNo()
    const bomSnapshot = JSON.stringify(requirements.map(row => ({
      materialId: row.material.id,
      itemCode: row.material.itemCode,
      name: row.material.name,
      specification: row.material.specification,
      unit: row.material.unit,
      qtyPerUnit: row.qtyPerUnit,
      totalQty: row.requiredQty
    })))

    try {
      await fastify.prisma.$transaction(async tx => {
        for (const row of allocationPlan) {
          await consumeMaterialAllocations(tx, row.material, row.allocations)
          const changed = await tx.materialItem.updateMany({
            where: { id: row.material.id, currentStock: { gte: row.requiredQty } },
            data: { currentStock: { decrement: row.requiredQty } }
          })
          if (changed.count !== 1) throw new Error(`${row.material.name}库存刚刚发生变化，请刷新后重试`)
          const materialAfter = await tx.materialItem.findUnique({ where: { id: row.material.id } })
          await tx.materialLog.create({
            data: {
              materialId: row.material.id, type: 'kit_assembly_consumed', quantity: row.requiredQty,
              beforeQty: materialAfter.currentStock + row.requiredQty, afterQty: materialAfter.currentStock,
              operatorId, referenceNo: batchNo, note: `组装 ${sku.skuCode || sku.skuBarcode || sku.id} × ${qty}`
            }
          })
        }

        const inventory = await tx.skuInventory.findUnique({ where: { skuId } })
        if (!inventory) throw new Error('SKU库存记录不存在')
        const inventoryAfter = await tx.skuInventory.update({ where: { skuId }, data: { currentStock: { increment: qty } } })
        await tx.inventoryLog.create({
          data: {
            skuId, type: 'kit_assembled', quantity: qty, operatorId,
            beforeQty: inventoryAfter.currentStock - qty, afterQty: inventoryAfter.currentStock,
            reason: '材料包组装入库', note: `${batchNo}${normalizedBoxCode ? `；箱码 ${normalizedBoxCode}` : ''}`
          }
        })

        let container = null
        if (normalizedBoxCode) {
          container = await tx.kitContainer.upsert({
            where: { code: normalizedBoxCode },
            create: { code: normalizedBoxCode, skuId, currentQty: qty, location: location?.trim() || null },
            update: { currentQty: { increment: qty }, location: location?.trim() || undefined }
          })
        }
        const assembly = await tx.kitAssemblyBatch.create({
          data: {
            batchNo, skuId, quantity: qty, bomVersion: sku.bomVersion || 0,
            availableQty: qty, bomSnapshot, containerId: container?.id || null,
            operatorId, note: note?.trim() || null
          }
        })
        await tx.kitAssemblyConsumption.createMany({ data: allocationPlan.flatMap(row => row.allocations.map(lot => ({
          kitAssemblyBatchId: assembly.id, materialId: row.material.id,
          sourceType: lot.sourceType, sourceBatchId: lot.id, quantity: lot.quantity
        }))) })
      })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message || '材料包入库失败' })
    }

    return reply.send({
      success: true,
      message: `✓ 已入库 ${qty} 套材料包，零件已同步扣除`,
      data: {
        batchNo, skuId, quantity: qty, boxCode: normalizedBoxCode,
        requirements: allocationPlan.map(row => ({ requiredQty: row.requiredQty, ...presentAllocation(row.material, row.allocations) }))
      }
    })
  })

  // ── 退回收货与检查 ─────────────────────────────
  fastify.get('/returns', { preHandler: requireProduction }, async (req, reply) => {
    const where = req.query.status ? { status: req.query.status } : {}
    const receipts = await fastify.prisma.inventoryReturnReceipt.findMany({
      where, include: { items: true }, orderBy: { receivedAt: 'desc' }, take: 100
    })
    const aftersales = await fastify.prisma.aftersaleRequest.findMany({
      where: { id: { in: receipts.map(row => row.aftersaleRequestId) } }, include: { order: true, user: { select: { phone: true, nickname: true } } }
    })
    const requestMap = Object.fromEntries(aftersales.map(row => [row.id, row]))
    return reply.send({ success: true, data: receipts.map(row => ({ ...row, aftersale: requestMap[row.aftersaleRequestId] || null })) })
  })

  fastify.post('/returns/receive', { preHandler: requireProduction }, async (req, reply) => {
    const { aftersaleRequestId, trackingNo, trackingCompany, note } = req.body || {}
    const request = await fastify.prisma.aftersaleRequest.findUnique({ where: { id: aftersaleRequestId }, include: { order: true } })
    if (!request) return reply.code(404).send({ success: false, message: '售后申请不存在' })
    if (!['approved', 'completed'].includes(request.status))
      return reply.code(400).send({ success: false, message: '只有已同意的售后申请才能登记退回收货' })
    const existing = await fastify.prisma.inventoryReturnReceipt.findFirst({
      where: { aftersaleRequestId, status: { in: ['QUARANTINED', 'INSPECTED'] } }
    })
    if (existing) return reply.code(409).send({ success: false, message: `该售后已登记退回：${existing.returnNo}` })
    const row = await fastify.prisma.inventoryReturnReceipt.create({ data: {
      returnNo: makeNo('RT'), aftersaleRequestId, orderId: request.orderId,
      trackingNo: trackingNo?.trim() || null, trackingCompany: trackingCompany?.trim() || null,
      receivedBy: req.user.userId, note: note?.trim() || null
    } })
    return reply.send({ success: true, message: `已收货并进入隔离区：${row.returnNo}`, data: row })
  })

  fastify.post('/returns/:id/inspect', { preHandler: requireProduction }, async (req, reply) => {
    const { id } = req.params
    const { packageCondition, receivedQty = 1, items = [], note } = req.body || {}
    const qty = Number(receivedQty)
    const receipt = await fastify.prisma.inventoryReturnReceipt.findUnique({ where: { id } })
    if (!receipt) return reply.code(404).send({ success: false, message: '退回收货记录不存在' })
    if (receipt.status !== 'QUARANTINED') return reply.code(400).send({ success: false, message: '该退回件已经检查完成' })
    const order = await fastify.prisma.customizeOrder.findUnique({ where: { id: receipt.orderId } })
    if (!order) return reply.code(404).send({ success: false, message: '原生产任务不存在' })
    if (!Number.isInteger(qty) || qty <= 0) return reply.code(400).send({ success: false, message: '收回数量必须为正整数' })

    if (packageCondition !== 'UNOPENED_INTACT' && !items.length)
      return reply.code(400).send({ success: false, message: '已拆封退回件必须逐项登记去向' })

    try {
      await fastify.prisma.$transaction(async tx => {
        const inspectionRows = []
        if (packageCondition === 'UNOPENED_INTACT') {
          const inventory = await tx.skuInventory.findUnique({ where: { skuId: order.skuId } })
          if (!inventory) throw new Error('原 SKU 没有库存记录')
          const latest = await tx.kitAssemblyBatch.findFirst({ where: { skuId: order.skuId }, orderBy: { createdAt: 'desc' } })
          const batch = await tx.kitAssemblyBatch.create({ data: {
            batchNo: makeNo('KR'), skuId: order.skuId, quantity: qty, availableQty: qty,
            bomVersion: latest?.bomVersion || 0, bomSnapshot: latest?.bomSnapshot || '[]',
            stockClass: 'NEW', batchType: 'RETURN_RECOVERED', sourceReturnReceiptId: receipt.id,
            operatorId: req.user.userId, note: note?.trim() || '退回未拆封完整材料包，检查合格后回库'
          } })
          const after = await tx.skuInventory.update({ where: { skuId: order.skuId }, data: { currentStock: { increment: qty } } })
          await tx.inventoryLog.create({ data: {
            skuId: order.skuId, type: 'return_recovered', quantity: qty, orderId: order.id,
            operatorId: req.user.userId, beforeQty: after.currentStock - qty, afterQty: after.currentStock,
            reason: '退回检查合格', note: `${receipt.returnNo}；新回收批次 ${batch.batchNo}`
          } })
          inspectionRows.push({ returnReceiptId: receipt.id, inventoryLevel: 'KIT', skuId: order.skuId,
            receivedQty: qty, disposition: 'NORMAL_KIT', resultBatchType: 'KIT', resultBatchId: batch.id })
        } else {
          for (const item of items) {
            const itemQty = Number(item.receivedQty)
            if (!Number.isInteger(itemQty) || itemQty <= 0) throw new Error('逐项检查数量必须为正整数')
            if (!['SERVICE_ONLY', 'SCRAP', 'MISSING', 'PRIVATE_DESTROY'].includes(item.disposition))
              throw new Error('已拆封物品只能进入维修备用、报废、缺失或私密素材销毁流程')
            let resultBatchId = null
            if (item.disposition === 'SERVICE_ONLY') {
              const material = await tx.materialItem.findUnique({ where: { id: item.materialId } })
              if (!material || material.itemType === 'PACKED') throw new Error('维修备用只能登记可复用的基础零件')
              const lot = await tx.materialReceipt.create({ data: {
                receiptNo: makeNo('SRV'), materialId: material.id, orderedSpec: '售后退回检查',
                actualQty: itemQty, acceptedQty: itemQty, availableQty: itemQty,
                stockClass: 'SERVICE_ONLY', sourceReturnReceiptId: receipt.id,
                operatorId: req.user.userId, note: item.note?.trim() || '仅供维修或内部使用，不进入新订单'
              } })
              await tx.materialItem.update({ where: { id: material.id }, data: { serviceStock: { increment: itemQty } } })
              resultBatchId = lot.id
            }
            inspectionRows.push({ returnReceiptId: receipt.id, inventoryLevel: item.inventoryLevel || 'BASE',
              materialId: item.materialId || null, skuId: item.skuId || null, receivedQty: itemQty,
              disposition: item.disposition, resultBatchType: resultBatchId ? 'SERVICE_RECEIPT' : null,
              resultBatchId, note: item.note?.trim() || null })
          }
        }
        await tx.inventoryReturnInspectionItem.createMany({ data: inspectionRows })
        await tx.inventoryReturnReceipt.update({ where: { id }, data: {
          status: 'INSPECTED', inspectedBy: req.user.userId, inspectedAt: new Date(), note: note?.trim() || receipt.note
        } })
        await tx.aftersaleRequest.update({ where: { id: receipt.aftersaleRequestId }, data: { status: 'completed' } })
      })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message || '退回检查登记失败' })
    }
    return reply.send({ success: true, message: '退回检查已完成，库存已按检查结论处理' })
  })

  fastify.post('/returns/:id/replacement', { preHandler: requireProduction }, async (req, reply) => {
    const receipt = await fastify.prisma.inventoryReturnReceipt.findUnique({ where: { id: req.params.id } })
    if (!receipt) return reply.code(404).send({ success: false, message: '退回记录不存在' })
    const original = await fastify.prisma.customizeOrder.findUnique({ where: { id: receipt.orderId } })
    if (!original) return reply.code(404).send({ success: false, message: '原生产任务不存在' })
    const exists = await fastify.prisma.customizeOrder.findFirst({ where: { replacementForId: original.id, aftersaleRequestId: receipt.aftersaleRequestId } })
    if (exists) return reply.code(409).send({ success: false, message: `补发任务已经创建：${exists.orderNo}` })
    let nextUnitIndex = original.unitIndex
    if (original.salesOrderItemId) {
      const last = await fastify.prisma.customizeOrder.findFirst({ where: { salesOrderItemId: original.salesOrderItemId }, orderBy: { unitIndex: 'desc' } })
      nextUnitIndex = (last?.unitIndex || 0) + 1
    }
    const replacement = await fastify.prisma.customizeOrder.create({ data: {
      orderNo: makeNo('PU-R'), userId: original.userId, modelId: original.modelId, modelName: original.modelName,
      frameCount: original.frameCount, size: original.size, material: original.material,
      color: original.color, colorName: original.colorName, skuId: original.skuId,
      ossPath: original.ossPath, frameUrls: original.frameUrls, status: 'processing',
      sourceType: original.sourceType, collabWorkId: original.collabWorkId,
      receiverName: original.receiverName, receiverPhone: original.receiverPhone,
      receiverAddress: original.receiverAddress, receiverCity: original.receiverCity,
      platform: original.platform, priorityLevel: original.priorityLevel,
      buyerNote: `售后补发，原任务 ${original.orderNo}${req.body?.note ? `；${req.body.note}` : ''}`,
      salesOrderItemId: original.salesOrderItemId, unitIndex: nextUnitIndex,
      replacementForId: original.id, aftersaleRequestId: receipt.aftersaleRequestId
    } })
    return reply.send({ success: true, message: `已创建新的补发生产任务：${replacement.orderNo}`, data: replacement })
  })

  // GET /api/inventory/:skuId
  // 单个SKU库存详情 + 最近100条变动记录
  fastify.get('/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const invData = await getInventoryWithAlert(fastify.prisma, skuId)
    if (!invData) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const logs = await fastify.prisma.inventoryLog.findMany({
      where: { skuId },
      orderBy: { createdAt: 'desc' },
      take: 100
    })

    return reply.send({
      success: true,
      data: {
        ...invData,
        availableStock: invData.availableQty,
        logs
      }
    })
  })

  // POST /api/inventory/:skuId/restock
  // 手动盘点入库（通过 InventoryService 保证幂等 + 审计日志）
  // Body: { quantity, note?, reason? }
  fastify.post('/:skuId/restock', { preHandler: requireProduction }, async (req, reply) => {
    const { skuId }          = req.params
    const { quantity, note, reason } = req.body
    const clientRequestId = String(req.body?.clientRequestId || '').trim()
    const operatorId         = req.user.userId
    const userRole           = req.user.role ?? 0

    if (!clientRequestId || clientRequestId.length > 80)
      return reply.code(400).send({ success: false, message: '缺少库存调整请求标识，请重新打开操作面板' })
    if (!Number.isInteger(quantity) || quantity === 0)
      return reply.code(400).send({ success: false, message: '数量不能为0' })
    if (userRole < 2 && quantity < 0)
      return reply.code(403).send({ success: false, message: '生产端只能录入正数' })

    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })
    if (quantity < 0 && inv.currentStock + quantity < 0)
      return reply.code(400).send({ success: false, message: `调减数量超出当前库存（当前：${inv.currentStock}）` })

    const adjustReason   = reason || note || (quantity > 0 ? '手动入库' : '手动调减')
    const idempotencyKey = `inventory-adjust:${clientRequestId}`
    const requestFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ skuId, quantity, reason: adjustReason }))
      .digest('hex')

    const validateReplay = row => {
      if (!row) return null
      if (row.skuId !== skuId || row.operatorId !== operatorId || row.requestFingerprint !== requestFingerprint) {
        return reply.code(409).send({
          success: false,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: '本次请求标识已用于其他库存调整，请刷新后重试'
        })
      }
      return true
    }
    const replay = await fastify.prisma.inventoryLog.findUnique({ where: { idempotencyKey } })
    if (replay) {
      const valid = validateReplay(replay)
      if (valid !== true) return valid
      const current = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
      return reply.send({
        success: true,
        message: '库存调整已保存',
        data: { ...current, availableQty: calcAvailable(current), reused: true }
      })
    }

    try {
      await manualAdjust(
        fastify.prisma, skuId, quantity, adjustReason, operatorId,
        idempotencyKey, requestFingerprint
      )
    } catch (err) {
      if (err.code === 'P2002') {
        const concurrentReplay = await fastify.prisma.inventoryLog.findUnique({ where: { idempotencyKey } })
        const valid = validateReplay(concurrentReplay)
        if (valid !== true) return valid
        const current = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
        return reply.send({
          success: true,
          message: '库存调整已保存',
          data: { ...current, availableQty: calcAvailable(current), reused: true }
        })
      }
      return reply.code(400).send({ success: false, message: err.message })
    }

    const updated = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    const actionWord = quantity > 0 ? `入库 ${quantity} 个` : `调减 ${Math.abs(quantity)} 个`
    return reply.send({
      success: true,
      message: `✓ 已${actionWord}，当前库存 ${updated.currentStock}`,
      data:    { ...updated, availableQty: calcAvailable(updated), reused: false }
    })
  })

  // PUT /api/inventory/:skuId/settings
  // 修改预警设置 + 流量因子
  // Body: { safetyStock?, maxOrderLimit?, safetyFactor? }
  fastify.put('/:skuId/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { safetyStock, maxOrderLimit, safetyFactor } = req.body

    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const data = {}
    if (safetyStock   !== undefined) data.safetyStock   = safetyStock
    if (maxOrderLimit !== undefined) data.maxOrderLimit = maxOrderLimit
    if (safetyFactor  !== undefined) data.safetyFactor  = safetyFactor

    const updated = await fastify.prisma.skuInventory.update({ where: { skuId }, data })
    return reply.send({ success: true, data: { ...updated, availableQty: calcAvailable(updated) } })
  })

  // GET /api/inventory/logs — 全局变动记录（管理员）
  fastify.get('/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = 1, limit = 50, skuId, type } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (skuId) where.skuId = skuId
    if (type)  where.type  = type

    const [logs, total] = await Promise.all([
      fastify.prisma.inventoryLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit) }),
      fastify.prisma.inventoryLog.count({ where })
    ])

    const skuIds   = [...new Set(logs.map(l => l.skuId))]
    const skus     = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models   = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const skuMap   = Object.fromEntries(skus.map(s => [s.id, s]))
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = logs.map(l => {
      const sku  = skuMap[l.skuId] ?? {}
      const spec = sku.size
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : '—'
      return { ...l, skuSpec: spec, modelName: modelMap[sku.modelId] ?? '—' }
    })

    return reply.send({ success: true, data: { logs: result, total, page: parseInt(page), limit: parseInt(limit) } })
  })

  // GET /api/inventory/snapshots — 历史快照（管理员）
  // Query: ?date=2026-04-14 or ?skuId=xxx&page=1
  fastify.get('/snapshots', { preHandler: requireAdmin }, async (req, reply) => {
    const { date, skuId, page = 1, limit = 50 } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (skuId) where.skuId = skuId
    if (date) {
      const d = new Date(date)
      const dNext = new Date(d)
      dNext.setDate(dNext.getDate() + 1)
      where.snapshotDate = { gte: d, lt: dNext }
    }

    const [snapshots, total] = await Promise.all([
      fastify.prisma.inventorySnapshot.findMany({ where, orderBy: { snapshotDate: 'desc' }, skip, take: parseInt(limit) }),
      fastify.prisma.inventorySnapshot.count({ where })
    ])

    return reply.send({ success: true, data: { snapshots, total, page: parseInt(page) } })
  })

  // GET /api/inventory/channel-quotas — 查看渠道配额建议
  fastify.get('/channel-quotas', { preHandler: requireAdmin }, async (req, reply) => {
    const inventories = await fastify.prisma.skuInventory.findMany()
    const quotas      = await fastify.prisma.channelQuota.findMany()
    const quotaMap    = Object.fromEntries(quotas.map(q => [q.skuId, q]))

    const skuIds = inventories.map(i => i.skuId)
    const skus   = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const skuMap = Object.fromEntries(skus.map(s => [s.id, s]))

    const modelIds = [...new Set(skus.map(s => s.modelId).filter(Boolean))]
    const models   = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = inventories.map(inv => {
      const available = calcAvailable(inv)
      const quota     = quotaMap[inv.skuId]
      const buffer    = quota?.bufferPool ?? 10
      const allocatable = Math.max(0, available - buffer)

      const sku  = skuMap[inv.skuId]
      const spec = sku
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : ''

      return {
        skuId:         inv.skuId,
        skuCode:       sku?.skuCode   ?? null,
        modelName:     sku ? (modelMap[sku.modelId] ?? '—') : '—',
        skuSpec:       spec,
        available,
        bufferPool:    buffer,
        allocatable,
        suggestTaobao: Math.floor(allocatable * 0.35),
        suggestDouyin: Math.floor(allocatable * 0.35),
        suggestXhs:    Math.floor(allocatable * 0.30),
        taobaoQty:     quota?.taobaoQty ?? 0,
        douyinQty:     quota?.douyinQty ?? 0,
        xhsQty:        quota?.xhsQty ?? 0,
        livestreamMode: quota?.livestreamMode ?? false,
      }
    })

    return reply.send({ success: true, data: result })
  })

  // PUT /api/inventory/channel-quotas/:skuId — 更新渠道配额
  fastify.put('/channel-quotas/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { taobaoQty, douyinQty, xhsQty, bufferPool, livestreamMode } = req.body

    const data = {}
    if (taobaoQty     !== undefined) data.taobaoQty     = taobaoQty
    if (douyinQty     !== undefined) data.douyinQty     = douyinQty
    if (xhsQty        !== undefined) data.xhsQty        = xhsQty
    if (bufferPool    !== undefined) data.bufferPool    = bufferPool
    if (livestreamMode !== undefined) data.livestreamMode = livestreamMode

    const updated = await fastify.prisma.channelQuota.upsert({
      where:  { skuId },
      create: { skuId, ...data },
      update: data
    })
    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────
  // 生产端扫码发货（role >= 1）
  // ─────────────────────────────────────────────

  // POST /api/inventory/ship
  // 扫码发货：订单码 + SKU条形码 + 快递单号
  fastify.post('/ship', { preHandler: requireProduction }, async (req, reply) => {
    const { orderNo, skuBarcode, trackingNo, trackingCompany } = req.body
    const operatorId = req.user.userId

    if (!orderNo)         return reply.code(400).send({ success: false, message: '缺少订单号' })
    if (!skuBarcode)      return reply.code(400).send({ success: false, message: '缺少SKU条形码' })
    if (!trackingNo)      return reply.code(400).send({ success: false, message: '缺少快递单号' })
    if (!trackingCompany) return reply.code(400).send({ success: false, message: '缺少快递公司' })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { orderNo } })
    if (!order) return reply.code(404).send({ success: false, message: `订单号 ${orderNo} 不存在` })
    if (order.status === 'shipped') return reply.code(400).send({ success: false, message: '该订单已发货' })
    if (!['paid', 'producing', 'done'].includes(order.status))
      return reply.code(400).send({ success: false, message: `订单状态「${order.status}」不可发货` })

    const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuBarcode } })
    if (!sku) return reply.code(404).send({ success: false, message: `SKU条形码 ${skuBarcode} 不存在` })
    if (sku.id !== order.skuId) return reply.code(400).send({ success: false, message: 'SKU不匹配，请检查材料包是否正确' })

    // 生成正版验证码：{年2位}{随机6位大写}{校验字母}
    const year      = new Date().getFullYear().toString().slice(2)
    const random    = Math.random().toString(36).slice(2, 8).toUpperCase()
    const checkChar = String.fromCharCode(65 + (orderNo.length + sku.id.length) % 26)
    const authCode  = `${year}${random}${checkChar}`

    await fastify.prisma.$transaction([
      fastify.prisma.customizeOrder.update({
        where: { orderNo },
        data:  { status: 'shipped', trackingNo, trackingCompany }
      }),
      fastify.prisma.inventoryLog.create({
        data: {
          skuId: sku.id, type: 'out', quantity: 1,
          orderId: order.id, operatorId,
          note: `发货：订单${orderNo}，${trackingCompany} ${trackingNo}`
        }
      }),
      fastify.prisma.authCode.create({
        data: { code: authCode, orderId: order.id, skuId: sku.id, issuedAt: new Date() }
      })
    ])

    return reply.send({ success: true, message: '✓ 发货成功', data: { orderNo, trackingNo, trackingCompany, authCode } })
  })

  // ─────────────────────────────────────────────
  // 公开接口（无需登录）
  // ─────────────────────────────────────────────

  // GET /api/inventory/verify/:code — 正版验证
  fastify.get('/verify/:code', async (req, reply) => {
    const { code } = req.params

    const auth = await fastify.prisma.authCode.findUnique({ where: { code } })
    if (!auth) {
      return reply.send({ success: true, data: { valid: false, message: '未找到此验证码，请确认是否为正版哞屋动画机' } })
    }

    await fastify.prisma.authCode.update({
      where: { code },
      data:  { queriedCount: { increment: 1 }, lastQueriedAt: new Date() }
    })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { id: auth.orderId } })
    const sku   = await fastify.prisma.machineModelSku.findUnique({ where: { id: auth.skuId } })
    const model = sku ? await fastify.prisma.machineModel.findUnique({ where: { id: sku.modelId }, select: { name: true } }) : null

    return reply.send({
      success: true,
      data: {
        valid: true, code,
        issuedAt:     auth.issuedAt,
        modelName:    model?.name   ?? '—',
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
      if (!user || !user.role)
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
