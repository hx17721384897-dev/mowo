// src/routes/feed.js
// 社区混合 feed 流：文章 + 商品合并排序返回

export default async function feedRoutes(fastify) {

  // ─────────────────────────────────────────
  // GET /api/feed 社区混合 feed 流
  // ─────────────────────────────────────────
  // 不需要登录
  // tag 筛选：只筛文章，商品没有标签字段
  // saleOnly：只看可购买，只返回商品
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', minimum: 1, default: 1 },
          limit:    { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          tag:      { type: 'string' },
          saleOnly: { type: 'boolean', default: false },
          sort:     { type: 'string', enum: ['latest', 'popular'], default: 'latest' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, tag, saleOnly, sort } = request.query
    const skip = (page - 1) * limit

    const orderBy = sort === 'popular'
      ? { likeCount: 'desc' }
      : { createdAt: 'desc' }

    // ── 有标签筛选时：只查文章，不查商品
    // ── saleOnly 时：只查商品，不查文章
    // ── 其他情况：文章和商品都查
    const shouldFetchArticles = !saleOnly
    const shouldFetchProducts = !tag  // 有标签筛选时不显示商品

    const [articles, products] = await Promise.all([

      shouldFetchArticles
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
              articleProducts: {
                take: 1,
                select: { productId: true }
              }
            }
          })
        : Promise.resolve([]),

      shouldFetchProducts
        ? fastify.prisma.product.findMany({
            where: { status: 'published' },
            orderBy: sort === 'popular'
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

    // 给每条数据加 feedType 标记
    const articleItems = articles.map(a => ({
      feedType: 'article',
      hasSale: a.articleProducts.length > 0,
      id: a.id,
      title: a.title,
      coverUrl: a.coverUrl,
      tags: a.tags,
      likeCount: a.likeCount,
      collectCount: a.collectCount,
      commentCount: a.commentCount,
      createdAt: a.createdAt,
      user: a.user
    }))

    const productItems = products.map(p => ({
      feedType: 'product',
      id: p.id,
      title: p.title,
      machineType: p.machineType,
      frameCount: p.frameCount,
      finalPrice: Number(p.finalPrice),
      salesCount: p.salesCount,
      createdAt: p.createdAt,
      previewUrl: p.animation?.previewUrl || null,
      user: p.user
    }))

    // 合并排序
    const merged = [...articleItems, ...productItems].sort((a, b) => {
      if (sort === 'popular') {
        const aScore = a.likeCount || a.salesCount || 0
        const bScore = b.likeCount || b.salesCount || 0
        return bScore - aScore
      }
      return new Date(b.createdAt) - new Date(a.createdAt)
    })

    // 手动分页
    const total = merged.length
    const items = merged.slice(skip, skip + limit)

    return reply.send({
      success: true,
      data: {
        items,
        pagination: {
          page, limit, total,
          totalPages: Math.ceil(total / limit)
        }
      }
    })
  })
}
