// src/routes/creator.js
// 创作者端接口（role >= 1，且 certifyStatus === 2）

export default async function creatorRoutes(fastify) {
  const { prisma } = fastify

  // ─────────────────────────────────────────────
  // 辅助
  // ─────────────────────────────────────────────

  function requireCreator(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      const user  = fastify.jwt.decode(token)
      fastify.jwt.verify(token)
      if (!user || user.role < 1) {
        return reply.code(403).send({ success: false, message: '权限不足，需要创作者身份' })
      }
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }

  function safeJson(str) {
    try { return JSON.parse(str) } catch { return [] }
  }

  // ─────────────────────────────────────────────
  // 我的联名作品
  // ─────────────────────────────────────────────

  /**
   * GET /api/creator/collab/works
   * 查看自己所有联名作品
   * 查询参数：status / page / limit
   */
  fastify.get('/creator/collab/works', { preHandler: requireCreator }, async (req, reply) => {
    const { status, page = 1, limit = 20 } = req.query
    const skip  = (Number(page) - 1) * Number(limit)
    const where = { creatorId: req.user.userId }
    if (status) where.status = status

    const [works, total] = await Promise.all([
      prisma.collabWork.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { framePacks: true },
      }),
      prisma.collabWork.count({ where }),
    ])

    const result = works.map(w => ({
      ...w,
      animationFrames: safeJson(w.animationFrames),
      supportedSkus:   safeJson(w.supportedSkus),
      sizes:           safeJson(w.sizes || '[]'),
    }))

    return reply.send({ success: true, data: { works: result, total, page: Number(page), limit: Number(limit) } })
  })

  /**
   * GET /api/creator/collab/works/:id
   * 查看自己某个联名作品详情（含帧图预签名URL）
   */
  fastify.get('/creator/collab/works/:id', { preHandler: requireCreator }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({
      where: { id: req.params.id },
      include: { framePacks: true },
    })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.creatorId !== req.user.userId)
      return reply.code(403).send({ success: false, message: '无权访问' })

    const frameKeys = safeJson(work.animationFrames)
    const frameUrls = frameKeys.map(key => fastify.ossPresignGet(key, 3600))
    const coverUrl  = work.coverUrl ? fastify.ossPresignGet(work.coverUrl, 3600) : null

    return reply.send({
      success: true,
      data: {
        ...work,
        animationFrames: frameUrls,
        coverUrl,
        supportedSkus: safeJson(work.supportedSkus),
        sizes:         safeJson(work.sizes || '[]'),
      },
    })
  })

  // ─────────────────────────────────────────────
  // 上传帧素材包
  // ─────────────────────────────────────────────

  /**
   * GET /api/creator/collab/works/:id/frame-packs/:size/upload-url
   * 获取帧素材包上传的OSS预签名URL
   * 创作者拿到URL后直接PUT上传zip文件到OSS
   */
  fastify.get('/creator/collab/works/:id/frame-packs/:size/upload-url', {
    preHandler: requireCreator
  }, async (req, reply) => {
    const { id } = req.params
    const size   = decodeURIComponent(req.params.size)

    const work = await prisma.collabWork.findUnique({ where: { id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.creatorId !== req.user.userId)
      return reply.code(403).send({ success: false, message: '无权操作' })
    if (work.status !== 'approved')
      return reply.code(400).send({ success: false, message: '只有审核通过的作品才能上传帧素材包' })

    // OSS路径
    const ossKey    = `collab-frames/${id}/${size.replace(/\*/g,'x')}.zip`
    const uploadUrl = fastify.oss.signatureUrl(ossKey, {
      expires: 3600,
      method:  'PUT',
    })

    return reply.send({
      success: true,
      data: { uploadUrl, ossKey, expiresIn: 3600 }
    })
  })

  /**
   * POST /api/creator/collab/works/:id/frame-packs/:size/confirm-upload
   * 确认上传完成，更新数据库记录
   * Body: { ossKey }
   */
  fastify.post('/creator/collab/works/:id/frame-packs/:size/confirm-upload', {
    preHandler: requireCreator
  }, async (req, reply) => {
    const { id }   = req.params
    const size     = decodeURIComponent(req.params.size)
    const { ossKey } = req.body

    const work = await prisma.collabWork.findUnique({ where: { id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.creatorId !== req.user.userId)
      return reply.code(403).send({ success: false, message: '无权操作' })

    // upsert 帧素材包记录
    const pack = await prisma.collabFramePack.upsert({
      where:  { collabWorkId_size: { collabWorkId: id, size } },
      create: { collabWorkId: id, size, ossPath: ossKey, stockType: 'on_demand' },
      update: { ossPath: ossKey, localCachePath: null }, // 清除旧缓存
    })

    // 同步更新 collabWork.sizes
    const existing = safeJson(work.sizes || '[]')
    if (!existing.includes(size)) {
      await prisma.collabWork.update({
        where: { id },
        data:  { sizes: JSON.stringify([...existing, size]) },
      })
    }

    return reply.send({ success: true, message: '帧素材包已更新', data: pack })
  })

  /**
   * GET /api/creator/collab/works/:id/frame-packs
   * 查看自己作品的所有帧素材包
   */
  fastify.get('/creator/collab/works/:id/frame-packs', {
    preHandler: requireCreator
  }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.creatorId !== req.user.userId)
      return reply.code(403).send({ success: false, message: '无权访问' })

    const packs = await prisma.collabFramePack.findMany({
      where:   { collabWorkId: req.params.id },
      orderBy: { size: 'asc' },
    })

    return reply.send({ success: true, data: packs })
  })

  // ─────────────────────────────────────────────
  // 销量统计
  // ─────────────────────────────────────────────

  /**
   * GET /api/creator/collab/stats
   * 创作者自己的销量和收益概览
   */
  fastify.get('/creator/collab/stats', { preHandler: requireCreator }, async (req, reply) => {
    const creatorId = req.user.userId

    const [totalWorks, approvedWorks, onShelfWorks] = await Promise.all([
      prisma.collabWork.count({ where: { creatorId } }),
      prisma.collabWork.count({ where: { creatorId, status: 'approved' } }),
      prisma.collabWork.count({ where: { creatorId, status: 'approved', isOnShelf: true } }),
    ])

    return reply.send({
      success: true,
      data: { totalWorks, approvedWorks, onShelfWorks }
    })
  })
}
