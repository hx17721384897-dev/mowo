// src/routes/feed.js
// 社区混合 feed 流：文章 + 商品合并排序返回

export default async function feedRoutes(fastify) {

  // ─────────────────────────────────────────
  // GET /api/feed 社区混合 feed 流
  // ─────────────────────────────────────────
  // 不需要登录
  // 同时查文章和商品，合并后按时间排序
  // 支持按类型筛选、标签筛选、分页
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', minimum: 1, default: 1 },
          limit:    { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          type:     { type: 'string', enum: ['all', 'article', 'product'], default: 'all' },
          tag:      { type: 'string' },
          sort:     { type: 'string', enum: ['latest', 'popular'], default: 'latest' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, type, tag, sort } = request.query
    const skip = (page - 1) * limit

    // 排序字段
    // latest → 按创建时间降序
    // hot    → 按点赞数降序
    const orderBy = sort === 'hot'
      ? { likeCount: 'desc' }
      : { createdAt: 'desc' }

    // 并行查文章和商品
    const [articles, products] = await Promise.all([

      // 查文章（type 为 all 或 article 时查）
      (type === 'all' || type === 'article')
        ? fastify.prisma.article.findMany({
            where: {
              status: 'published',
              ...(tag ? { tags: { contains: tag } } : {})
            },
            orderBy,
            select: {
              id: true,
              title: true,
              coverUrl: true,
              tags: true,
              likeCount: true,
              collectCount: true,
              commentCount: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  profile: { select: { nickname: true, avatarUrl: true } }
                }
              },
              // 关联商品（有的话说明这篇文章带商品）
              articleProducts: {
                take: 1,
                select: { productId: true }
              }
            }
          })
        : Promise.resolve([]),

      // 查商品（type 为 all 或 product 时查）
      (type === 'all' || type === 'product')
        ? fastify.prisma.product.findMany({
            where: {
              status: 'published'
            },
            orderBy: sort === 'hot'
              ? { salesCount: 'desc' }
              : { createdAt: 'desc' },
            select: {
              id: true,
              title: true,
              machineType: true,
              frameCount: true,
              finalPrice: true,
              salesCount: true,
              createdAt: true,
              animation: {
                select: { previewUrl: true }
              },
              user: {
                select: {
                  id: true,
                  profile: { select: { nickname: true, avatarUrl: true } }
                }
              }
            }
          })
        : Promise.resolve([])
    ])

    // 给每条数据加上 feedType 标记
    const articleItems = articles.map(a => ({
      feedType: 'article',
      hasProduct: a.articleProducts.length > 0,
      ...a,
      articleProducts: undefined // 不返回这个字段，只用 hasProduct 代替
    }))

    const productItems = products.map(p => ({
      feedType: 'product',
      finalPrice: Number(p.finalPrice),
      ...p
    }))

    // 合并后按时间排序
    const merged = [...articleItems, ...productItems].sort((a, b) => {
      if (sort === 'hot') {
        const aScore = a.likeCount || a.salesCount || 0
        const bScore = b.likeCount || b.salesCount || 0
        return bScore - aScore
      }
      return new Date(b.createdAt) - new Date(a.createdAt)
    })

    // 手动分页（因为是两个表合并的）
    const total = merged.length
    const items = merged.slice(skip, skip + limit)

    return reply.send({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    })
  })
}