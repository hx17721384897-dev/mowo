// src/routes/machine-models.js
// 注意：精确路由必须在动态路由 /:id 之前注册

export default async function machineModelRoutes(fastify) {

  // ─────────────────────────────────────────────
  // 管理员精确路由（必须在 /:id 之前）
  // ─────────────────────────────────────────────

  fastify.get('/admin/all', { preHandler: requireAdmin }, async (req, reply) => {
    const models = await fastify.prisma.machineModel.findMany({
      orderBy: { sortOrder: 'asc' }
    })
    return reply.send({ success: true, data: models.map(parseModel) })
  })

  fastify.get('/admin/:id/skus', { preHandler: requireAdmin }, async (req, reply) => {
    const skus = await fastify.prisma.machineModelSku.findMany({
      where: { modelId: req.params.id },
      orderBy: [{ sortOrder: 'asc' }, { size: 'asc' }, { material: 'asc' }, { frameCount: 'asc' }]
    })
    return reply.send({ success: true, data: skus })
  })

  fastify.delete('/skus/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const existing = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!existing) return reply.code(404).send({ success: false, message: 'SKU不存在' })

    const orderCount = await fastify.prisma.customizeOrder.count({ where: { skuId } })
    if (orderCount > 0) {
      return reply.code(400).send({
        success: false,
        message: `该SKU已有 ${orderCount} 个关联订单，无法删除，可改为下架`
      })
    }
    await fastify.prisma.skuInventory.deleteMany({ where: { skuId } })
    await fastify.prisma.machineModelSku.delete({ where: { id: skuId } })
    return reply.send({ success: true, message: 'SKU已删除' })
  })

  fastify.put('/skus/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { isActive } = req.body
    const existing = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!existing) return reply.code(404).send({ success: false, message: 'SKU不存在' })
    const updated = await fastify.prisma.machineModelSku.update({
      where: { id: skuId },
      data: { isActive }
    })
    return reply.send({ success: true, data: updated })
  })

  // PUT /api/machine-models/skus/:skuId/price — 单独更新价格
  fastify.put('/skus/:skuId/price', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { price }  = req.body
    if (price === undefined || Number(price) < 0) {
      return reply.code(400).send({ success: false, message: '价格无效' })
    }
    const existing = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!existing) return reply.code(404).send({ success: false, message: 'SKU不存在' })
    const updated = await fastify.prisma.machineModelSku.update({
      where: { id: skuId },
      data:  { price: Number(price) }
    })
    return reply.send({ success: true, data: updated })
  })

  // POST /api/machine-models/skus/:skuId/upload-image
  // 接收图片文件，后端上传到 OSS，保存 objectKey 到数据库
  fastify.post('/skus/:skuId/upload-image', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params

    const existing = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!existing) return reply.code(404).send({ success: false, message: 'SKU不存在' })

    // 读取 multipart 文件
    const data = await req.file()
    if (!data) return reply.code(400).send({ success: false, message: '未收到文件' })

    const ext       = (data.filename || 'jpg').split('.').pop().toLowerCase() || 'jpg'
    const objectKey = `sku-images/${skuId}/${Date.now()}.${ext}`

    // 读取文件内容为 Buffer
    const chunks = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    if (buffer.length > 5 * 1024 * 1024) {
      return reply.code(400).send({ success: false, message: '图片不能超过 5MB' })
    }

    // 上传到 OSS
    await fastify.oss.put(objectKey, buffer, {
      headers: { 'Content-Type': data.mimetype || 'image/jpeg' }
    })

    // 保存到数据库
    const updated = await fastify.prisma.machineModelSku.update({
      where: { id: skuId },
      data:  { previewImage: objectKey }
    })

    // 返回预签名读取 URL 供前端立即预览
    const previewUrl = fastify.ossPresignGet(objectKey, 3600)
    return reply.send({ success: true, data: { ...updated, previewUrl } })
  })

  // GET /api/machine-models/skus/:skuId/image-url
  // 获取SKU图片的预签名读取URL
  fastify.get('/skus/:skuId/image-url', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })
    if (!sku.previewImage) return reply.send({ success: true, data: { previewUrl: null } })
    const previewUrl = fastify.ossPresignGet(sku.previewImage, 3600)
    return reply.send({ success: true, data: { previewUrl } })
  })

  fastify.get('/skus/:skuId/example-media-url', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { key } = req.query
    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })
    const allowedKeys = safeJson(sku.exampleMedia, [])
    if (!key || !allowedKeys.includes(key)) {
      return reply.code(403).send({ success: false, message: '该图片不属于当前SKU' })
    }
    return reply.send({ success: true, data: { url: fastify.ossPresignGet(key, 300), expiresIn: 300 } })
  })

  // GET /api/machine-models/:id/sku-sales — 获取该款式各SKU销量（热门排序用）
  fastify.get('/:id/sku-sales', async (req, reply) => {
    const { id } = req.params
    // 统计 customize_orders 里各 skuId 的订单数
    const orders = await fastify.prisma.customizeOrder.groupBy({
      by: ['skuId'],
      where: {
        skuId: { not: null },
        // 只统计已付款以上的订单
        status: { in: ['paid','producing','done','shipped'] }
      },
      _count: { skuId: true }
    })
    // 过滤出属于本款式的 SKU
    const skus = await fastify.prisma.machineModelSku.findMany({
      where: { modelId: id },
      select: { id: true }
    })
    const skuIdSet = new Set(skus.map(s => s.id))
    const result   = {}
    orders.forEach(o => {
      if (skuIdSet.has(o.skuId)) result[o.skuId] = o._count.skuId
    })
    return reply.send({ success: true, data: result })
  })

  // ─────────────────────────────────────────────
  // 公开接口
  // ─────────────────────────────────────────────

  fastify.get('/', async (req, reply) => {
    const models = await fastify.prisma.machineModel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, name: true, description: true,
        ratios: true, frameOptions: true, sizes: true,
        previewImage: true, sortOrder: true, isActive: true,
        modelType: true
      }
    })
    return reply.send({ success: true, data: models.map(parseModel) })
  })

  fastify.get('/:id', async (req, reply) => {
    const model = await fastify.prisma.machineModel.findUnique({ where: { id: req.params.id } })
    if (!model || !model.isActive)
      return reply.code(404).send({ success: false, message: '款式不存在' })
    return reply.send({ success: true, data: parseModel(model) })
  })

  fastify.get('/:id/skus', async (req, reply) => {
    const skus = await fastify.prisma.machineModelSku.findMany({
      where: { modelId: req.params.id, isActive: true },
      orderBy: [{ size: 'asc' }, { material: 'asc' }, { frameCount: 'asc' }, { colorName: 'asc' }]
    })
    return reply.send({ success: true, data: skus })
  })

  // ─────────────────────────────────────────────
  // 管理员写操作
  // ─────────────────────────────────────────────

  fastify.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, previewImage, modelType = 'single' } = req.body
    if (!name) return reply.code(400).send({ success: false, message: '款式名称必填' })
    const maxSort = await fastify.prisma.machineModel.findFirst({
      orderBy: { sortOrder: 'desc' }, select: { sortOrder: true }
    })
    const model = await fastify.prisma.machineModel.create({
      data: {
        name,
        description:  description  ?? null,
        previewImage: previewImage ?? null,
        modelType:    modelType,
        ratios:       JSON.stringify(['1:1']),
        frameOptions: JSON.stringify([]),
        sizes:        JSON.stringify([]),
        isActive:     true,
        sortOrder:    maxSort ? maxSort.sortOrder + 1 : 0,
      }
    })
    return reply.code(201).send({ success: true, data: parseModel(model) })
  })

  fastify.put('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const { name, description, previewImage, videoUrl, isActive, sortOrder, modelType } = req.body
    const existing = await fastify.prisma.machineModel.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ success: false, message: '款式不存在' })
    const data = {}
    if (name          !== undefined) data.name         = name
    if (description   !== undefined) data.description  = description
    if (previewImage  !== undefined) data.previewImage = previewImage
    if (videoUrl      !== undefined) data.videoUrl     = videoUrl
    if (isActive      !== undefined) data.isActive     = isActive
    if (sortOrder     !== undefined) data.sortOrder    = sortOrder
    if (modelType     !== undefined) data.modelType    = modelType
    const updated = await fastify.prisma.machineModel.update({ where: { id }, data })
    return reply.send({ success: true, data: parseModel(updated) })
  })

  fastify.delete('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const existing = await fastify.prisma.machineModel.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ success: false, message: '款式不存在' })
    const skuCount = await fastify.prisma.machineModelSku.count({ where: { modelId: id } })
    if (skuCount > 0) {
      return reply.code(400).send({
        success: false,
        message: `该款式下还有 ${skuCount} 个SKU，请先删除所有SKU再删除款式`
      })
    }
    await fastify.prisma.machineModel.delete({ where: { id } })
    return reply.send({ success: true, message: '款式已删除' })
  })

  fastify.post('/:id/skus', { preHandler: requireAdmin }, async (req, reply) => {
    const { id: modelId } = req.params
    const { size, material, frameCount, colorName, colorHex, price } = req.body

    if (!size)      return reply.code(400).send({ success: false, message: '尺寸必填' })
    if (!material)  return reply.code(400).send({ success: false, message: '材质必填' })
    if (!frameCount) return reply.code(400).send({ success: false, message: '帧数必填' })
    if (!colorName) return reply.code(400).send({ success: false, message: '颜色名称必填' })
    if (!colorHex)  return reply.code(400).send({ success: false, message: '颜色色值必填' })
    if (price === undefined || price === null || price === '') {
      return reply.code(400).send({ success: false, message: '价格必填' })
    }
    if (Number(price) < 0) return reply.code(400).send({ success: false, message: '价格不能为负数' })

    const model = await fastify.prisma.machineModel.findUnique({ where: { id: modelId } })
    if (!model) return reply.code(404).send({ success: false, message: '款式不存在' })

    const duplicate = await fastify.prisma.machineModelSku.findFirst({
      where: { modelId, size, material, frameCount: Number(frameCount), colorName }
    })
    if (duplicate) {
      return reply.code(400).send({
        success: false,
        message: `已存在相同SKU：${size} · ${material} · ${frameCount}帧 · ${colorName}`
      })
    }

    const maxSort = await fastify.prisma.machineModelSku.findFirst({
      where: { modelId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true }
    })

    const skuBarcode = `MOWO-SKU-${modelId.slice(0,4).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`

    const sku = await fastify.prisma.machineModelSku.create({
      data: {
        modelId, size, material,
        frameCount:  Number(frameCount),
        colorName,
        colorHex,
        price:     Number(price),
        skuBarcode,
        skuCode:   skuBarcode,
        isActive:  true,
        sortOrder: maxSort ? maxSort.sortOrder + 1 : 0,
      }
    })

    await fastify.prisma.skuInventory.create({
      data: {
        skuId:         sku.id,
        currentStock:  0,
        reservedStock: 0,
        safetyStock:   10,
        maxOrderLimit: 100,
      }
    })

    return reply.code(201).send({ success: true, data: sku })
  })

  // SKU 材料清单（BOM）：零件只能在库存页建立，这里仅选择并设置每套用量。
  fastify.get('/skus/:skuId/bom', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })

    const bindings = await fastify.prisma.materialSkuBinding.findMany({
      where: { skuId }, orderBy: { createdAt: 'asc' }
    })
    const materialIds = bindings.map(item => item.materialId)
    const materials = await fastify.prisma.materialItem.findMany({ where: { id: { in: materialIds } } })
    const materialMap = Object.fromEntries(materials.map(item => [item.id, item]))

    return reply.send({
      success: true,
      data: {
        skuId,
        version: sku.bomVersion || 0,
        items: bindings.map(binding => ({ ...binding, material: materialMap[binding.materialId] || null }))
      }
    })
  })

  fastify.put('/skus/:skuId/bom', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const items = Array.isArray(req.body?.items) ? req.body.items : null
    if (!items) return reply.code(400).send({ success: false, message: '材料清单格式无效' })

    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })

    const normalized = []
    const seen = new Set()
    for (const item of items) {
      const materialId = String(item.materialId || '')
      const qtyPerUnit = Number(item.qtyPerUnit)
      if (!materialId || seen.has(materialId))
        return reply.code(400).send({ success: false, message: '材料清单包含空项或重复零件' })
      if (!Number.isInteger(qtyPerUnit) || qtyPerUnit <= 0)
        return reply.code(400).send({ success: false, message: '每套用量必须为正整数' })
      seen.add(materialId)
      normalized.push({ materialId, skuId, qtyPerUnit })
    }

    if (normalized.length) {
      const activeCount = await fastify.prisma.materialItem.count({
        where: { id: { in: normalized.map(item => item.materialId) }, isActive: true }
      })
      if (activeCount !== normalized.length)
        return reply.code(400).send({ success: false, message: '材料清单中存在已停用或不存在的零件' })
    }

    const nextVersion = (sku.bomVersion || 0) + 1
    await fastify.prisma.$transaction(async tx => {
      await tx.materialSkuBinding.deleteMany({ where: { skuId } })
      if (normalized.length) await tx.materialSkuBinding.createMany({ data: normalized })
      await tx.machineModelSku.update({ where: { id: skuId }, data: { bomVersion: nextVersion } })
    })

    return reply.send({ success: true, message: '材料清单已保存', data: { skuId, version: nextVersion, items: normalized } })
  })

  // ─────────────────────────────────────────────
  // SKU 示例物料（exampleMedia）
  // ─────────────────────────────────────────────

  /**
   * POST /api/machine-models/skus/:skuId/example-media
   * 上传一张示例图片，追加到 exampleMedia JSON 数组（最多5张）
   */
  fastify.post('/skus/:skuId/example-media', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })

    const existing = safeJson(sku.exampleMedia, [])
    if (existing.length >= 5) {
      return reply.code(400).send({ success: false, message: '示例图最多5张，请先删除旧图' })
    }

    const data = await req.file()
    if (!data) return reply.code(400).send({ success: false, message: '未收到文件' })

    const ext = (data.filename || 'jpg').split('.').pop().toLowerCase() || 'jpg'
    const objectKey = `sku-example/${skuId}/${Date.now()}.${ext}`

    const chunks = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    if (buffer.length > 5 * 1024 * 1024) {
      return reply.code(400).send({ success: false, message: '图片不能超过 5MB' })
    }

    await fastify.oss.put(objectKey, buffer, {
      headers: { 'Content-Type': data.mimetype || 'image/jpeg' }
    })

    const updated = await fastify.prisma.machineModelSku.update({
      where: { id: skuId },
      data: { exampleMedia: JSON.stringify([...existing, objectKey]) }
    })

    const previewUrl = fastify.ossPresignGet(objectKey, 3600)
    return reply.send({ success: true, data: { objectKey, previewUrl, exampleMedia: safeJson(updated.exampleMedia, []) } })
  })

  /**
   * DELETE /api/machine-models/skus/:skuId/example-media
   * 从 exampleMedia 数组删除指定的 objectKey
   * Body: { objectKey: string }
   */
  fastify.delete('/skus/:skuId/example-media', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { objectKey } = req.body
    if (!objectKey) return reply.code(400).send({ success: false, message: 'objectKey必填' })

    const sku = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
    if (!sku) return reply.code(404).send({ success: false, message: 'SKU不存在' })

    const existing = safeJson(sku.exampleMedia, [])
    const filtered = existing.filter(k => k !== objectKey)

    await fastify.prisma.machineModelSku.update({
      where: { id: skuId },
      data: { exampleMedia: JSON.stringify(filtered) }
    })

    // 尝试从 OSS 删除（非关键操作，失败不影响响应）
    fastify.oss.delete(objectKey).catch(() => {})

    return reply.send({ success: true, data: { exampleMedia: filtered } })
  })

  // ─────────────────────────────────────────────
  // 排序接口
  // ─────────────────────────────────────────────

  // PUT /api/machine-models/reorder — 调整款式顺序
  fastify.put('/reorder', { preHandler: requireAdmin }, async (req, reply) => {
    const { modelIds } = req.body
    if (!Array.isArray(modelIds) || !modelIds.length)
      return reply.code(400).send({ success: false, message: 'modelIds不能为空' })

    await Promise.all(modelIds.map((id, idx) =>
      fastify.prisma.machineModel.update({
        where: { id },
        data:  { sortOrder: idx }
      })
    ))

    return reply.send({ success: true, message: '款式顺序已保存' })
  })

  // PUT /api/machine-models/:id/skus/reorder — 调整某款式下SKU顺序
  fastify.put('/:id/skus/reorder', { preHandler: requireAdmin }, async (req, reply) => {
    const { id: modelId } = req.params
    const { skuIds }      = req.body
    if (!Array.isArray(skuIds) || !skuIds.length)
      return reply.code(400).send({ success: false, message: 'skuIds不能为空' })

    await Promise.all(skuIds.map((id, idx) =>
      fastify.prisma.machineModelSku.update({
        where: { id },
        data:  { sortOrder: idx }
      })
    ))

    return reply.send({ success: true, message: 'SKU顺序已保存' })
  })

  // ─────────────────────────────────────────────
  // 辅助
  // ─────────────────────────────────────────────

  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      const user  = fastify.jwt.decode(token)
      fastify.jwt.verify(token)
      if (!user || user.role < 2) {
        return reply.code(403).send({ success: false, message: '权限不足' })
      }
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}

function parseModel(m) {
  return {
    ...m,
    ratios:       safeJson(m.ratios,       []),
    frameOptions: safeJson(m.frameOptions, []),
    sizes:        safeJson(m.sizes,        []),
  }
}

function safeJson(str, fallback = []) {
  try { return JSON.parse(str) } catch { return fallback }
}
