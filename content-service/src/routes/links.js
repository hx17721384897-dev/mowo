// src/routes/links.js
// 引流链接系统
//
// 创作者端（certifyStatus = 2）：
//   GET  /api/creator/links/referral          专属推广链接（已有，bull.js里，这里不重复）
//   GET  /api/creator/links/social            我提交的外部视频链接列表
//   POST /api/creator/links/social            提交新的外部视频链接
//   PUT  /api/creator/links/social/:id        更新链接信息
//   DELETE /api/creator/links/social/:id      删除链接
//
// 管理端（role >= 2）：
//   GET  /api/admin/links/social              所有创作者的外部链接（分页/状态筛选）
//   GET  /api/admin/links/social/stats        统计（各状态数量）
//   PUT  /api/admin/links/social/:id/review   审核（通过/拒绝 + 填播放量点赞数 + 设加成系数）

export default async function linksRoutes(fastify) {

  const requireAdmin = fastify.requireRole(2)

  async function requireCreator(request, reply) {
    await fastify.authenticate(request, reply)
    if (request.user.certifyStatus !== 2) {
      return reply.code(403).send({ success: false, message: '需要创作者认证才能使用此功能' })
    }
  }

  const PLATFORM_LABELS = {
    bilibili:     'B站',
    xiaohongshu:  '小红书',
    weibo:        '微博',
    douyin:       '抖音',
    other:        '其他平台'
  }

  // ══════════════════════════════════════════
  // 创作者端
  // ══════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/creator/links/social
  // 我提交的外部视频链接列表
  // ─────────────────────────────────────────
  fastify.get('/creator/links/social', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user

    const links = await fastify.prisma.creatorSocialLink.findMany({
      where:   { creatorId: userId },
      orderBy: { createdAt: 'desc' }
    })

    return reply.send({
      success: true,
      data: links.map(formatSocialLink)
    })
  })

  // ─────────────────────────────────────────
  // POST /api/creator/links/social
  // 提交新的外部视频链接
  // ─────────────────────────────────────────
  fastify.post('/creator/links/social', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        required: ['platform', 'videoUrl'],
        properties: {
          platform:    { type: 'string', enum: ['bilibili','xiaohongshu','weibo','douyin','other'] },
          videoUrl:    { type: 'string', minLength: 1, maxLength: 500 },
          videoTitle:  { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { platform, videoUrl, videoTitle, description } = request.body

    // 同一创作者同一链接不能重复提交
    const existing = await fastify.prisma.creatorSocialLink.findFirst({
      where: { creatorId: userId, videoUrl }
    })
    if (existing) {
      return reply.code(400).send({ success: false, message: '该链接已提交过，请勿重复添加' })
    }

    const link = await fastify.prisma.creatorSocialLink.create({
      data: {
        creatorId:   userId,
        platform,
        videoUrl,
        videoTitle:  videoTitle || null,
        description: description || null,
        status:      'pending'
      }
    })

    return reply.code(201).send({ success: true, data: formatSocialLink(link) })
  })

  // ─────────────────────────────────────────
  // PUT /api/creator/links/social/:id
  // 更新链接（只能改 pending 状态的）
  // ─────────────────────────────────────────
  fastify.put('/creator/links/social/:id', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        properties: {
          videoTitle:  { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { id }     = request.params
    const { videoTitle, description } = request.body

    const link = await fastify.prisma.creatorSocialLink.findUnique({ where: { id } })
    if (!link || link.creatorId !== userId) {
      return reply.code(404).send({ success: false, message: '链接不存在' })
    }
    if (link.status !== 'pending') {
      return reply.code(400).send({ success: false, message: '已审核的链接不可修改，请删除后重新提交' })
    }

    const updated = await fastify.prisma.creatorSocialLink.update({
      where: { id },
      data:  { videoTitle: videoTitle || null, description: description || null }
    })

    return reply.send({ success: true, data: formatSocialLink(updated) })
  })

  // ─────────────────────────────────────────
  // DELETE /api/creator/links/social/:id
  // 删除链接
  // ─────────────────────────────────────────
  fastify.delete('/creator/links/social/:id', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user
    const { id }     = request.params

    const link = await fastify.prisma.creatorSocialLink.findUnique({ where: { id } })
    if (!link || link.creatorId !== userId) {
      return reply.code(404).send({ success: false, message: '链接不存在' })
    }

    await fastify.prisma.creatorSocialLink.delete({ where: { id } })
    return reply.send({ success: true, message: '已删除' })
  })

  // ══════════════════════════════════════════
  // 管理端
  // ══════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/admin/links/social/stats
  // 统计各状态数量
  // ─────────────────────────────────────────
  fastify.get('/admin/links/social/stats', {
    preHandler: requireAdmin
  }, async (request, reply) => {
    const [pending, approved, rejected, total] = await Promise.all([
      fastify.prisma.creatorSocialLink.count({ where: { status: 'pending'  } }),
      fastify.prisma.creatorSocialLink.count({ where: { status: 'approved' } }),
      fastify.prisma.creatorSocialLink.count({ where: { status: 'rejected' } }),
      fastify.prisma.creatorSocialLink.count()
    ])

    return reply.send({ success: true, data: { total, pending, approved, rejected } })
  })

  // ─────────────────────────────────────────
  // GET /api/admin/links/social
  // 所有链接列表，支持状态/平台/关键词筛选
  // ─────────────────────────────────────────
  fastify.get('/admin/links/social', {
    preHandler: requireAdmin,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', minimum: 1, default: 1 },
          limit:    { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          status:   { type: 'string', enum: ['pending','approved','rejected'] },
          platform: { type: 'string' },
          keyword:  { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, status, platform, keyword } = request.query
    const skip = (page - 1) * limit

    const where = {}
    if (status)   where.status   = status
    if (platform) where.platform = platform

    const [links, total] = await Promise.all([
      fastify.prisma.creatorSocialLink.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            select: {
              profile: { select: { nickname: true, avatarUrl: true } }
            }
          }
        }
      }),
      fastify.prisma.creatorSocialLink.count({ where })
    ])

    // 关键词过滤（按创作者昵称）
    let result = links
    if (keyword) {
      const kw = keyword.toLowerCase()
      result = links.filter(l =>
        l.creator?.profile?.nickname?.toLowerCase().includes(kw) ||
        l.videoTitle?.toLowerCase().includes(kw)
      )
    }

    return reply.send({
      success: true,
      data: {
        links: result.map(l => ({
          ...formatSocialLink(l),
          creatorNickname: l.creator?.profile?.nickname || '未设置昵称',
          creatorAvatar:   l.creator?.profile?.avatarUrl || null,
          platformLabel:   PLATFORM_LABELS[l.platform] || l.platform
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // PUT /api/admin/links/social/:id/review
  // 审核：通过/拒绝，填入播放量点赞数，设加成系数
  // 审核通过后同步更新对应创作者最新 bull_score 的 socialManualMod
  // ─────────────────────────────────────────
  fastify.put('/admin/links/social/:id/review', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status:         { type: 'string', enum: ['approved','rejected'] },
          brandMentioned: { type: 'boolean' },
          viewCount:      { type: 'integer', minimum: 0 },
          likeCount:      { type: 'integer', minimum: 0 },
          manualMod:      { type: 'number',  minimum: 0.5, maximum: 2.0 },
          reviewNote:     { type: 'string',  maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const { id }                                              = request.params
    const { status, brandMentioned, viewCount, likeCount, manualMod, reviewNote } = request.body
    const { userId: adminId }                                 = request.user
    const now = new Date()

    const link = await fastify.prisma.creatorSocialLink.findUnique({ where: { id } })
    if (!link) return reply.code(404).send({ success: false, message: '链接不存在' })

    await fastify.prisma.$transaction(async (tx) => {
      // 1. 更新链接审核状态
      await tx.creatorSocialLink.update({
        where: { id },
        data: {
          status,
          brandMentioned: brandMentioned ?? false,
          viewCount:      viewCount      ?? link.viewCount,
          likeCount:      likeCount      ?? link.likeCount,
          manualMod:      manualMod      ?? 1.0,
          reviewNote:     reviewNote     || null,
          reviewedBy:     adminId,
          reviewedAt:     now,
          lastFetchedAt:  now
        }
      })

      // 2. 审核通过且设了加成系数时，同步到最新 bull_score
      if (status === 'approved' && manualMod !== undefined) {
        const latestScore = await tx.bullScore.findFirst({
          where:   { creatorId: link.creatorId },
          orderBy: { scoreDate: 'desc' }
        })
        if (latestScore) {
          await tx.bullScore.update({
            where: { id: latestScore.id },
            data:  { socialManualMod: manualMod }
          })
        }
      }
    })

    return reply.send({ success: true, message: status === 'approved' ? '已通过审核' : '已拒绝' })
  })

  // ── 格式化辅助函数 ──
  function formatSocialLink(l) {
    return {
      id:            l.id,
      creatorId:     l.creatorId,
      platform:      l.platform,
      platformLabel: PLATFORM_LABELS[l.platform] || l.platform,
      videoUrl:      l.videoUrl,
      videoTitle:    l.videoTitle,
      description:   l.description,
      viewCount:     l.viewCount,
      likeCount:     l.likeCount,
      lastFetchedAt: l.lastFetchedAt,
      status:        l.status,
      brandMentioned: l.brandMentioned,
      manualMod:     l.manualMod,
      reviewNote:    l.reviewNote,
      reviewedBy:    l.reviewedBy,
      reviewedAt:    l.reviewedAt,
      createdAt:     l.createdAt,
      updatedAt:     l.updatedAt
    }
  }
}
