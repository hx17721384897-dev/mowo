// 显式生产批次：完整总订单入批、生产前检查和批次详情。

import crypto from 'node:crypto'
import { createProductionBatchNo } from '../lib/sales-orders.js'
import { buildPrintRuleMap, loadPrintCutConfig, snapshotPrintRule, snapshotUnconfiguredSku } from '../lib/print-production.js'
import { generateProductionFile } from '../lib/production-artifacts.js'
import { DEFAULT_FULFILLMENT_HOLD_MINUTES, FULFILLMENT_HOLD_KEY, isFulfillmentHoldActive, parseFulfillmentHoldMinutes } from '../lib/fulfillment-hold.js'
import { hasPermission, PERMISSION } from '../lib/permissions.js'

const ORDER_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: { productionTasks: { orderBy: { unitIndex: 'asc' } } }
  }
}

const ACTIVE_BATCH_STATUSES = ['READY', 'IN_PROGRESS', 'Open', 'Locked', 'Processing']

function createRequestFingerprint(salesOrderIds, acknowledgeWarnings) {
  return crypto.createHash('sha256').update(JSON.stringify({ salesOrderIds, acknowledgeWarnings })).digest('hex')
}

function idempotencyConflict(reply) {
  return reply.code(409).send({
    success: false,
    code: 'IDEMPOTENCY_KEY_CONFLICT',
    message: '本次请求标识已用于其他生产批次请求，请刷新后重试'
  })
}

function sendReplayedBatch(reply, batch) {
  return reply.send({
    success: true,
    message: '生产批次已创建',
    data: { batchId: batch.id, warnings: batch.warningSnapshot || [], artifactErrors: [], reused: true }
  })
}

function parseFrames(value) {
  try {
    const frames = JSON.parse(value || '[]')
    return Array.isArray(frames) ? frames.filter(Boolean) : []
  } catch {
    return []
  }
}

function flattenTasks(order) {
  return order.items.flatMap(item => item.productionTasks.map(task => ({ ...task, item, order })))
}

async function getKitAvailability(prisma, skuIds) {
  if (!skuIds.length) return new Map()
  const rows = await prisma.kitAssemblyBatch.findMany({
    where: {
      skuId: { in: skuIds },
      status: 'AVAILABLE',
      stockClass: 'NEW',
      availableQty: { gt: 0 }
    },
    select: { skuId: true, availableQty: true, reservedQty: true }
  })
  const result = new Map(skuIds.map(skuId => [skuId, 0]))
  for (const row of rows) {
    result.set(row.skuId, (result.get(row.skuId) || 0) + Math.max(0, row.availableQty - row.reservedQty))
  }
  return result
}

async function assessOrders(prisma, orders, printGroups = null) {
  const configuredGroups = printGroups || await loadPrintCutConfig(prisma)
  const printRuleMap = buildPrintRuleMap(configuredGroups)
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
    if (isFulfillmentHoldActive(order)) {
      hardBlocks.push({ code: 'FULFILLMENT_HOLD', message: `暂缓履约中，最早可于 ${order.earliestProductionAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 开始制作` })
    }
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
      if (!printRuleMap.has(task.skuId)) {
        warnings.push({
          code: 'PRINT_SKU_UNCONFIRMED',
          skuId: task.skuId,
          productionNo: task.orderNo,
          message: `${sku?.model?.name || task.modelName} · ${sku?.skuCode || task.skuId} 尚未确认打印与裁切组，将排在批次末尾等待现场确认`
        })
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
      paidAt: order.paidAt,
      earliestProductionAt: order.earliestProductionAt,
      platform: order.platform,
      receiverName: order.receiverName,
      itemCount: order.items.length,
      productionUnitCount: orderTasks.length,
      estimatedPrintPages: orderTasks.reduce((sum, task) => sum + (printRuleMap.get(task.skuId)?.rule.pagesPerUnit || 0), 0),
      unconfiguredPrintUnitCount: orderTasks.filter(task => !printRuleMap.has(task.skuId)).length,
      hardBlocks,
      warnings,
      ready: hardBlocks.length === 0,
      items: order.items.map(item => ({
        id: item.id,
        title: item.snapshotTitle,
        skuId: item.skuId,
        skuCode: item.skuCode,
        quantity: item.quantity,
        productionNos: item.productionTasks.map(task => task.orderNo),
        productionSpecs: item.productionTasks.map(task => ({
          skuId: task.skuId,
          modelId: task.modelId,
          modelName: task.modelName,
          size: task.size,
          frameCount: task.frameCount,
          printGroupId: printRuleMap.get(task.skuId)?.group.id || null
        }))
      }))
    }
  })
}

function candidateFilters(query = {}) {
  const number = value => value === undefined || value === '' ? null : Number(value)
  return {
    paidFrom: String(query.paidFrom || '').trim(),
    paidTo: String(query.paidTo || '').trim(),
    orderNo: String(query.orderNo || '').trim(),
    platform: String(query.platform || '').trim(),
    modelId: String(query.modelId || '').trim(),
    skuId: String(query.skuId || '').trim(),
    size: String(query.size || '').trim(),
    frameCount: number(query.frameCount),
    printGroupId: String(query.printGroupId || '').trim(),
    readyOnly: String(query.readyOnly || '') === 'true',
    kitAvailableOnly: String(query.kitAvailableOnly || '') === 'true'
  }
}

function taskMatches(task, filters, printRuleMap) {
  if (filters.modelId && task.modelId !== filters.modelId) return false
  if (filters.skuId && task.skuId !== filters.skuId) return false
  if (filters.size && task.size !== filters.size) return false
  if (filters.frameCount && task.frameCount !== filters.frameCount) return false
  if (filters.printGroupId && printRuleMap.get(task.skuId)?.group.id !== filters.printGroupId) return false
  return true
}

function buildPrintPlan(tasks, printRuleMap) {
  const planned = tasks.map(task => ({ task, entry: printRuleMap.get(task.skuId) || null }))
  planned.sort((a, b) => {
    const aSnapshot = snapshotPrintRule(a.entry) || snapshotUnconfiguredSku(a.task)
    const bSnapshot = snapshotPrintRule(b.entry) || snapshotUnconfiguredSku(b.task)
    return (aSnapshot.groupOrder - bSnapshot.groupOrder)
      || (aSnapshot.ruleOrder - bSnapshot.ruleOrder)
      || (new Date(a.task.order.paidAt || 0) - new Date(b.task.order.paidAt || 0))
      || String(a.task.orderNo).localeCompare(String(b.task.orderNo))
  })
  return planned.map((row, index) => ({
    ...row,
    sequence: index + 1,
    snapshot: snapshotPrintRule(row.entry) || snapshotUnconfiguredSku(row.task)
  }))
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

  fastify.get('/hold-setting', { preHandler: requireAdmin }, async (req, reply) => {
    const config = await fastify.prisma.platformConfig.findUnique({
      where: { configKey: FULFILLMENT_HOLD_KEY },
      include: { updater: { select: { profile: { select: { nickname: true } } } } }
    })
    return reply.send({ success: true, data: {
      minutes: parseFulfillmentHoldMinutes(config?.configValue) ?? DEFAULT_FULFILLMENT_HOLD_MINUTES,
      updatedAt: config?.updatedBy ? config.updatedAt : null,
      updatedByName: config?.updater?.profile?.nickname || null,
      canEdit: hasPermission(req.user, PERMISSION.PRODUCTION_CONFIG)
    } })
  })

  fastify.put('/hold-setting', { preHandler: fastify.requirePermission(PERMISSION.PRODUCTION_CONFIG) }, async (req, reply) => {
    const minutes = parseFulfillmentHoldMinutes(req.body?.minutes)
    if (minutes === null) return reply.code(400).send({ success: false, message: '暂缓时长须为 0 到 10080 的整数分钟' })
    try {
      await fastify.prisma.$transaction(async tx => {
        const current = await tx.platformConfig.findUnique({ where: { configKey: FULFILLMENT_HOLD_KEY } })
        if (!current) throw Object.assign(new Error('暂缓履约设置不存在，请先应用数据库迁移'), { code: 'HOLD_SETTING_MISSING' })
        const previous = parseFulfillmentHoldMinutes(current.configValue)
        if (previous === minutes) return
        const updated = await tx.platformConfig.updateMany({
          where: { configKey: FULFILLMENT_HOLD_KEY, configValue: current.configValue, updatedAt: current.updatedAt },
          data: { configValue: String(minutes), updatedBy: req.user.userId }
        })
        if (updated.count !== 1) throw Object.assign(new Error('设置已被其他管理员修改，请刷新后重试'), { code: 'HOLD_SETTING_CHANGED' })
        await tx.operationLog.create({ data: {
          userId: req.user.userId, userRole: req.user.role ?? 0,
          method: 'PUT', path: req.url, target: 'PlatformConfig', targetId: FULFILLMENT_HOLD_KEY,
          action: '修改暂缓履约时长', before: JSON.stringify({ minutes: previous }), after: JSON.stringify({ minutes }),
          ip: req.ip || null
        } })
      })
    } catch (error) {
      if (['HOLD_SETTING_MISSING', 'HOLD_SETTING_CHANGED'].includes(error.code)) {
        return reply.code(409).send({ success: false, code: error.code, message: error.message })
      }
      throw error
    }
    return reply.send({ success: true, data: { minutes } })
  })

  fastify.get('/candidates', { preHandler: requireAdmin }, async (req, reply) => {
    const filters = candidateFilters(req.query)
    const paidAt = {}
    if (filters.paidFrom) paidAt.gte = new Date(`${filters.paidFrom}T00:00:00+08:00`)
    if (filters.paidTo) paidAt.lte = new Date(`${filters.paidTo}T23:59:59.999+08:00`)
    if ([paidAt.gte, paidAt.lte].some(value => value && Number.isNaN(value.getTime()))) {
      return reply.code(400).send({ success: false, message: '支付日期格式不正确' })
    }
    if (paidAt.gte && paidAt.lte && paidAt.gte > paidAt.lte) {
      return reply.code(400).send({ success: false, message: '支付开始日期不能晚于结束日期' })
    }
    const orders = await fastify.prisma.salesOrder.findMany({
      where: {
        status: 'paid',
        ...(Object.keys(paidAt).length ? { paidAt } : {}),
        ...(filters.orderNo ? { orderNo: { contains: filters.orderNo, mode: 'insensitive' } } : {}),
        ...(filters.platform ? { platform: filters.platform } : {})
      },
      include: ORDER_INCLUDE,
      orderBy: { paidAt: 'asc' },
      take: 500
    })
    const printGroups = await loadPrintCutConfig(fastify.prisma)
    const printRuleMap = buildPrintRuleMap(printGroups)
    const hasProductionFilter = Boolean(filters.modelId || filters.skuId || filters.size || filters.frameCount || filters.printGroupId)
    let assessed = await assessOrders(fastify.prisma, orders, printGroups)
    assessed = assessed.map((row, index) => {
      const tasks = flattenTasks(orders[index])
      const matchedUnitCount = hasProductionFilter ? tasks.filter(task => taskMatches(task, filters, printRuleMap)).length : tasks.length
      return {
        ...row,
        matchedUnitCount,
        extraUnitCount: Math.max(0, tasks.length - matchedUnitCount),
        includesUnmatchedItems: hasProductionFilter && matchedUnitCount > 0 && matchedUnitCount < tasks.length
      }
    }).filter(row => !hasProductionFilter || row.matchedUnitCount > 0)
    if (filters.readyOnly) assessed = assessed.filter(row => row.ready)
    if (filters.kitAvailableOnly) assessed = assessed.filter(row => !row.warnings.some(warning => warning.code === 'KIT_SHORTAGE'))

    const optionSkus = await fastify.prisma.machineModelSku.findMany({
      where: { isActive: true, model: { isActive: true } },
      select: { id: true, skuCode: true, size: true, frameCount: true, modelId: true, model: { select: { name: true, sortOrder: true } } },
      orderBy: [{ model: { sortOrder: 'asc' } }, { sortOrder: 'asc' }]
    })
    return reply.send({ success: true, data: assessed, meta: {
      totalOrders: assessed.length,
      totalUnits: assessed.reduce((sum, order) => sum + order.productionUnitCount, 0),
      models: [...new Map(optionSkus.map(sku => [sku.modelId, { id: sku.modelId, name: sku.model.name }])).values()],
      skus: optionSkus.map(sku => ({ id: sku.id, code: sku.skuCode, modelId: sku.modelId, modelName: sku.model.name, size: sku.size, frameCount: sku.frameCount })),
      sizes: [...new Set(optionSkus.map(sku => sku.size))],
      frameCounts: [...new Set(optionSkus.map(sku => sku.frameCount))].sort((a, b) => a - b),
      printGroups: printGroups.map(group => ({ id: group.id, name: group.name, size: group.size }))
    } })
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
      include: { orders: true, units: { orderBy: { printSequence: 'asc' } }, batchItems: true }
    })
    if (!batch) return reply.code(404).send({ success: false, message: '生产批次不存在' })

    const salesOrderIds = batch.orders.map(row => row.salesOrderId)
    const salesOrders = salesOrderIds.length ? await fastify.prisma.salesOrder.findMany({
      where: { id: { in: salesOrderIds } }, include: ORDER_INCLUDE, orderBy: { createdAt: 'asc' }
    }) : []
    const unitById = new Map(batch.units.map(unit => [unit.productionUnitId, unit]))
    const availability = await getKitAvailability(fastify.prisma, batch.batchItems.map(item => item.skuId))
    const [productionFiles, framePacks, pairings, reprints] = await Promise.all([
      fastify.prisma.productionPrintFile.findMany({
        where: { productionBatchId: batch.id, status: 'READY' },
        select: { id: true, displayName: true, targetFrameCount: true, animationVersionId: true, objectKey: true, sourceType: true, createdAt: true },
        orderBy: { createdAt: 'asc' }
      }),
      fastify.prisma.productionFramePack.findMany({ where: { batchId: batch.id }, orderBy: { attemptNo: 'desc' } }),
      fastify.prisma.productionUnitPairing.findMany({ where: { batchId: batch.id, status: { not: 'VOID' } } }),
      fastify.prisma.productionFrameReprint.findMany({ where: { batchId: batch.id }, orderBy: { createdAt: 'desc' } })
    ])
    const packByUnit = new Map(framePacks.filter(pack => pack.isActive).map(pack => [pack.productionUnitId, pack]))
    const packHistoryByUnit = new Map()
    for (const pack of framePacks) {
      const rows = packHistoryByUnit.get(pack.productionUnitId) || []
      rows.push(pack)
      packHistoryByUnit.set(pack.productionUnitId, rows)
    }
    const reprintsByUnit = new Map()
    for (const reprint of reprints) {
      const rows = reprintsByUnit.get(reprint.productionUnitId) || []
      rows.push(reprint)
      reprintsByUnit.set(reprint.productionUnitId, rows)
    }
    const pairingByUnit = new Map(pairings.map(pairing => [pairing.productionUnitId, pairing]))
    const requesterIds = [...new Set(reprints.map(reprint => reprint.requestedBy))]
    const requesters = requesterIds.length ? await fastify.prisma.user.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, profile: { select: { nickname: true } } }
    }) : []
    const requesterById = new Map(requesters.map(user => [user.id, user.profile?.nickname || '工作人员']))
    const packById = new Map(framePacks.map(pack => [pack.id, pack]))
    const taskInfoById = new Map()
    for (const order of salesOrders) {
      for (const item of order.items) {
        for (const task of item.productionTasks) {
          taskInfoById.set(task.id, {
            orderNo: order.orderNo,
            productionNo: task.orderNo,
            specification: `${task.modelName} · ${task.frameCount}帧 · ${task.size} · ${task.material} · ${task.colorName}`
          })
        }
      }
    }
    const reprintTimeline = reprints.map((reprint, index) => {
      const task = taskInfoById.get(reprint.productionUnitId) || {}
      const workflow = unitById.get(reprint.productionUnitId) || null
      return {
        id: reprint.id,
        revisionNo: reprints.length - index,
        orderNo: task.orderNo || '-',
        productionNo: task.productionNo || reprint.productionUnitId,
        specification: task.specification || '-',
        oldFramePackCode: reprint.oldFramePackCode,
        newFramePackCode: reprint.newFramePackCode,
        requestedPages: reprint.requestedPages,
        reason: reprint.reason,
        requestedByName: requesterById.get(reprint.requestedBy) || '工作人员',
        createdAt: reprint.createdAt,
        newFramePackStatus: packById.get(reprint.newFramePackId)?.status || 'IN_PROGRESS',
        frameStatus: workflow?.frameStatus || 'IN_PROGRESS',
        pairingStatus: workflow?.pairingStatus || 'WAITING',
        packageStatus: workflow?.packageStatus || 'WAITING',
        productionPrintFileId: reprint.productionPrintFileId
      }
    })

    const orders = salesOrders.map(order => ({
      id: order.id,
      orderNo: order.orderNo,
      receiverName: order.receiverName,
      receiverPhone: order.receiverPhone,
      receiverCity: order.receiverCity,
      receiverAddress: order.receiverAddress,
      fulfillmentStatus: order.fulfillmentStatus,
      trackingNo: order.trackingNo,
      trackingCompany: order.trackingCompany,
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
           workflow: unitById.get(task.id) || null,
           framePack: packByUnit.get(task.id) || null,
           framePackHistory: packHistoryByUnit.get(task.id) || [],
           reprints: reprintsByUnit.get(task.id) || [],
           pairing: pairingByUnit.get(task.id) || null
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
      ledgerCheck: {
        currentMarker: `${batch.id} / 返工${reprints.length}次`,
        reprintCount: reprints.length,
        latestReprintAt: reprints[0]?.createdAt || null
      },
      reprintTimeline,
      materialDemand,
      productionFiles: await Promise.all(productionFiles.map(async file => ({
        id: file.id, displayName: file.displayName, targetFrameCount: file.targetFrameCount, sourceType: file.sourceType,
        createdAt: file.createdAt, downloadUrl: await fastify.storagePresignGet(file.objectKey, 900)
      }))),
      printQueue: batch.units.map(unit => ({
        productionUnitId: unit.productionUnitId,
        productionNo: unit.productionNoSnapshot,
        sequence: unit.printSequence,
        groupCode: unit.printGroupCode,
        groupName: unit.printGroupName,
        pageCount: unit.printPageCount,
        rule: unit.printRuleSnapshot
      })),
      orders,
      legacy: batch.orders.length === 0
    } })
  })

  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const salesOrderIds = [...new Set((Array.isArray(req.body?.salesOrderIds) ? req.body.salesOrderIds : []).filter(Boolean))].sort()
    const acknowledgeWarnings = req.body?.acknowledgeWarnings === true
    const clientRequestId = typeof req.body?.clientRequestId === 'string' ? req.body.clientRequestId.trim() : ''
    if (!salesOrderIds.length) return reply.code(400).send({ success: false, message: '请至少选择一个完整总订单' })
    if (salesOrderIds.length > 100) return reply.code(400).send({ success: false, message: '单批次最多选择 100 个总订单' })
    if (!clientRequestId || clientRequestId.length > 80) {
      return reply.code(400).send({ success: false, code: 'CLIENT_REQUEST_ID_REQUIRED', message: '缺少有效的本次请求标识，请刷新后重试' })
    }

    const requestFingerprint = createRequestFingerprint(salesOrderIds, acknowledgeWarnings)
    const existingRequest = await fastify.prisma.productionBatch.findUnique({ where: { clientRequestId } })
    if (existingRequest) {
      if (existingRequest.operatorId !== req.user.userId || existingRequest.requestFingerprint !== requestFingerprint) {
        return idempotencyConflict(reply)
      }
      return sendReplayedBatch(reply, existingRequest)
    }

    const orders = await fastify.prisma.salesOrder.findMany({
      where: { id: { in: salesOrderIds } }, include: ORDER_INCLUDE
    })
    if (orders.length !== salesOrderIds.length) return reply.code(400).send({ success: false, message: '部分总订单不存在' })
    const printGroups = await loadPrintCutConfig(fastify.prisma)
    const printRuleMap = buildPrintRuleMap(printGroups)
    const assessments = await assessOrders(fastify.prisma, orders, printGroups)
    const blocked = assessments.filter(order => order.hardBlocks.length)
    if (blocked.length) {
      return reply.code(409).send({ success: false, code: 'BATCH_NOT_READY', message: '有订单不具备生产条件', data: blocked })
    }

    const allTasks = orders.flatMap(flattenTasks)
    const printPlan = buildPrintPlan(allTasks, printRuleMap)
    const skuRequirements = new Map()
    for (const task of allTasks) skuRequirements.set(task.skuId, (skuRequirements.get(task.skuId) || 0) + 1)
    const availability = await getKitAvailability(fastify.prisma, [...skuRequirements.keys()])
    const kitWarnings = [...skuRequirements].flatMap(([skuId, required]) => {
      const available = availability.get(skuId) || 0
      return available < required ? [{ code: 'KIT_SHORTAGE', skuId, required, available, shortage: required - available,
        message: `SKU ${skuId} 需要 ${required} 套标准材料包，当前可用 ${available} 套` }] : []
    })
    const printWarnings = assessments.flatMap(order => order.warnings.filter(warning => warning.code === 'PRINT_SKU_UNCONFIRMED'))
    const batchWarnings = [...printWarnings, ...kitWarnings]
    if (batchWarnings.length && !acknowledgeWarnings) {
      return reply.code(409).send({ success: false, code: 'BATCH_WARNINGS_REQUIRE_ACK', message: '存在生产风险，请确认后继续', data: batchWarnings })
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
          clientRequestId,
          requestFingerprint,
          status: 'READY',
          warningSnapshot: batchWarnings,
          salesOrderCount: orders.length,
          productionUnitCount: allTasks.length,
          skuCount: skuRequirements.size,
          printPlanSnapshot: printPlan.map(row => ({
            productionUnitId: row.task.id,
            productionNo: row.task.orderNo,
            sequence: row.sequence,
            modelId: row.task.modelId,
            modelName: row.task.modelName,
            ...row.snapshot
          }))
        } })
        await tx.productionBatchOrder.createMany({ data: orders.map(order => ({
          batchId,
          salesOrderId: order.id,
          orderNoSnapshot: order.orderNo,
          warningSnapshot: assessments.find(row => row.id === order.id)?.warnings || []
        })) })
        await tx.productionBatchUnit.createMany({ data: printPlan.map(row => ({
          batchId,
          productionUnitId: row.task.id,
          salesOrderId: row.task.item.salesOrderId,
          skuId: row.task.skuId,
          productionNoSnapshot: row.task.orderNo,
          printGroupId: row.entry?.group.id || null,
          printGroupCode: row.entry?.group.code || null,
          printGroupName: row.entry?.group.name || '未配置 SKU，待现场确认',
          printRuleId: row.entry?.rule.id || null,
          printSequence: row.sequence,
          printPageCount: row.entry?.rule.pagesPerUnit || null,
          printRuleSnapshot: row.snapshot
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
        const eligible = await tx.salesOrder.updateMany({
          where: { id: { in: salesOrderIds }, status: 'paid',
            OR: [{ earliestProductionAt: null }, { earliestProductionAt: { lte: new Date() } }] },
          data: { fulfillmentStatus: 'PENDING_ADDRESS_EXPORT' }
        })
        if (eligible.count !== salesOrderIds.length) {
          throw Object.assign(new Error('订单仍在暂缓履约时间内或状态已改变，请刷新后重试'), { code: 'FULFILLMENT_HOLD' })
        }
      })
    } catch (error) {
      if (['ACTIVE_BATCH_EXISTS', 'BATCH_RACE', 'FULFILLMENT_HOLD'].includes(error.code)) {
        return reply.code(409).send({ success: false, code: error.code, message: error.message })
      }
      if (error.code === 'P2002') {
        const existing = await fastify.prisma.productionBatch.findUnique({ where: { clientRequestId } })
        if (existing && existing.operatorId === req.user.userId && existing.requestFingerprint === requestFingerprint) {
          return sendReplayedBatch(reply, existing)
        }
        if (existing) return idempotencyConflict(reply)
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

    // 初期批量不大，入批后立即生成并冻结文件；生成失败不撤销已经建立的生产批次。
    const artifactErrors = []
    const generatedSpecs = new Set()
    for (const row of printPlan) {
      const animationVersionId = row.task.item?.animationVersionId
      const assetId = row.task.item?.animationAssetId
      const template = row.entry?.group?.templates?.find(item => item.status === 'ACTIVE')
      if (!assetId || !animationVersionId || !template) {
        artifactErrors.push({ productionNo: row.task.orderNo, message: !template ? '打印裁切组尚未上传有效 Word 模板' : '订单缺少动画资产或锁定版本' })
        continue
      }
      const key = `${animationVersionId}:${template.id}:${row.task.frameCount}`
      if (generatedSpecs.has(key)) continue
      generatedSpecs.add(key)
      try {
        await generateProductionFile(fastify, {
          assetId, animationVersionId, templateVersionId: template.id,
          targetFrameCount: row.task.frameCount, createdBy: req.user.userId,
          sourceType: 'ORDER', productionBatchId: batchId
        })
      } catch (error) {
        artifactErrors.push({ productionNo: row.task.orderNo, message: error.message })
      }
    }

    return reply.code(201).send({
      success: true,
      message: artifactErrors.length ? '生产批次已创建，部分打印文件生成失败，请在帧图资产库处理' : '生产批次已创建',
      data: { batchId, warnings: batchWarnings, artifactErrors, reused: false }
    })
  })
}
