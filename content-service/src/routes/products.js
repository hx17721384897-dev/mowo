// src/routes/products.js
// 商品相关接口：上架、列表、详情、编辑、下架

// 机型和支持帧数的对应关系，后端校验用
const MACHINE_SPECS = {
  cylinder:    { frames: [12, 16, 24] },
  lantern:     { frames: [12, 16] },
  hexagon:     { frames: [6, 12] },
  'flat-round': { frames: [12, 24] },
  mini:        { frames: [12] }
}

export default async function productRoutes(fastify) {

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
  // POST /api/products 上架商品
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 校验机型和帧数是否匹配
  // 从 platform_rules 读取底价
  // 根据信用分决定是否需要审核
  fastify.post('/', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        required: ['animationId', 'title', 'machineType', 'frameCount', 'markupPrice'],
        properties: {
          animationId: { type: 'string' },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string' },
          machineType: {
            type: 'string',
            enum: ['cylinder', 'lantern', 'hexagon', 'flat-round', 'mini']
          },
          frameCount: { type: 'integer' },
          markupPrice: { type: 'number', minimum: 0 },
          stockType: { type: 'string', enum: ['unlimited', 'limited'] },
          stockLimit: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const {
      animationId, title, description,
      machineType, frameCount, markupPrice,
      stockType = 'unlimited', stockLimit
    } = request.body

    // 校验机型和帧数是否匹配
    const spec = MACHINE_SPECS[machineType]
    if (!spec.frames.includes(frameCount)) {
      return reply.code(400).send({
        success: false,
        message: `${machineType} 机型不支持 ${frameCount} 帧，支持帧数为：${spec.frames.join('/')}`
      })
    }

    // 确认动画存在且属于当前创作者
    const animation = await fastify.prisma.animation.findUnique({
      where: { id: animationId }
    })
    if (!animation) {
      return reply.code(404).send({ success: false, message: '动画不存在' })
    }
    if (animation.userId !== userId) {
      return reply.code(403).send({ success: false, message: '只能使用自己的动画' })
    }
    if (animation.status !== 'published') {
      return reply.code(400).send({ success: false, message: '动画尚未完成上传，请先上传所有帧图' })
    }
    if (animation.frameCount !== frameCount) {
      return reply.code(400).send({
        success: false,
        message: `动画帧数为 ${animation.frameCount} 帧，与选择的机型帧数 ${frameCount} 不匹配`
      })
    }

    // 从 platform_rules 读取对应机型底价
    // rule_key 格式：base_price_cylinder_12
    const ruleKey = `base_price_${machineType}_${frameCount}`
    const priceRule = await fastify.prisma.platformRule.findUnique({
      where: { ruleKey }
    })

    // 如果还没有设置底价，使用默认值 0，后续管理员配置
    const basePrice = priceRule ? Number(priceRule.ruleValue) : 0
    const finalPrice = basePrice + markupPrice

    // 查信用分决定商品状态
    const creditScore = await fastify.prisma.creditScore.findUnique({
      where: { userId }
    })
    const score = creditScore?.score || 100
    const status = score >= 80 ? 'published' : 'pending'

    // 事务：创建商品 + 更新创作者商品计数
    const product = await fastify.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          userId,
          animationId,
          title,
          description: description || null,
          machineType,
          frameCount,
          basePrice,
          markupPrice,
          finalPrice,
          stockType,
          stockLimit: stockType === 'limited' ? stockLimit : null,
          status
        }
      })

      await tx.creatorProfile.update({
        where: { userId },
        data: { productCount: { increment: 1 } }
      })

      return newProduct
    })

    return reply.code(201).send({
      success: true,
      message: status === 'published' ? '商品上架成功' : '商品已提交审核',
      data: {
        id: product.id,
        finalPrice: product.finalPrice,
        status: product.status
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/products 公开商品列表
  // ─────────────────────────────────────────
  // 不需要登录
  // 支持按机型筛选、分页
  // 只返回 published 状态的商品
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          machineType: { type: 'string' },
          creatorId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, machineType, creatorId } = request.query
    const skip = (page - 1) * limit

    const where = {
      status: 'published',
      ...(machineType ? { machineType } : {}),
      ...(creatorId ? { userId: creatorId } : {})
    }

    const [products, total] = await Promise.all([
      fastify.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          machineType: true,
          frameCount: true,
          finalPrice: true,
          salesCount: true,
          stockType: true,
          stockLimit: true,
          createdAt: true,
          animation: {
            select: { previewUrl: true, title: true }
          },
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true, avatarUrl: true } }
            }
          }
        }
      }),
      fastify.prisma.product.count({ where })
    ])

    return reply.send({
      success: true,
      data: {
        products,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/products/mine 我的商品列表
  // ─────────────────────────────────────────
  // 需要创作者认证
  // 返回所有状态的商品（包括待审核、已拒绝）
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

    const [products, total] = await Promise.all([
      fastify.prisma.product.findMany({
        where: { userId, status: { not: 'removed' } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          animation: {
            select: { title: true, previewUrl: true, frameCount: true }
          }
        }
      }),
      fastify.prisma.product.count({
        where: { userId, status: { not: 'removed' } }
      })
    ])

    return reply.send({
      success: true,
      data: {
        products,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/products/:id 商品详情
  // ─────────────────────────────────────────
  // 不需要登录
  // 返回商品完整信息、动画预览、创作者信息
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params

    const product = await fastify.prisma.product.findUnique({
      where: { id },
      include: {
        animation: {
          include: {
            frames: { orderBy: { frameIndex: 'asc' } }
          }
        },
        user: {
          select: {
            id: true,
            certifyStatus: true,
            profile: { select: { nickname: true, avatarUrl: true } },
            creatorProfile: { select: { styleTags: true, totalSales: true } }
          }
        }
      }
    })

    if (!product || product.status === 'removed') {
      return reply.code(404).send({ success: false, message: '商品不存在' })
    }

    return reply.send({ success: true, data: product })
  })

  // ─────────────────────────────────────────
  // PUT /api/products/:id 编辑商品
  // ─────────────────────────────────────────
  // 需要创作者认证，只能编辑自己的商品
  // 只能改标题、描述、加价、库存，不能改机型和动画
  fastify.put('/:id', {
    preHandler: requireCreator,
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string' },
          markupPrice: { type: 'number', minimum: 0 },
          stockType: { type: 'string', enum: ['unlimited', 'limited'] },
          stockLimit: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { id } = request.params
    const { title, description, markupPrice, stockType, stockLimit } = request.body

    const product = await fastify.prisma.product.findUnique({ where: { id } })
    if (!product) {
      return reply.code(404).send({ success: false, message: '商品不存在' })
    }
    if (product.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权编辑此商品' })
    }

    // 如果改了加价，重新计算最终售价
    const newMarkupPrice = markupPrice !== undefined ? markupPrice : Number(product.markupPrice)
    const newFinalPrice = Number(product.basePrice) + newMarkupPrice

    const updated = await fastify.prisma.product.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(markupPrice !== undefined && {
          markupPrice: newMarkupPrice,
          finalPrice: newFinalPrice
        }),
        ...(stockType && { stockType }),
        ...(stockType === 'limited' && stockLimit ? { stockLimit } : {}),
        ...(stockType === 'unlimited' ? { stockLimit: null } : {})
      }
    })

    return reply.send({ success: true, message: '商品更新成功', data: updated })
  })

  // ─────────────────────────────────────────
  // DELETE /api/products/:id 下架商品
  // ─────────────────────────────────────────
  // 需要创作者认证，只能下架自己的商品
  // 软删除，改 status 为 removed
  fastify.delete('/:id', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user
    const { id } = request.params

    const product = await fastify.prisma.product.findUnique({ where: { id } })
    if (!product) {
      return reply.code(404).send({ success: false, message: '商品不存在' })
    }
    if (product.userId !== userId) {
      return reply.code(403).send({ success: false, message: '无权下架此商品' })
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status: 'removed' }
      })
      await tx.creatorProfile.update({
        where: { userId },
        data: { productCount: { decrement: 1 } }
      })
    })

    return reply.send({ success: true, message: '商品已下架' })
  })
}