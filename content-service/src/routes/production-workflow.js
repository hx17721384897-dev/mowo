import archiver from 'archiver'
import { generateProductionFile } from '../lib/production-artifacts.js'

const ACTIVE_BATCH_STATUSES = ['READY', 'IN_PROGRESS']

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvBuffer(headers, rows) {
  const lines = [headers, ...rows].map(row => row.map(csvCell).join(','))
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8')
}

function safeName(value) {
  return String(value || 'file').replace(/[\\/:*?"<>|]/g, '_')
}

function framePackCode(productionNo, attemptNo = 1) {
  return `FP-${String(productionNo).replace(/^PU-/, '')}-${String(attemptNo).padStart(2, '0')}`
}

async function zipBuffer(entries) {
  const archive = archiver('zip', { zlib: { level: 6 } })
  const chunks = []
  archive.on('data', chunk => chunks.push(chunk))
  const completed = new Promise((resolve, reject) => {
    archive.once('end', resolve)
    archive.once('error', reject)
  })
  for (const entry of entries) archive.append(entry.buffer, { name: entry.name })
  await archive.finalize()
  await completed
  return Buffer.concat(chunks)
}

async function loadBatchContext(prisma, batchId) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id: batchId },
    include: { orders: true, units: { orderBy: { printSequence: 'asc' } }, batchItems: true }
  })
  if (!batch || !batch.orders.length) return null
  const salesOrderIds = batch.orders.map(row => row.salesOrderId)
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: salesOrderIds } },
    include: { items: { include: { productionTasks: { orderBy: { unitIndex: 'asc' } } } } },
    orderBy: { createdAt: 'asc' }
  })
  return { batch, orders }
}

function allTasks(orders) {
  return orders.flatMap(order => order.items.flatMap(item => item.productionTasks.map(task => ({ task, item, order }))))
}

async function ensureBatchPrintFiles(fastify, context, createdBy) {
  let files = await fastify.prisma.productionPrintFile.findMany({
    where: { productionBatchId: context.batch.id, status: 'READY', sourceType: { not: 'REPRINT' } },
    include: { asset: { select: { assetNo: true } } }, orderBy: { createdAt: 'asc' }
  })
  const rows = allTasks(context.orders)
  const units = new Map(context.batch.units.map(unit => [unit.productionUnitId, unit]))
  const groupIds = [...new Set(context.batch.units.map(unit => unit.printGroupId).filter(Boolean))]
  const groups = groupIds.length ? await fastify.prisma.printCutGroup.findMany({
    where: { id: { in: groupIds } },
    include: { templates: { where: { status: 'ACTIVE' }, orderBy: { versionNo: 'desc' }, take: 1 } }
  }) : []
  const groupMap = new Map(groups.map(group => [group.id, group]))
  const errors = []
  for (const row of rows) {
    const unit = units.get(row.task.id)
    const template = groupMap.get(unit?.printGroupId)?.templates?.[0]
    if (!row.item.animationAssetId || !row.item.animationVersionId || !template) {
      errors.push({ productionNo: row.task.orderNo, specification: `${row.task.size} · ${row.task.frameCount}帧`, reason: !template ? '打印裁切组仍未上传有效 Word 模板' : '缺少动画资产或锁定版本' })
      continue
    }
    const exists = files.some(file => file.animationVersionId === row.item.animationVersionId &&
      file.targetFrameCount === row.task.frameCount && file.templateVersionId === template.id)
    if (exists) continue
    try {
      await generateProductionFile(fastify, {
        assetId: row.item.animationAssetId, animationVersionId: row.item.animationVersionId,
        templateVersionId: template.id, targetFrameCount: row.task.frameCount,
        createdBy, sourceType: 'ORDER', productionBatchId: context.batch.id
      })
    } catch (error) {
      errors.push({ productionNo: row.task.orderNo, specification: `${row.task.size} · ${row.task.frameCount}帧`, reason: error.message })
    }
  }
  files = await fastify.prisma.productionPrintFile.findMany({
    where: { productionBatchId: context.batch.id, status: 'READY', sourceType: { not: 'REPRINT' } },
    include: { asset: { select: { assetNo: true } } }, orderBy: { createdAt: 'asc' }
  })
  const fileByProductionUnit = new Map(rows.map(row => {
    const unit = units.get(row.task.id)
    const template = groupMap.get(unit?.printGroupId)?.templates?.[0]
    const file = template ? files.find(candidate => candidate.animationVersionId === row.item.animationVersionId &&
      candidate.targetFrameCount === row.task.frameCount && candidate.templateVersionId === template.id) : null
    return [row.task.id, file || null]
  }))
  return { files, errors, fileByProductionUnit }
}

async function audit(fastify, req, action, targetId) {
  await fastify.prisma.operationLog.create({ data: {
    userId: req.user.userId, userRole: req.user.role ?? 0,
    method: req.method, path: req.url, action, targetId: targetId || null, ip: req.ip || null
  } }).catch(() => {})
}

async function resolveKitSource(tx, code, skuId = null) {
  let kitBatch = await tx.kitAssemblyBatch.findUnique({ where: { batchNo: code } })
  let container = null
  if (kitBatch) {
    if (kitBatch.containerId) container = await tx.kitContainer.findUnique({ where: { id: kitBatch.containerId } })
  } else {
    container = await tx.kitContainer.findUnique({ where: { code } })
    if (!container || !container.isActive) throw new Error('材料包箱码不存在或已经停用')
    const candidates = await tx.kitAssemblyBatch.findMany({
      where: { containerId: container.id, ...(skuId ? { skuId } : {}), status: 'AVAILABLE', stockClass: 'NEW' },
      orderBy: { createdAt: 'asc' }
    })
    kitBatch = candidates.find(row => row.availableQty > row.reservedQty) || null
  }
  if (!kitBatch || kitBatch.status !== 'AVAILABLE' || kitBatch.stockClass !== 'NEW') throw new Error('该材料包批次当前不可用于生产')
  if (skuId && kitBatch.skuId !== skuId) throw new Error('材料包规格与当前生产件 SKU 不一致')
  return { kitBatch, container }
}

async function resolvePickedKitSource(tx, { code, batchId, skuId }) {
  const directBatch = await tx.kitAssemblyBatch.findUnique({ where: { batchNo: code } })
  let container = null
  let pick = null
  if (directBatch) {
    if (directBatch.skuId !== skuId) throw new Error('材料包规格与当前生产件 SKU 不一致')
    pick = await tx.productionMaterialPick.findFirst({
      where: {
        batchId, skuId, kitAssemblyBatchId: directBatch.id,
        status: 'ACTIVE', remainingQty: { gt: 0 }
      },
      include: { kitAssemblyBatch: true, kitContainer: true },
      orderBy: { pickedAt: 'asc' }
    })
  } else {
    container = await tx.kitContainer.findUnique({ where: { code } })
    if (!container || !container.isActive) throw new Error('材料包箱码不存在或已经停用')
    if (container.skuId !== skuId) throw new Error('材料箱规格与当前生产件 SKU 不一致')
    pick = await tx.productionMaterialPick.findFirst({
      where: {
        batchId, skuId, kitContainerId: container.id,
        status: 'ACTIVE', remainingQty: { gt: 0 }
      },
      include: { kitAssemblyBatch: true, kitContainer: true },
      orderBy: { pickedAt: 'asc' }
    })
  }
  if (!pick) throw new Error('该材料来源尚未为当前生产批次领用，或已领数量已经用完')
  const kitBatch = pick.kitAssemblyBatch
  container = pick.kitContainer || container
  if (kitBatch.status !== 'AVAILABLE' || kitBatch.stockClass !== 'NEW') throw new Error('已领材料包批次当前不可用于生产')
  if (kitBatch.availableQty < 1 || kitBatch.reservedQty < 1) throw new Error('已领材料包库存与预留数量不一致，请先核对库存')
  return { pick, kitBatch, container }
}

async function refreshReadyToShip(tx, salesOrderId) {
  const units = await tx.productionBatchUnit.findMany({ where: { salesOrderId } })
  const ready = units.length > 0 && units.every(unit =>
    unit.pairingStatus === 'COMPLETED' && unit.packageStatus === 'COMPLETED' && unit.exceptionStatus === 'NORMAL')
  if (ready) {
    const now = new Date()
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { fulfillmentStatus: 'READY_TO_SHIP', readyToShipAt: now } })
    await tx.productionBatchOrder.updateMany({ where: { salesOrderId }, data: { status: 'READY_TO_SHIP' } })
  }
  return ready
}

export default async function productionWorkflowRoutes(fastify) {
  const requireAdmin = fastify.requireRole(2)
  const requireProduction = fastify.requireRole(1)

  fastify.get('/scan-overview', { preHandler: requireProduction }, async (req, reply) => {
    const batches = await fastify.prisma.productionBatch.findMany({
      where: { status: { in: ACTIVE_BATCH_STATUSES } }, include: { units: true },
      orderBy: { createdAt: 'desc' }, take: 30
    })
    const waitingSessions = await fastify.prisma.productionPackingSession.count({ where: { status: { in: ['OPEN', 'COMPLETE'] } } })
    const recent = await fastify.prisma.operationLog.findMany({
      where: { path: { contains: '/production-workflow/' } }, orderBy: { createdAt: 'desc' }, take: 20
    })
    return reply.send({ success: true, data: {
      batches: batches.map(batch => ({
        id: batch.id, status: batch.status, createdAt: batch.createdAt,
        total: batch.units.length,
        frameCompleted: batch.units.filter(unit => unit.frameStatus === 'COMPLETED').length,
        materialPicked: batch.units.filter(unit => unit.materialStatus === 'PICKED').length,
        paired: batch.units.filter(unit => unit.pairingStatus === 'COMPLETED').length,
        packaged: batch.units.filter(unit => unit.packageStatus === 'COMPLETED').length,
        exceptions: batch.units.filter(unit => unit.exceptionStatus !== 'NORMAL').length
      })),
      waitingSessions,
      recent: recent.map(row => ({ action: row.action, targetId: row.targetId, createdAt: row.createdAt, userId: row.userId }))
    } })
  })

  // 正式订单工作队列。后台各环节页和批次总览共用这一份数据。
  fastify.get('/orders', { preHandler: requireAdmin }, async (req, reply) => {
    const fulfillmentStatus = String(req.query?.status || '').trim()
    const batchId = String(req.query?.batchId || '').trim()
    const q = String(req.query?.q || '').trim()
    const allowed = ['PAID', 'PENDING_ADDRESS_EXPORT', 'WAITING_TRACKING', 'READY_FOR_PRODUCTION', 'PRODUCING', 'READY_TO_SHIP', 'SHIPPED']
    if (fulfillmentStatus && !allowed.includes(fulfillmentStatus)) {
      return reply.code(400).send({ success: false, message: '订单环节参数无效' })
    }
    const where = {
      ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
      ...(q ? { OR: [
        { orderNo: { contains: q, mode: 'insensitive' } },
        { receiverName: { contains: q, mode: 'insensitive' } },
        { receiverPhone: { contains: q } },
        { trackingNo: { contains: q, mode: 'insensitive' } }
      ] } : {}),
      ...(batchId ? { productionBatchOrders: { some: { batchId } } } : {})
    }
    const [orders, grouped] = await Promise.all([
      fastify.prisma.salesOrder.findMany({
        where,
        include: {
          productionBatchOrders: { orderBy: { createdAt: 'desc' }, include: { batch: { select: { id: true, status: true, createdAt: true } } } },
          items: { include: { productionTasks: { orderBy: { unitIndex: 'asc' } } } }
        },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        take: 500
      }),
      fastify.prisma.salesOrder.groupBy({ by: ['fulfillmentStatus'], _count: { _all: true } })
    ])
    const unitIds = orders.flatMap(order => order.items.flatMap(item => item.productionTasks.map(task => task.id)))
    const [units, packs, reprints] = unitIds.length ? await Promise.all([
      fastify.prisma.productionBatchUnit.findMany({ where: { productionUnitId: { in: unitIds } } }),
      fastify.prisma.productionFramePack.findMany({ where: { productionUnitId: { in: unitIds } }, orderBy: [{ productionUnitId: 'asc' }, { attemptNo: 'desc' }] }),
      fastify.prisma.productionFrameReprint.findMany({ where: { productionUnitId: { in: unitIds } }, orderBy: { createdAt: 'desc' } })
    ]) : [[], [], []]
    const unitMap = new Map(units.map(unit => [unit.productionUnitId, unit]))
    const packMap = new Map()
    for (const pack of packs) {
      const list = packMap.get(pack.productionUnitId) || []
      list.push(pack)
      packMap.set(pack.productionUnitId, list)
    }
    const reprintMap = new Map()
    for (const reprint of reprints) {
      const list = reprintMap.get(reprint.productionUnitId) || []
      list.push(reprint)
      reprintMap.set(reprint.productionUnitId, list)
    }
    return reply.send({ success: true, data: {
      orders: orders.map(order => {
        const membership = order.productionBatchOrders[0] || null
        return {
          id: order.id, orderNo: order.orderNo, fulfillmentStatus: order.fulfillmentStatus,
          paidAt: order.paidAt, createdAt: order.createdAt, receiverName: order.receiverName,
          receiverPhone: order.receiverPhone, receiverCity: order.receiverCity,
          receiverAddress: order.receiverAddress, trackingNo: order.trackingNo,
          trackingCompany: order.trackingCompany, batchId: membership?.batchId || null,
          batchStatus: membership?.batch?.status || null,
          itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
          units: order.items.flatMap(item => item.productionTasks.map(task => ({
            id: task.id, productionNo: task.orderNo, skuId: task.skuId,
            skuCode: item.skuCode, title: item.snapshotTitle,
            specification: `${task.modelName} · ${task.size} · ${task.frameCount}帧 · ${task.material} · ${task.colorName}`,
            printPageCount: unitMap.get(task.id)?.printPageCount || null,
            workflow: unitMap.get(task.id) || null,
            framePacks: packMap.get(task.id) || [],
            reprints: reprintMap.get(task.id) || []
          })))
        }
      }),
      counts: Object.fromEntries(grouped.map(row => [row.fulfillmentStatus, row._count._all]))
    } })
  })

  // 每个总订单只导出一行；第一次导出后进入“处理中”。
  fastify.post('/batches/:batchId/export-addresses', { preHandler: requireAdmin }, async (req, reply) => {
    const context = await loadBatchContext(fastify.prisma, req.params.batchId)
    if (!context) return reply.code(404).send({ success: false, message: '正式生产批次不存在' })
    const invalid = context.orders.filter(order => !['PENDING_ADDRESS_EXPORT', 'WAITING_TRACKING'].includes(order.fulfillmentStatus))
    if (invalid.length) return reply.code(409).send({ success: false, message: '部分订单当前不允许导出地址', data: invalid.map(o => o.orderNo) })

    const rows = context.orders.map((order, index) => [
      index + 1, order.receiverName, order.receiverPhone, order.receiverCity,
      order.receiverAddress, order.orderNo, context.batch.id,
      order.items.reduce((sum, item) => sum + item.quantity, 0), '哞屋动画机'
    ])
    await fastify.prisma.salesOrder.updateMany({
      where: { id: { in: context.orders.map(order => order.id) }, fulfillmentStatus: 'PENDING_ADDRESS_EXPORT' },
      data: { fulfillmentStatus: 'WAITING_TRACKING', addressExportedAt: new Date() }
    })
    await fastify.prisma.productionBatchOrder.updateMany({
      where: { batchId: context.batch.id, status: 'WAITING' }, data: { status: 'WAITING_TRACKING' }
    })
    await audit(fastify, req, `批次 ${context.batch.id} 导出 ${rows.length} 个总订单地址`, context.batch.id)
    const csv = csvBuffer(['序号','收件人','电话','城市','地址','总订单号','生产批次','商品件数','备注'], rows)
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${context.batch.id}_addresses.csv"`)
    return reply.send(csv)
  })

  // 面单绑定到 SO，并同步到该总订单的全部 PU；绑定后进入“待生产”。
  fastify.post('/batches/:batchId/tracking', { preHandler: requireAdmin }, async (req, reply) => {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
    if (!entries.length) return reply.code(400).send({ success: false, message: '请填写总订单号和快递单号' })
    const context = await loadBatchContext(fastify.prisma, req.params.batchId)
    if (!context) return reply.code(404).send({ success: false, message: '正式生产批次不存在' })
    const orderMap = new Map(context.orders.map(order => [order.orderNo, order]))
    const normalized = entries.map(entry => ({
      orderNo: String(entry.orderNo || '').trim(), trackingNo: String(entry.trackingNo || '').trim(),
      trackingCompany: String(entry.trackingCompany || '').trim()
    }))
    const errors = normalized.filter(entry => !orderMap.has(entry.orderNo) || !entry.trackingNo || !entry.trackingCompany)
    if (errors.length) return reply.code(400).send({ success: false, message: '存在批次外订单或快递信息不完整', data: errors })

    await fastify.prisma.$transaction(async tx => {
      for (const entry of normalized) {
        const order = orderMap.get(entry.orderNo)
        if (!['WAITING_TRACKING', 'READY_FOR_PRODUCTION'].includes(order.fulfillmentStatus)) {
          throw new Error(`${entry.orderNo} 尚未导出地址或已经进入后续流程`)
        }
        await tx.salesOrder.update({ where: { id: order.id }, data: {
          fulfillmentStatus: 'READY_FOR_PRODUCTION', trackingNo: entry.trackingNo,
          trackingCompany: entry.trackingCompany, trackingBoundAt: new Date()
        } })
        await tx.customizeOrder.updateMany({ where: { salesOrderItemId: { in: order.items.map(item => item.id) } }, data: {
          trackingNo: entry.trackingNo, trackingCompany: entry.trackingCompany,
          status: 'processing', lockStatus: 'LOCKED', batchId: context.batch.id
        } })
        await tx.productionBatchOrder.updateMany({ where: { batchId: context.batch.id, salesOrderId: order.id }, data: { status: 'READY_FOR_PRODUCTION' } })
      }
    })
    await audit(fastify, req, `批次 ${context.batch.id} 绑定 ${normalized.length} 个总订单面单`, context.batch.id)
    return reply.send({ success: true, message: `已绑定 ${normalized.length} 个面单，订单进入待生产` })
  })

  // 第一次导出生产资料意味着两条生产线正式开始；重复下载不重复推进状态。
  fastify.post('/batches/:batchId/export-production', { preHandler: requireAdmin }, async (req, reply) => {
    const context = await loadBatchContext(fastify.prisma, req.params.batchId)
    if (!context) return reply.code(404).send({ success: false, message: '正式生产批次不存在' })
    const invalid = context.orders.filter(order => !['READY_FOR_PRODUCTION', 'PRODUCING'].includes(order.fulfillmentStatus))
    if (invalid.length) return reply.code(409).send({ success: false, message: '部分订单尚未绑定面单', data: invalid.map(o => o.orderNo) })

    const tasks = allTasks(context.orders)
    const ensured = await ensureBatchPrintFiles(fastify, context, req.user.userId)
    const files = ensured.files
    const fileForTask = row => ensured.fileByProductionUnit.get(row.task.id)
    const missing = tasks.filter(row => !fileForTask(row)).map(row => ({
      productionNo: row.task.orderNo, specification: `${row.task.size} · ${row.task.frameCount}帧`
    }))
    if (missing.length) return reply.code(409).send({
      success: false,
      message: '部分产品的打印文件生成失败，请查看具体产品和原因；修正后再次导出会自动补生成',
      data: missing.map(item => ({ ...item, reason: ensured.errors.find(error => error.productionNo === item.productionNo)?.reason || '文件生成失败' }))
    })

    await fastify.prisma.$transaction(async tx => {
      for (const row of tasks) {
        const existing = await tx.productionFramePack.findFirst({ where: { productionUnitId: row.task.id, isActive: true } })
        if (!existing) await tx.productionFramePack.create({ data: {
          code: framePackCode(row.task.orderNo), productionUnitId: row.task.id,
          salesOrderId: row.order.id, batchId: context.batch.id, skuId: row.task.skuId,
          animationVersionId: row.item.animationVersionId || null,
          targetFrameCount: row.task.frameCount, size: row.task.size,
          status: 'IN_PROGRESS', createdBy: req.user.userId
        } })
      }
      await tx.productionBatch.update({ where: { id: context.batch.id }, data: { status: 'IN_PROGRESS' } })
      await tx.productionBatchUnit.updateMany({ where: { batchId: context.batch.id, frameStatus: 'WAITING' }, data: { frameStatus: 'IN_PROGRESS' } })
      await tx.productionBatchUnit.updateMany({ where: { batchId: context.batch.id, materialStatus: 'WAITING' }, data: { materialStatus: 'IN_PROGRESS' } })
      await tx.productionBatchOrder.updateMany({ where: { batchId: context.batch.id }, data: { status: 'PRODUCING' } })
      await tx.salesOrder.updateMany({ where: { id: { in: context.orders.map(order => order.id) } }, data: {
        fulfillmentStatus: 'PRODUCING', productionStartedAt: new Date()
      } })
      await tx.customizeOrder.updateMany({ where: { id: { in: tasks.map(row => row.task.id) } }, data: { status: 'producing', batchId: context.batch.id } })
    })

    const framePacks = await fastify.prisma.productionFramePack.findMany({ where: { batchId: context.batch.id, isActive: true } })
    const packMap = new Map(framePacks.map(pack => [pack.productionUnitId, pack]))
    const skus = await fastify.prisma.machineModelSku.findMany({
      where: { id: { in: [...new Set(tasks.map(row => row.task.skuId))] } },
      select: { id: true, skuCode: true, size: true, material: true, frameCount: true, colorName: true, model: { select: { name: true } } }
    })
    const skuMap = new Map(skus.map(sku => [sku.id, sku]))
    const entries = []
    const archiveName = file => `${file.asset?.assetNo || file.id.slice(0, 8)}_${safeName(file.displayName)}`
    for (const file of files) entries.push({ name: `Word/${archiveName(file)}`, buffer: await fastify.storageGetBuffer(file.objectKey) })
    entries.push({ name: '帧素材包标签.csv', buffer: csvBuffer(
      ['生产顺序','帧包码','总订单号','单件产品号','动画版本','目标帧数','尺寸','Word文件'],
      tasks.map(row => {
        const unit = context.batch.units.find(item => item.productionUnitId === row.task.id)
        return [unit?.printSequence, packMap.get(row.task.id)?.code, row.order.orderNo, row.task.orderNo,
          row.item.animationVersionId, row.task.frameCount, row.task.size, archiveName(fileForTask(row))]
      })
    ) })
    entries.push({ name: '材料包需求清单.csv', buffer: csvBuffer(
      ['SKU','款式','尺寸','帧数','材质','颜色','需要数量'],
      context.batch.batchItems.map(item => {
        const sku = skuMap.get(item.skuId) || {}
        return [sku.skuCode || item.skuId, sku.model?.name, sku.size, sku.frameCount, sku.material, sku.colorName, item.plannedQty]
      })
    ) })
    const zip = await zipBuffer(entries)
    await audit(fastify, req, `批次 ${context.batch.id} 导出生产资料并进入生产中`, context.batch.id)
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${context.batch.id}_production.zip"`)
    return reply.send(zip)
  })

  // 一张打印坏了也必须换新 FP 码；文档只包含员工指定的页。
  fastify.post('/units/:productionUnitId/reprint', { preHandler: requireAdmin }, async (req, reply) => {
    const productionUnitId = String(req.params.productionUnitId || '').trim()
    const reason = String(req.body?.reason || '').trim()
    const requestedPages = [...new Set((Array.isArray(req.body?.pages) ? req.body.pages : []).map(Number))].sort((a, b) => a - b)
    if (!reason) return reply.code(400).send({ success: false, message: '请填写返工原因' })
    const workflowUnit = await fastify.prisma.productionBatchUnit.findFirst({ where: { productionUnitId } })
    if (!workflowUnit) return reply.code(404).send({ success: false, message: '没有找到该生产件' })
    const totalPages = Number(workflowUnit.printPageCount || 0)
    if (!requestedPages.length || requestedPages.some(page => !Number.isInteger(page) || page < 1 || page > totalPages)) {
      return reply.code(400).send({ success: false, message: `请选择 1-${totalPages} 之间的重印页码` })
    }
    const [task, activePack, pairing] = await Promise.all([
      fastify.prisma.customizeOrder.findUnique({ where: { id: productionUnitId }, include: { salesOrderItem: true } }),
      fastify.prisma.productionFramePack.findFirst({ where: { productionUnitId, isActive: true } }),
      fastify.prisma.productionUnitPairing.findUnique({ where: { productionUnitId } })
    ])
    if (!task?.salesOrderItem || !activePack) return reply.code(409).send({ success: false, message: '生产件缺少正式订单或当前帧包记录' })
    if (pairing && pairing.status !== 'VOID') return reply.code(409).send({ success: false, message: '该帧包已经领取材料并完成配对，请先走生产异常退回流程' })
    if (!workflowUnit.printGroupId) return reply.code(409).send({ success: false, message: '该生产件没有冻结打印裁切组' })
    const template = await fastify.prisma.printTemplateVersion.findFirst({
      where: { groupId: workflowUnit.printGroupId, status: 'ACTIVE' }, orderBy: { versionNo: 'desc' }
    })
    if (!template) return reply.code(409).send({ success: false, message: '当前打印裁切组没有有效 Word 模板' })

    let printFile
    try {
      printFile = await generateProductionFile(fastify, {
        assetId: task.salesOrderItem.animationAssetId,
        animationVersionId: task.salesOrderItem.animationVersionId,
        templateVersionId: template.id,
        targetFrameCount: task.frameCount,
        requestedPages,
        createdBy: req.user.userId,
        sourceType: 'REPRINT',
        productionBatchId: workflowUnit.batchId
      })
    } catch (error) {
      return reply.code(409).send({ success: false, message: `返工文件生成失败：${error.message}` })
    }

    const attemptNo = activePack.attemptNo + 1
    const newCode = framePackCode(task.orderNo, attemptNo)
    const result = await fastify.prisma.$transaction(async tx => {
      await tx.productionFramePack.update({ where: { id: activePack.id }, data: {
        status: 'VOID', isActive: false, voidReason: reason,
        voidedBy: req.user.userId, voidedAt: new Date()
      } })
      const newPack = await tx.productionFramePack.create({ data: {
        code: newCode, productionUnitId, salesOrderId: workflowUnit.salesOrderId,
        batchId: workflowUnit.batchId, skuId: task.skuId,
        animationVersionId: task.salesOrderItem.animationVersionId,
        targetFrameCount: task.frameCount, size: task.size, attemptNo,
        status: 'IN_PROGRESS', isActive: true, printFileId: printFile.id,
        requestedPages, createdBy: req.user.userId
      } })
      const reprint = await tx.productionFrameReprint.create({ data: {
        productionUnitId, salesOrderId: workflowUnit.salesOrderId, batchId: workflowUnit.batchId,
        oldFramePackId: activePack.id, oldFramePackCode: activePack.code,
        newFramePackId: newPack.id, newFramePackCode: newPack.code,
        productionPrintFileId: printFile.id, requestedPages, reason,
        requestedBy: req.user.userId
      } })
      await tx.productionBatchUnit.update({ where: { id: workflowUnit.id }, data: {
        frameStatus: 'IN_PROGRESS', exceptionStatus: 'NORMAL'
      } })
      return { newPack, reprint }
    })
    await audit(fastify, req, `${task.orderNo} 重印第 ${requestedPages.join('、')} 页；${activePack.code} 作废，启用 ${newCode}`, productionUnitId)
    return reply.send({ success: true, message: `已生成 ${newCode}，旧码 ${activePack.code} 已失效`, data: {
      framePackCode: newCode, oldFramePackCode: activePack.code,
      pages: requestedPages, fileName: printFile.displayName,
      downloadUrl: await fastify.storagePresignGet(printFile.objectKey, 900),
      reprintId: result.reprint.id
    } })
  })

  fastify.get('/pairing/lookup/:code', { preHandler: requireProduction }, async (req, reply) => {
    const code = String(req.params.code || '').trim()
    const framePack = await fastify.prisma.productionFramePack.findUnique({ where: { code } })
    if (framePack) {
      const [unit, task, sku] = await Promise.all([
        fastify.prisma.productionBatchUnit.findFirst({ where: { batchId: framePack.batchId, productionUnitId: framePack.productionUnitId } }),
        fastify.prisma.customizeOrder.findUnique({ where: { id: framePack.productionUnitId } }),
        fastify.prisma.machineModelSku.findUnique({ where: { id: framePack.skuId }, include: { model: { select: { name: true } } } })
      ])
      return reply.send({ success: true, data: {
        type: 'FRAME_PACK', ...framePack, productionNo: task?.orderNo || unit?.productionNoSnapshot,
        skuCode: sku?.skuCode || null,
        specification: sku ? `${sku.model?.name || ''} · ${sku.size} · ${sku.frameCount}帧 · ${sku.material} · ${sku.colorName}` : null,
        workflow: unit
      } })
    }
    const container = await fastify.prisma.kitContainer.findUnique({ where: { code } })
    if (container) {
      const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: container.skuId }, include: { model: { select: { name: true } } } })
      return reply.send({ success: true, data: { type: 'KIT_CONTAINER', ...container,
        freeQty: Math.max(0, container.currentQty - container.reservedQty), skuCode: sku?.skuCode || null,
        specification: sku ? `${sku.model?.name || ''} · ${sku.size} · ${sku.frameCount}帧 · ${sku.material} · ${sku.colorName}` : null
      } })
    }
    const kitBatch = await fastify.prisma.kitAssemblyBatch.findUnique({ where: { batchNo: code } })
    if (kitBatch) {
      const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: kitBatch.skuId }, include: { model: { select: { name: true } } } })
      return reply.send({ success: true, data: { type: 'KIT_BATCH', ...kitBatch,
        freeQty: Math.max(0, kitBatch.availableQty - kitBatch.reservedQty), skuCode: sku?.skuCode || null,
        specification: sku ? `${sku.model?.name || ''} · ${sku.size} · ${sku.frameCount}帧 · ${sku.material} · ${sku.colorName}` : null
      } })
    }
    return reply.code(404).send({ success: false, message: '没有找到该帧包码、材料包批次码或箱码' })
  })

  // 裁切、装袋并贴标后扫描 FP，独立确认帧素材包完成。
  fastify.post('/frame-packs/:code/complete', { preHandler: requireProduction }, async (req, reply) => {
    const code = String(req.params.code || '').trim()
    try {
      const result = await fastify.prisma.$transaction(async tx => {
        const frame = await tx.productionFramePack.findUnique({ where: { code } })
        if (!frame || !frame.isActive || frame.status === 'VOID') throw new Error('帧素材包不存在或已经作废')
        if (['PAIRED', 'PACKED', 'SHIPPED'].includes(frame.status)) return { frame, reused: true }
        if (!['CREATED', 'IN_PROGRESS', 'COMPLETED'].includes(frame.status)) throw new Error('该帧素材包当前不能登记完成')
        if (frame.status !== 'COMPLETED') {
          await tx.productionFramePack.update({ where: { id: frame.id }, data: { status: 'COMPLETED' } })
          await tx.productionBatchUnit.updateMany({
            where: { batchId: frame.batchId, productionUnitId: frame.productionUnitId },
            data: { frameStatus: 'COMPLETED' }
          })
        }
        return { frame, reused: frame.status === 'COMPLETED' }
      })
      await audit(fastify, req, `帧素材包 ${code} 完成裁切装袋`, result.frame.id)
      return reply.send({ success: true, message: result.reused ? '该帧素材包此前已经登记完成' : '帧素材包已登记完成', data: result })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
  })

  fastify.get('/material-picks', { preHandler: requireProduction }, async (req, reply) => {
    const batchId = String(req.query?.batchId || '').trim()
    const picks = await fastify.prisma.productionMaterialPick.findMany({
      where: { ...(batchId ? { batchId } : {}), status: { in: ['ACTIVE', 'CONSUMED', 'RETURNED'] } },
      include: { kitAssemblyBatch: true, kitContainer: true }, orderBy: { pickedAt: 'desc' }, take: 200
    })
    return reply.send({ success: true, data: picks.map(pick => ({
      ...pick, sourceCode: pick.kitContainer?.code || pick.kitAssemblyBatch.batchNo,
      kitBatchNo: pick.kitAssemblyBatch.batchNo
    })) })
  })

  // 扫 KB/BX 并按批次领料：只预留库存，不做正式消耗。
  fastify.post('/material-picks', { preHandler: requireProduction }, async (req, reply) => {
    const batchId = String(req.body?.batchId || '').trim()
    const kitCode = String(req.body?.kitCode || '').trim()
    const quantity = Number(req.body?.quantity)
    if (!batchId || !kitCode || !Number.isInteger(quantity) || quantity < 1) {
      return reply.code(400).send({ success: false, message: '请选择生产批次、扫描材料来源并填写正确数量' })
    }
    try {
      const pick = await fastify.prisma.$transaction(async tx => {
        const batch = await tx.productionBatch.findUnique({ where: { id: batchId } })
        if (!batch || !ACTIVE_BATCH_STATUSES.includes(batch.status)) throw new Error('生产批次不存在或已经结束')
        const { kitBatch, container } = await resolveKitSource(tx, kitCode)
        const waitingUnits = await tx.productionBatchUnit.findMany({
          where: { batchId, skuId: kitBatch.skuId, materialStatus: { in: ['WAITING', 'IN_PROGRESS'] }, pairingStatus: 'WAITING' },
          orderBy: [{ printSequence: 'asc' }, { createdAt: 'asc' }], take: quantity
        })
        if (waitingUnits.length < quantity) throw new Error(`该批次当前最多还需要领取 ${waitingUnits.length} 套此规格材料包`)
        const reserved = await tx.kitAssemblyBatch.updateMany({
          where: { id: kitBatch.id, reservedQty: kitBatch.reservedQty, availableQty: { gte: kitBatch.reservedQty + quantity } },
          data: { reservedQty: { increment: quantity } }
        })
        if (reserved.count !== 1) throw new Error('材料包可用数量刚刚发生变化，请重新扫描')
        if (container) {
          const box = await tx.kitContainer.updateMany({
            where: { id: container.id, reservedQty: container.reservedQty, currentQty: { gte: container.reservedQty + quantity } },
            data: { reservedQty: { increment: quantity } }
          })
          if (box.count !== 1) throw new Error('材料箱可用数量不足或刚刚发生变化')
        }
        await tx.productionBatchUnit.updateMany({ where: { id: { in: waitingUnits.map(unit => unit.id) } }, data: { materialStatus: 'PICKED' } })
        return tx.productionMaterialPick.create({ data: {
          batchId, skuId: kitBatch.skuId, kitAssemblyBatchId: kitBatch.id,
          kitContainerId: container?.id || null, quantity, remainingQty: quantity,
          pickedBy: req.user.userId
        } })
      })
      await audit(fastify, req, `批次 ${batchId} 从 ${kitCode} 领取 ${quantity} 套材料包`, pick.id)
      return reply.code(201).send({ success: true, message: `已为 ${batchId} 预留 ${quantity} 套材料包`, data: pick })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
  })

  fastify.post('/material-picks/:id/return', { preHandler: requireProduction }, async (req, reply) => {
    const quantity = Number(req.body?.quantity)
    const reason = String(req.body?.reason || '').trim()
    if (!Number.isInteger(quantity) || quantity < 1 || !reason) return reply.code(400).send({ success: false, message: '请填写退回数量和原因' })
    try {
      const result = await fastify.prisma.$transaction(async tx => {
        const pick = await tx.productionMaterialPick.findUnique({ where: { id: req.params.id } })
        if (!pick || pick.status !== 'ACTIVE' || pick.remainingQty < quantity) throw new Error('领料记录不存在或可退数量不足')
        const releasable = await tx.productionBatchUnit.findMany({
          where: { batchId: pick.batchId, skuId: pick.skuId, materialStatus: 'PICKED', pairingStatus: 'WAITING' },
          orderBy: { updatedAt: 'desc' }, take: quantity
        })
        if (releasable.length < quantity) throw new Error('部分材料已经进入配对，不能退回这么多')
        await tx.productionBatchUnit.updateMany({ where: { id: { in: releasable.map(unit => unit.id) } }, data: { materialStatus: 'IN_PROGRESS' } })
        const releasedBatch = await tx.kitAssemblyBatch.updateMany({ where: { id: pick.kitAssemblyBatchId, reservedQty: { gte: quantity } }, data: { reservedQty: { decrement: quantity } } })
        if (releasedBatch.count !== 1) throw new Error('材料包批次预留数量不一致，请先核对库存')
        if (pick.kitContainerId) {
          const releasedBox = await tx.kitContainer.updateMany({ where: { id: pick.kitContainerId, reservedQty: { gte: quantity } }, data: { reservedQty: { decrement: quantity } } })
          if (releasedBox.count !== 1) throw new Error('材料箱预留数量不一致，请先核对库存')
        }
        const remainingQty = pick.remainingQty - quantity
        const returnedQty = pick.returnedQty + quantity
        const status = remainingQty === 0 ? (pick.consumedQty > 0 ? 'CONSUMED' : 'RETURNED') : 'ACTIVE'
        const updated = await tx.productionMaterialPick.update({ where: { id: pick.id }, data: {
          remainingQty, returnedQty, status, returnedBy: req.user.userId, returnedAt: new Date(), returnReason: reason
        } })
        return updated
      })
      await audit(fastify, req, `领料 ${result.id} 退回 ${quantity} 套：${reason}`, result.id)
      return reply.send({ success: true, message: `已退回 ${quantity} 套未使用材料包`, data: result })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
  })

  // 活动材料来源扫一次后可连续扫 FP；每次配对从本批次已领数量中正式消耗一套。
  fastify.post('/pairing', { preHandler: requireProduction }, async (req, reply) => {
    const frameCode = String(req.body?.framePackCode || '').trim()
    const kitCode = String(req.body?.kitCode || '').trim()
    if (!frameCode || !kitCode) return reply.code(400).send({ success: false, message: '请依次扫描帧素材包和材料包批次/箱码' })
    try {
      const result = await fastify.prisma.$transaction(async tx => {
        const frame = await tx.productionFramePack.findUnique({ where: { code: frameCode } })
        if (!frame || !frame.isActive || frame.status !== 'COMPLETED') throw new Error('帧素材包不存在、已作废、尚未登记完成或已经配对')
        const existing = await tx.productionUnitPairing.findUnique({ where: { productionUnitId: frame.productionUnitId } })
        if (existing && existing.status !== 'VOID') throw new Error('该单件产品已经完成配对，不能重复领取材料包')
        const workflowUnit = await tx.productionBatchUnit.findFirst({ where: { batchId: frame.batchId, productionUnitId: frame.productionUnitId } })
        if (!workflowUnit || workflowUnit.materialStatus !== 'PICKED') throw new Error('该生产件尚未完成材料领用')
        const { pick, kitBatch, container } = await resolvePickedKitSource(tx, {
          code: kitCode, batchId: frame.batchId, skuId: frame.skuId
        })

        const consumed = await tx.productionMaterialPick.updateMany({
          where: { id: pick.id, status: 'ACTIVE', remainingQty: { gt: 0 } },
          data: { remainingQty: { decrement: 1 }, consumedQty: { increment: 1 } }
        })
        if (consumed.count !== 1) throw new Error('已领材料数量刚刚发生变化，请重新扫描')
        if (pick.remainingQty === 1) await tx.productionMaterialPick.update({ where: { id: pick.id }, data: { status: 'CONSUMED' } })
        const deducted = await tx.kitAssemblyBatch.updateMany({
          where: { id: kitBatch.id, availableQty: { gte: 1 }, reservedQty: { gte: 1 } },
          data: { availableQty: { decrement: 1 }, reservedQty: { decrement: 1 } }
        })
        if (deducted.count !== 1) throw new Error('材料包库存与预留数量不一致，请先核对库存')
        if (container) {
          const box = await tx.kitContainer.updateMany({
            where: { id: container.id, currentQty: { gte: 1 }, reservedQty: { gte: 1 } },
            data: { currentQty: { decrement: 1 }, reservedQty: { decrement: 1 } }
          })
          if (box.count !== 1) throw new Error('材料包箱内数量不足，请核对库存')
        }
        const skuInventory = await tx.skuInventory.findUnique({ where: { skuId: frame.skuId } })
        if (skuInventory) {
          const stock = await tx.skuInventory.updateMany({ where: { skuId: frame.skuId, currentStock: { gte: 1 } }, data: { currentStock: { decrement: 1 } } })
          if (stock.count !== 1) throw new Error('材料包汇总库存不足，请先修正库存')
        }
        const pairing = existing
          ? await tx.productionUnitPairing.update({ where: { id: existing.id }, data: {
              framePackId: frame.id, kitAssemblyBatchId: kitBatch.id, kitContainerId: container?.id || null,
              status: 'PAIRED', pairedBy: req.user.userId, pairedAt: new Date()
            } })
          : await tx.productionUnitPairing.create({ data: {
              productionUnitId: frame.productionUnitId, salesOrderId: frame.salesOrderId,
              batchId: frame.batchId, framePackId: frame.id, skuId: frame.skuId,
              kitAssemblyBatchId: kitBatch.id, kitContainerId: container?.id || null,
              pairedBy: req.user.userId
            } })
        await tx.productionFramePack.update({ where: { id: frame.id }, data: { status: 'PAIRED' } })
        await tx.productionBatchUnit.updateMany({ where: { batchId: frame.batchId, productionUnitId: frame.productionUnitId }, data: {
          pairingStatus: 'COMPLETED'
        } })
        await tx.batchItem.updateMany({ where: { batchId: frame.batchId, skuId: frame.skuId }, data: { actualQty: { increment: 1 } } })
        return { pairing, frameCode, materialPickId: pick.id, kitBatchNo: kitBatch.batchNo, containerCode: container?.code || null }
      })
      await audit(fastify, req, `帧包 ${frameCode} 与材料包 ${kitCode} 配对`, result.pairing.id)
      return reply.send({ success: true, message: '配对成功，请保留单件产品外包装上的帧包码', data: result })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
  })

  fastify.get('/packing/:trackingNo', { preHandler: requireProduction }, async (req, reply) => {
    const trackingNo = String(req.params.trackingNo || '').trim()
    const order = await fastify.prisma.salesOrder.findFirst({ where: { trackingNo }, include: {
      items: { include: { productionTasks: { orderBy: { unitIndex: 'asc' } } } }, productionBatchOrders: true
    } })
    if (!order) return reply.code(404).send({ success: false, message: '没有找到该快递面单绑定的总订单' })
    const tasks = order.items.flatMap(item => item.productionTasks)
    const pairings = await fastify.prisma.productionUnitPairing.findMany({ where: { productionUnitId: { in: tasks.map(task => task.id) }, status: { not: 'VOID' } } })
    const session = await fastify.prisma.productionPackingSession.findUnique({ where: { salesOrderId: order.id }, include: { scans: true } })
    const pairMap = new Map(pairings.map(row => [row.productionUnitId, row]))
    const scanned = new Set((session?.scans || []).map(row => row.productionUnitId))
    return reply.send({ success: true, data: {
      order: { id: order.id, orderNo: order.orderNo, receiverName: order.receiverName, fulfillmentStatus: order.fulfillmentStatus },
      session: session ? { id: session.id, status: session.status } : null,
      units: tasks.map(task => ({ productionUnitId: task.id, productionNo: task.orderNo,
        specification: `${task.modelName} · ${task.frameCount}帧 · ${task.size} · ${task.material} · ${task.colorName}`,
        paired: pairMap.has(task.id), scanned: scanned.has(task.id) })),
      complete: tasks.length > 0 && tasks.every(task => scanned.has(task.id))
    } })
  })

  fastify.get('/packing-sessions', { preHandler: requireProduction }, async (req, reply) => {
    const sessions = await fastify.prisma.productionPackingSession.findMany({
      where: { status: { in: ['OPEN', 'COMPLETE'] } }, include: { scans: true }, orderBy: { updatedAt: 'desc' }, take: 100
    })
    const orders = sessions.length ? await fastify.prisma.salesOrder.findMany({
      where: { id: { in: sessions.map(session => session.salesOrderId) } },
      include: { items: { include: { productionTasks: true } } }
    }) : []
    const orderMap = new Map(orders.map(order => [order.id, order]))
    return reply.send({ success: true, data: sessions.map(session => {
      const order = orderMap.get(session.salesOrderId)
      const total = order?.items.flatMap(item => item.productionTasks).length || 0
      return {
        id: session.id, trackingNo: session.trackingNo, status: session.status,
        orderNo: order?.orderNo || '-', receiverName: order?.receiverName || '-',
        scanned: session.scans.length, total, updatedAt: session.updatedAt
      }
    }) })
  })

  fastify.post('/packing/:trackingNo/scan', { preHandler: requireProduction }, async (req, reply) => {
    const trackingNo = String(req.params.trackingNo || '').trim()
    const frameCode = String(req.body?.framePackCode || '').trim()
    if (!frameCode) return reply.code(400).send({ success: false, message: '请扫描单件产品外包装上的帧包码' })
    try {
      const data = await fastify.prisma.$transaction(async tx => {
        const order = await tx.salesOrder.findFirst({ where: { trackingNo } })
        if (!order) throw new Error('快递面单未绑定总订单')
        if (!['PRODUCING', 'READY_TO_SHIP'].includes(order.fulfillmentStatus)) throw new Error('该订单当前不允许装箱')
        const frame = await tx.productionFramePack.findUnique({ where: { code: frameCode } })
        if (!frame || !frame.isActive || frame.salesOrderId !== order.id) throw new Error('该产品不属于当前快递面单对应的总订单')
        const pairing = await tx.productionUnitPairing.findUnique({ where: { productionUnitId: frame.productionUnitId } })
        if (!pairing || !['PAIRED', 'PACKED'].includes(pairing.status)) throw new Error('该产品尚未完成帧包与材料包配对')
        const membership = await tx.productionBatchOrder.findFirst({ where: { salesOrderId: order.id, batch: { status: { in: ACTIVE_BATCH_STATUSES } } } })
        if (!membership) throw new Error('该订单没有有效生产批次')
        const session = await tx.productionPackingSession.upsert({
          where: { salesOrderId: order.id },
          create: { salesOrderId: order.id, batchId: membership.batchId, trackingNo, startedBy: req.user.userId },
          update: { trackingNo }
        })
        await tx.productionPackingScan.upsert({
          where: { sessionId_productionUnitId: { sessionId: session.id, productionUnitId: frame.productionUnitId } },
          create: { sessionId: session.id, productionUnitId: frame.productionUnitId, framePackId: frame.id, scannedBy: req.user.userId },
          update: { framePackId: frame.id, scannedBy: req.user.userId, scannedAt: new Date() }
        })
        await tx.productionBatchUnit.updateMany({ where: { batchId: membership.batchId, productionUnitId: frame.productionUnitId }, data: { packageStatus: 'COMPLETED' } })
        if (pairing.status === 'PAIRED') {
          await tx.productionUnitPairing.update({ where: { id: pairing.id }, data: { status: 'PACKED', packedAt: new Date() } })
        }
        const complete = await refreshReadyToShip(tx, order.id)
        if (complete) await tx.productionPackingSession.update({ where: { id: session.id }, data: { status: 'COMPLETE', completedAt: new Date() } })
        return { complete, orderNo: order.orderNo }
      })
      return reply.send({ success: true, message: data.complete ? '整笔订单已经配齐，可以确认发货' : '本件已装箱，订单仍有产品未齐', data })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
  })

  fastify.post('/packing/:trackingNo/ship', { preHandler: requireProduction }, async (req, reply) => {
    const trackingNo = String(req.params.trackingNo || '').trim()
    try {
      const result = await fastify.prisma.$transaction(async tx => {
        const order = await tx.salesOrder.findFirst({ where: { trackingNo } })
        if (!order || order.fulfillmentStatus !== 'READY_TO_SHIP') throw new Error('订单尚未配齐，不能发货')
        const session = await tx.productionPackingSession.findUnique({ where: { salesOrderId: order.id }, include: { scans: true } })
        if (!session || session.status !== 'COMPLETE') throw new Error('装箱扫码记录不完整')
        const units = await tx.productionBatchUnit.findMany({ where: { salesOrderId: order.id } })
        if (!units.length || units.some(unit => unit.pairingStatus !== 'COMPLETED' || unit.packageStatus !== 'COMPLETED' || unit.exceptionStatus !== 'NORMAL')) {
          throw new Error('仍有单件产品未完成配对、装箱或存在异常')
        }
        const now = new Date()
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'shipped', fulfillmentStatus: 'SHIPPED', shippedAt: now } })
        await tx.customizeOrder.updateMany({ where: { id: { in: units.map(unit => unit.productionUnitId) } }, data: { status: 'shipped', shippedAt: now } })
        await tx.productionBatchOrder.updateMany({ where: { salesOrderId: order.id }, data: { status: 'SHIPPED' } })
        await tx.productionFramePack.updateMany({ where: { salesOrderId: order.id, isActive: true }, data: { status: 'SHIPPED' } })
        await tx.productionUnitPairing.updateMany({ where: { salesOrderId: order.id, status: 'PACKED' }, data: { status: 'SHIPPED', shippedAt: now } })
        await tx.productionPackingSession.update({ where: { id: session.id }, data: { status: 'SHIPPED', shippedAt: now } })
        const remaining = await tx.productionBatchOrder.count({ where: { batchId: session.batchId, status: { not: 'SHIPPED' } } })
        if (remaining === 0) await tx.productionBatch.update({ where: { id: session.batchId }, data: { status: 'COMPLETED' } })
        return { orderNo: order.orderNo, batchId: session.batchId }
      })
      await audit(fastify, req, `总订单 ${result.orderNo} 扫码确认发货`, result.orderNo)
      return reply.send({ success: true, message: '发货成功', data: result })
    } catch (error) {
      return reply.code(409).send({ success: false, message: error.message })
    }
  })
}
