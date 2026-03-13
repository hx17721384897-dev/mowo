// src/routes/animations.js
// 动画内容相关接口：上传动画、帧图管理、动画列表

export default async function animationRoutes(fastify) {

  // 验证是否为认证创作者的中间件
  // 在需要创作者权限的接口里使用
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
  // POST /api/animations 上传动画
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 创建动画记录，帧图通过另一个接口单独上传
  fastify.post('/', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        required: ['title', 'frameCount', 'copyrightType'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string' },
          previewUrl: { type: 'string' },
          frameCount: { type: 'integer', enum: [6, 12, 16, 24] },
          copyrightType: {
            type: 'string',
            enum: ['original', 'licensed', 'buyout']
          },
          copyrightNote: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const {
      title, description, previewUrl,
      frameCount, copyrightType, copyrightNote
    } = request.body

    const animation = await fastify.prisma.animation.create({
      data: {
        userId,
        title,
        description: description || null,
        previewUrl: previewUrl || null,
        frameCount,
        copyrightType,
        copyrightNote: copyrightNote || null,
        status: 'draft'
        // 上传完所有帧图后再改为 published
      }
    })

    return reply.code(201).send({
      success: true,
      message: '动画创建成功，请继续上传帧图',
      data: { id: animation.id, frameCount: animation.frameCount }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/animations/:id/frames 上传帧图
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 一次上传一帧，前端循环调用
  // 所有帧上传完毕后动画状态自动变为 published
  fastify.post('/:id/frames', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        required: ['frameIndex', 'imageUrl'],
        properties: {
          frameIndex: { type: 'integer', minimum: 1 },
          imageUrl: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { id: animationId } = request.params
    const { frameIndex, imageUrl } = request.body

    // 确认动画存在且属于当前创作者
    const animation = await fastify.prisma.animation.findUnique({
      where: { id: animationId }
    })
    if (!animation) {
      return reply.code(404).send({ success: false, message: '动画不存在' })
    }
    if (animation.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权操作此动画' })
    }
    if (frameIndex > animation.frameCount) {
      return reply.code(400).send({
        success: false,
        message: `帧序号超出范围，此动画最多 ${animation.frameCount} 帧`
      })
    }

    // 创建或更新帧图（同一序号重复上传则覆盖）
    const frame = await fastify.prisma.animationFrame.upsert({
      where: {
        animationId_frameIndex: { animationId, frameIndex }
      },
      update: { imageUrl },
      create: { animationId, frameIndex, imageUrl }
    })

    // 检查是否所有帧都已上传
    const uploadedCount = await fastify.prisma.animationFrame.count({
      where: { animationId }
    })

    let allUploaded = false
    if (uploadedCount >= animation.frameCount) {
      // 所有帧上传完毕，动画状态改为 published
      await fastify.prisma.animation.update({
        where: { id: animationId },
        data: { status: 'published' }
      })
      allUploaded = true
    }

    return reply.code(201).send({
      success: true,
      message: allUploaded
        ? `所有帧上传完毕，动画已发布`
        : `第 ${frameIndex} 帧上传成功，已上传 ${uploadedCount}/${animation.frameCount} 帧`,
      data: {
        frame,
        uploadedCount,
        totalFrames: animation.frameCount,
        allUploaded
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/animations/mine 我的动画列表
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 返回当前创作者的所有动画，包含每个动画已上传的帧数
  fastify.get('/mine', {
    preHandler: requireCreator,
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
    const { userId } = request.user
    const { page, limit } = request.query
    const skip = (page - 1) * limit

    const [animations, total] = await Promise.all([
      fastify.prisma.animation.findMany({
        where: { userId, status: { not: 'removed' } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { frames: true, products: true } }
        }
      }),
      fastify.prisma.animation.count({
        where: { userId, status: { not: 'removed' } }
      })
    ])

    return reply.send({
      success: true,
      data: {
        animations,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/animations/:id 动画详情
  // ─────────────────────────────────────────
  // 需要创作者认证，只能查看自己的动画
  // 返回动画信息和所有帧图
  fastify.get('/:id', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user
    const { id } = request.params

    const animation = await fastify.prisma.animation.findUnique({
      where: { id },
      include: {
        frames: { orderBy: { frameIndex: 'asc' } },
        _count: { select: { products: true } }
      }
    })

    if (!animation) {
      return reply.code(404).send({ success: false, message: '动画不存在' })
    }
    if (animation.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权查看此动画' })
    }

    return reply.send({ success: true, data: animation })
  })

  // ─────────────────────────────────────────
  // DELETE /api/animations/:id 删除动画
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 如果动画已有商品在售，不能删除
  fastify.delete('/:id', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user
    const { id } = request.params

    const animation = await fastify.prisma.animation.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } }
      }
    })

    if (!animation) {
      return reply.code(404).send({ success: false, message: '动画不存在' })
    }
    if (animation.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权删除此动画' })
    }
    if (animation._count.products > 0) {
      return reply.code(400).send({
        success: false,
        message: '该动画已有关联商品，请先下架所有商品再删除动画'
      })
    }

    await fastify.prisma.animation.update({
      where: { id },
      data: { status: 'removed' }
    })

    return reply.send({ success: true, message: '动画已删除' })
  })
}