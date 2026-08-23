// 显式生产批次：完整总订单入批、生产前检查和批次详情。

import { createProductionBatchNo } from '../lib/sales-orders.js'

const ORDER_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: { productionTasks: { orderBy: { unitIndex: 'asc' } } }
  }
}

const ACTIVE_BATCH_STATUSES = ['READY', 'IN_PROGRESS', 'Open', 'Locked', 'Processing']

function parseFrames(value) {
  try {
    const frames = JSON.parse(value || '[]')
    return Array.isArray(frames) ? frames.filter(Boolean) : []
  } catch {
    return []
  }
}

function flattenTasks(order) {
  return order.items.flatMap(item => item.productionTasks.map(task => ({ ...task, item })))
}

async function getKitAvailability(prisma, skuIds) {
  if (!skuIds.length) return new Map()
  const rows = await prisma.kitAssemblyBatch.groupBy({
    by: ['skuId'],
    where: {
      skuId: { in: skuIds },
      status: 'AVAILABLE',
      stockClass: 'NEW',
      availableQty: { gt: 0 }
    },
    _sum: { availableQty: true }
  })
  return new Map(rows.map(row => [row.skuId, row._sum.availableQty || 0]))
}

async function assessOrders(prisma, orders) {
  const tasks = orders.flatMap(flattenTasks)
  const skuIds = [...new Set(tasks.map(task => task.skuId).filter(Boolean))]
  const orderIds = orders.map(order => order.id)
  const [skus, activeMemberships, kitAvailability] = await Promise.all([
    skuIds.length ? prisma.machineModelSku.findMany({
      where: { id: { in: skuIds } },
      select: { id: true, skuCode: true, isActive: true, size: true, frameCount: true, material: true, colorName: true,
        model: { select: { name: true, isActive: true } } }
    }) : [],
    orderIds.length ? prisma.productionBatchOrder.findMany({
      where: { salesOrderId: { in: orderIds }, batch: { status: { in: ACTIVE_BATCH_STATUSES } } },
      select: { salesOrderId: true, batchId: true }
    }) : [],
    getKitAvailability(prisma, skuIds)
  ])
  const skuMap = new Map(skus.map(sku => [sku.id, sku]))
  const membershipMap = new Map(activeMemberships.map(row => [row.salesOrderId, row.batchId]))

  return orders.map(order => {
    const orderTasks = flattenTasks(order)
    const hardBlocks = []
    const warnings = []
    const expectedQty = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

    if (order.status !== 'paid') hardBlocks.push({ code: 'ORDER_NOT_PAID', message: '总订单不是已付款状态' })
    if (!order.receiverName || !order.receiverPhone || !order.receiverAddress) {
      hardBlocks.push({ code: 'ADDRESS_INCOMPLETE', message: '收货信息不完整' })
    }
    if (!order.items.length || !orderTasks.length) {
      hardBlocks.push({ code: 'NO_PRODUCTION_UNIT', message: '订单尚未生成单件生产任务' })
    } else if (expectedQty !== orderTasks.length) {
      hardBlocks.push({ code: 'UNIT_COUNT_MISMATCH', message: `购买 ${expectedQty} 件，但只找到 ${orderTasks.length} 个生产任务` })
    }
    if (membershipMap.has(order.id)) {
      hardBlocks.push({ code: 'ACTIVE_BATCH_EXISTS', message: `已经进入生产批次 ${membershipMap.get(order.id)}` })
    }
    if (orderTasks.some(task => task.batchId)) {
      hardBlocks.push({ code: 'LEGACY_BATCH_EXISTS', message: '部分生产任务已经存在旧批次编号' })
    }
    if (orderTasks.some(task => task.status !== 'paid')) {
      hardBlocks.push({ code: 'UNIT_STATUS_INVALID', message: '部分生产任务已进入其他流程或状态不允许入批' })
    }

    const requirements = new Map()
    for (const task of orderTasks) {
      const sku = skuMap.get(task.skuId)
      if (!sku || !sku.isActive || !sku.model?.isActive) {
        hardBlocks.push({ code: 'SKU_UNAVAILABLE', message: `生产任务 ${task.orderNo} 的 SKU 不存在或已停用` })
      }
      if (!parseFrames(task.frameUrls).length) {
        hardBlocks.push({ code: 'FRAME_FILE_MISSING', message: `生产任务 ${task.orderNo} 缺少已锁定帧图` })
      }
      if (task.skuId) requirements.set(task.skuId, (requirements.get(task.skuId) || 0) + 1)
    }

    for (const [skuId, required] of requirements) {
      const available = kitAvailability.get(skuId) || 0
      if (available < required) {
        const sku = skuMap.get(skuId)
        warnings.push({
          code: 'KIT_SHORTAGE', skuId, required, available, shortage: required - available,
          message: `${sku?.skuCode || skuId} 需要 ${required} 套标准材料包，当前可用 ${available} 套`
        })
      }
    }

    return {
      id: order.id,
      orderNo: order.orderNo,
      createdAt: order.createdAt,
      receiverName: order.receiverName,
      itemCount: order.items.length,
      productionUnitCount: orderTasks.length,
      hardBlocks,
      warnings,
      ready: hardBlocks.length === 0,
      items: order.items.map(item => ({
        id: item.id,
        title: item.snapshotTitle,
        skuId: item.skuId,
        skuCode: item.skuCode,
        quantity: item.quantity,
        productionNos: item.productionTasks.map(task => task.orderNo)
      }))
    }
  })
}

function summarizeUnits(units) {
  const count = (field, value) => units.filter(unit => unit[field] === value).length
  return {
    total: units.length,
    frameCompleted: count('frameStatus', 'COMPLETED'),
    materialPicked: count('materialStatus', 'PICKED'),
    paired: count('pairingStatus', 'COMPLETED'),
    packaged: count('packageStatus', 'COMPLETED'),
    exceptions: units.filter(unit => unit.exceptionStatus !== 'NORMAL').length
  }
}

export default async function productionBatchRoutes(fastify) {
  const requireAdmin = fastify.requireRole(2)

  fastify.get('/candidates', { preHandler: requireAdmin }, async (req, reply) => {
    const orders = await fastify.prisma.salesOrder.findMany({
      where: { status: 'paid' },
      include: ORDER_INCLUDE,
      orderBy: { paidAt: 'asc' },
      take: 100
    })
    const assessed = await assessOrders(fastify.prisma, orders)
    return reply.send({ success: true, data: assessed })
  })

  fastify.get('/', { preHandler: requireAdmin }, async (req, reply) => {
    const status = String(req.query?.status || '').trim()
    const batches = await fastify.prisma.productionBatch.findMany({
      where: status ? { status } : {},
      include: { orders: true, units: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
    return reply.send({ success: true, data: batches.map(batch => ({
      id: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      salesOrderCount: batch.salesOrderCount || batch.orders.length,
      productionUnitCount: batch.productionUnitCount || batch.units.length,
      skuCount: batch.skuCount,
      warningCount: Array.isArray(batch.warningSnapshot) ? batch.warningSnapshot.length : 0,
      progress: summarizeUnits(batch.units),
      legacy: batch.orders.length === 0
    })) })
  })

  fastify.get('/:batchId', { preHandler: requireAdmin }, async (req, reply) => {
    const batch = await fastify.prisma.productionBatch.findUnique({
      where: { id: req.params.batchId },
      include: { orders: true, units: true, batchItems: true }
    })
    if (!batch) return reply.code(404).send({ success: false, message: '生产批次不存在' })

    const salesOrderIds = batch.orders.map(row => row.salesOrderId)
    const salesOrders = salesOrderIds.length ? await fastify.prisma.salesOrder.findMany({
      where: { id: { in: salesOrderIds } }, include: ORDER_INCLUDE, orderBy: { createdAt: 'asc' }
    }) : []
    const unitById = new Map(batch.units.map(unit => [unit.productionUnitId, unit]))
    const availability = await getKitAvailability(fastify.prisma, batch.batchItems.map(item => item.skuId))

    const orders = salesOrders.map(order => ({
      id: order.id,
      orderNo: order.orderNo,
      receiverName: order.receiverName,
      receiverPhone: order.receiverPhone,
      receiverCity: order.receiverCity,
      receiverAddress: order.receiverAddress,
      warningSnapshot: batch.orders.find(row => row.salesOrderId === order.id)?.warningSnapshot || [],
      items: order.items.map(item => ({
        id: item.id,
        title: item.snapshotTitle,
        quantity: item.quantity,
        skuId: item.skuId,
        skuCode: item.skuCode,
        productionUnits: item.productionTasks.map(task => ({
          id: task.id,
          productionNo: task.orderNo,
          specification: `${task.modelName} · ${task.frameCount}帧 · ${task.size} · ${task.material} · ${task.colorName}`,
          workflow: unitById.get(task.id) || null
        }))
      }))
    }))

    const materialDemand = batch.batchItems.map(item => ({
      skuId: item.skuId,
      skuCode: item.skuCode,
      required: item.plannedQty,
      available: availability.get(item.skuId) || 0,
      picked: batch.units.filter(unit => unit.skuId === item.skuId && unit.materialStatus === 'PICKED').length
    }))

    return reply.send({ success: true, data: {
      batch: {
        id: batch.id, status: batch.status, createdAt: batch.createdAt, updatedAt: batch.updatedAt,
        salesOrderCount: batch.salesOrderCount, productionUnitCount: batch.productionUnitCount,
        skuCount: batch.skuCount, warnings: batch.warningSnapshot || []
      },
      progress: summarizeUnits(batch.units),
      materialDemand,
      orders,
      legacy: batch.orders.length === 0
    } })
  })

  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const salesOrderIds = [...new Set((Array.isArray(req.body?.salesOrderIds) ? req.body.salesOrderIds : []).filter(Boolean))]
    const acknowledgeWarnings = req.body?.acknowledgeWarnings === true
    if (!salesOrderIds.length) return reply.code(400).send({ success: false, message: '请至少选择一个完整总订单' })
    if (salesOrderIds.length > 100) return reply.code(400).send({ success: false, message: '单批次最多选择 100 个总订单' })

    const orders = await fastify.prisma.salesOrder.findMany({
      where: { id: { in: salesOrderIds } }, include: ORDER_INCLUDE
    })
    if (orders.length !== salesOrderIds.length) return reply.code(400).send({ success: false, message: '部分总订单不存在' })
    const assessments = await assessOrders(fastify.prisma, orders)
    const blocked = assessments.filter(order => order.hardBlocks.length)
    if (blocked.length) {
      return reply.code(409).send({ success: false, code: 'BATCH_NOT_READY', message: '有订单不具备生产条件', data: blocked })
    }

    const allTasks = orders.flatMap(flattenTasks)
    const skuRequirements = new Map()
    for (const task of allTasks) skuRequirements.set(task.skuId, (skuRequirements.get(task.skuId) || 0) + 1)
    const availability = await getKitAvailability(fastify.prisma, [...skuRequirements.keys()])
    const batchWarnings = [...skuRequirements].flatMap(([skuId, required]) => {
      const available = availability.get(skuId) || 0
      return available < required ? [{ code: 'KIT_SHORTAGE', skuId, required, available, shortage: required - available,
        message: `SKU ${skuId} 需要 ${required} 套标准材料包，当前可用 ${available} 套` }] : []
    })
    if (batchWarnings.length && !acknowledgeWarnings) {
      return reply.code(409).send({ success: false, code: 'BATCH_WARNINGS_REQUIRE_ACK', message: '材料包存在缺口，请确认后继续', data: batchWarnings })
    }

    const batchId = createProductionBatchNo()
    try {
      await fastify.prisma.$transaction(async tx => {
        const existing = await tx.productionBatchOrder.findFirst({
          where: { salesOrderId: { in: salesOrderIds }, batch: { status: { in: ACTIVE_BATCH_STATUSES } } }
        })
        if (existing) throw Object.assign(new Error(`订单已经进入批次 ${existing.batchId}`), { code: 'ACTIVE_BATCH_EXISTS' })

        await tx.productionBatch.create({ data: {
          id: batchId,
          operatorId: req.user.userId,
          status: 'READY',
          warningSnapshot: batchWarnings,
          salesOrderCount: orders.length,
          productionUnitCount: allTasks.length,
          skuCount: skuRequirements.size
        } })
        await tx.productionBatchOrder.createMany({ data: orders.map(order => ({
          batchId,
          salesOrderId: order.id,
          orderNoSnapshot: order.orderNo,
          warningSnapshot: assessments.find(row => row.id === order.id)?.warnings || []
        })) })
        await tx.productionBatchUnit.createMany({ data: allTasks.map(task => ({
          batchId,
          productionUnitId: task.id,
          salesOrderId: task.item.salesOrderId,
          skuId: task.skuId,
          productionNoSnapshot: task.orderNo
        })) })
        const skus = await tx.machineModelSku.findMany({
          where: { id: { in: [...skuRequirements.keys()] } }, select: { id: true, skuCode: true }
        })
        const skuMap = new Map(skus.map(sku => [sku.id, sku]))
        await tx.batchItem.createMany({ data: [...skuRequirements].map(([skuId, plannedQty]) => ({
          batchId, skuId, skuCode: skuMap.get(skuId)?.skuCode || null, plannedQty
        })) })
        const taskIds = allTasks.map(task => task.id)
        const claimed = await tx.customizeOrder.updateMany({
          where: { id: { in: taskIds }, status: 'paid', batchId: null },
          data: { batchId, lockStatus: 'LOCKED' }
        })
        if (claimed.count !== taskIds.length) {
          throw Object.assign(new Error('部分生产任务刚刚被其他批次领取，请刷新后重试'), { code: 'BATCH_RACE' })
        }
      })
    } catch (error) {
      if (['ACTIVE_BATCH_EXISTS', 'BATCH_RACE'].includes(error.code)) {
        return reply.code(409).send({ success: false, code: error.code, message: error.message })
      }
      throw error
    }

    await fastify.prisma.operationLog.create({ data: {
      userId: req.user.userId,
      userRole: req.user.role ?? 0,
      method: 'POST',
      path: req.url,
      action: `创建生产批次 ${batchId}，包含 ${orders.length} 个总订单、${allTasks.length} 个生产件`,
      targetId: batchId,
      ip: req.ip || null
    } }).catch(() => {})

    return reply.code(201).send({ success: true, message: '生产批次已创建', data: { batchId, warnings: batchWarnings } })
  })
}
