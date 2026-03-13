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
}