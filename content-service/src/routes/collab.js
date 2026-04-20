// src/routes/collab.js — 联名系统路由
// 公开接口 + 创作者申请

import { calcRevenueRate } from '../lib/revenue.js'

export default async function collabRoutes(fastify) {
  const { prisma } = fastify

  // ─────────────────────────────────────────────
  // 公开接口（无需登录）
  // ─────────────────────────────────────────────

  /**
   * GET /api/collab/works
   * 联名作品列表（只返回 approved 状态）
   * 查询参数：page / limit / creatorId
   */
  fastify.get('/collab/works', async (req, reply) => {
    const { page = 1, limit = 12, creatorId } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = { status: 'approved' }
    if (creatorId) where.creatorId = creatorId

    const [works, total] = await Promise.all([
      prisma.collabWork.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { approvedAt: 'desc' },
        select: {
          id: true,
          creatorId: true,
          title: true,
          description: true,
          coverUrl: true,
          supportedSkus: true,
          isNewbieWork: true,
          isExclusiveWork: true,
          approvedAt: true,
          createdAt: true,
        },
      }),
      prisma.collabWork.count({ where }),
    ])

    // 为每个作品附上创作者基础信息
    const creatorIds = [...new Set(works.map(w => w.creatorId))]
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, nickname: true, avatarUrl: true },
    })
    const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]))

    // 批量查询点赞数
    const workIds = works.map(w => w.id)
    const likeCounts = await prisma.like.groupBy({
      by: ['targetId'],
      where: { targetType: 'collab_work', targetId: { in: workIds } },
      _count: { id: true },
    })
    const likeCountMap = Object.fromEntries(likeCounts.map(l => [l.targetId, l._count.id]))

    // 若已登录，批量查询当前用户点赞状态
    let myLikedSet = new Set()
    const token = req.headers.authorization?.replace('Bearer ', '') || ''
    if (token) {
      try {
        const user = fastify.jwt.decode(token)
        fastify.jwt.verify(token)
        if (user) {
          const myLikes = await prisma.like.findMany({
            where: { userId: user.userId, targetType: 'collab_work', targetId: { in: workIds } },
            select: { targetId: true },
          })
          myLikedSet = new Set(myLikes.map(l => l.targetId))
        }
      } catch {}
    }

    const result = works.map(w => ({
      ...w,
      supportedSkus: safeJson(w.supportedSkus),
      creator: profileMap[w.creatorId] ?? { userId: w.creatorId, nickname: '创作者', avatarUrl: null },
      likeCount: likeCountMap[w.id] ?? 0,
      isLiked: myLikedSet.has(w.id),
    }))

    return reply.send({ success: true, data: { works: result, total, page: Number(page), limit: Number(limit) } })
  })

  /**
   * GET /api/collab/works/:id
   * 联名作品详情（含帧图列表，供展示动画用）
   */
  fastify.get('/collab/works/:id', async (req, reply) => {
    const work = await prisma.collabWork.findUnique({
      where: { id: req.params.id },
    })
    if (!work || work.status !== 'approved') {
      return reply.code(404).send({ success: false, message: '作品不存在' })
    }

    // 获取创作者信息
    const profile = await prisma.userProfile.findUnique({
      where: { userId: work.creatorId },
      select: { userId: true, nickname: true, avatarUrl: true },
    })

    // 获取支持的SKU详情
    const skuIds = safeJson(work.supportedSkus)
    const skus = skuIds.length
      ? await prisma.machineModelSku.findMany({
          where: { id: { in: skuIds } },
          select: { id: true, size: true, material: true, colorOptions: true },
        })
      : []

    // 帧图：生成预签名URL
    const frameKeys = safeJson(work.animationFrames)
    const frameUrls = frameKeys.map(key => fastify.ossPresignGet(key, 3600))

    // 封面图预签名
    const coverUrl = work.coverUrl ? fastify.ossPresignGet(work.coverUrl, 3600) : null

    // 点赞数 + 当前用户是否已点赞
    const likeCount = await prisma.like.count({ where: { targetType: 'collab_work', targetId: work.id } })
    let isLiked = false
    const token = req.headers.authorization?.replace('Bearer ', '') || ''
    if (token) {
      try {
        const user = fastify.jwt.decode(token)
        fastify.jwt.verify(token)
        if (user) {
          const hit = await prisma.like.findFirst({
            where: { userId: user.userId, targetType: 'collab_work', targetId: work.id },
          })
          isLiked = !!hit
        }
      } catch {}
    }

    return reply.send({
      success: true,
      data: {
        ...work,
        animationFrames: frameUrls,
        coverUrl,
        supportedSkus: skus.map(s => ({ ...s, colorOptions: safeJson(s.colorOptions) })),
        creator: profile ?? { userId: work.creatorId, nickname: '创作者', avatarUrl: null },
        likeCount,
        isLiked,
      },
    })
  })

  // ─────────────────────────────────────────────
  // 创作者接口（需登录 + certifyStatus=2）
  // ─────────────────────────────────────────────

  /**
   * GET /api/collab/my-works
   * 我的联名作品列表（含各种状态）
   */
  fastify.get('/collab/my-works', { preHandler: requireCertified }, async (req, reply) => {
    const works = await prisma.collabWork.findMany({
      where: { creatorId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({
      success: true,
      data: works.map(w => ({
        ...w,
        animationFrames: safeJson(w.animationFrames),
        supportedSkus: safeJson(w.supportedSkus),
      })),
    })
  })

  /**
   * POST /api/collab/apply
   * 申请联名
   *
   * Body:
   * {
   *   orderNo: string,         // 引用 customize_orders.orderNo，帧图来源
   *   title: string,
   *   description?: string,
   *   supportedSkus: string[], // SKU ID数组
   *   activityId?: string,     // 可选，参与活动
   *   agreementSigned: true,   // 必须为true，表示已同意授权协议
   * }
   */
  fastify.post('/collab/apply', { preHandler: requireCertified }, async (req, reply) => {
    const { orderNo, animationId, title, description, supportedSkus, activityId, agreementSigned } = req.body
    const userId = req.user.userId

    // 基础校验
    if (!title || !supportedSkus?.length) {
      return reply.code(400).send({ success: false, message: '缺少必填字段：title / supportedSkus' })
    }
    if (!orderNo && !animationId) {
      return reply.code(400).send({ success: false, message: '必须提供 animationId（动画作品）或 orderNo（定制订单）' })
    }
    if (!agreementSigned) {
      return reply.code(400).send({ success: false, message: '必须同意联名授权协议' })
    }

    let animationFramesJson, coverKey, orderNoForRecord = null

    if (animationId) {
      // 来源：创作者动画作品库（CustomProduct）
      const cp = await prisma.customProduct.findFirst({
        where: { id: animationId, userId, status: { not: 'removed' } },
      })
      if (!cp) {
        return reply.code(404).send({ success: false, message: '动画作品不存在或不属于你' })
      }
      animationFramesJson = cp.animationFrames
      const frameArr = safeJson(cp.animationFrames)
      coverKey = frameArr[0] ?? null

      // 检查该动画是否已申请过联名
      const existing = await prisma.collabWork.findFirst({
        where: { animationFrames: cp.animationFrames, creatorId: userId, status: { not: 'rejected' } },
      })
      if (existing) {
        return reply.code(400).send({ success: false, message: '该动画作品已申请过联名' })
      }
    } else {
      // 来源：已购定制订单（原有流程）
      const order = await prisma.customizeOrder.findFirst({
        where: { orderNo, userId },
      })
      if (!order) {
        return reply.code(404).send({ success: false, message: '订单不存在或不属于你' })
      }
      if (order.status === 'pending') {
        return reply.code(400).send({ success: false, message: '订单尚未完成支付，无法申请联名' })
      }
      // 检查该订单是否已申请过联名
      const existing = await prisma.collabWork.findFirst({
        where: { orderNo, creatorId: userId },
      })
      if (existing) {
        return reply.code(400).send({ success: false, message: '该订单已申请过联名' })
      }
      animationFramesJson = order.frameUrls
      const frameKeys = safeJson(order.frameUrls)
      coverKey = frameKeys[0] ?? null
      orderNoForRecord = orderNo
    }

    // 验证 SKU
    const skus = await prisma.machineModelSku.findMany({
      where: { id: { in: supportedSkus }, isActive: true },
    })
    if (skus.length !== supportedSkus.length) {
      return reply.code(400).send({ success: false, message: '部分SKU不存在或已下架' })
    }

    // 验证活动（如果传了activityId）
    if (activityId) {
      const activity = await prisma.collabActivity.findUnique({ where: { id: activityId } })
      if (!activity || !activity.isActive || new Date() > activity.endAt) {
        return reply.code(400).send({ success: false, message: '活动不存在或已结束' })
      }
    }

    // 判断是否是创作者前3款（新手期）
    const approvedCount = await prisma.collabWork.count({
      where: { creatorId: userId, status: 'approved' },
    })
    const pendingCount = await prisma.collabWork.count({
      where: { creatorId: userId, status: 'pending' },
    })
    const isNewbieWork = (approvedCount + pendingCount) < 3

    // 创建申请
    const work = await prisma.collabWork.create({
      data: {
        creatorId:        userId,
        orderNo:          orderNoForRecord,
        title,
        description:      description ?? null,
        coverUrl:         coverKey,
        animationFrames:  animationFramesJson,
        supportedSkus:    JSON.stringify(supportedSkus),
        isNewbieWork,
        newbieExpiredAt:  null,
        activityId:       activityId ?? null,
        isExclusiveWork:  false,
        status:           'pending',
        agreementSignedAt: new Date(),
        revenueRate:      0,
      },
    })

    return reply.code(201).send({ success: true, data: { id: work.id, status: 'pending' } })
  })

  // ─────────────────────────────────────────────
  // 点赞接口（需登录，普通用户即可）
  // ─────────────────────────────────────────────

  /**
   * POST /api/collab/works/:id/like
   * 切换点赞状态，返回 { liked, likeCount }
   */
  fastify.post('/collab/works/:id/like', { preHandler: requireAuth }, async (req, reply) => {
    const workId = req.params.id
    const userId = req.user.userId

    const work = await prisma.collabWork.findUnique({ where: { id: workId }, select: { id: true, status: true } })
    if (!work || work.status !== 'approved') {
      return reply.code(404).send({ success: false, message: '作品不存在' })
    }

    const existing = await prisma.like.findFirst({
      where: { userId, targetType: 'collab_work', targetId: workId },
    })

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } })
    } else {
      await prisma.like.create({ data: { userId, targetType: 'collab_work', targetId: workId } })
    }

    const likeCount = await prisma.like.count({ where: { targetType: 'collab_work', targetId: workId } })
    return reply.send({ success: true, data: { liked: !existing, likeCount } })
  })

  // ─────────────────────────────────────────────
  // 辅助函数
  // ─────────────────────────────────────────────

  function requireAuth(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      const user = fastify.jwt.decode(token)
      fastify.jwt.verify(token)
      if (!user) return reply.code(401).send({ success: false, message: '未登录' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }

  function requireCertified(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      const user = fastify.jwt.decode(token)
      fastify.jwt.verify(token)
      if (!user) return reply.code(401).send({ success: false, message: '未登录' })
      if (user.certifyStatus !== 2) {
        return reply.code(403).send({ success: false, message: '需要创作者身份' })
      }
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}

function safeJson(str) {
  try { return JSON.parse(str) } catch { return [] }
}
