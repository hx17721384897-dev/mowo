// routes/orders.js — 用户端订单查询、确认收货、取消订单
// 注册前缀：/api/orders

import { unlockInventoryInTransaction, makeIdempotencyKey } from '../lib/inventory.js'
import { FILE_PURPOSE, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'
import { summarizeProductionStatus } from '../lib/sales-orders.js'

// 安全签名辅助：仅对 OSS key（相对路径）生成预签名 URL
// data URL（base64）和完整 http(s) URL 直接返回 null（不适合做缩略图）
function ossSign(fastify, value) {
  if (!value) return null
  if (value.startsWith('data:')) return null          // base64 data URL，跳过
  if (value.startsWith('http://') || value.startsWith('https://')) {
    // 已经是完整 URL，直接返回（通常不会出现，但做兜底）
    return value
  }
  // 相对 OSS key，生成预签名 URL（有效期 1 小时）
  try {
    return fastify.ossPresignGet(value, 3600)
  } catch {
    return null
  }
}

// 后端状态 → 前端展示映射
const STATUS_MAP = {
  pending:    { label: '待付款', group: 'pending',   step: 0 },
  paid:       { label: '制作中', group: 'making',    step: 1 },
  locked:     { label: '制作中', group: 'making',    step: 1 },
  processing: { label: '制作中', group: 'making',    step: 1 },
  producing:  { label: '制作中', group: 'making',    step: 1 },
  shipped:    { label: '运输中', group: 'shipped',   step: 2 },
  received:   { label: '已完成', group: 'done',      step: 3 },
  aftersale:  { label: '售后中', group: 'aftersale', step: -1 },
  cancelled:  { label: '已取消', group: 'cancelled', step: -1 },
}

// 进行中的状态（active tab）
const ACTIVE_STATUSES = ['pending', 'paid', 'locked', 'processing', 'producing', 'shipped']

const SALES_ORDER_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: { productionTasks: { orderBy: { unitIndex: 'asc' } } }
  }
}

function parseConfig(value) {
  try { return JSON.parse(value || '{}') } catch { return {} }
}

function serializeSalesOrder(fastify, order, includeAddress = false) {
  const tasks = order.items.flatMap(item => item.productionTasks)
  const status = summarizeProductionStatus(tasks)
  const display = STATUS_MAP[status] || { label: status, group: 'unknown', step: -1 }
  const items = order.items.map(item => {
    const config = parseConfig(item.configSnapshotJson)
    const firstTask = item.productionTasks[0]
    let previewUrl = ossSign(fastify, item.snapshotPreviewUrl)
    if (!previewUrl && firstTask?.frameUrls) {
      try { previewUrl = ossSign(fastify, JSON.parse(firstTask.frameUrls)[0]) } catch {}
    }
    return {
      id: item.id,
      itemNo: item.itemNo,
      itemType: item.itemType,
      productTitle: item.snapshotTitle,
      coverUrl: previewUrl,
      modelName: config.modelName || firstTask?.modelName || null,
      size: config.size || firstTask?.size || null,
      material: config.material || firstTask?.material || null,
      frameCount: config.skuFrameCount || firstTask?.frameCount || null,
      colorName: config.colorName || firstTask?.colorName || null,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
      animationAssetId: item.animationAssetId,
      animationVersionId: item.animationVersionId,
      skuId: item.skuId,
      productionTasks: item.productionTasks.map(task => ({
        id: task.id, productionNo: task.orderNo, unitIndex: task.unitIndex,
        status: task.status, trackingNo: task.trackingNo, trackingCompany: task.trackingCompany
      }))
    }
  })
  const firstItem = items[0] || {}
  const trackingTasks = tasks.filter(task => task.trackingNo)
  return {
    id: order.id,
    orderNo: order.orderNo,
    status,
    displayStatus: display.label,
    statusGroup: display.group,
    statusStep: display.step,
    sourceType: order.items.every(item => item.itemType === 'MARKET') ? 'collab' : 'custom',
    platform: order.platform,
    productTitle: items.length > 1 ? `${items.length} 种商品 · 共 ${items.reduce((sum, item) => sum + item.quantity, 0)} 件` : firstItem.productTitle,
    coverUrl: firstItem.coverUrl || null,
    modelName: firstItem.modelName || null,
    size: firstItem.size || null,
    material: firstItem.material || null,
    frameCount: firstItem.frameCount || null,
    colorName: firstItem.colorName || null,
    totalAmount: Number(order.totalAmount),
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
    trackingNo: trackingTasks.length === tasks.length && new Set(trackingTasks.map(task => task.trackingNo)).size === 1 ? trackingTasks[0]?.trackingNo : null,
    trackingCompany: trackingTasks.length === tasks.length && new Set(trackingTasks.map(task => task.trackingCompany)).size === 1 ? trackingTasks[0]?.trackingCompany : null,
    shippedAt: tasks.length && tasks.every(task => ['shipped', 'received'].includes(task.status))
      ? tasks.reduce((latest, task) => !latest || task.shippedAt > latest ? task.shippedAt : latest, null)
      : null,
    receiverName: order.receiverName || null,
    receiverCity: order.receiverCity || null,
    ...(includeAddress ? {
      receiverPhone: order.receiverPhone || null,
      receiverAddress: order.receiverAddress || null
    } : {}),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  }
}

async function orderRoutes(fastify, opts) {
  const { prisma } = fastify

  // 所有接口统一检查设备会话和账号状态。
  fastify.addHook('preHandler', async (req, reply) => {
    return fastify.authenticate(req, reply)
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/mine?tab=active&page=1&limit=30
  // 获取当前用户订单列表
  // ──────────────────────────────────────────────
  fastify.get('/mine', async (req, reply) => {
    const userId = req.user.userId
    const tab    = req.query.tab    || 'active'   // active | all
    const page   = Math.max(1, Number(req.query.page  || 1))
    const limit  = Math.min(50, Math.max(1, Number(req.query.limit || 30)))
    const skip   = (page - 1) * limit

    const salesOrders = await prisma.salesOrder.findMany({
      where: { userId }, include: SALES_ORDER_INCLUDE, orderBy: { createdAt: 'desc' }
    })
    // 旧测试数据没有订单头，继续作为单商品旧订单显示，避免本地历史记录突然消失。
    const legacy = await prisma.customizeOrder.findMany({
      where: { userId, salesOrderItemId: null }, orderBy: { createdAt: 'desc' }
    })
    const legacyResult = legacy.map(order => {
      const display = STATUS_MAP[order.status] || { label: order.status, group: 'unknown', step: -1 }
      let coverUrl = null
      try { coverUrl = ossSign(fastify, JSON.parse(order.frameUrls || '[]')[0]) } catch {}
      return {
        id: order.id, orderNo: order.orderNo, status: order.status,
        displayStatus: display.label, statusGroup: display.group, statusStep: display.step,
        sourceType: order.sourceType, platform: order.platform,
        productTitle: `DIY 定制款 · ${order.size} ${order.frameCount}帧 ${order.colorName}`,
        modelName: order.modelName, size: order.size, material: order.material,
        frameCount: order.frameCount, colorName: order.colorName, totalAmount: 0,
        itemCount: 1, totalQuantity: 1, coverUrl,
        receiverName: order.receiverName, receiverCity: order.receiverCity,
        trackingNo: order.trackingNo, trackingCompany: order.trackingCompany,
        shippedAt: order.shippedAt, createdAt: order.createdAt, updatedAt: order.updatedAt,
        legacy: true
      }
    })
    const all = [
      ...salesOrders.map(order => serializeSalesOrder(fastify, order)),
      ...legacyResult
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    const visible = tab === 'active' ? all.filter(order => ACTIVE_STATUSES.includes(order.status)) : all
    const activeCount = all.filter(order => ACTIVE_STATUSES.includes(order.status)).length
    const totalCount = all.length
    const result = visible.slice(skip, skip + limit)

    return reply.send({
      success: true,
      data: {
        orders:      result,
        activeCount,
        totalCount,
        page,
        limit,
        hasMore: skip + result.length < visible.length,
      },
    })
  })

  // ──────────────────────────────────────────────
  // POST /api/orders/:id/confirm-receipt
  // 确认收货：status shipped → received，触发联名分红冷却期
  // ──────────────────────────────────────────────
  fastify.post('/:id/confirm-receipt', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (salesOrder) {
      const tasks = salesOrder.items.flatMap(item => item.productionTasks)
      if (!tasks.length || tasks.some(task => !['shipped', 'received'].includes(task.status))) {
        return reply.code(400).send({ success: false, message: '订单中仍有商品尚未发货，暂时不能确认收货' })
      }
      const now = new Date()
      await prisma.$transaction(async tx => {
        await tx.customizeOrder.updateMany({
          where: { id: { in: tasks.map(task => task.id) }, status: 'shipped' },
          data: { status: 'received', receivedAt: now }
        })
        await tx.salesOrderItem.updateMany({ where: { salesOrderId: id }, data: { status: 'received' } })
        await tx.salesOrder.update({ where: { id }, data: { status: 'received', receivedAt: now } })
        if (fastify.config.features.creatorFinance) {
          await tx.collabOrder.updateMany({
            where: { orderId: { in: tasks.map(task => task.id) }, revenueStatus: { in: ['estimated', 'cooling'] } },
            data: { revenueStatus: 'cooling', coolingEndAt: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000) }
          })
        }
      })
      return reply.send({ success: true, data: { status: 'received' } })
    }

    const order = await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!order) {
      return reply.code(404).send({ success: false, message: '订单不存在' })
    }
    if (order.status !== 'shipped') {
      return reply.code(400).send({
        success: false,
        message: `当前订单状态「${STATUS_MAP[order.status]?.label || order.status}」不可确认收货`,
      })
    }

    // 事务：更新订单状态 + 启动联名分红冷却期
    await prisma.$transaction(async tx => {
      await tx.customizeOrder.update({
        where: { id },
        data: { status: 'received', receivedAt: new Date() },
      })

      // 若为联名款，将 collabOrder 从 estimated/cooling → cooling（写入冷却期结束时间）
      if (fastify.config.features.creatorFinance && order.sourceType === 'collab') {
        const coolingEndAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        await tx.collabOrder.updateMany({
          where: {
            orderId:       id,
            revenueStatus: { in: ['estimated', 'cooling'] },
          },
          data: {
            revenueStatus: 'cooling',
            coolingEndAt,
          },
        })
      }
    })

    return reply.send({ success: true, data: { status: 'received' } })
  })

  // ──────────────────────────────────────────────
  // POST /api/orders/:id/cancel
  // 取消订单：仅限 pending / paid 状态
  // paid 状态需释放已锁库存
  // ──────────────────────────────────────────────
  fastify.post('/:id/cancel', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (salesOrder) {
      const tasks = salesOrder.items.flatMap(item => item.productionTasks)
      if (tasks.some(task => !['pending', 'paid'].includes(task.status))) {
        return reply.code(400).send({ success: false, message: '订单中已有商品进入生产，如需取消请联系客服' })
      }
      await prisma.$transaction(async tx => {
        await tx.customizeOrder.updateMany({ where: { id: { in: tasks.map(task => task.id) } }, data: { status: 'cancelled' } })
        await tx.salesOrderItem.updateMany({ where: { salesOrderId: id }, data: { status: 'cancelled' } })
        await tx.salesOrder.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date() } })
        for (const item of salesOrder.items) {
          await unlockInventoryInTransaction(tx, item.skuId, item.quantity, id, `sales_order_cancel_${id}_${item.id}`)
        }
      })
      return reply.send({ success: true, data: { status: 'cancelled' } })
    }

    const order = await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!order) {
      return reply.code(404).send({ success: false, message: '订单不存在' })
    }

    const cancellable = ['pending', 'paid']
    if (!cancellable.includes(order.status)) {
      return reply.code(400).send({
        success: false,
        message: `订单已进入「${STATUS_MAP[order.status]?.label || order.status}」状态，如需取消请联系客服`,
      })
    }

    await prisma.$transaction(async tx => {
      await tx.customizeOrder.update({ where: { id }, data: { status: 'cancelled' } })
      // paid 状态已锁定库存，必须与订单状态一起提交。
      if (order.status === 'paid' && order.skuId) {
        await unlockInventoryInTransaction(tx, order.skuId, 1, order.id, makeIdempotencyKey('cancel_order', order.id))
      }
    })

    return reply.send({ success: true, data: { status: 'cancelled' } })
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/:id
  // 单个订单详情（含物流信息）
  // ──────────────────────────────────────────────
  fastify.get('/:id', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (salesOrder) {
      return reply.send({ success: true, data: serializeSalesOrder(fastify, salesOrder, true) })
    }

    const order = await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!order) {
      return reply.code(404).send({ success: false, message: '订单不存在' })
    }

    const display  = STATUS_MAP[order.status] || { label: order.status, group: 'unknown', step: -1 }
    const collab   = order.collabWorkId
      ? await prisma.collabWork.findUnique({
          where: { id: order.collabWorkId },
          select: { id: true, coverUrl: true, title: true },
        })
      : null

    const productTitle = order.sourceType === 'collab' && collab
      ? collab.title
      : `DIY 定制款 · ${order.size} ${order.frameCount}帧 ${order.colorName}`

    // 缩略图：联名取 coverUrl，自定义取 frameUrls 第一帧，经 ossSign 安全处理
    let previewUrl = null
    try {
      if (order.sourceType === 'collab' && collab?.coverUrl) {
        previewUrl = ossSign(fastify, collab.coverUrl)
      } else {
        const frames = JSON.parse(order.frameUrls || '[]')
        if (frames[0]) previewUrl = ossSign(fastify, frames[0])
      }
    } catch {}

    return reply.send({
      success: true,
      data: {
        id:              order.id,
        orderNo:         order.orderNo,
        status:          order.status,
        displayStatus:   display.label,
        statusGroup:     display.group,
        statusStep:      display.step,
        sourceType:      order.sourceType,
        modelName:       order.modelName,
        size:            order.size,
        material:        order.material,
        frameCount:      order.frameCount,
        colorName:       order.colorName,
        productTitle,
        totalAmount:     Number(order.totalAmount || 0),
        trackingNo:      order.trackingNo     || null,
        trackingCompany: order.trackingCompany || null,
        shippedAt:       order.shippedAt      || null,
        receiverName:    order.receiverName   || null,
        receiverPhone:   order.receiverPhone  || null,
        receiverAddress: order.receiverAddress || null,
        receiverCity:    order.receiverCity   || null,
        coverUrl:        previewUrl,
        createdAt:       order.createdAt,
        updatedAt:       order.updatedAt,
      },
    })
  })
  // ──────────────────────────────────────────────
  // POST /api/orders/:id/aftersale
  // 提交售后申请（退款 or 质量问题）
  // 允许状态：paid / locked / processing / producing / shipped / received
  // ──────────────────────────────────────────────
  fastify.post('/:id/aftersale', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params
    const { type, reason, description, imageUrls = [] } = req.body

    // 参数校验
    const VALID_TYPES = ['refund', 'quality']
    if (!VALID_TYPES.includes(type)) {
      return reply.code(400).send({ success: false, message: '申请类型无效' })
    }
    if (!reason || !reason.trim()) {
      return reply.code(400).send({ success: false, message: '请选择申请原因' })
    }

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    const salesTasks = salesOrder?.items.flatMap(item => item.productionTasks) || []
    const order = salesOrder
      ? salesTasks[0]
      : await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const AFTERSALE_ALLOW = ['paid', 'locked', 'processing', 'producing', 'shipped', 'received']
    const relevantTasks = salesOrder ? salesTasks : [order]
    if (!relevantTasks.length || relevantTasks.some(task => !AFTERSALE_ALLOW.includes(task.status))) {
      return reply.code(400).send({
        success: false,
        message: '订单中有商品处于不可申请售后的状态',
      })
    }
    if (type === 'quality' && relevantTasks.some(task => task.status !== 'received')) {
      return reply.code(400).send({ success: false, message: '质量问题售后需在确认收货后申请' })
    }
    if (relevantTasks.some(task => task.aftersaleCount >= 3)) {
      return reply.code(400).send({ success: false, message: '申请次数已达上限（3次），请联系客服处理' })
    }

    // 检查是否已有 pending 申请
    const existing = await prisma.aftersaleRequest.findFirst({
      where: { orderId: { in: relevantTasks.map(task => task.id) }, status: 'pending' },
    })
    if (existing) {
      return reply.code(400).send({ success: false, message: '已有处理中的申请，请等待客服回复' })
    }

    let evidenceFiles = []
    try {
      evidenceFiles = await findOwnedReadyFiles(prisma, imageUrls, userId, [FILE_PURPOSE.AFTERSALE_EVIDENCE])
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    // 事务：创建申请 + 订单变为 aftersale + 次数+1 + 联名分红取消
    await prisma.$transaction(async tx => {
      const aftersale = await tx.aftersaleRequest.create({
        data: {
          orderId: order.id,
          userId,
          type,
          reason: reason.trim(),
          description: [salesOrder ? `用户订单：${salesOrder.orderNo}` : null, description?.trim() || null].filter(Boolean).join('\n') || null,
          imageUrls: JSON.stringify(Array.isArray(imageUrls) ? imageUrls : []),
        },
      })
      await linkFiles(tx, evidenceFiles, 'AFTERSALE_REQUEST', aftersale.id)
      await tx.customizeOrder.updateMany({
        where: { id: { in: relevantTasks.map(task => task.id) } },
        data: { status: 'aftersale' },
      })
      await tx.customizeOrder.update({ where: { id: order.id }, data: { aftersaleCount: { increment: 1 } } })
      if (salesOrder) {
        await tx.salesOrderItem.updateMany({ where: { salesOrderId: salesOrder.id }, data: { status: 'aftersale' } })
        await tx.salesOrder.update({ where: { id: salesOrder.id }, data: { status: 'aftersale' } })
      }
      // 联名款：取消冷却期中的分红（还未打款的部分）
      if (order.sourceType === 'collab') {
        await tx.collabOrder.updateMany({
          where: { orderId: { in: relevantTasks.map(task => task.id) }, revenueStatus: { in: ['estimated', 'cooling'] } },
          data: { revenueStatus: 'cancelled' },
        })
      }
    })

    return reply.send({ success: true, data: { status: 'aftersale' } })
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/:id/aftersale
  // 查看订单最新一条售后申请详情
  // ──────────────────────────────────────────────
  fastify.get('/:id/aftersale', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    const taskIds = salesOrder?.items.flatMap(item => item.productionTasks.map(task => task.id)) || []
    const order = salesOrder ? null : await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!salesOrder && !order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const request = await prisma.aftersaleRequest.findFirst({
      where: { orderId: salesOrder ? { in: taskIds } : id },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ success: true, data: request || null })
  })
}

export default orderRoutes
