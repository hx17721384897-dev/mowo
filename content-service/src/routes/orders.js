// routes/orders.js — 用户端订单查询、确认收货、取消订单
// 注册前缀：/api/orders

import { unlockInventory, makeIdempotencyKey } from '../lib/inventory.js'
import { FILE_PURPOSE, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'

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

    const where = { userId }
    if (tab === 'active') {
      where.status = { in: ACTIVE_STATUSES }
    }

    const [orders, activeCount, totalCount] = await Promise.all([
      prisma.customizeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.customizeOrder.count({ where: { userId, status: { in: ACTIVE_STATUSES } } }),
      prisma.customizeOrder.count({ where: { userId } }),
    ])

    // 批量获取联名作品封面（MARKET 订单用）
    const collabWorkIds = orders
      .filter(o => o.sourceType === 'collab' && o.collabWorkId)
      .map(o => o.collabWorkId)
      .filter(Boolean)

    const collabMap = {}
    if (collabWorkIds.length) {
      const works = await prisma.collabWork.findMany({
        where: { id: { in: collabWorkIds } },
        select: { id: true, coverUrl: true, title: true },
      })
      works.forEach(w => { collabMap[w.id] = w })
    }

    const result = orders.map(o => {
      const display    = STATUS_MAP[o.status] || { label: o.status, group: 'unknown', step: -1 }
      const collab     = o.collabWorkId ? (collabMap[o.collabWorkId] || null) : null

      // 商品展示标题
      const productTitle = o.sourceType === 'collab' && collab
        ? collab.title
        : `DIY 定制款 · ${o.size} ${o.frameCount}帧 ${o.colorName}`

      // 缩略图：联名取 coverUrl，自定义取 frameUrls 第一帧
      // 仅当值是 OSS key（相对路径）时才预签名；data URL / 完整 http URL 直接使用
      let previewUrl = null
      try {
        if (o.sourceType === 'collab' && collab?.coverUrl) {
          previewUrl = ossSign(fastify, collab.coverUrl)
        } else {
          const frames = JSON.parse(o.frameUrls || '[]')
          if (frames[0]) previewUrl = ossSign(fastify, frames[0])
        }
      } catch {}

      return {
        id:             o.id,
        orderNo:        o.orderNo,
        status:         o.status,
        displayStatus:  display.label,
        statusGroup:    display.group,
        statusStep:     display.step,
        sourceType:     o.sourceType,     // 'custom' | 'collab'
        platform:       o.platform,
        modelName:      o.modelName,
        size:           o.size,
        material:       o.material,
        frameCount:     o.frameCount,
        colorName:      o.colorName,
        productTitle,
        totalAmount:    Number(o.totalAmount || 0),
        trackingNo:     o.trackingNo     || null,
        trackingCompany: o.trackingCompany || null,
        shippedAt:      o.shippedAt      || null,
        receiverName:   o.receiverName   || null,
        receiverCity:   o.receiverCity   || null,
        coverUrl:       previewUrl,
        createdAt:      o.createdAt,
        updatedAt:      o.updatedAt,
      }
    })

    return reply.send({
      success: true,
      data: {
        orders:      result,
        activeCount,
        totalCount,
        page,
        limit,
        hasMore: skip + orders.length < (tab === 'active' ? activeCount : totalCount),
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

    await prisma.customizeOrder.update({
      where: { id },
      data: { status: 'cancelled' },
    })

    // paid 状态已锁定库存，需释放
    if (order.status === 'paid' && order.skuId) {
      try {
        await unlockInventory(
          prisma,
          order.skuId,
          1,
          order.id,
          makeIdempotencyKey('cancel_order', order.id)
        )
      } catch (e) {
        fastify.log.warn('取消订单释放库存失败：' + e.message)
      }
    }

    return reply.send({ success: true, data: { status: 'cancelled' } })
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/:id
  // 单个订单详情（含物流信息）
  // ──────────────────────────────────────────────
  fastify.get('/:id', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

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

    const order = await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const AFTERSALE_ALLOW = ['paid', 'locked', 'processing', 'producing', 'shipped', 'received']
    if (!AFTERSALE_ALLOW.includes(order.status)) {
      return reply.code(400).send({
        success: false,
        message: `「${STATUS_MAP[order.status]?.label || order.status}」状态不可申请售后`,
      })
    }
    if (type === 'quality' && order.status !== 'received') {
      return reply.code(400).send({ success: false, message: '质量问题售后需在确认收货后申请' })
    }
    if (order.aftersaleCount >= 3) {
      return reply.code(400).send({ success: false, message: '申请次数已达上限（3次），请联系客服处理' })
    }

    // 检查是否已有 pending 申请
    const existing = await prisma.aftersaleRequest.findFirst({
      where: { orderId: id, status: 'pending' },
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
          orderId: id,
          userId,
          type,
          reason: reason.trim(),
          description: description?.trim() || null,
          imageUrls: JSON.stringify(Array.isArray(imageUrls) ? imageUrls : []),
        },
      })
      await linkFiles(tx, evidenceFiles, 'AFTERSALE_REQUEST', aftersale.id)
      await tx.customizeOrder.update({
        where: { id },
        data: { status: 'aftersale', aftersaleCount: { increment: 1 } },
      })
      // 联名款：取消冷却期中的分红（还未打款的部分）
      if (order.sourceType === 'collab') {
        await tx.collabOrder.updateMany({
          where: { orderId: id, revenueStatus: { in: ['estimated', 'cooling'] } },
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

    const order = await prisma.customizeOrder.findFirst({ where: { id, userId } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const request = await prisma.aftersaleRequest.findFirst({
      where: { orderId: id },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ success: true, data: request || null })
  })
}

export default orderRoutes
