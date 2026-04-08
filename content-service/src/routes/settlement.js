// src/routes/settlement.js
// 分红结算相关接口
//
// 路由分三组：
//   /api/internal/settlement/*  — 定时任务专用（内部调用，IP白名单保护）
//   /api/admin/settlement/*     — 管理员操作
//   /api/creator/settlement/*   — 创作者查看

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

// 获取当前结算周标识，如 "2026-W14"
function getCurrentWeek() {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((now - startOfYear) / 86400000)
  const week = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`
}

// 计算冷却期截止时间（确认收货时间 + 15天）
function calcCoolingEnd(confirmedAt) {
  const d = new Date(confirmedAt)
  d.setDate(d.getDate() + 15)
  return d
}

// 计算储备金释放时间（确认收货时间 + 90天）
function calcReserveReleaseAt(confirmedAt) {
  const d = new Date(confirmedAt)
  d.setDate(d.getDate() + 90)
  return d
}

export default async function settlementRoutes(fastify) {

  // ═══════════════════════════════════════════════════════════
  // 内部定时任务接口
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────
  // POST /api/internal/settlement/cooling-to-available
  // 定时任务：冷却期满 → 分红转为可提现
  // 建议每天凌晨跑一次（cron: 0 2 * * *）
  // ─────────────────────────────────────────
  fastify.post('/internal/cooling-to-available', async (request, reply) => {
    const clientIp = request.ip
    if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
      return reply.code(403).send({ success: false, message: '仅限内部调用' })
    }

    const now = new Date()

    // 找出所有冷却期已到期、状态还是 cooling 的联名订单
    const readyOrders = await fastify.prisma.collabOrder.findMany({
      where: {
        revenueStatus: 'cooling',
        coolingEndAt: { lte: now }
      }
    })

    if (readyOrders.length === 0) {
      return reply.send({ success: true, message: '没有到期订单', count: 0 })
    }

    // 按创作者分组
    const creatorMap = {}
    for (const order of readyOrders) {
      if (!creatorMap[order.creatorId]) creatorMap[order.creatorId] = 0
      creatorMap[order.creatorId] += order.payoutAmount
    }

    await fastify.prisma.$transaction(async (tx) => {
      // 批量将订单状态改为 available
      await tx.collabOrder.updateMany({
        where: { id: { in: readyOrders.map(o => o.id) } },
        data: { revenueStatus: 'available' }
      })

      // 按创作者更新 Balance：pendingAmount → availableAmount
      for (const [creatorId, amount] of Object.entries(creatorMap)) {
        await tx.balance.upsert({
          where: { creatorId },
          create: {
            creatorId,
            pendingAmount: 0,
            availableAmount: amount,
            withdrawnAmount: 0
          },
          update: {
            pendingAmount:   { decrement: amount },
            availableAmount: { increment: amount }
          }
        })
      }
    })

    await fastify.prisma.operationLog.create({
      data: {
        userId:   'system',
        userRole: -1,
        method:   'POST',
        path:     '/api/internal/settlement/cooling-to-available',
        action:   'COOLING_TO_AVAILABLE',
        after:    JSON.stringify({ count: readyOrders.length, creatorCount: Object.keys(creatorMap).length }),
        ip:       clientIp
      }
    })

    return reply.send({
      success: true,
      message: `已处理 ${readyOrders.length} 笔订单，涉及 ${Object.keys(creatorMap).length} 位创作者`,
      count: readyOrders.length
    })
  })

  // ─────────────────────────────────────────
  // POST /api/internal/settlement/release-reserve
  // 定时任务：储备金 90 天到期 → 释放回可提现余额
  // 建议每天凌晨跑一次（cron: 0 3 * * *）
  // ─────────────────────────────────────────
  fastify.post('/internal/release-reserve', async (request, reply) => {
    const clientIp = request.ip
    if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
      return reply.code(403).send({ success: false, message: '仅限内部调用' })
    }

    const now = new Date()

    // 找出所有到期待释放的储备金流水
    // note 不含 [released] 表示尚未处理
    const dueReserveLogs = await fastify.prisma.reserveLog.findMany({
      where: {
        actionType: 'deduct',
        releaseAt:  { lte: now },
        note:       { not: { contains: '[released]' } }
      }
    })

    if (dueReserveLogs.length === 0) {
      return reply.send({ success: true, message: '没有到期储备金', count: 0 })
    }

    // 按创作者分组
    const creatorReleaseMap = {}
    for (const log of dueReserveLogs) {
      if (!creatorReleaseMap[log.creatorId]) creatorReleaseMap[log.creatorId] = []
      creatorReleaseMap[log.creatorId].push(log)
    }

    await fastify.prisma.$transaction(async (tx) => {
      for (const [creatorId, logs] of Object.entries(creatorReleaseMap)) {
        const totalRelease = logs.reduce((sum, l) => sum + l.amount, 0)

        const reserve = await tx.creatorReserve.findUnique({ where: { creatorId } })
        const newReleasable = Math.max(0, (reserve?.releasableAmount ?? 0) - totalRelease)
        const newReleased   = (reserve?.releasedAmount ?? 0) + totalRelease

        await tx.creatorReserve.update({
          where: { creatorId },
          data: {
            releasableAmount: newReleasable,
            releasedAmount:   newReleased
          }
        })

        await tx.reserveLog.create({
          data: {
            creatorId,
            actionType:  'release',
            amount:      totalRelease,
            balanceAfter: newReleasable,
            note:        `释放 ${logs.length} 笔储备金`
          }
        })

        // 标记原始 deduct 记录已处理
        await tx.reserveLog.updateMany({
          where: { id: { in: logs.map(l => l.id) } },
          data:  { note: '[released]' }
        })

        // 将释放金额打入可提现余额
        await tx.balance.upsert({
          where: { creatorId },
          create: {
            creatorId,
            pendingAmount:   0,
            availableAmount: totalRelease,
            withdrawnAmount: 0
          },
          update: {
            availableAmount: { increment: totalRelease }
          }
        })
      }
    })

    const totalAmount = dueReserveLogs.reduce((sum, l) => sum + l.amount, 0)

    return reply.send({
      success: true,
      message: `已释放 ${dueReserveLogs.length} 笔储备金，涉及 ${Object.keys(creatorReleaseMap).length} 位创作者，合计 ¥${totalAmount.toFixed(2)}`,
      count: dueReserveLogs.length
    })
  })

  // ═══════════════════════════════════════════════════════════
  // 管理员接口（role >= 2）
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/admin/settlement/pending
  // 查询所有待结算汇总，按创作者分组
  // ─────────────────────────────────────────
  fastify.get('/admin/pending', {
    preHandler: fastify.requireRole(2)
  }, async (request, reply) => {
    const { week } = request.query
    const targetWeek = week || getCurrentWeek()

    // 所有状态为 available、尚未结算的订单
    const orders = await fastify.prisma.collabOrder.findMany({
      where: {
        revenueStatus:    'available',
        settlementStatus: 'pending'
      },
      include: {
        collabWork: { select: { title: true } }
      }
    })

    // 按创作者分组汇总
    const creatorMap = {}
    for (const order of orders) {
      const cid = order.creatorId
      if (!creatorMap[cid]) {
        creatorMap[cid] = {
          creatorId:      cid,
          orderCount:     0,
          totalRevenue:   0,
          reserveDeducted: 0,
          payoutAmount:   0,
          orders:         []
        }
      }
      creatorMap[cid].orderCount++
      creatorMap[cid].totalRevenue    += order.revenueAmount
      creatorMap[cid].reserveDeducted += order.reserveAmount
      creatorMap[cid].payoutAmount    += order.payoutAmount
      creatorMap[cid].orders.push({
        id:            order.id,
        orderId:       order.orderId,
        workTitle:     order.collabWork?.title || '未知作品',
        salePrice:     order.salePrice,
        revenueRate:   order.revenueRate,
        revenueAmount: order.revenueAmount,
        reserveAmount: order.reserveAmount,
        payoutAmount:  order.payoutAmount,
        createdAt:     order.createdAt
      })
    }

    // 带出创作者昵称和头像
    const creatorIds = Object.keys(creatorMap)
    if (creatorIds.length > 0) {
      const profiles = await fastify.prisma.userProfile.findMany({
        where:  { userId: { in: creatorIds } },
        select: { userId: true, nickname: true, avatarUrl: true }
      })
      for (const p of profiles) {
        if (creatorMap[p.userId]) {
          creatorMap[p.userId].nickname  = p.nickname
          creatorMap[p.userId].avatarUrl = p.avatarUrl
        }
      }
    }

    const list = Object.values(creatorMap).sort((a, b) => b.payoutAmount - a.payoutAmount)

    return reply.send({
      success: true,
      data: {
        week:         targetWeek,
        creatorCount: list.length,
        totalPayout:  list.reduce((s, c) => s + c.payoutAmount, 0),
        list
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/admin/settlement/settle
  // 确认打款：对指定创作者结算
  // body: { creatorId, week?, note? }
  // ─────────────────────────────────────────
  fastify.post('/admin/settle', {
    preHandler: fastify.requireRole(2),
    schema: {
      body: {
        type: 'object',
        required: ['creatorId'],
        properties: {
          creatorId: { type: 'string' },
          week:      { type: 'string' },
          note:      { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { creatorId, note } = request.body
    const week    = request.body.week || getCurrentWeek()
    const adminId = request.user.userId

    // 防止重复结算
    const existing = await fastify.prisma.settlementRecord.findUnique({
      where: { settlementWeek_creatorId: { settlementWeek: week, creatorId } }
    })
    if (existing?.status === 'paid') {
      return reply.code(400).send({ success: false, message: `${week} 该创作者已结算完毕` })
    }

    // 找出所有可结算订单
    const orders = await fastify.prisma.collabOrder.findMany({
      where: {
        creatorId,
        revenueStatus:    'available',
        settlementStatus: 'pending'
      }
    })

    if (orders.length === 0) {
      return reply.code(400).send({ success: false, message: '该创作者暂无可结算订单' })
    }

    const totalRevenue    = orders.reduce((s, o) => s + o.revenueAmount, 0)
    const reserveDeducted = orders.reduce((s, o) => s + o.reserveAmount, 0)
    const payoutAmount    = orders.reduce((s, o) => s + o.payoutAmount,  0)

    await fastify.prisma.$transaction(async (tx) => {
      // 1. 订单状态 → settled
      await tx.collabOrder.updateMany({
        where: { id: { in: orders.map(o => o.id) } },
        data: {
          revenueStatus:    'withdrawn',
          settlementStatus: 'settled',
          settlementWeek:   week,
          settledAt:        new Date()
        }
      })

      // 2. 写或更新结算凭证
      await tx.settlementRecord.upsert({
        where: { settlementWeek_creatorId: { settlementWeek: week, creatorId } },
        create: {
          settlementWeek:  week,
          creatorId,
          orderCount:      orders.length,
          totalRevenue,
          reserveDeducted,
          payoutAmount,
          status:    'paid',
          settledBy: adminId,
          settledAt: new Date(),
          note:      note || null
        },
        update: {
          orderCount:      orders.length,
          totalRevenue,
          reserveDeducted,
          payoutAmount,
          status:    'paid',
          settledBy: adminId,
          settledAt: new Date(),
          note:      note || null
        }
      })

      // 3. Balance：扣减 availableAmount，累加 withdrawnAmount
      await tx.balance.update({
        where: { creatorId },
        data: {
          availableAmount: { decrement: payoutAmount },
          withdrawnAmount: { increment: payoutAmount }
        }
      })
    })

    await fastify.prisma.operationLog.create({
      data: {
        userId:   adminId,
        userRole: request.user.role,
        method:   'POST',
        path:     '/api/admin/settlement/settle',
        action:   'SETTLEMENT_PAID',
        targetId: creatorId,
        after:    JSON.stringify({ week, payoutAmount, orderCount: orders.length }),
        ip:       request.ip
      }
    })

    return reply.send({
      success: true,
      message: `结算成功，共 ${orders.length} 笔，实际打款 ¥${payoutAmount.toFixed(2)}`,
      data: { week, creatorId, orderCount: orders.length, totalRevenue, reserveDeducted, payoutAmount }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/admin/settlement/history
  // 历史结算记录，支持按创作者/结算周筛选
  // ─────────────────────────────────────────
  fastify.get('/admin/history', {
    preHandler: fastify.requireRole(2)
  }, async (request, reply) => {
    const { creatorId, week, page = 1, pageSize = 20 } = request.query
    const skip = (Number(page) - 1) * Number(pageSize)

    const where = { status: 'paid' }
    if (creatorId) where.creatorId = creatorId
    if (week)      where.settlementWeek = week

    const [total, records] = await Promise.all([
      fastify.prisma.settlementRecord.count({ where }),
      fastify.prisma.settlementRecord.findMany({
        where,
        orderBy: { settledAt: 'desc' },
        skip,
        take: Number(pageSize),
        include: {
          creator: {
            select: { profile: { select: { nickname: true, avatarUrl: true } } }
          },
          settledByUser: {
            select: { profile: { select: { nickname: true } } }
          }
        }
      })
    ])

    return reply.send({
      success: true,
      data: {
        total,
        page:     Number(page),
        pageSize: Number(pageSize),
        list: records.map(r => ({
          id:              r.id,
          settlementWeek:  r.settlementWeek,
          creatorId:       r.creatorId,
          nickname:        r.creator?.profile?.nickname   || '未知',
          avatarUrl:       r.creator?.profile?.avatarUrl  || null,
          orderCount:      r.orderCount,
          totalRevenue:    r.totalRevenue,
          reserveDeducted: r.reserveDeducted,
          payoutAmount:    r.payoutAmount,
          status:          r.status,
          settledBy:       r.settledByUser?.profile?.nickname || '未知管理员',
          settledAt:       r.settledAt,
          note:            r.note
        }))
      }
    })
  })

  // ═══════════════════════════════════════════════════════════
  // 创作者接口（certifyStatus = 2）
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/creator/settlement/summary
  // 收益总览：各状态金额 + 储备金 + 钱包余额
  // ─────────────────────────────────────────
  fastify.get('/creator/summary', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user

    if (request.user.certifyStatus < 2) {
      return reply.code(403).send({ success: false, message: '需要完成创作者认证' })
    }

    const [estimated, cooling, available, withdrawn, reserve, balance, nextCooling] = await Promise.all([
      fastify.prisma.collabOrder.aggregate({
        where: { creatorId: userId, revenueStatus: 'estimated' },
        _sum:  { revenueAmount: true }
      }),
      fastify.prisma.collabOrder.aggregate({
        where: { creatorId: userId, revenueStatus: 'cooling' },
        _sum:  { revenueAmount: true }
      }),
      fastify.prisma.collabOrder.aggregate({
        where: { creatorId: userId, revenueStatus: 'available' },
        _sum:  { payoutAmount: true }
      }),
      fastify.prisma.collabOrder.aggregate({
        where: { creatorId: userId, revenueStatus: 'withdrawn' },
        _sum:  { payoutAmount: true }
      }),
      fastify.prisma.creatorReserve.findUnique({ where: { creatorId: userId } }),
      fastify.prisma.balance.findUnique({ where: { creatorId: userId } }),
      fastify.prisma.collabOrder.findFirst({
        where:   { creatorId: userId, revenueStatus: 'cooling' },
        orderBy: { coolingEndAt: 'asc' },
        select:  { coolingEndAt: true }
      })
    ])

    return reply.send({
      success: true,
      data: {
        estimatedAmount:  estimated._sum.revenueAmount || 0,   // 预估中（订单未收货）
        coolingAmount:    cooling._sum.revenueAmount   || 0,   // 冷却中（等15天）
        availableAmount:  available._sum.payoutAmount  || 0,   // 可结算
        withdrawnAmount:  withdrawn._sum.payoutAmount  || 0,   // 已提现累计
        nextCoolingEndAt: nextCooling?.coolingEndAt    || null, // 最近一笔解冻时间

        reserve: {
          releasableAmount:  reserve?.releasableAmount  || 0,
          frozenAmount:      reserve?.frozenAmount      || 0,
          nextReleaseAt:     reserve?.nextReleaseAt     || null,
          nextReleaseAmount: reserve?.nextReleaseAmount || 0
        },

        walletBalance: balance?.availableAmount || 0
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/creator/settlement/detail
  // 分红明细列表，支持按状态筛选和分页
  // ─────────────────────────────────────────
  fastify.get('/creator/detail', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user

    if (request.user.certifyStatus < 2) {
      return reply.code(403).send({ success: false, message: '需要完成创作者认证' })
    }

    const { status, page = 1, pageSize = 20 } = request.query
    const skip  = (Number(page) - 1) * Number(pageSize)
    const where = { creatorId: userId }
    if (status) where.revenueStatus = status

    const [total, orders] = await Promise.all([
      fastify.prisma.collabOrder.count({ where }),
      fastify.prisma.collabOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(pageSize),
        include: {
          collabWork: { select: { title: true, coverUrl: true } }
        }
      })
    ])

    return reply.send({
      success: true,
      data: {
        total,
        page:     Number(page),
        pageSize: Number(pageSize),
        list: orders.map(o => ({
          id:             o.id,
          orderId:        o.orderId,
          workTitle:      o.collabWork?.title    || '未知作品',
          workCover:      o.collabWork?.coverUrl || null,
          salePrice:      o.salePrice,
          revenueRate:    o.revenueRate,
          revenueAmount:  o.revenueAmount,   // 分红总额
          reserveRate:    o.reserveRate,
          reserveAmount:  o.reserveAmount,   // 储备金扣除
          payoutAmount:   o.payoutAmount,    // 实际到账
          revenueStatus:  o.revenueStatus,
          coolingEndAt:   o.coolingEndAt,
          settlementWeek: o.settlementWeek,
          settledAt:      o.settledAt,
          createdAt:      o.createdAt
        }))
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/creator/settlement/reserve
  // 储备金详情：余额 + 变动流水
  // ─────────────────────────────────────────
  fastify.get('/creator/reserve', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user

    if (request.user.certifyStatus < 2) {
      return reply.code(403).send({ success: false, message: '需要完成创作者认证' })
    }

    const { page = 1, pageSize = 20 } = request.query
    const skip = (Number(page) - 1) * Number(pageSize)

    const [reserve, total, logs] = await Promise.all([
      fastify.prisma.creatorReserve.findUnique({ where: { creatorId: userId } }),
      fastify.prisma.reserveLog.count({ where: { creatorId: userId } }),
      fastify.prisma.reserveLog.findMany({
        where:   { creatorId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(pageSize)
      })
    ])

    return reply.send({
      success: true,
      data: {
        reserve: {
          totalReserved:     reserve?.totalReserved     || 0,
          releasableAmount:  reserve?.releasableAmount  || 0,
          frozenAmount:      reserve?.frozenAmount      || 0,
          releasedAmount:    reserve?.releasedAmount    || 0,
          nextReleaseAt:     reserve?.nextReleaseAt     || null,
          nextReleaseAmount: reserve?.nextReleaseAmount || 0
        },
        logs: {
          total,
          page:     Number(page),
          pageSize: Number(pageSize),
          list: logs.map(l => ({
            id:           l.id,
            actionType:   l.actionType,
            amount:       l.amount,
            balanceAfter: l.balanceAfter,
            releaseAt:    l.releaseAt,
            note:         l.note,
            createdAt:    l.createdAt
          }))
        }
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/creator/settlement/withdraw
  // 创作者发起提现申请
  // 阶段1：写记录 + 冻结余额，灵活用工 API 占位
  // ─────────────────────────────────────────
  fastify.post('/creator/withdraw', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'method', 'accountName', 'accountNumber'],
        properties: {
          amount:        { type: 'number', minimum: 1 },
          method:        { type: 'string', enum: ['alipay', 'bankcard'] },
          accountName:   { type: 'string', maxLength: 50 },
          accountNumber: { type: 'string', maxLength: 100 },
          bankName:      { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user

    if (request.user.certifyStatus < 2) {
      return reply.code(403).send({ success: false, message: '需要完成创作者认证' })
    }

    const { amount, method, accountName, accountNumber, bankName } = request.body

    if (method === 'bankcard' && !bankName) {
      return reply.code(400).send({ success: false, message: '银行卡提现需填写开户行' })
    }

    // 验证余额
    const balance = await fastify.prisma.balance.findUnique({ where: { creatorId: userId } })
    const available = Number(balance?.availableAmount || 0)
    if (available < amount) {
      return reply.code(400).send({
        success: false,
        message: `可提现余额不足，当前余额 ¥${available.toFixed(2)}`
      })
    }

    // 防止重复提交
    const pending = await fastify.prisma.withdrawalRequest.findFirst({
      where: { creatorId: userId, status: 'pending' }
    })
    if (pending) {
      return reply.code(400).send({ success: false, message: '您有一笔提现正在处理中，请勿重复提交' })
    }

    const withdrawal = await fastify.prisma.$transaction(async (tx) => {
      const record = await tx.withdrawalRequest.create({
        data: {
          creatorId: userId,
          amount,
          method,
          accountName,
          accountNumber,
          bankName: bankName || null,
          status:   'pending'
        }
      })

      // 冻结余额（从 availableAmount 移出）
      await tx.balance.update({
        where: { creatorId: userId },
        data:  { availableAmount: { decrement: amount } }
      })

      return record
    })

    // ── 灵活用工平台 API 占位 ──────────────────────────────────
    // TODO: 选定平台后在此处实现
    //
    // 需要做的事：
    //   1. 查询创作者实名信息（来自 CertifyApplication）
    //   2. 生成"任务完成单"：任务描述 = "联名动画机内容创作"，金额 = amount
    //   3. 调用平台 API 下发，拿到任务单号写回 withdrawal.note
    //   4. 平台异步回调时：status → 'approved'，balance.withdrawnAmount += amount
    //
    // const taskResult = await callFlexPlatformAPI({ withdrawalId: withdrawal.id, ... })
    // ──────────────────────────────────────────────────────────

    await fastify.prisma.operationLog.create({
      data: {
        userId,
        userRole: request.user.role,
        method:   'POST',
        path:     '/api/creator/settlement/withdraw',
        action:   'WITHDRAW_REQUEST',
        targetId: withdrawal.id,
        after:    JSON.stringify({ amount, method }),
        ip:       request.ip
      }
    })

    return reply.send({
      success: true,
      message: '提现申请已提交，预计 1-3 个工作日到账',
      data: {
        withdrawalId: withdrawal.id,
        amount,
        status: 'pending'
      }
    })
  })
}
