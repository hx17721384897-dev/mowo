// src/routes/articles.js
// 文章相关接口：发布、列表、详情、编辑、删除、点赞、收藏、评论、关注

export default async function articleRoutes(fastify) {

  // ─────────────────────────────────────────
  // POST /api/articles 发布文章
  // ─────────────────────────────────────────
  // 需要登录
  // 根据信用分决定状态：>=80 直接 published，否则 pending
  // 同时更新 user_profiles.article_count
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          content: { type: 'string', minLength: 1 },
          coverUrl: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          productIds: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { title, content, coverUrl, tags, productIds } = request.body

    // 查信用分决定文章状态
    const creditScore = await fastify.prisma.creditScore.findUnique({
      where: { userId }
    })
    const score = creditScore?.score || 100
    const status = score >= 80 ? 'published' : 'pending'

    // 事务：创建文章 + 关联商品 + 更新文章计数
    const article = await fastify.prisma.$transaction(async (tx) => {
      const newArticle = await tx.article.create({
        data: {
          userId,
          title,
          content,
          coverUrl: coverUrl || null,
          tags: tags ? JSON.stringify(tags) : null,
          status
        }
      })

      // 如果有关联商品，写入 article_products 表
      if (productIds && productIds.length > 0) {
        await tx.articleProduct.createMany({
          data: productIds.map((productId, index) => ({
            articleId: newArticle.id,
            productId,
            position: index + 1
          }))
        })
      }

      // 更新作者的文章计数
      await tx.userProfile.update({
        where: { userId },
        data: { articleCount: { increment: 1 } }
      })

      return newArticle
    })

    return reply.code(201).send({
      success: true,
      message: status === 'published' ? '文章发布成功' : '文章已提交审核',
      data: { id: article.id, status }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/articles 获取文章列表（社区页）
  // ─────────────────────────────────────────
  // 不需要登录
  // 支持标签筛选、分页
  // 只返回 published 状态的文章
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          tag: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, tag } = request.query
    const skip = (page - 1) * limit

    // 构建查询条件
    // 如果传了 tag，用 contains 做模糊匹配（tags 字段存的是 JSON 字符串）
    const where = {
      status: 'published',
      ...(tag ? { tags: { contains: tag } } : {})
    }

    // 同时查文章列表和总数，用于前端分页
    const [articles, total] = await Promise.all([
      fastify.prisma.article.findMany({
        where,
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
          viewCount: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              profile: {
                select: { nickname: true, avatarUrl: true }
              }
            }
          }
        }
      }),
      fastify.prisma.article.count({ where })
    ])

    return reply.send({
      success: true,
      data: {
        articles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/articles/:id 获取文章详情
  // ─────────────────────────────────────────
  // 不需要登录
  // 返回文章完整内容、关联商品、作者信息
  // 同时增加浏览数
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params

    const article = await fastify.prisma.article.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            certifyStatus: true,
            profile: {
              select: { nickname: true, avatarUrl: true, bio: true }
            },
            creatorProfile: {
              select: { styleTags: true }
            }
          }
        },
        articleProducts: {
          orderBy: { position: 'asc' },
          include: {
            product: {
              select: {
                id: true,
                title: true,
                machineType: true,
                finalPrice: true,
                salesCount: true
              }
            }
          }
        }
      }
    })

    if (!article || article.status === 'removed') {
      return reply.code(404).send({ success: false, message: '文章不存在' })
    }

    // 增加浏览数
    await fastify.prisma.article.update({
      where: { id },
      data: { viewCount: { increment: 1 } }
    })

    return reply.send({ success: true, data: article })
  })

  // ─────────────────────────────────────────
  // PUT /api/articles/:id 编辑文章
  // ─────────────────────────────────────────
  // 需要登录，只能编辑自己的文章
  fastify.put('/:id', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          content: { type: 'string' },
          coverUrl: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { id } = request.params
    const { title, content, coverUrl, tags } = request.body

    // 确认文章存在且属于当前用户
    const article = await fastify.prisma.article.findUnique({ where: { id } })
    if (!article) {
      return reply.code(404).send({ success: false, message: '文章不存在' })
    }
    if (article.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权编辑此文章' })
    }

    const updated = await fastify.prisma.article.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(coverUrl && { coverUrl }),
        ...(tags && { tags: JSON.stringify(tags) })
      }
    })

    return reply.send({ success: true, message: '文章更新成功', data: updated })
  })

  // ─────────────────────────────────────────
  // DELETE /api/articles/:id 删除文章
  // ─────────────────────────────────────────
  // 需要登录，只能删除自己的文章
  // 软删除，改 status 为 removed
  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user
    const { id } = request.params

    const article = await fastify.prisma.article.findUnique({ where: { id } })
    if (!article) {
      return reply.code(404).send({ success: false, message: '文章不存在' })
    }
    if (article.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权删除此文章' })
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.article.update({
        where: { id },
        data: { status: 'removed' }
      })
      // 更新文章计数
      await tx.userProfile.update({
        where: { userId },
        data: { articleCount: { decrement: 1 } }
      })
    })

    return reply.send({ success: true, message: '文章已删除' })
  })

  // ─────────────────────────────────────────
  // POST /api/articles/:id/like 点赞/取消点赞
  // ─────────────────────────────────────────
  // 需要登录
  // 已点赞则取消，未点赞则点赞（切换逻辑）
  fastify.post('/:id/like', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user
    const { id: articleId } = request.params

    // 查是否已点赞
    const existing = await fastify.prisma.like.findUnique({
      where: {
        userId_targetType_targetId: {
          userId,
          targetType: 'article',
          targetId: articleId
        }
      }
    })

    if (existing) {
      // 已点赞 → 取消
      await fastify.prisma.$transaction(async (tx) => {
        await tx.like.delete({ where: { id: existing.id } })
        await tx.article.update({
          where: { id: articleId },
          data: { likeCount: { decrement: 1 } }
        })
        // 减少作者获赞数
        const article = await tx.article.findUnique({
          where: { id: articleId },
          select: { userId: true }
        })
        await tx.userProfile.update({
          where: { userId: article.userId },
          data: { likedCount: { decrement: 1 } }
        })
      })
      return reply.send({ success: true, liked: false, message: '已取消点赞' })
    } else {
      // 未点赞 → 点赞
      await fastify.prisma.$transaction(async (tx) => {
        await tx.like.create({
          data: { userId, targetType: 'article', targetId: articleId }
        })
        await tx.article.update({
          where: { id: articleId },
          data: { likeCount: { increment: 1 } }
        })
        const article = await tx.article.findUnique({
          where: { id: articleId },
          select: { userId: true }
        })
        await tx.userProfile.update({
          where: { userId: article.userId },
          data: { likedCount: { increment: 1 } }
        })
      })
      return reply.send({ success: true, liked: true, message: '点赞成功' })
    }
  })

  // ─────────────────────────────────────────
  // POST /api/articles/:id/collect 收藏/取消收藏
  // ─────────────────────────────────────────
  // 需要登录，切换逻辑同点赞
  fastify.post('/:id/collect', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user
    const { id: articleId } = request.params

    const existing = await fastify.prisma.collect.findUnique({
      where: { userId_articleId: { userId, articleId } }
    })

    if (existing) {
      await fastify.prisma.$transaction(async (tx) => {
        await tx.collect.delete({ where: { id: existing.id } })
        await tx.article.update({
          where: { id: articleId },
          data: { collectCount: { decrement: 1 } }
        })
      })
      return reply.send({ success: true, collected: false, message: '已取消收藏' })
    } else {
      await fastify.prisma.$transaction(async (tx) => {
        await tx.collect.create({ data: { userId, articleId } })
        await tx.article.update({
          where: { id: articleId },
          data: { collectCount: { increment: 1 } }
        })
      })
      return reply.send({ success: true, collected: true, message: '收藏成功' })
    }
  })

  // ─────────────────────────────────────────
  // POST /api/articles/:id/comments 发评论
  // ─────────────────────────────────────────
  // 需要登录
  // parentId 有值表示回复某条评论，没有则为顶级评论
  fastify.post('/:id/comments', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 500 },
          parentId: { type: 'string' },
          replyToUserId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { id: articleId } = request.params
    const { content, parentId, replyToUserId } = request.body

    const comment = await fastify.prisma.$transaction(async (tx) => {
      const newComment = await tx.comment.create({
        data: {
          articleId,
          userId,
          content,
          parentId: parentId || null,
          replyToUserId: replyToUserId || null
        }
      })
      // 更新文章评论数
      await tx.article.update({
        where: { id: articleId },
        data: { commentCount: { increment: 1 } }
      })
      return newComment
    })

    return reply.code(201).send({ success: true, message: '评论成功', data: comment })
  })

  // ─────────────────────────────────────────
  // GET /api/articles/:id/comments 获取评论列表
  // ─────────────────────────────────────────
  // 不需要登录
  // 只返回顶级评论（parentId 为 null），每条顶级评论带上前3条回复
  fastify.get('/:id/comments', {
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
    const { id: articleId } = request.params
    const { page, limit } = request.query
    const skip = (page - 1) * limit

    const [comments, total] = await Promise.all([
      fastify.prisma.comment.findMany({
        where: { articleId, parentId: null, status: 'published' },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true, avatarUrl: true } }
            }
          },
          // 每条顶级评论带上前3条回复
          replies: {
            where: { status: 'published' },
            take: 3,
            orderBy: { createdAt: 'asc' },
            include: {
              user: {
                select: {
                  id: true,
                  profile: { select: { nickname: true, avatarUrl: true } }
                }
              }
            }
          }
        }
      }),
      fastify.prisma.comment.count({
        where: { articleId, parentId: null, status: 'published' }
      })
    ])

    return reply.send({
      success: true,
      data: {
        comments,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })
}