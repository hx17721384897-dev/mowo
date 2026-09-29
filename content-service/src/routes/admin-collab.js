// src/routes/admin-collab.js — 管理员联名作品、商品与库存管理
// 全部需要 role >= 2

import crypto from 'node:crypto'
import {
  COLLAB_FULFILLMENT_MODE,
  getCollabSaleReadiness,
  isCollabSkuFrameCompatible,
  isLegacyInlineCollabCover,
  normalizeSaleConfigInput,
} from '../lib/collab-sale-config.js'
import { FILE_PURPOSE, linkFiles } from '../lib/private-files.js'
import { PERMISSION } from '../lib/permissions.js'

export default async function adminCollabRoutes(fastify) {
  const { prisma } = fastify
  // 旧版本在此自行解码 JWT 并覆盖 req.user，导致路由处理器可能读到
  // token 内的历史岗位，而不是 authenticate 已从数据库确认的当前岗位。
  // 保留局部 preHandler 作为路由自说明，但复用唯一的命名权限校验。
  const requireAdmin = fastify.requirePermission(PERMISSION.COLLAB)

  function framePackMutationResponse(row, replayed = false) {
    return {
      stockType: row.stockType,
      quantity: row.quantity,
      currentStock: row.resultStock,
      replayed,
    }
  }

  function framePackMutationError(code, message) {
    const error = new Error(message)
    error.businessCode = code
    return error
  }

  // ─────────────────────────────────────────────
  // 已完成线下合作确认的联名作品运营
  // ─────────────────────────────────────────────

  /**
   * GET /api/admin/collab/works
   * 联名作品列表（只返回已完成线下合作确认的作品）
   * 查询参数：page / limit
   */
  fastify.get('/admin/collab/works', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = { status: 'approved' }

    const [works, total] = await Promise.all([
      prisma.collabWork.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          saleSkus: {
            where: { isEnabled: true },
            select: { id: true, finalPrice: true, leadTimeDays: true, fulfillmentMode: true },
          },
        },
      }),
      prisma.collabWork.count({ where }),
    ])

    // 附创作者信息
    const creatorIds = [...new Set(works.map(w => w.creatorId))]
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, nickname: true, avatarUrl: true },
    })
    const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]))

    const result = works.map(w => {
      // 预签名封面图（list 不含完整 animationFrames，避免大量 base64 数据）
      const coverUrl = presignAdminKey(w.coverUrl, fastify, 3600)
      return {
        ...w,
        animationFrames: [],           // list 不返回帧数据，减小响应体积
        coverUrl,                      // 已预签名，前端直接用
        supportedSkus: safeJson(w.supportedSkus),
        creator: profileMap[w.creatorId] ?? null,
        saleConfigCount: w.saleSkus.length,
      }
    })

    return reply.send({ success: true, data: { works: result, total, page: Number(page), limit: Number(limit) } })
  })

  /**
   * GET /api/admin/collab/works/:id
   * 联名作品运营详情（含帧图预签名 URL）
   */
  fastify.get('/admin/collab/works/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findFirst({
      where: { id: req.params.id, status: 'approved' },
      include: {
        animationVersion: { select: { baseFrameCount: true } },
        saleSkus: { where: { isEnabled: true }, orderBy: { sortOrder: 'asc' }, include: { sku: { include: { model: true } } } },
      },
    })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })

    const frameKeys = safeJson(work.animationFrames)
    const frameUrls = frameKeys.map(key =>
      (key && !key.startsWith('data:') && !key.startsWith('http'))
        ? fastify.ossPresignGet(key, 3600)
        : key  // data URI 直接透传给管理员预览
    )
    const coverUrl = (work.coverUrl && !work.coverUrl.startsWith('data:') && !work.coverUrl.startsWith('http'))
      ? fastify.ossPresignGet(work.coverUrl, 3600)
      : work.coverUrl || null

    const profile = await prisma.userProfile.findUnique({
      where: { userId: work.creatorId },
      select: { userId: true, nickname: true, avatarUrl: true },
    })
    const readiness = await getCollabSaleReadiness(prisma, work.id)

    return reply.send({
      success: true,
      data: {
        ...work,
        animationFrames: frameUrls,
        coverUrl,
        supportedSkus: safeJson(work.supportedSkus),
        creator: profile,
        saleReadiness: { ready: readiness.ready, blockers: readiness.blockers, baseFrameCount: readiness.baseFrameCount },
      },
    })
  })

  /**
   * PUT /api/admin/collab/:id/suspend
   * 管理员暂停销售
   */
  fastify.put('/admin/collab/:id/suspend', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved')
      return reply.code(400).send({ success: false, message: '只有完成线下合作确认的作品才能暂停' })
    if (work.shelfStatus === 'suspended')
      return reply.code(400).send({ success: false, message: '作品已处于暂停状态' })

    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        shelfStatus: 'suspended',
        suspendedAt: new Date(),
        suspendedBy: req.user.userId,
        isOnShelf:   false,
      },
    })
    return reply.send({ success: true, message: '已暂停销售', data: updated })
  })

  /**
   * PUT /api/admin/collab/:id/resume
   * 管理员恢复上架（从暂停状态）
   */
  fastify.put('/admin/collab/:id/resume', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.shelfStatus !== 'suspended')
      return reply.code(400).send({ success: false, message: '只有暂停中的作品才能恢复' })
    if (!(await requireSaleReady(req.params.id, reply))) return

    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        shelfStatus: 'on_sale',
        suspendedAt: null,
        suspendedBy: null,
        isOnShelf:   true,
      },
    })
    return reply.send({ success: true, message: '已恢复上架', data: updated })
  })

  /**
   * PUT /api/admin/collab/:id/force-delist
   * 管理员强制下架，需填写内部备注和给创作者的通知
   * Body: { reason, notice }
   */
  fastify.put('/admin/collab/:id/force-delist', { preHandler: requireAdmin }, async (req, reply) => {
    const { reason, notice } = req.body
    if (!reason?.trim()) return reply.code(400).send({ success: false, message: '请填写下架原因（内部备注）' })
    if (!notice?.trim()) return reply.code(400).send({ success: false, message: '请填写发给创作者的通知内容' })

    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved')
      return reply.code(400).send({ success: false, message: '只有完成线下合作确认的作品才能下架' })

    const now = new Date()
    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        shelfStatus:    'off_shelf',
        isOnShelf:      false,
        offShelfAt:     now,
        offShelfType:   'platform_force',
        offShelfReason: reason.trim(),
        offShelfNotice: notice.trim(),
        suspendedAt:    null,
        suspendedBy:    null,
      },
    })

    return reply.send({ success: true, message: '已强制下架并记录告知内容', data: updated })
  })

  /**
   * PUT /api/admin/collab/:id/relist
   * 管理员重新上架已下架作品（无需重复线下确认）
   */
  fastify.put('/admin/collab/:id/relist', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.shelfStatus !== 'off_shelf')
      return reply.code(400).send({ success: false, message: '只有已下架的作品才能重新上架' })
    if (!(await requireSaleReady(req.params.id, reply))) return

    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        shelfStatus:    'on_sale',
        isOnShelf:      true,
        shelfAt:        new Date(),
        offShelfAt:     null,
        offShelfType:   null,
        offShelfReason: null,
        offShelfNotice: null,
      },
    })
    return reply.send({ success: true, message: '已重新上架', data: updated })
  })

  // ─────────────────────────────────────────────
  // 联名商品编辑工作区：商品资料、媒体、销售 SKU、库存提示与审计记录共用一个入口。
  // ─────────────────────────────────────────────

  fastify.get('/admin/collab/:id/product-workspace', { preHandler: requireAdmin }, async (req, reply) => {
    const readiness = await getCollabSaleReadiness(prisma, req.params.id)
    if (!readiness.work) return reply.code(404).send({ success: false, message: '作品不存在' })

    const work = await prisma.collabWork.findUnique({
      where: { id: req.params.id },
      include: {
        animationAsset: { select: { assetNo: true, title: true } },
        animationVersion: { select: { versionNo: true, baseFrameCount: true } },
        saleSkus: { orderBy: { sortOrder: 'asc' } },
      },
    })

    const candidates = await prisma.machineModelSku.findMany({
      where: {
        OR: [
          { isActive: true, model: { isActive: true } },
          { collabSaleSkus: { some: { collabWorkId: req.params.id } } },
        ],
      },
      orderBy: [
        { model: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
        { size: 'asc' },
        { frameCount: 'asc' },
      ],
      include: { model: { select: { id: true, name: true, isActive: true } } },
    })

    const skuIds = candidates.map(sku => sku.id)
    const inventories = skuIds.length ? await prisma.skuInventory.findMany({ where: { skuId: { in: skuIds } } }) : []
    const inventoryMap = new Map(inventories.map(row => [row.skuId, row]))
    const imageUrl = key => presignAdminKey(key, fastify, 3600)
    const activeMap = new Map(candidates.map(sku => [sku.id, sku.isActive && sku.model.isActive]))
    const selected = work.saleSkus.map(offer => ({
      id: offer.id,
      skuId: offer.skuId,
      finalPrice: Number(offer.finalPrice),
      fulfillmentMode: offer.fulfillmentMode,
      leadTimeDays: offer.leadTimeDays,
      sortOrder: offer.sortOrder,
      isEnabled: offer.isEnabled && activeMap.get(offer.skuId) === true,
    }))

    return reply.send({
      success: true,
      data: {
        productNo: work.productNo,
        shelfStatus: work.shelfStatus,
        isOnShelf: work.isOnShelf,
        sourceTitle: work.title,
        sourceDescription: work.description,
        storefrontTitle: work.storefrontTitle || work.title,
        storefrontSummary: work.storefrontSummary,
        storefrontDescription: work.storefrontDescription || work.description,
        storefrontMedia: await Promise.all(safeJson(work.storefrontMedia).map(async key => ({
          key,
          url: presignAdminKey(key, fastify, 3600),
          kind: await mediaKind(prisma, key),
        }))),
        storefrontTags: safeJson(work.storefrontTags),
        storefrontSeries: work.storefrontSeries,
        storefrontKeywords: work.storefrontKeywords,
        storefrontSortOrder: work.storefrontSortOrder,
        coverUrl: presignAdminKey(work.storefrontCoverUrl || work.coverUrl, fastify, 3600),
        coverKey: work.storefrontCoverUrl || work.coverUrl,
        hoverGifUrl: presignAdminKey(work.hoverGifUrl, fastify, 3600),
        asset: work.animationAsset ? {
          assetNo: work.animationAsset.assetNo,
          title: work.animationAsset.title,
          versionNo: work.animationVersion?.versionNo || null,
        } : null,
        baseFrameCount: readiness.baseFrameCount,
        ready: readiness.ready,
        blockers: readiness.blockers,
        readinessGroups: groupReadiness(readiness.blockers),
        selected,
        candidates: candidates.map(sku => ({
          id: sku.id,
          skuCode: sku.skuCode,
          modelId: sku.modelId,
          modelName: sku.model.name,
          size: sku.size,
          material: sku.material,
          frameCount: sku.frameCount,
          colorName: sku.colorName,
          colorHex: sku.colorHex,
          basePrice: Number(sku.price),
          previewImage: imageUrl(sku.previewImage),
          compatible: isCollabSkuFrameCompatible(readiness.baseFrameCount, sku.frameCount),
          isActive: sku.isActive && sku.model.isActive,
          inventory: inventorySummary(inventoryMap.get(sku.id)),
        })),
      },
    })
  })

  fastify.put('/admin/collab/:id/product-workspace', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        productNo: true,
        title: true,
        status: true,
        storefrontSummary: true,
        storefrontTitle: true,
        storefrontDescription: true,
        storefrontCoverUrl: true,
        storefrontMedia: true,
        storefrontTags: true,
        storefrontSeries: true,
        storefrontKeywords: true,
        storefrontSortOrder: true,
        coverUrl: true,
        animationFrames: true,
        animationVersion: { select: { baseFrameCount: true } },
        saleSkus: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved') {
      return reply.code(409).send({ success: false, message: '只有完成线下合作确认的正式作品可以配置销售规格' })
    }

    const config = normalizeSaleConfigInput(req.body)
    const storefrontTitle = String(req.body?.storefrontTitle || '').trim()
    const storefrontDescription = String(req.body?.storefrontDescription || '').trim()
    const storefrontSeries = String(req.body?.storefrontSeries || '').trim()
    const storefrontKeywords = String(req.body?.storefrontKeywords || '').trim()
    const storefrontTags = normalizeTextArray(req.body?.storefrontTags)
    const storefrontMedia = normalizeKeyArray(req.body?.storefrontMedia)
    const coverKey = String(req.body?.coverKey || '').trim()
    if (storefrontTitle.length < 2 || storefrontTitle.length > 120) {
      return reply.code(400).send({ success: false, message: '商品标题需为 2 至 120 个字' })
    }
    if (config.storefrontSummary && config.storefrontSummary.length > 300) {
      return reply.code(400).send({ success: false, message: '货架简介最多 300 个字' })
    }
    if (storefrontDescription.length > 5000) return reply.code(400).send({ success: false, message: '商品详情最多 5000 个字' })
    if (storefrontSeries.length > 80) return reply.code(400).send({ success: false, message: '系列名称最多 80 个字' })
    if (storefrontKeywords.length > 300) return reply.code(400).send({ success: false, message: '内部搜索词最多 300 个字' })
    if (storefrontTags.length > 10 || storefrontTags.some(tag => tag.length > 20)) {
      return reply.code(400).send({ success: false, message: '最多设置 10 个标签，每个不超过 20 个字' })
    }
    if (storefrontMedia.length > 8) return reply.code(400).send({ success: false, message: '商品展示素材最多 8 个' })
    const previousMedia = safeJson(work.storefrontMedia)
    const incomingMedia = storefrontMedia.filter(key => !previousMedia.includes(key))
    const mediaFiles = incomingMedia.length ? await prisma.privateFile.findMany({
      where: {
        objectKey: { in: incomingMedia },
        ownerUserId: req.user.userId,
        purpose: FILE_PURPOSE.COLLAB_STOREFRONT_MEDIA,
        status: 'READY',
        deletedAt: null,
        OR: [
          { linkedResourceId: null },
          { linkedResourceType: 'COLLAB_WORK', linkedResourceId: work.id },
        ],
      },
    }) : []
    if (mediaFiles.length !== incomingMedia.length) {
      return reply.code(409).send({ success: false, message: '展示素材不存在、尚未上传完成或不属于当前商品' })
    }
    const uploadedMedia = mediaFiles.filter(file => !file.linkedResourceId)
    const allowedCovers = new Set([work.storefrontCoverUrl, work.coverUrl, ...storefrontMedia].filter(Boolean))
    if (coverKey && !allowedCovers.has(coverKey)) return reply.code(400).send({ success: false, message: '商品封面必须来自当前展示素材' })
    if (isLegacyInlineCollabCover(coverKey)) {
      return reply.code(400).send({ success: false, message: '旧版封面不能用于正式商品，请在“展示素材与封面”中重新上传' })
    }
    if (config.storefrontSortOrder < -10000 || config.storefrontSortOrder > 10000) {
      return reply.code(400).send({ success: false, message: '推荐顺序必须在 -10000 到 10000 之间' })
    }
    if (config.skus.length > 100) {
      return reply.code(400).send({ success: false, message: '最多配置 100 个销售 SKU' })
    }
    const uniqueSkuIds = [...new Set(config.skus.map(row => row.skuId))]
    if (uniqueSkuIds.length !== config.skus.length || uniqueSkuIds.some(id => !id)) {
      return reply.code(400).send({ success: false, message: '销售配置包含空白或重复 SKU' })
    }

    const skus = await prisma.machineModelSku.findMany({
      where: { id: { in: uniqueSkuIds } },
      include: { model: { select: { name: true, isActive: true } } },
    })
    if (skus.length !== uniqueSkuIds.length) {
      return reply.code(409).send({ success: false, message: '部分 SKU 不存在、款式已停用或 SKU 已停用' })
    }
    const skuMap = new Map(skus.map(sku => [sku.id, sku]))
    const baseFrameCount = work.animationVersion?.baseFrameCount || safeJson(work.animationFrames).length
    if (!baseFrameCount) return reply.code(409).send({ success: false, message: '作品没有可用核心帧，暂不能配置销售规格' })

    for (const row of config.skus) {
      const sku = skuMap.get(row.skuId)
      const label = sku.skuCode || `${sku.model.name} ${sku.size} ${sku.frameCount}帧`
      if (row.isEnabled && (!sku.isActive || !sku.model.isActive)) {
        return reply.code(409).send({ success: false, message: `${label} 已停用，只能保留为停售历史规格` })
      }
      if (!isCollabSkuFrameCompatible(baseFrameCount, sku.frameCount)) {
        return reply.code(409).send({ success: false, message: `${label} 与 ${baseFrameCount} 个核心帧不兼容` })
      }
      if (!Number.isFinite(row.finalPrice) || row.finalPrice < Number(sku.price) || row.finalPrice > 999999.99) {
        return reply.code(400).send({ success: false, message: `${label} 的最终售价必须不低于基础价且不超过 999999.99 元` })
      }
      if (!Object.values(COLLAB_FULFILLMENT_MODE).includes(row.fulfillmentMode)) {
        return reply.code(400).send({ success: false, message: `${label} 的供货方式无效` })
      }
      if (!Number.isInteger(row.leadTimeDays) || row.leadTimeDays < 1 || row.leadTimeDays > 60) {
        return reply.code(400).send({ success: false, message: `${label} 的预计发货天数必须是 1 至 60 天` })
      }
    }

    const before = {
      storefrontSummary: work.storefrontSummary,
      storefrontTitle: work.storefrontTitle,
      storefrontMedia: safeJson(work.storefrontMedia),
      storefrontTags: safeJson(work.storefrontTags),
      storefrontSeries: work.storefrontSeries,
      storefrontKeywords: work.storefrontKeywords,
      description: work.description,
      storefrontDescription: work.storefrontDescription,
      storefrontCoverUrl: work.storefrontCoverUrl,
      storefrontSortOrder: work.storefrontSortOrder,
      skus: work.saleSkus.map(row => ({
        skuId: row.skuId,
        finalPrice: Number(row.finalPrice),
        fulfillmentMode: row.fulfillmentMode,
        leadTimeDays: row.leadTimeDays,
        sortOrder: row.sortOrder,
        isEnabled: row.isEnabled,
      })),
    }
    const operatorId = req.user.userId
    const productNo = work.productNo || makeProductNo(work.id)
    const previousCover = work.storefrontCoverUrl || work.coverUrl
    const nextStorefrontCover = coverKey || (isLegacyInlineCollabCover(previousCover) ? null : previousCover)
    await prisma.$transaction(async tx => {
      await tx.collabWork.update({
        where: { id: work.id },
        data: {
          productNo,
          storefrontTitle,
          storefrontSummary: config.storefrontSummary,
          storefrontDescription: storefrontDescription || null,
          storefrontMedia: JSON.stringify(storefrontMedia),
          storefrontTags: JSON.stringify(storefrontTags),
          storefrontSeries: storefrontSeries || null,
          storefrontKeywords: storefrontKeywords || null,
          storefrontSortOrder: config.storefrontSortOrder,
          storefrontUpdatedBy: operatorId,
          storefrontCoverUrl: nextStorefrontCover,
          supportedSkus: JSON.stringify(config.skus.map(row => row.skuId)),
        },
      })
      await tx.collabSaleSku.deleteMany({
        where: { collabWorkId: work.id, skuId: { notIn: uniqueSkuIds } },
      })
      for (const row of config.skus) {
        await tx.collabSaleSku.upsert({
          where: { collabWorkId_skuId: { collabWorkId: work.id, skuId: row.skuId } },
          create: { collabWorkId: work.id, createdBy: operatorId, updatedBy: operatorId, ...row },
          update: { updatedBy: operatorId, ...row },
        })
      }
      await linkFiles(tx, uploadedMedia, 'COLLAB_WORK', work.id)
    })

    const readiness = await getCollabSaleReadiness(prisma, work.id)
    req.operationAudit = {
      action: `更新联名商品《${storefrontTitle}》`,
      target: 'COLLAB_PRODUCT',
      targetId: work.id,
      before,
      after: { productNo, storefrontTitle, storefrontDescription, storefrontSummary: config.storefrontSummary, storefrontMedia, storefrontTags, storefrontSeries, storefrontKeywords, storefrontSortOrder: config.storefrontSortOrder, skus: config.skus },
    }
    return reply.send({
      success: true,
      message: readiness.ready ? '商品资料已保存，可以上架' : '商品资料已保存，但仍有上架阻断项',
      data: { productNo, ready: readiness.ready, blockers: readiness.blockers, readinessGroups: groupReadiness(readiness.blockers) },
    })
  })

  fastify.get('/admin/collab/:id/product-history', { preHandler: requireAdmin }, async (req, reply) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
    const rows = await prisma.operationLog.findMany({
      where: { targetId: req.params.id, target: { in: ['COLLAB_PRODUCT', 'COLLAB_SALE_CONFIG'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, userId: true, action: true, outcome: true, createdAt: true },
    })
    const userIds = [...new Set(rows.map(row => row.userId))]
    const profiles = await prisma.userProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, nickname: true } })
    const names = new Map(profiles.map(profile => [profile.userId, profile.nickname]))
    return reply.send({ success: true, data: rows.map(row => ({ ...row, operatorName: names.get(row.userId) || row.userId })) })
  })

  // ─────────────────────────────────────────────
  // 联名帧素材包库存管理
  // ─────────────────────────────────────────────

  /**
   * GET /api/admin/collab/:id/frame-packs
   * 查看某个联名作品的所有尺寸帧素材包库存
   */
  fastify.get('/admin/collab/:id/frame-packs', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })

    const packs = await prisma.collabFramePack.findMany({
      where: { collabWorkId: req.params.id },
      orderBy: { size: 'asc' },
    })

    return reply.send({ success: true, data: packs })
  })

  /**
   * POST /api/admin/collab/:id/frame-packs/:size/update
   * 原子更新库存类型与数量。clientRequestId 是持久化幂等键，同键重试不得重复增减。
   * Body: { stockType: 'on_demand'|'stocked', quantity: integer, clientRequestId }
   */
  fastify.post('/admin/collab/:id/frame-packs/:size/update', { preHandler: requireAdmin }, async (req, reply) => {
    const collabWorkId = String(req.params.id || '').trim()
    const size = String(req.params.size || '').trim()
    const stockType = String(req.body?.stockType || '').trim()
    const quantity = Number(req.body?.quantity ?? 0)
    const clientRequestId = String(req.body?.clientRequestId || '').trim()
    const operatorId = req.user.userId

    if (!collabWorkId || !size || size.length > 20)
      return reply.code(400).send({ success: false, code: 'INVALID_FRAME_PACK', message: '作品或尺寸无效' })
    if (!['on_demand', 'stocked'].includes(stockType))
      return reply.code(400).send({ success: false, code: 'INVALID_STOCK_TYPE', message: '库存类型无效' })
    if (!Number.isInteger(quantity) || Math.abs(quantity) > 1000000)
      return reply.code(400).send({ success: false, code: 'INVALID_STOCK_QUANTITY', message: '库存调整量必须是绝对值不超过 1000000 的整数' })
    if (!clientRequestId || clientRequestId.length > 80)
      return reply.code(400).send({ success: false, code: 'INVALID_REQUEST_ID', message: '缺少有效的库存调整请求标识' })

    const requestFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ collabWorkId, size, stockType, quantity }))
      .digest('hex')
    const validateReplay = row => {
      if (!row) return null
      if (row.operatorId !== operatorId || row.collabWorkId !== collabWorkId || row.size !== size || row.requestFingerprint !== requestFingerprint)
        throw framePackMutationError('IDEMPOTENCY_CONFLICT', '该库存调整请求标识已用于其他操作')
      return framePackMutationResponse(row, true)
    }

    try {
      const initialReplay = validateReplay(await prisma.collabFramePackMutation.findUnique({ where: { clientRequestId } }))
      if (initialReplay) return reply.send({ success: true, data: initialReplay })

      let mutation = null
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          mutation = await prisma.$transaction(async tx => {
            const replay = validateReplay(await tx.collabFramePackMutation.findUnique({ where: { clientRequestId } }))
            if (replay) return { ...replay, replayed: true }

            const work = await tx.collabWork.findUnique({ where: { id: collabWorkId }, select: { id: true } })
            if (!work) throw framePackMutationError('COLLAB_WORK_NOT_FOUND', '作品不存在')

            const current = await tx.collabFramePack.findUnique({
              where: { collabWorkId_size: { collabWorkId, size } },
            })
            if (!current && quantity < 0)
              throw framePackMutationError('INSUFFICIENT_FRAME_PACK_STOCK', '该尺寸尚无库存，不能调减')
            const nextStock = (current?.currentStock || 0) + quantity
            const reservedStock = current?.reservedStock || 0
            if (nextStock < reservedStock)
              throw framePackMutationError('INSUFFICIENT_FRAME_PACK_STOCK', `调整后库存不能低于已占用数量 ${reservedStock}`)

            const pack = current
              ? await tx.collabFramePack.update({
                  where: { collabWorkId_size: { collabWorkId, size } },
                  data: { stockType, currentStock: { increment: quantity } },
                })
              : await tx.collabFramePack.create({
                  data: { collabWorkId, size, stockType, currentStock: quantity },
                })
            const saved = await tx.collabFramePackMutation.create({
              data: {
                clientRequestId,
                requestFingerprint,
                collabWorkId,
                size,
                operatorId,
                stockType,
                quantity,
                resultStock: pack.currentStock,
              },
            })
            return framePackMutationResponse(saved)
          }, { isolationLevel: 'Serializable' })
          break
        } catch (error) {
          if (!['P2002', 'P2034'].includes(error.code) || attempt === 3) throw error
          const replay = validateReplay(await prisma.collabFramePackMutation.findUnique({ where: { clientRequestId } }))
          if (replay) {
            mutation = replay
            break
          }
        }
      }

      req.operationAudit = {
        action: `调整联名帧素材包库存 ${quantity >= 0 ? '+' : ''}${quantity}`,
        target: 'COLLAB_FRAME_PACK',
        targetId: collabWorkId,
        after: { size, stockType, quantity, clientRequestId, currentStock: mutation.currentStock },
      }
      return reply.send({ success: true, data: mutation })
    } catch (error) {
      if (error.businessCode === 'IDEMPOTENCY_CONFLICT')
        return reply.code(409).send({ success: false, code: error.businessCode, message: error.message })
      if (error.businessCode === 'COLLAB_WORK_NOT_FOUND')
        return reply.code(404).send({ success: false, code: error.businessCode, message: error.message })
      if (error.businessCode === 'INSUFFICIENT_FRAME_PACK_STOCK')
        return reply.code(409).send({ success: false, code: error.businessCode, message: error.message })
      throw error
    }
  })

  /**
   * PUT /api/admin/collab/:id/frame-packs/:size
   * 更新某个尺寸的帧素材包设置（不存在则创建）
   * Body: { stockType: 'on_demand'|'stocked', currentStock?, ossPath? }
   */
  fastify.put('/admin/collab/:id/frame-packs/:size', { preHandler: requireAdmin }, async (req, reply) => {
    const { id }  = req.params
    const size    = decodeURIComponent(req.params.size)
    const { stockType, currentStock, ossPath } = req.body

    if (stockType && !['on_demand', 'stocked'].includes(stockType))
      return reply.code(400).send({ success: false, message: "stockType 必须是 'on_demand' 或 'stocked'" })

    const data = {}
    if (stockType    !== undefined) data.stockType    = stockType
    if (currentStock !== undefined) data.currentStock = parseInt(currentStock)
    if (ossPath      !== undefined) data.ossPath      = ossPath

    const pack = await prisma.collabFramePack.upsert({
      where:  { collabWorkId_size: { collabWorkId: id, size } },
      create: { collabWorkId: id, size, ...data },
      update: data,
    })

    return reply.send({ success: true, data: pack })
  })

  /**
   * POST /api/admin/collab/:id/frame-packs/:size/restock
   * 调整帧素材包库存数量
   * Body: { quantity, note? }
   */
  fastify.post('/admin/collab/:id/frame-packs/:size/restock', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params
    const size   = decodeURIComponent(req.params.size)
    const { quantity, note } = req.body

    if (!quantity || isNaN(quantity))
      return reply.code(400).send({ success: false, message: 'quantity 必须是数字' })

    const pack = await prisma.collabFramePack.findUnique({
      where: { collabWorkId_size: { collabWorkId: id, size } },
    })
    if (!pack) return reply.code(404).send({ success: false, message: '该尺寸帧素材包不存在，请先创建' })

    const updated = await prisma.collabFramePack.update({
      where: { collabWorkId_size: { collabWorkId: id, size } },
      data:  { currentStock: { increment: parseInt(quantity) } },
    })

    return reply.send({ success: true, message: `库存已调整 ${quantity > 0 ? '+' : ''}${quantity}`, data: updated })
  })

  // ─────────────────────────────────────────────
  // 辅助
  // ─────────────────────────────────────────────

  async function requireSaleReady(workId, reply) {
    const readiness = await getCollabSaleReadiness(prisma, workId)
    if (readiness.ready) return true
    reply.code(409).send({
      success: false,
      message: '该作品尚未满足上架条件',
      code: 'COLLAB_SALE_NOT_READY',
      blockers: readiness.blockers,
    })
    return false
  }

}

function safeJson(str) {
  try { return JSON.parse(str) } catch { return [] }
}

/**
 * 对管理端 OSS key 进行预签名。
 * - OSS objectKey（不含 http/data 前缀）→ 预签名 URL
 * - data URI → 直接透传（管理员预览用）
 * - 完整 http URL → 直接透传
 * - null/空 → null
 */
function presignAdminKey(key, fastify, expires = 3600) {
  if (!key) return null
  if (key.startsWith('data:') || key.startsWith('http')) return key
  return fastify.ossPresignGet(key, expires)
}

function normalizeTextArray(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/)
  return [...new Set(rows.map(item => String(item).trim()).filter(Boolean))]
}

function normalizeKeyArray(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => String(item || '').trim()).filter(key => key && !key.startsWith('data:')))]
}

function makeProductNo(id) {
  return `COL-${String(id || '').replaceAll('-', '').slice(0, 12).toUpperCase()}`
}

function inventorySummary(row) {
  if (!row) return { current: 0, reserved: 0, available: 0, safety: 0, status: 'NO_RECORD' }
  const available = Math.max(0, row.currentStock - row.reservedStock - row.wipFrameQty - row.wipKitQty)
  return {
    current: row.currentStock,
    reserved: row.reservedStock,
    available,
    safety: row.safetyStock,
    status: available <= 0 ? 'OUT' : available <= row.safetyStock ? 'LOW' : 'ENOUGH',
  }
}

function groupReadiness(blockers) {
  const groups = { content: [], sale: [], asset: [] }
  for (const blocker of blockers || []) {
    if (/SKU|售价|发货|供货/.test(blocker)) groups.sale.push(blocker)
    else if (/动画|核心帧|版本/.test(blocker)) groups.asset.push(blocker)
    else groups.content.push(blocker)
  }
  return groups
}

async function mediaKind(prisma, key) {
  if (!key) return 'image'
  const file = await prisma.privateFile.findUnique({ where: { objectKey: key }, select: { detectedMimeType: true, declaredMimeType: true } })
  const mime = file?.detectedMimeType || file?.declaredMimeType || ''
  return mime.startsWith('video/') ? 'video' : 'image'
}
