// src/routes/settlement.js
// 分红结算系统：管理端结算操作 + 创作者收益查询
//
// 路由清单：
//   管理端（role >= 2）：
//     GET  /api/admin/settlement/pending       待结算汇总（按创作者分组）
//     GET  /api/admin/settlement/history       历史结算记录
//     POST /api/admin/settlement/settle        确认打款
//
//   创作者端（certifyStatus = 2）：
//     GET  /api/creator/settlement/summary     收益总览
//     GET  /api/creator/settlement/orders      联名分红明细列表
//     GET  /api/creator/settlement/reserve     储备金状态 + 流水

export default async function settlementRoutes(fastify) {

  const requireAdmin = fastify.requireRole(2)

  async function requireCreator(request, reply) {
    await fastify.authenticate(request, reply)
    if (request.user.certifyStatus !== 2) {
      return reply.code(403).send({
        success: false,
        message: '需要创作者认证才能使用此功能'
      })
    }
  }

  // 计算 ISO 周号，格式 2026-W14
  function getISOWeek(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  }

  // ══════════════════════════════════════════
  // 管理端接口
  // ══════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/admin/settlement/pending
  // 待结算汇总：revenueStatus=available 且 settlementStatus=pending
  // 按创作者分组，展示每人应收金额
  // ─────────────────────────────────────────
  fastify.get('/admin/settlement/pending', {
    preHandler: requireAdmin
  }, async (request, reply) => {

    const orders = await fastify.prisma.collabOrder.findMany({
      where: {
        revenueStatus: 'available',
        settlementStatus: 'pending'
      },
      include: {
        collabWork: { select: { title: true } }
      },
      orderBy: { createdAt: 'asc' }
    })

    if (orders.length === 0) {
      return reply.send({
        success: true,
        data: { creators: [], totalPayout: 0, orderCount: 0, currentWeek: getISOWeek() }
      })
    }

    // 按 creatorId 分组
    const grouped = {}
    for (const o of orders) {
      if (!grouped[o.creatorId]) {
        grouped[o.creatorId] = {
          creatorId:    o.creatorId,
          orderCount:   0,
          totalRevenue: 0,
          totalReserve: 0,
          totalPayout:  0,
          orders:       []
        }
      }
      const g = grouped[o.creatorId]
      g.orderCount++
      g.totalRevenue += o.revenueAmount
      g.totalReserve += o.reserveAmount
      g.totalPayout  += o.payoutAmount
      g.orders.push({
        id:            o.id,
        orderId:       o.orderId,
        workTitle:     o.collabWork?.title ?? '-',
        salePrice:     o.salePrice,
        revenueRate:   o.revenueRate,
        revenueAmount: o.revenueAmount,
        reserveAmount: o.reserveAmount,
        payoutAmount:  o.payoutAmount,
        coolingEndAt:  o.coolingEndAt,
        createdAt:     o.createdAt
      })
    }

    // 批量拉创作者昵称
    const creatorIds = Object.keys(grouped)
    const profiles = await fastify.prisma.userProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, nickname: true, avatarUrl: true }
    })
    const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]))

    const creators = creatorIds.map(id => {
      const g = grouped[id]
      const p = profileMap[id] || {}
      return {
        ...g,
        nickname:     p.nickname  || '未设置昵称',
        avatarUrl:    p.avatarUrl || null,
        totalRevenue: +g.totalRevenue.toFixed(2),
        totalReserve: +g.totalReserve.toFixed(2),
        totalPayout:  +g.totalPayout.toFixed(2)
      }
    })

    return reply.send({
      success: true,
      data: {
        creators,
        totalPayout:  +creators.reduce((s, c) => s + c.totalPayout, 0).toFixed(2),
        orderCount:   creators.reduce((s, c) => s + c.orderCount, 0),
        currentWeek:  getISOWeek()
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/admin/settlement/history
  // 历史结算记录，支持按创作者/周/状态筛选
  // ─────────────────────────────────────────
  fastify.get('/admin/settlement/history', {
    preHandler: requireAdmin,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:           { type: 'integer', minimum: 1, default: 1 },
          limit:          { type: 'integer', minimum: 1, maximum: 500, default: 20 },
          creatorId:      { type: 'string' },
          settlementWeek: { type: 'string' },
          status:         { type: 'string', enum: ['pending', 'paid', 'failed'] }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, creatorId, settlementWeek, status } = request.query
    const skip = (page - 1) * limit

    const where = {
      ...(creatorId      ? { creatorId }      : {}),
      ...(settlementWeek ? { settlementWeek } : {}),
      ...(status         ? { status }         : {})
    }

    const [records, total] = await Promise.all([
      fastify.prisma.settlementRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            select: { profile: { select: { nickname: true, avatarUrl: true } } }
          },
          settledByUser: {
            select: { profile: { select: { nickname: true } } }
          }
        }
      }),
      fastify.prisma.settlementRecord.count({ where })
    ])

    const formatted = records.map(r => ({
      id:              r.id,
      settlementWeek:  r.settlementWeek,
      creatorId:       r.creatorId,
      nickname:        r.creator?.profile?.nickname  || '未设置昵称',
      avatarUrl:       r.creator?.profile?.avatarUrl || null,
      orderCount:      r.orderCount,
      totalRevenue:    +r.totalRevenue.toFixed(2),
      reserveDeducted: +r.reserveDeducted.toFixed(2),
      payoutAmount:    +r.payoutAmount.toFixed(2),
      status:          r.status,
      settledBy:       r.settledByUser?.profile?.nickname || null,
      settledAt:       r.settledAt,
      note:            r.note,
      createdAt:       r.createdAt
    }))

    return reply.send({
      success: true,
      data: {
        records: formatted,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/admin/settlement/settle
  // 确认打款：对某创作者的所有 available 订单一次性结算
  //
  // 事务步骤：
  //   1. 写/更新 settlement_records 凭证（paid）
  //   2. 将该批 collab_orders 标记 settlementStatus=settled
  //   3. payoutAmount 累加进 balances.availableAmount
  // ─────────────────────────────────────────
  fastify.post('/admin/settlement/settle', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['creatorId'],
        properties: {
          creatorId: { type: 'string' },
          note:      { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId: adminId } = request.user
    const { creatorId, note } = request.body
    const settlementWeek = getISOWeek()

    const orders = await fastify.prisma.collabOrder.findMany({
      where: {
        creatorId,
        revenueStatus:    'available',
        settlementStatus: 'pending'
      }
    })

    if (orders.length === 0) {
      return reply.code(400).send({
        success: false,
        message: '该创作者暂无可结算订单'
      })
    }

    // 防同周重复打款
    const existing = await fastify.prisma.settlementRecord.findUnique({
      where: { settlementWeek_creatorId: { settlementWeek, creatorId } }
    })
    if (existing?.status === 'paid') {
      return reply.code(400).send({
        success: false,
        message: `本周（${settlementWeek}）已完成结算，请勿重复操作`
      })
    }

    const totalRevenue    = orders.reduce((s, o) => s + o.revenueAmount, 0)
    const reserveDeducted = orders.reduce((s, o) => s + o.reserveAmount, 0)
    const payoutAmount    = orders.reduce((s, o) => s + o.payoutAmount,  0)
    const orderIds        = orders.map(o => o.id)
    const now             = new Date()

    await fastify.prisma.$transaction(async (tx) => {
      // 1. 写结算凭证
      await tx.settlementRecord.upsert({
        where:  { settlementWeek_creatorId: { settlementWeek, creatorId } },
        create: {
          settlementWeek,
          creatorId,
          orderCount:      orders.length,
          totalRevenue:    +totalRevenue.toFixed(4),
          reserveDeducted: +reserveDeducted.toFixed(4),
          payoutAmount:    +payoutAmount.toFixed(4),
          status:          'paid',
          settledBy:       adminId,
          settledAt:       now,
          note:            note || null
        },
        update: {
          orderCount:      orders.length,
          totalRevenue:    +totalRevenue.toFixed(4),
          reserveDeducted: +reserveDeducted.toFixed(4),
          payoutAmount:    +payoutAmount.toFixed(4),
          status:          'paid',
          settledBy:       adminId,
          settledAt:       now,
          note:            note || null
        }
      })

      // 2. 批量标记订单已结算
      await tx.collabOrder.updateMany({
        where: { id: { in: orderIds } },
        data: {
          settlementStatus: 'settled',
          settlementWeek,
          settledAt: now
        }
      })

      // 3. 写入创作者余额（upsert，新创作者自动建账）
      await tx.balance.upsert({
        where:  { creatorId },
        create: {
          creatorId,
          pendingAmount:   0,
          availableAmount: +payoutAmount.toFixed(4),
          withdrawnAmount: 0
        },
        update: {
          availableAmount: { increment: +payoutAmount.toFixed(4) }
        }
      })
    })

    return reply.send({
      success: true,
      message: `结算成功，已向创作者打款 ¥${payoutAmount.toFixed(2)}`,
      data: {
        settlementWeek,
        creatorId,
        orderCount:   orders.length,
        payoutAmount: +payoutAmount.toFixed(2)
      }
    })
  })

  // ══════════════════════════════════════════
  // 创作者端接口
  // ══════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/creator/settlement/summary
  // 收益总览：各状态金额 + 余额 + 储备金快照
  // 前端用：creator-dashboard.html 顶部数字卡片
  // ─────────────────────────────────────────
  fastify.get('/creator/settlement/summary', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user

    const [orderStats, balance, reserve] = await Promise.all([
      fastify.prisma.collabOrder.groupBy({
        by: ['revenueStatus'],
        where: { creatorId: userId },
        _sum:   { payoutAmount: true },
        _count: { id: true }
      }),
      fastify.prisma.balance.findUnique({ where: { creatorId: userId } }),
      fastify.prisma.creatorReserve.findUnique({ where: { creatorId: userId } })
    ])

    const statsMap = {}
    for (const s of orderStats) {
      statsMap[s.revenueStatus] = {
        amount: +(s._sum.payoutAmount || 0).toFixed(2),
        count:  s._count.id
      }
    }

    return reply.send({
      success: true,
      data: {
        estimated: statsMap['estimated'] || { amount: 0, count: 0 },
        cooling:   statsMap['cooling']   || { amount: 0, count: 0 },
        available: statsMap['available'] || { amount: 0, count: 0 },
        withdrawn: statsMap['withdrawn'] || { amount: 0, count: 0 },
        balance: {
          availableAmount: balance ? +balance.availableAmount.toFixed(2) : 0,
          withdrawnAmount: balance ? +balance.withdrawnAmount.toFixed(2) : 0
        },
        reserve: reserve ? {
          totalReserved:     +reserve.totalReserved.toFixed(2),
          releasableAmount:  +reserve.releasableAmount.toFixed(2),
          frozenAmount:      +reserve.frozenAmount.toFixed(2),
          releasedAmount:    +reserve.releasedAmount.toFixed(2),
          nextReleaseAt:     reserve.nextReleaseAt,
          nextReleaseAmount: +reserve.nextReleaseAmount.toFixed(2)
        } : {
          totalReserved: 0, releasableAmount: 0, frozenAmount: 0,
          releasedAmount: 0, nextReleaseAt: null, nextReleaseAmount: 0
        }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/creator/settlement/orders
  // 联名分红明细列表（分页 + 状态筛选）
  // 前端用：creator-earnings.html 明细表格
  // ─────────────────────────────────────────
  fastify.get('/creator/settlement/orders', {
    preHandler: requireCreator,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:          { type: 'integer', minimum: 1, default: 1 },
          limit:         { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          revenueStatus: {
            type: 'string',
            enum: ['estimated', 'cooling', 'available', 'withdrawn']
          }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { page, limit, revenueStatus } = request.query
    const skip = (page - 1) * limit

    const where = {
      creatorId: userId,
      ...(revenueStatus ? { revenueStatus } : {})
    }

    const [orders, total] = await Promise.all([
      fastify.prisma.collabOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          collabWork: { select: { title: true, coverUrl: true } }
        }
      }),
      fastify.prisma.collabOrder.count({ where })
    ])

    const formatted = orders.map(o => ({
      id:            o.id,
      orderId:       o.orderId,
      workTitle:     o.collabWork?.title    || '-',
      workCover:     o.collabWork?.coverUrl || null,
      // 公式拆解，方便前端展示「¥XX × 20% - 储备金15% = ¥XX」
      salePrice:     +o.salePrice.toFixed(2),
      revenueRate:   o.revenueRate,
      revenueAmount: +o.revenueAmount.toFixed(2),
      reserveRate:   o.reserveRate,
      reserveAmount: +o.reserveAmount.toFixed(2),
      payoutAmount:  +o.payoutAmount.toFixed(2),
      revenueStatus:  o.revenueStatus,
      coolingEndAt:   o.coolingEndAt,
      settlementWeek: o.settlementWeek,
      settledAt:      o.settledAt,
      createdAt:      o.createdAt
    }))

    return reply.send({
      success: true,
      data: {
        orders: formatted,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/creator/settlement/reserve
  // 储备金状态 + 近期变动流水
  // 前端用：creator-earnings.html 储备金区块
  // ─────────────────────────────────────────
  fastify.get('/creator/settlement/reserve', {
    preHandler: requireCreator,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { page, limit } = request.query
    const skip = (page - 1) * limit

    const [reserve, logs, total] = await Promise.all([
      fastify.prisma.creatorReserve.findUnique({ where: { creatorId: userId } }),
      fastify.prisma.reserveLog.findMany({
        where: { creatorId: userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      fastify.prisma.reserveLog.count({ where: { creatorId: userId } })
    ])

    return reply.send({
      success: true,
      data: {
        reserve: reserve ? {
          totalReserved:     +reserve.totalReserved.toFixed(2),
          releasableAmount:  +reserve.releasableAmount.toFixed(2),
          frozenAmount:      +reserve.frozenAmount.toFixed(2),
          releasedAmount:    +reserve.releasedAmount.toFixed(2),
          nextReleaseAt:     reserve.nextReleaseAt,
          nextReleaseAmount: +reserve.nextReleaseAmount.toFixed(2)
        } : null,
        logs: logs.map(l => ({
          id:           l.id,
          actionType:   l.actionType,
          // deduct / release / freeze / unfreeze / confiscate
          amount:       +l.amount.toFixed(2),
          balanceAfter: +l.balanceAfter.toFixed(2),
          releaseAt:    l.releaseAt,
          note:         l.note,
          createdAt:    l.createdAt
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })
}
