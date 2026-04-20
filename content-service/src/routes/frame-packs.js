// src/routes/frame-packs.js
// 帧包备货白名单管理
// GET/POST/DELETE role >= 2（管理员）; restock role >= 1（生产端也可入库）

export default async function framePacksRoutes(fastify) {

  // ─────────────────────────────────────────────
  // GET /api/frame-packs
  // 全部白名单作品 + 变体 + 预警
  // ─────────────────────────────────────────────
  fastify.get('/', { preHandler: requireProduction }, async (req, reply) => {
    const works = await fastify.prisma.framePackWork.findMany({
      where: { isActive: true },
      include: {
        variants: {
          where: { isActive: true },
          orderBy: [{ size: 'asc' }, { frameCount: 'asc' }]
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const variantIds = works.flatMap(w => w.variants.map(v => v.id))

    const consumed = await fastify.prisma.framePackLog.groupBy({
      by: ['variantId'],
      where: { type: 'order_consumed', createdAt: { gte: thirtyDaysAgo }, variantId: { in: variantIds } },
      _sum: { quantity: true }
    })
    const consumedMap = Object.fromEntries(consumed.map(c => [c.variantId, c._sum.quantity || 0]))

    // OSS 预签名缩略图
    const result = await Promise.all(works.map(async w => {
      const thumbnailUrl = (w.thumbnailKey && fastify.ossPresignGet)
        ? await fastify.ossPresignGet(w.thumbnailKey).catch(() => null)
        : null

      const variants = w.variants.map(v => {
        const consumed30d     = consumedMap[v.id] || 0
        const dailyConsumption = consumed30d / 30
        const availableDays   = dailyConsumption > 0 ? v.currentStock / dailyConsumption : null

        let alertLevel = 'OK'
        if (availableDays !== null) {
          if      (availableDays < v.leadTime)           alertLevel = 'CRITICAL'
          else if (availableDays < v.leadTime * 1.5)     alertLevel = 'WARNING'
          else if (availableDays < v.leadTime * 2)       alertLevel = 'SUGGEST'
        } else if (v.currentStock <= v.safetyStock) {
          alertLevel = v.currentStock === 0 ? 'CRITICAL' : 'WARNING'
        }

        return { ...v, consumed30d, dailyConsumption: Math.round(dailyConsumption * 10) / 10, availableDays: availableDays !== null ? Math.round(availableDays) : null, alertLevel }
      })

      const worstAlert = variants.reduce((worst, v) => {
        const rank = { CRITICAL: 3, WARNING: 2, SUGGEST: 1, OK: 0 }
        return (rank[v.alertLevel] || 0) > (rank[worst] || 0) ? v.alertLevel : worst
      }, 'OK')

      return { ...w, thumbnailUrl, variants, worstAlert }
    }))

    return reply.send({ success: true, data: result })
  })

  // ─────────────────────────────────────────────
  // GET /api/frame-packs/search-collab?q=
  // 搜索联名作品（供添加时选择）
  // ─────────────────────────────────────────────
  fastify.get('/search-collab', { preHandler: requireAdmin }, async (req, reply) => {
    const { q = '' } = req.query
    const works = await fastify.prisma.collabWork.findMany({
      where: {
        status: 'approved',
        title: { contains: q, mode: 'insensitive' }
      },
      select: { id: true, title: true, animationFrames: true },
      take: 20,
      orderBy: { createdAt: 'desc' }
    })

    // 排除已在白名单的
    const existing = await fastify.prisma.framePackWork.findMany({
      where: { collabWorkId: { in: works.map(w => w.id) }, isActive: true },
      select: { collabWorkId: true }
    })
    const existingIds = new Set(existing.map(e => e.collabWorkId))

    const result = works.map(w => {
      let thumbnailKey = null
      try {
        const frames = JSON.parse(w.animationFrames || '[]')
        thumbnailKey = frames[0] || null
      } catch {}
      return {
        id:           w.id,
        title:        w.title,
        thumbnailKey,
        alreadyAdded: existingIds.has(w.id)
      }
    })

    return reply.send({ success: true, data: result })
  })

  // ─────────────────────────────────────────────
  // POST /api/frame-packs
  // 添加作品到白名单
  // Body: { collabWorkId, name?, thumbnailKey? }
  // ─────────────────────────────────────────────
  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const { collabWorkId, name, thumbnailKey } = req.body
    const operatorId = req.user.userId

    if (!collabWorkId && !name?.trim())
      return reply.code(400).send({ success: false, message: '需要提供联名作品或手动名称' })

    let displayName = name?.trim()
    let thumbKey    = thumbnailKey || null

    if (collabWorkId) {
      const cw = await fastify.prisma.collabWork.findUnique({ where: { id: collabWorkId } })
      if (!cw) return reply.code(404).send({ success: false, message: '联名作品不存在' })
      if (!displayName) displayName = cw.title
      if (!thumbKey) {
        try {
          const frames = JSON.parse(cw.animationFrames || '[]')
          thumbKey = frames[0] || null
        } catch {}
      }
    }

    const work = await fastify.prisma.framePackWork.create({
      data: { collabWorkId: collabWorkId || null, name: displayName, thumbnailKey: thumbKey, createdBy: operatorId }
    })
    return reply.send({ success: true, data: work })
  })

  // ─────────────────────────────────────────────
  // DELETE /api/frame-packs/:workId
  // 软删除（连同变体一起下架）
  // ─────────────────────────────────────────────
  fastify.delete('/:workId', { preHandler: requireAdmin }, async (req, reply) => {
    const { workId } = req.params
    await fastify.prisma.$transaction([
      fastify.prisma.framePackWork.update({ where: { id: workId }, data: { isActive: false } }),
      fastify.prisma.framePackVariant.updateMany({ where: { workId }, data: { isActive: false } })
    ])
    return reply.send({ success: true })
  })

  // ─────────────────────────────────────────────
  // POST /api/frame-packs/:workId/variants
  // 添加规格变体
  // Body: { size, frameCount, skuCode?, safetyStock?, leadTime?, note? }
  // ─────────────────────────────────────────────
  fastify.post('/:workId/variants', { preHandler: requireAdmin }, async (req, reply) => {
    const { workId } = req.params
    const { size, frameCount, skuCode, safetyStock, leadTime, note } = req.body
    const operatorId = req.user.userId

    if (!size?.trim() || !frameCount)
      return reply.code(400).send({ success: false, message: '尺寸和帧数不能为空' })

    const existing = await fastify.prisma.framePackVariant.findUnique({
      where: { workId_size_frameCount: { workId, size: size.trim(), frameCount: parseInt(frameCount) } }
    })
    if (existing && existing.isActive)
      return reply.code(409).send({ success: false, message: '该尺寸/帧数组合已存在' })

    const variant = await fastify.prisma.framePackVariant.upsert({
      where: { workId_size_frameCount: { workId, size: size.trim(), frameCount: parseInt(frameCount) } },
      create: {
        workId, size: size.trim(), frameCount: parseInt(frameCount),
        skuCode: skuCode || null, safetyStock: safetyStock ?? 5,
        leadTime: leadTime ?? 7, note: note || null, createdBy: operatorId
      },
      update: { isActive: true, skuCode: skuCode || null, safetyStock: safetyStock ?? 5, leadTime: leadTime ?? 7, note: note || null }
    })
    return reply.send({ success: true, data: variant })
  })

  // ─────────────────────────────────────────────
  // PUT /api/frame-packs/:workId/variants/:variantId
  // 编辑变体（编码/安全库存/采购周期/备注）
  // ─────────────────────────────────────────────
  fastify.put('/:workId/variants/:variantId', { preHandler: requireAdmin }, async (req, reply) => {
    const { variantId } = req.params
    const { skuCode, safetyStock, leadTime, note } = req.body

    const data = {}
    if (skuCode      !== undefined) data.skuCode      = skuCode || null
    if (safetyStock  !== undefined) data.safetyStock  = safetyStock
    if (leadTime     !== undefined) data.leadTime     = leadTime
    if (note         !== undefined) data.note         = note

    const updated = await fastify.prisma.framePackVariant.update({ where: { id: variantId }, data })
    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────
  // DELETE /api/frame-packs/:workId/variants/:variantId
  // ─────────────────────────────────────────────
  fastify.delete('/:workId/variants/:variantId', { preHandler: requireAdmin }, async (req, reply) => {
    const { variantId } = req.params
    await fastify.prisma.framePackVariant.update({ where: { id: variantId }, data: { isActive: false } })
    return reply.send({ success: true })
  })

  // ─────────────────────────────────────────────
  // POST /api/frame-packs/:workId/variants/:variantId/restock
  // 入库（管理员 + 生产端 role >= 1）
  // Body: { quantity, note? }
  // ─────────────────────────────────────────────
  fastify.post('/:workId/variants/:variantId/restock', { preHandler: requireProduction }, async (req, reply) => {
    const { variantId } = req.params
    const { quantity, note } = req.body
    const operatorId = req.user.userId

    if (!quantity || quantity <= 0)
      return reply.code(400).send({ success: false, message: '数量必须大于0' })

    const variant = await fastify.prisma.framePackVariant.findUnique({ where: { id: variantId } })
    if (!variant || !variant.isActive)
      return reply.code(404).send({ success: false, message: '变体不存在' })

    const beforeQty = variant.currentStock
    const afterQty  = beforeQty + quantity

    await fastify.prisma.$transaction([
      fastify.prisma.framePackVariant.update({ where: { id: variantId }, data: { currentStock: afterQty } }),
      fastify.prisma.framePackLog.create({
        data: { variantId, type: 'purchase_in', quantity, beforeQty, afterQty, operatorId, note: note || null }
      })
    ])

    return reply.send({ success: true, message: `✓ 已入库 ${quantity} 套，当前库存 ${afterQty}`, data: { currentStock: afterQty } })
  })

  // ─────────────────────────────────────────────
  // POST /api/frame-packs/:workId/variants/:variantId/adjust
  // 手动调整（支持正负，必填原因）
  // Body: { delta, note }
  // ─────────────────────────────────────────────
  fastify.post('/:workId/variants/:variantId/adjust', { preHandler: requireAdmin }, async (req, reply) => {
    const { variantId } = req.params
    const { delta, note } = req.body
    const operatorId = req.user.userId

    if (!delta || delta === 0) return reply.code(400).send({ success: false, message: '调整量不能为0' })
    if (!note?.trim())         return reply.code(400).send({ success: false, message: '手动调整必须填写原因' })

    const variant = await fastify.prisma.framePackVariant.findUnique({ where: { id: variantId } })
    if (!variant || !variant.isActive) return reply.code(404).send({ success: false, message: '变体不存在' })

    const afterQty = variant.currentStock + delta
    if (afterQty < 0) return reply.code(400).send({ success: false, message: `调减超出库存（当前：${variant.currentStock}）` })

    await fastify.prisma.$transaction([
      fastify.prisma.framePackVariant.update({ where: { id: variantId }, data: { currentStock: afterQty } }),
      fastify.prisma.framePackLog.create({
        data: { variantId, type: 'manual_adjustment', quantity: Math.abs(delta), beforeQty: variant.currentStock, afterQty, operatorId, note: note.trim() }
      })
    ])

    return reply.send({ success: true, message: `✓ 已调整 ${delta > 0 ? '+' : ''}${delta}，当前库存 ${afterQty}`, data: { currentStock: afterQty } })
  })

  // ─────────────────────────────────────────────
  // GET /api/frame-packs/:workId/variants/:variantId/logs
  // ─────────────────────────────────────────────
  fastify.get('/:workId/variants/:variantId/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const { variantId } = req.params
    const { page = 1, limit = 50 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const [logs, total] = await Promise.all([
      fastify.prisma.framePackLog.findMany({
        where: { variantId },
        orderBy: { createdAt: 'desc' },
        skip, take: parseInt(limit)
      }),
      fastify.prisma.framePackLog.count({ where: { variantId } })
    ])

    return reply.send({ success: true, data: { logs, total, page: parseInt(page) } })
  })

  // ─────────────────────────────────────────────
  // 权限中间件
  // ─────────────────────────────────────────────
  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || (user.role ?? 0) < 2)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }

  function requireProduction(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || (user.role ?? 0) < 1)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}
