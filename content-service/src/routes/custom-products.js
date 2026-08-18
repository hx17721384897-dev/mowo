// src/routes/custom-products.js
// DIY 定制草稿工作区 API
// 注册前缀：/api/custom-products

import { FILE_PURPOSE, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'

export default async function customProductRoutes(fastify) {
  const { prisma } = fastify

  // ── 创建草稿（编辑器保存）──
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
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

    // ── 草稿数量上限（普通用户 3 个，认证创作者 10 个）──
    const certifyStatus = req.user.certifyStatus ?? 0
    const DRAFT_LIMIT = certifyStatus >= 2 ? 10 : 3
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

    const cp = await prisma.$transaction(async tx => {
      const created = await tx.customProduct.create({ data: {
        userId,
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

    return reply.send({ success: true, data: cp })
  })

  // ── 草稿配额查询（前端在进入编辑流程前调用）──
  fastify.get('/quota', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.userId
    const certifyStatus = req.user.certifyStatus ?? 0
    const limit = certifyStatus >= 2 ? 10 : 3
    const count = await prisma.customProduct.count({
      where: { userId, status: { in: ['draft', 'in_cart'] } }
    })
    return reply.send({
      success: true,
      data: { count, limit, canCreate: count < limit }
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
