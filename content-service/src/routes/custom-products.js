// src/routes/custom-products.js
// DIY 定制草稿工作区 API
// 注册前缀：/api/custom-products

import { FILE_PURPOSE, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'

const DRAFT_LIMIT = 3

function draftKey(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  return key && key.length <= 80 ? key : null
}

export default async function customProductRoutes(fastify) {
  const { prisma } = fastify

  // ── 创建草稿（编辑器保存）──
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const rawClientDraftKey = req.body?.clientDraftKey
    const clientDraftKey = rawClientDraftKey == null ? null : draftKey(rawClientDraftKey)
    if (rawClientDraftKey != null && !clientDraftKey) {
      return reply.code(400).send({ success: false, message: '草稿标识无效，请刷新后重试' })
    }
    const existing = clientDraftKey
      ? await prisma.customProduct.findUnique({ where: { clientDraftKey } })
      : null
    if (existing) {
      if (existing.userId !== userId) {
        return reply.code(409).send({ success: false, message: '草稿标识冲突，请刷新后重试' })
      }
      return reply.send({ success: true, data: existing, reused: true })
    }
    const {
      animationFrames, // JSON 字符串，帧图 OSS URL 列表
      draftData,       // 工程文件 JSON
      previewUrl,      // GIF 预览
      staticPreviewUrl,// 效果图 PNG
      configJson,      // 定制参数 { size, material, colorName, frameCount, ... }
      hardwareSkuId,
      frameCount
    } = req.body

    if (!animationFrames) {
      return reply.code(400).send({ success: false, message: '帧图数据不能为空' })
    }

    let frameKeys
    try {
      frameKeys = typeof animationFrames === 'string' ? JSON.parse(animationFrames) : animationFrames
      if (!Array.isArray(frameKeys) || frameKeys.length === 0 || frameKeys.length > 50) throw new Error()
    } catch {
      return reply.code(400).send({ success: false, message: '帧图数据格式无效' })
    }
    let ownedFrames = []
    try {
      ownedFrames = await findOwnedReadyFiles(prisma, frameKeys, userId, [FILE_PURPOSE.CREATOR_FRAME, FILE_PURPOSE.CUSTOMIZATION_FRAME])
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    // ── 草稿数量上限（当前版本所有用户规则一致）──
    const activeDraftCount = await prisma.customProduct.count({
      where: { userId, status: { in: ['draft', 'in_cart'] } }
    })
    if (activeDraftCount >= DRAFT_LIMIT) {
      return reply.code(400).send({
        success: false,
        code: 'DRAFT_LIMIT_REACHED',
        message: `草稿箱已达上限（${DRAFT_LIMIT} 个），请先在「我的动画」删除旧草稿再继续`
      })
    }

    const draftExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    let cp
    try {
      cp = await prisma.$transaction(async tx => {
        const created = await tx.customProduct.create({ data: {
          userId, clientDraftKey,
          animationFrames: JSON.stringify(frameKeys),
          draftData:        draftData || null,
          draftExpiresAt,
          previewUrl:       previewUrl || null,
          staticPreviewUrl: staticPreviewUrl || null,
          configJson:       configJson || null,
          hardwareSkuId:    hardwareSkuId || null,
          frameCount:       frameCount ? parseInt(frameCount) : null,
          status:           'draft'
        } })
        await linkFiles(tx, ownedFrames, 'CUSTOM_PRODUCT', created.id)
        return created
      })
    } catch (error) {
      if (error.code !== 'P2002' || !clientDraftKey) throw error
      cp = await prisma.customProduct.findUnique({ where: { clientDraftKey } })
      if (!cp || cp.userId !== userId) {
        return reply.code(409).send({ success: false, message: '草稿标识冲突，请刷新后重试' })
      }
      return reply.send({ success: true, data: cp, reused: true })
    }

    return reply.send({ success: true, data: cp })
  })

  // ── 草稿配额查询（前端在进入编辑流程前调用）──
  fastify.get('/quota', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const count = await prisma.customProduct.count({
      where: { userId, status: { in: ['draft', 'in_cart'] } }
    })
    return reply.send({
      success: true,
      data: { count, limit: DRAFT_LIMIT, canCreate: count < DRAFT_LIMIT }
    })
  })

  // ── 列出当前用户的动画作品（创作者动画库）──
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const page  = Math.max(1, Number(req.query.page  || 1))
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)))
    const skip  = (page - 1) * limit

    const [items, total] = await Promise.all([
      prisma.customProduct.findMany({
        where:   { userId, status: { not: 'removed' } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.customProduct.count({ where: { userId, status: { not: 'removed' } } }),
    ])

    const itemsWithPreview = await Promise.all(items.map(async item => {
      let previewFrameUrl = null
      try {
        const keys = JSON.parse(item.animationFrames || '[]')
        const firstKey = Array.isArray(keys) ? keys[0] : null
        if (typeof firstKey === 'string' && !firstKey.startsWith('data:') && !firstKey.startsWith('http')) {
          const file = await prisma.privateFile.findFirst({ where: {
            objectKey: firstKey,
            ownerUserId: userId,
            status: 'READY',
            linkedResourceType: 'CUSTOM_PRODUCT',
            linkedResourceId: item.id
          } })
          if (file) previewFrameUrl = fastify.storagePresignGet(file.objectKey, 300)
        }
      } catch {}
      return { ...item, previewFrameUrl }
    }))

    return reply.send({
      success: true,
      data: {
        items: itemsWithPreview,
        total,
        page,
        hasMore: skip + items.length < total,
      }
    })
  })

  // Vue 编辑器只读取草稿重编所需字段和短期帧地址，不返回整行内部数据。
  fastify.get('/:id/editor', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.userId
    const cp = await prisma.customProduct.findUnique({ where: { id: req.params.id } })
    if (!cp || cp.userId !== userId || ['ordered', 'removed'].includes(cp.status)) {
      return reply.code(404).send({ success: false, message: '可编辑草稿不存在' })
    }
    const request = await prisma.customizationRequest.findFirst({
      where: { customProductId: cp.id }, orderBy: { createdAt: 'desc' }
    })
    if (request && request.status !== 'DRAFT') {
      return reply.code(409).send({ success: false, message: '该定制已提交，不能继续修改帧图' })
    }
    let frameKeys = []
    try { frameKeys = JSON.parse(cp.animationFrames || '[]') } catch {}
    if (!Array.isArray(frameKeys) || !frameKeys.length) {
      return reply.code(409).send({ success: false, message: '草稿没有可恢复的帧图' })
    }
    const uniqueKeys = [...new Set(frameKeys)]
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: uniqueKeys }, ownerUserId: userId, status: 'READY', deletedAt: null,
      linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: cp.id
    } })
    if (files.length !== uniqueKeys.length) {
      return reply.code(409).send({ success: false, message: '草稿帧图不完整，请重新上传素材' })
    }
    const frames = frameKeys.map(key => {
      const signed = fastify.storagePresignGet(key, 1800)
      return { key, url: signed.startsWith('/') ? `${req.protocol}://${req.headers.host}${signed}` : signed }
    })
    let config = {}
    try { config = JSON.parse(cp.configJson || '{}') } catch {}
    return reply.send({ success: true, data: {
      id: cp.id, status: cp.status, frameCount: cp.frameCount, frames, config,
      request: request ? { id: request.id, status: request.status, machineModelId: request.machineModelId } : null
    } })
  })

  // 原位更新同一商品草稿及其 DRAFT 请求，禁止重编时另建第二份草稿。
  fastify.patch('/:id/editor', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.userId
    const cp = await prisma.customProduct.findUnique({ where: { id: req.params.id } })
    if (!cp || cp.userId !== userId || ['ordered', 'removed'].includes(cp.status)) {
      return reply.code(404).send({ success: false, message: '可编辑草稿不存在' })
    }
    const frameKeys = Array.isArray(req.body?.frameKeys) ? req.body.frameKeys : []
    if (!frameKeys.length || frameKeys.length > 50 || frameKeys.some(key => typeof key !== 'string')) {
      return reply.code(400).send({ success: false, message: '草稿帧图数据无效' })
    }
    const request = await prisma.customizationRequest.findFirst({
      where: { customProductId: cp.id }, orderBy: { createdAt: 'desc' }
    })
    if (request && request.status !== 'DRAFT') {
      return reply.code(409).send({ success: false, message: '该定制已提交，不能继续修改帧图' })
    }
    const uniqueKeys = [...new Set(frameKeys)]
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: uniqueKeys }, ownerUserId: userId, status: 'READY', deletedAt: null,
      linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: cp.id
    } })
    if (files.length !== uniqueKeys.length) {
      return reply.code(400).send({ success: false, message: '草稿帧图不存在或不属于当前账号' })
    }
    const updated = await prisma.$transaction(async tx => {
      const product = await tx.customProduct.update({ where: { id: cp.id }, data: {
        animationFrames: JSON.stringify(frameKeys), frameCount: frameKeys.length,
        draftData: req.body?.editorData ? JSON.stringify(req.body.editorData) : cp.draftData,
        draftExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      } })
      if (request) await tx.customizationRequest.update({ where: { id: request.id }, data: {
        selectedFrameKeys: frameKeys,
        screeningData: { selectedFrameCount: frameKeys.length },
        editorData: req.body?.editorData || request.editorData || undefined
      } })
      return product
    })
    return reply.send({ success: true, data: { id: updated.id, requestId: request?.id || null, frameCount: updated.frameCount } })
  })

  // ── 获取草稿详情 ──
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const cp = await prisma.customProduct.findUnique({ where: { id } })
    if (!cp) return reply.code(404).send({ success: false, message: '草稿不存在' })
    if (cp.userId !== userId) return reply.code(403).send({ success: false, message: '无权访问' })

    return reply.send({ success: true, data: cp })
  })

  // ── 只修改草稿名称，不接收或覆盖其他工程配置 ──
  fastify.patch('/:id/title', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params
    const title = String(req.body?.title || '').trim()
    if (!title || title.length > 40) {
      return reply.code(400).send({ success: false, message: '动画名称需要包含 1 至 40 个字符' })
    }

    const cp = await prisma.customProduct.findUnique({ where: { id } })
    if (!cp) return reply.code(404).send({ success: false, message: '草稿不存在' })
    if (cp.userId !== userId) return reply.code(403).send({ success: false, message: '无权访问' })
    if (cp.status === 'ordered' || cp.status === 'removed') {
      return reply.code(400).send({ success: false, message: '该草稿已提交，不可再编辑' })
    }
    const customizationRequest = await prisma.customizationRequest.findFirst({
      where: { customProductId: cp.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true }
    })
    if (customizationRequest && customizationRequest.status !== 'DRAFT') {
      return reply.code(409).send({ success: false, message: '该定制已提交或正在清理，不能修改名称' })
    }

    let config = {}
    try {
      const parsed = typeof cp.configJson === 'string' ? JSON.parse(cp.configJson) : cp.configJson
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed
    } catch {}
    const updated = await prisma.customProduct.update({
      where: { id },
      data: { configJson: JSON.stringify({ ...config, animName: title }) }
    })
    return reply.send({ success: true, data: { id: updated.id, title } })
  })

  // ── 更新草稿（延长有效期）──
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params
    const {
      animationFrames,
      draftData,
      previewUrl,
      staticPreviewUrl,
      configJson,
      hardwareSkuId,
      frameCount
    } = req.body

    const cp = await prisma.customProduct.findUnique({ where: { id } })
    if (!cp) return reply.code(404).send({ success: false, message: '草稿不存在' })
    if (cp.userId !== userId) return reply.code(403).send({ success: false, message: '无权访问' })
    if (cp.status === 'ordered' || cp.status === 'removed') {
      return reply.code(400).send({ success: false, message: '该草稿已提交，不可再编辑' })
    }
    const customizationRequest = await prisma.customizationRequest.findFirst({
      where: { customProductId: cp.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true }
    })
    if (customizationRequest && customizationRequest.status !== 'DRAFT') {
      return reply.code(409).send({ success: false, message: '该定制已提交或正在清理，不能继续修改帧图' })
    }

    let nextFrameKeys = null
    let newlyLinkedFrames = []
    if (animationFrames !== undefined) {
      try {
        nextFrameKeys = typeof animationFrames === 'string' ? JSON.parse(animationFrames) : animationFrames
        if (!Array.isArray(nextFrameKeys) || nextFrameKeys.length === 0 || nextFrameKeys.length > 50) throw new Error()
      } catch {
        return reply.code(400).send({ success: false, message: '帧图数据格式无效' })
      }
      const files = await prisma.privateFile.findMany({ where: {
        objectKey: { in: [...new Set(nextFrameKeys)] },
        ownerUserId: userId,
        purpose: { in: [FILE_PURPOSE.CREATOR_FRAME, FILE_PURPOSE.CUSTOMIZATION_FRAME] },
        status: 'READY',
        OR: [
          { linkedResourceId: null },
          { linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: cp.id }
        ]
      } })
      if (files.length !== nextFrameKeys.length) {
        return reply.code(400).send({ success: false, message: '文件不存在、未完成上传或不属于当前草稿' })
      }
      newlyLinkedFrames = files.filter(file => !file.linkedResourceId)
    }

    // 延长 7 天
    const draftExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const updated = await prisma.$transaction(async tx => {
      const saved = await tx.customProduct.update({
        where: { id },
        data: {
        animationFrames:  nextFrameKeys ? JSON.stringify(nextFrameKeys) : cp.animationFrames,
        draftData:        draftData        !== undefined ? draftData : cp.draftData,
        previewUrl:       previewUrl       !== undefined ? previewUrl : cp.previewUrl,
        staticPreviewUrl: staticPreviewUrl !== undefined ? staticPreviewUrl : cp.staticPreviewUrl,
        configJson:       configJson       !== undefined ? configJson : cp.configJson,
        hardwareSkuId:    hardwareSkuId    !== undefined ? hardwareSkuId : cp.hardwareSkuId,
        frameCount:       frameCount       !== undefined ? parseInt(frameCount) : cp.frameCount,
        draftExpiresAt
        }
      })
      await linkFiles(tx, newlyLinkedFrames, 'CUSTOM_PRODUCT', cp.id)
      return saved
    })

    return reply.send({ success: true, data: updated })
  })

  // ── 删除动画作品（软删除）──
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const cp = await prisma.customProduct.findUnique({ where: { id } })
    if (!cp) return reply.code(404).send({ success: false, message: '动画作品不存在' })
    if (cp.userId !== userId) return reply.code(403).send({ success: false, message: '无权操作' })
    if (cp.status === 'in_cart' || cp.status === 'ordered') {
      return reply.code(400).send({ success: false, message: '该动画已在购物车或订单中，无法删除' })
    }
    const submittedRequest = await prisma.customizationRequest.findFirst({
      where: { customProductId: cp.id, status: { not: 'DRAFT' } },
      select: { id: true }
    })
    if (submittedRequest) {
      return reply.code(409).send({ success: false, message: '该动画已提交制作审核，不能删除' })
    }

    await prisma.customProduct.update({ where: { id }, data: { status: 'removed' } })
    return reply.send({ success: true })
  })

  // ── 重新生成预览图（当前 mock，可接 OSS 合成）──
  fastify.post('/:id/regenerate-preview', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const cp = await prisma.customProduct.findUnique({ where: { id } })
    if (!cp) return reply.code(404).send({ success: false, message: '草稿不存在' })
    if (cp.userId !== userId) return reply.code(403).send({ success: false, message: '无权访问' })

    // TODO: 接入实际预览图生成队列（当前直接返回）
    return reply.send({
      success: true,
      message: '预览图生成任务已投递',
      data: { id, previewUrl: cp.previewUrl }
    })
  })
}
