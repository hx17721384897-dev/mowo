// src/routes/certify.js
// 创作者认证相关接口：提交申请、查看状态

export default async function certifyRoutes(fastify) {

  // ─────────────────────────────────────────
  // POST /api/certify 提交认证申请
  // ─────────────────────────────────────────
  // 需要登录
  // 已经是创作者（certifyStatus=2）不能重复申请
  // 审核中（certifyStatus=1）不能重复申请
  // 提交后 users.certify_status 改为 1（审核中）
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: [
          'creatorName',
          'creatorType',
          'realName',
          'idNumberLast4',
          'certifyPassed',
          'copyrightConfirmed',
          'agreementConfirmed'
        ],
        properties: {
          creatorName: { type: 'string', minLength: 1, maxLength: 100 },
          creatorType: { type: 'string', enum: ['personal', 'studio', 'brand'] },
          mainStyle: { type: 'array', items: { type: 'string' } },
          portfolioUrls: { type: 'array', items: { type: 'string' } },
          realName: { type: 'string', minLength: 1, maxLength: 50 },
          idNumberLast4: { type: 'string', minLength: 4, maxLength: 4 },
          certifyPassed: { type: 'boolean' },
          copyrightConfirmed: { type: 'boolean' },
          agreementConfirmed: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const {
      creatorName, creatorType, mainStyle, portfolioUrls,
      realName, idNumberLast4, certifyPassed,
      copyrightConfirmed, agreementConfirmed
    } = request.body

    // 查当前认证状态
    const user = await fastify.prisma.user.findUnique({ where: { id: userId } })

    if (user.certifyStatus === 2) {
      return reply.code(400).send({ success: false, message: '您已经是认证创作者' })
    }
    if (user.certifyStatus === 1) {
      return reply.code(400).send({ success: false, message: '您的申请正在审核中，请耐心等待' })
    }

    // 第三方实名核验必须通过才能提交
    if (!certifyPassed) {
      return reply.code(400).send({ success: false, message: '实名认证未通过，无法提交申请' })
    }
    if (!copyrightConfirmed || !agreementConfirmed) {
      return reply.code(400).send({ success: false, message: '请确认版权声明和创作者协议' })
    }

    // 事务：创建申请记录 + 更新用户认证状态为审核中
    await fastify.prisma.$transaction(async (tx) => {
      await tx.certifyApplication.create({
        data: {
          userId,
          creatorName,
          creatorType,
          mainStyle: mainStyle ? JSON.stringify(mainStyle) : null,
          portfolioUrls: portfolioUrls ? JSON.stringify(portfolioUrls) : null,
          realName,
          idNumberLast4,
          certifyPassed,
          copyrightConfirmed,
          agreementConfirmed,
          status: 'pending'
        }
      })

      await tx.user.update({
        where: { id: userId },
        data: { certifyStatus: 1 }
      })
    })

    return reply.code(201).send({
      success: true,
      message: '认证申请已提交，预计1-3个工作日内审核完成'
    })
  })

  // ─────────────────────────────────────────
  // GET /api/certify/status 查看认证状态
  // ─────────────────────────────────────────
  // 需要登录
  // 返回当前认证状态和最新一次申请记录
  fastify.get('/status', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { certifyStatus: true }
    })

    // 查最新一次申请记录
    const latestApplication = await fastify.prisma.certifyApplication.findFirst({
      where: { userId },
      orderBy: { appliedAt: 'desc' },
      select: {
        status: true,
        rejectReason: true,
        appliedAt: true,
        reviewedAt: true
      }
    })

    const statusText = {
      0: '未申请',
      1: '审核中',
      2: '已通过',
      3: '已拒绝'
    }

    return reply.send({
      success: true,
      data: {
        certifyStatus: user.certifyStatus,
        statusText: statusText[user.certifyStatus],
        latestApplication
      }
    })
  })

  // ─────────────────────────────────────────
  // PUT /api/certify/review/:applicationId 管理员审核认证申请
  // ─────────────────────────────────────────
  // 需要管理员权限（role >= 2）
  // status: 'approved' | 'rejected'
  // rejectReason: 拒绝原因（拒绝时必填）
  fastify.put('/review/:applicationId', {
    preHandler: fastify.requireRole(2),
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['approved', 'rejected'] },
          rejectReason: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { applicationId } = request.params
    const { status, rejectReason } = request.body

    if (status === 'rejected' && !rejectReason) {
      return reply.code(400).send({ success: false, message: '拒绝时必须填写拒绝原因' })
    }

    const application = await fastify.prisma.certifyApplication.findUnique({
      where: { id: applicationId }
    })
    if (!application) {
      return reply.code(404).send({ success: false, message: '申请记录不存在' })
    }
    if (application.status !== 'pending') {
      return reply.code(400).send({ success: false, message: '该申请已审核，不能重复操作' })
    }

    const userId = application.userId

    await fastify.prisma.$transaction(async (tx) => {
      // 更新申请记录状态
      await tx.certifyApplication.update({
        where: { id: applicationId },
        data: {
          status,
          rejectReason: rejectReason || null,
          reviewedAt: new Date()
        }
      })

      if (status === 'approved') {
        // 审核通过：更新用户认证状态
        await tx.user.update({
          where: { id: userId },
          data: { certifyStatus: 2 }
        })

        // 创建 creator_profile（如果还没有）
        const existingProfile = await tx.creatorProfile.findUnique({
          where: { userId }
        })
        if (!existingProfile) {
          await tx.creatorProfile.create({
            data: {
              userId,
              bullLevel:       1,
              bullScore:       0,
              bullCoefficient: 1.0,
              isExclusive:     false
            }
          })
        }

        // 创建 creator_reserve（储备金账户，如果还没有）
        const existingReserve = await tx.creatorReserve.findUnique({
          where: { creatorId: userId }
        })
        if (!existingReserve) {
          await tx.creatorReserve.create({
            data: {
              creatorId:        userId,
              totalReserved:    0,
              frozenAmount:     0,
              releasableAmount: 0,
              releasedAmount:   0,
              nextReleaseAmount: 0
            }
          })
        }

        // 写牛量等级初始化记录
        await tx.bullScoreLog.create({
          data: {
            creatorId:   userId,
            changeType:  'init',
            levelBefore: 1,
            levelAfter:  1,
            scoreBefore: 0,
            scoreAfter:  0,
            reason:      '创作者认证通过，初始化牛量等级'
          }
        })
      } else {
        // 审核拒绝：更新用户认证状态为已拒绝
        await tx.user.update({
          where: { id: userId },
          data: { certifyStatus: 3 }
        })
      }
    })

    return reply.send({
      success: true,
      message: status === 'approved' ? '审核已通过，创作者账户初始化完成' : '审核已拒绝'
    })
  })
}