// src/routes/earnings.js
// 收益与提现相关接口：收益明细、账户余额、申请提现、提现记录

export default async function earningRoutes(fastify) {

  // 验证是否为认证创作者的中间件
  async function requireCreator(request, reply) {
    await fastify.authenticate(request, reply)
    if (request.user.certifyStatus !== 2) {
      return reply.code(403).send({
        success: false,
        message: '需要创作者认证才能使用此功能'
      })
    }
  }

  // ─────────────────────────────────────────
  // GET /api/earnings/balance 查看账户余额
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 返回三个余额数字：待结算、可提现、累计已提现
  fastify.get('/balance', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user

    const balance = await fastify.prisma.balance.findUnique({
      where: { creatorId: userId }
    })

    // 如果还没有余额记录（新创作者还没有订单），返回全零
    if (!balance) {
      return reply.send({
        success: true,
        data: {
          pendingAmount: 0,
          availableAmount: 0,
          withdrawnAmount: 0
        }
      })
    }

    return reply.send({
      success: true,
      data: {
        pendingAmount: Number(balance.pendingAmount),
        availableAmount: Number(balance.availableAmount),
        withdrawnAmount: Number(balance.withdrawnAmount)
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/earnings 收益明细列表
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 支持按状态筛选、分页
  // 返回每笔收益的来源商品、金额、状态
  fastify.get('/', {
    preHandler: requireCreator,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
          status: {
            type: 'string',
            enum: ['pending', 'available', 'withdrawn']
          }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { page, limit, status } = request.query
    const skip = (page - 1) * limit

    const where = {
      creatorId: userId,
      ...(status ? { status } : {})
    }

    const [earnings, total] = await Promise.all([
      fastify.prisma.earning.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: {
              title: true,
              machineType: true,
              frameCount: true
            }
          }
        }
      }),
      fastify.prisma.earning.count({ where })
    ])

    // 把 Decimal 转成数字方便前端使用
    const formattedEarnings = earnings.map(e => ({
      ...e,
      grossAmount: Number(e.grossAmount),
      platformFeeRate: Number(e.platformFeeRate),
      platformFee: Number(e.platformFee),
      netAmount: Number(e.netAmount)
    }))

    return reply.send({
      success: true,
      data: {
        earnings: formattedEarnings,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/earnings/withdraw 申请提现
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 检查可提现余额是否足够
  // 提交后锁定金额，更新余额
  fastify.post('/withdraw', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'method', 'accountName', 'accountNumber'],
        properties: {
          amount: { type: 'number', minimum: 1 },
          method: { type: 'string', enum: ['alipay', 'bankcard'] },
          accountName: { type: 'string', minLength: 1, maxLength: 50 },
          accountNumber: { type: 'string', minLength: 1, maxLength: 100 },
          bankName: { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { amount, method, accountName, accountNumber, bankName } = request.body

    // 查可提现余额
    const balance = await fastify.prisma.balance.findUnique({
      where: { creatorId: userId }
    })

    if (!balance || Number(balance.availableAmount) < amount) {
      return reply.code(400).send({
        success: false,
        message: `可提现余额不足，当前可提现：¥${balance ? Number(balance.availableAmount).toFixed(2) : '0.00'}`
      })
    }

    // bankcard 必须填银行名称
    if (method === 'bankcard' && !bankName) {
      return reply.code(400).send({
        success: false,
        message: '银行卡提现请填写银行名称'
      })
    }

    // 事务：创建提现申请 + 锁定余额
    await fastify.prisma.$transaction(async (tx) => {
      await tx.withdrawalRequest.create({
        data: {
          creatorId: userId,
          amount,
          method,
          accountName,
          accountNumber,
          bankName: bankName || null,
          status: 'pending'
        }
      })

      // 可提现余额减少，等管理员打款后再增加 withdrawnAmount
      await tx.balance.update({
        where: { creatorId: userId },
        data: {
          availableAmount: { decrement: amount }
        }
      })
    })

    return reply.code(201).send({
      success: true,
      message: '提现申请已提交，预计1-3个工作日内打款'
    })
  })

  // ─────────────────────────────────────────
  // GET /api/earnings/withdrawals 提现记录列表
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 返回所有提现申请记录
  fastify.get('/withdrawals', {
    preHandler: requireCreator,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { page, limit } = request.query
    const skip = (page - 1) * limit

    const [withdrawals, total] = await Promise.all([
      fastify.prisma.withdrawalRequest.findMany({
        where: { creatorId: userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          method: true,
          accountName: true,
          // 账号只显示后四位，保护隐私
          accountNumber: true,
          status: true,
          rejectReason: true,
          createdAt: true,
          reviewedAt: true
        }
      }),
      fastify.prisma.withdrawalRequest.count({
        where: { creatorId: userId }
      })
    ])

    const formattedWithdrawals = withdrawals.map(w => ({
      ...w,
      amount: Number(w.amount),
      // 账号只显示后四位
      accountNumberMasked: w.accountNumber.slice(-4).padStart(w.accountNumber.length, '*')
    }))

    return reply.send({
      success: true,
      data: {
        withdrawals: formattedWithdrawals,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })
}