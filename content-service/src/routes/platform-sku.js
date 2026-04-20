// src/routes/platform-sku.js
// 平台 SKU 映射管理（external_desc → internal sku_code）
// 注册前缀：/api/admin/sku-mapping

export default async function platformSkuRoutes(fastify) {

  // GET /api/admin/sku-mapping — 列表
  fastify.get('/', { preHandler: requireAdmin }, async (req, reply) => {
    const { platform, page = 1, limit = 100, q } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (platform) where.platform = platform
    if (q)        where.externalDesc = { contains: q }

    const [mappings, total] = await Promise.all([
      fastify.prisma.platformSkuMapping.findMany({
        where, orderBy: { platform: 'asc' }, skip, take: parseInt(limit)
      }),
      fastify.prisma.platformSkuMapping.count({ where })
    ])

    // 补充 SKU 详情
    const skuCodes = [...new Set(mappings.map(m => m.internalSkuCode))]
    const skus     = await fastify.prisma.machineModelSku.findMany({ where: { skuCode: { in: skuCodes } } })
    const skuMap   = Object.fromEntries(skus.map(s => [s.skuCode, s]))

    // 补充联名作品详情
    const collabWorkIds = [...new Set(mappings.map(m => m.collabWorkId).filter(Boolean))]
    const collabWorks   = collabWorkIds.length
      ? await fastify.prisma.collabWork.findMany({ where: { id: { in: collabWorkIds } }, select: { id: true, title: true, creatorId: true } })
      : []
    const collabWorkMap = Object.fromEntries(collabWorks.map(w => [w.id, w]))

    const result = mappings.map(m => ({
      ...m,
      skuDetails:   skuMap[m.internalSkuCode] ?? null,
      collabWork:   m.collabWorkId ? (collabWorkMap[m.collabWorkId] ?? null) : null
    }))

    return reply.send({ success: true, data: { mappings: result, total, page: parseInt(page) } })
  })

  // POST /api/admin/sku-mapping — 新建映射
  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const { platform, externalDesc, internalSkuCode, collabWorkId } = req.body

    if (!platform || !externalDesc || !internalSkuCode)
      return reply.code(400).send({ success: false, message: '缺少必填字段：platform / externalDesc / internalSkuCode' })
    if (!['TB', 'DY', 'XHS'].includes(platform))
      return reply.code(400).send({ success: false, message: '平台必须为 TB / DY / XHS' })

    // 验证 skuCode 存在
    const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuCode: internalSkuCode } })
    if (!sku) return reply.code(404).send({ success: false, message: `sku_code ${internalSkuCode} 不存在` })

    // 若传入 collabWorkId，验证联名作品存在
    if (collabWorkId) {
      const work = await fastify.prisma.collabWork.findUnique({ where: { id: collabWorkId } })
      if (!work) return reply.code(404).send({ success: false, message: '联名作品不存在' })
    }

    const mapping = await fastify.prisma.platformSkuMapping.create({
      data: { platform, externalDesc, internalSkuCode, collabWorkId: collabWorkId || null }
    })
    return reply.code(201).send({ success: true, data: mapping })
  })

  // PUT /api/admin/sku-mapping/:id — 更新
  fastify.put('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const { platform, externalDesc, internalSkuCode, collabWorkId } = req.body

    const existing = await fastify.prisma.platformSkuMapping.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ success: false, message: '映射记录不存在' })

    if (internalSkuCode) {
      const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuCode: internalSkuCode } })
      if (!sku) return reply.code(404).send({ success: false, message: `sku_code ${internalSkuCode} 不存在` })
    }

    if (collabWorkId) {
      const work = await fastify.prisma.collabWork.findUnique({ where: { id: collabWorkId } })
      if (!work) return reply.code(404).send({ success: false, message: '联名作品不存在' })
    }

    const data = {}
    if (platform)                   data.platform        = platform
    if (externalDesc)               data.externalDesc    = externalDesc
    if (internalSkuCode)            data.internalSkuCode = internalSkuCode
    if (collabWorkId !== undefined) data.collabWorkId    = collabWorkId || null  // 传 '' 或 null 可清除联名绑定

    const updated = await fastify.prisma.platformSkuMapping.update({ where: { id }, data })
    return reply.send({ success: true, data: updated })
  })

  // DELETE /api/admin/sku-mapping/:id — 删除
  fastify.delete('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const existing = await fastify.prisma.platformSkuMapping.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ success: false, message: '映射记录不存在' })

    await fastify.prisma.platformSkuMapping.delete({ where: { id } })
    return reply.send({ success: true, message: '映射已删除' })
  })

  // GET /api/admin/sku-mapping/resolve — 根据外部描述查询内部 SKU
  // Query: ?platform=TB&desc=椴木原木色 5x5 12帧
  fastify.get('/resolve', { preHandler: requireAdmin }, async (req, reply) => {
    const { platform, desc } = req.query
    if (!platform || !desc)
      return reply.code(400).send({ success: false, message: '缺少 platform 和 desc 参数' })

    const mapping = await fastify.prisma.platformSkuMapping.findFirst({
      where: { platform, externalDesc: { contains: desc.substring(0, 30) } }
    })

    if (!mapping) return reply.send({ success: true, data: { matched: false } })

    const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuCode: mapping.internalSkuCode } })
    const collabWork = mapping.collabWorkId
      ? await fastify.prisma.collabWork.findUnique({ where: { id: mapping.collabWorkId }, select: { id: true, title: true } })
      : null
    return reply.send({ success: true, data: { matched: true, mapping, sku, collabWork } })
  })

  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || user.role < 2)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}
