// src/routes/users.js
// 用户相关接口：查看他人主页、关注/取消关注

export default async function userRoutes(fastify) {

  // ─────────────────────────────────────────
  // GET /api/users/:id 查看他人主页
  // ─────────────────────────────────────────
  // 不需要登录
  // 返回用户公开信息，如果是创作者额外返回创作者信息
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params

    const user = await fastify.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        certifyStatus: true,
        createdAt: true,
        profile: {
          select: {
            nickname: true,
            avatarUrl: true,
            bio: true,
            city: true,
            mbti: true,
            followerCount: true,
            followingCount: true,
            articleCount: true,
            likedCount: true
          }
        },
        creatorProfile: {
          select: {
            styleTags: true,
            weiboUrl: true,
            xiaohongshuUrl: true,
            bilibiliUrl: true,
            totalSales: true,
            productCount: true
          }
        }
      }
    })

    if (!user) {
      return reply.code(404).send({ success: false, message: '用户不存在' })
    }

    return reply.send({ success: true, data: user })
  })

  // ─────────────────────────────────────────
  // GET /api/users/:id/articles 查看他人发布的文章
  // ─────────────────────────────────────────
  // 不需要登录，只返回 published 状态的文章
  fastify.get('/:id/articles', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 12 }
        }
      }
    }
  }, async (request, reply) => {
    const { id: userId } = request.params
    const { page, limit } = request.query
    const skip = (page - 1) * limit

    const [articles, total] = await Promise.all([
      fastify.prisma.article.findMany({
        where: { userId, status: 'published' },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          coverUrl: true,
          tags: true,
          likeCount: true,
          collectCount: true,
          commentCount: true,
          createdAt: true
        }
      }),
      fastify.prisma.article.count({
        where: { userId, status: 'published' }
      })
    ])

    return reply.send({
      success: true,
      data: {
        articles,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/users/:id/follow 关注/取消关注
  // ─────────────────────────────────────────
  // 需要登录
  // 已关注则取消，未关注则关注（切换逻辑）
  // 不能关注自己
  // 同时更新双方的 follower_count 和 following_count
  fastify.post('/:id/follow', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId: followerId } = request.user
    const { id: followingId } = request.params

    // 不能关注自己
    if (followerId === followingId) {
      return reply.code(400).send({ success: false, message: '不能关注自己' })
    }

    // 确认被关注的用户存在
    const targetUser = await fastify.prisma.user.findUnique({
      where: { id: followingId }
    })
    if (!targetUser) {
      return reply.code(404).send({ success: false, message: '用户不存在' })
    }

    // 查是否已关注
    const existing = await fastify.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId }
      }
    })

    if (existing) {
      // 已关注 → 取消关注
      await fastify.prisma.$transaction(async (tx) => {
        await tx.follow.delete({ where: { id: existing.id } })
        // 我的关注数 -1
        await tx.userProfile.update({
          where: { userId: followerId },
          data: { followingCount: { decrement: 1 } }
        })
        // 对方粉丝数 -1
        await tx.userProfile.update({
          where: { userId: followingId },
          data: { followerCount: { decrement: 1 } }
        })
      })
      return reply.send({ success: true, following: false, message: '已取消关注' })
    } else {
      // 未关注 → 关注
      await fastify.prisma.$transaction(async (tx) => {
        await tx.follow.create({ data: { followerId, followingId } })
        // 我的关注数 +1
        await tx.userProfile.update({
          where: { userId: followerId },
          data: { followingCount: { increment: 1 } }
        })
        // 对方粉丝数 +1
        await tx.userProfile.update({
          where: { userId: followingId },
          data: { followerCount: { increment: 1 } }
        })
      })
      return reply.send({ success: true, following: true, message: '关注成功' })
    }
  })

  // ─────────────────────────────────────────
  // GET /api/users/:id/follow-status 查询是否已关注某人
  // ─────────────────────────────────────────
  // 需要登录
  // 前端打开他人主页时用来决定「关注」按钮显示已关注还是未关注
  fastify.get('/:id/follow-status', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId: followerId } = request.user
    const { id: followingId } = request.params

    const existing = await fastify.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId }
      }
    })

    return reply.send({
      success: true,
      data: { following: !!existing }
    })
  })
}