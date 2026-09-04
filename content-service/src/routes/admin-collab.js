// src/routes/admin-collab.js — 管理员联名审核 + 活动管理
// 全部需要 role >= 2

import { calcRevenueRate, buildRevenueConfig } from '../lib/revenue.js'
import { generateAndUploadHoverGif } from '../lib/gif-generator.js'
import { updateCollabAssetStatus } from '../lib/collab-animation-asset.js'
import {
  COLLAB_FULFILLMENT_MODE,
  getCollabSaleReadiness,
  isCollabSkuFrameCompatible,
  isLegacyInlineCollabCover,
  normalizeSaleConfigInput,
} from '../lib/collab-sale-config.js'
import { FILE_PURPOSE, linkFiles } from '../lib/private-files.js'

export default async function adminCollabRoutes(fastify) {
  const { prisma } = fastify

  // ─────────────────────────────────────────────
  // 联名作品审核
  // ─────────────────────────────────────────────

  /**
   * GET /api/admin/collab/works
   * 联名作品列表（管理员视角，含所有状态）
   * 查询参数：status / page / limit
   */
  fastify.get('/admin/collab/works', { preHandler: requireAdmin }, async (req, reply) => {
    const { status, page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = {}
    if (status) where.status = status

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

    // 附创作者等级信息（用于审核时参考分红率）
    const creatorProfiles = await prisma.creatorProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, bullLevel: true, isExclusive: true },
    })
    const creatorMap = Object.fromEntries(creatorProfiles.map(c => [c.userId, c]))

    const result = works.map(w => {
      const cp = creatorMap[w.creatorId] ?? {}
      const preview = calcRevenueRate({
        bullEnergy: cp.bullLevel ?? 1,
        isExclusive: cp.isExclusive ?? false,
        isNewbieWork: w.isNewbieWork,
        newbieExpiredAt: w.newbieExpiredAt,
        activityRate: null,
      })
      // 预签名封面图（list 不含完整 animationFrames，避免大量 base64 数据）
      const coverUrl = presignAdminKey(w.coverUrl, fastify, 3600)
      return {
        ...w,
        animationFrames: [],           // list 不返回帧数据，减小响应体积
        coverUrl,                      // 已预签名，前端直接用
        supportedSkus: safeJson(w.supportedSkus),
        creator: profileMap[w.creatorId] ?? null,
        creatorLevel: { bullEnergy: cp.bullLevel ?? 1, isExclusive: cp.isExclusive ?? false },
        revenueRatePreview: preview.rate,
        saleConfigCount: w.saleSkus.length,
      }
    })

    return reply.send({ success: true, data: { works: result, total, page: Number(page), limit: Number(limit) } })
  })

  /**
   * GET /api/admin/collab/works/:id
   * 联名作品详情（审核用，含帧图预签名URL）
   */
  fastify.get('/admin/collab/works/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({
      where: { id: req.params.id },
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
   * PUT /api/admin/collab/:id/approve
   * 审核通过或拒绝
   *
   * Body: { action: 'approve' | 'reject', rejectReason?: string }
   */
  fastify.put('/admin/collab/:id/approve', { preHandler: requireAdmin }, async (req, reply) => {
    const { action, rejectReason } = req.body
    const adminId = req.user.userId

    if (!['approve', 'reject'].includes(action)) {
      return reply.code(400).send({ success: false, message: "action 必须是 'approve' 或 'reject'" })
    }

    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'pending') {
      return reply.code(400).send({ success: false, message: '只能审核 pending 状态的作品' })
    }

    if (action === 'reject') {
      if (!rejectReason) return reply.code(400).send({ success: false, message: '拒绝时必须填写原因' })

      const updated = await prisma.$transaction(async tx => {
        const rejected = await tx.collabWork.update({
          where: { id: req.params.id },
          data: { status: 'rejected', rejectReason, approvedAt: null, approvedBy: null },
        })
        await updateCollabAssetStatus(tx, rejected, 'rejected')
        return rejected
      })

      const notifType = work.isRevision ? 'revision_rejected' : 'rejected'
      const notifMsg  = work.isRevision
        ? `你对《${work.title}》的修改申请未通过，原因：${rejectReason}`
        : `你的作品《${work.title}》审核未通过，原因：${rejectReason}`
      await prisma.creatorNotification.create({
        data: { userId: work.creatorId, type: notifType, workId: work.id, workTitle: work.title, message: notifMsg }
      }).catch(() => {})

      return reply.send({ success: true, data: updated })
    }

    // action === 'approve'
    // 首发可审核和展示联名作品，但关闭时不承诺或自动计算线上分红。
    const creatorFinanceEnabled = fastify.config.features.creatorFinance
    // 读取分红参数配置
    const revenueConfigRows = creatorFinanceEnabled
      ? await prisma.platformConfig.findMany({ where: { groupName: 'revenue' } })
      : []
    const revenueConfig = buildRevenueConfig(revenueConfigRows)
    const newbieDays = Number(revenueConfig.revenue_newbie_days ?? 14)

    // 获取创作者等级信息（计算分红率快照）
    const creatorProfile = creatorFinanceEnabled
      ? await prisma.creatorProfile.findUnique({ where: { userId: work.creatorId } })
      : null

    // 查询活动分红率
    let activityRate = null
    if (creatorFinanceEnabled && work.activityId) {
      const activity = await prisma.collabActivity.findUnique({ where: { id: work.activityId } })
      if (activity && activity.isActive && new Date() <= activity.endAt) {
        activityRate = activity.revenueRate
      }
    }

    // 计算分红率快照
    const now = new Date()
    const newbieExpiredAt = work.isNewbieWork
      ? new Date(now.getTime() + newbieDays * 24 * 60 * 60 * 1000)
      : null

    const { rate, breakdown } = creatorFinanceEnabled
      ? calcRevenueRate({
          bullEnergy: creatorProfile?.bullLevel ?? 1,
          isExclusive: creatorProfile?.isExclusive ?? false,
          isNewbieWork: work.isNewbieWork,
          newbieExpiredAt,
          activityRate,
          config: revenueConfig,
        })
      : { rate: 0, breakdown: [] }

    const updated = await prisma.$transaction(async tx => {
      const approved = await tx.collabWork.update({
        where: { id: req.params.id },
        data: {
        status: 'approved',
        approvedAt: now,
        approvedBy: adminId,
        rejectReason: null,
        isExclusiveWork: creatorFinanceEnabled ? (creatorProfile?.isExclusive ?? false) : false,
        newbieExpiredAt: creatorFinanceEnabled ? newbieExpiredAt : null,
        revenueRate: rate,
        isOnShelf: false,
        shelfAt: null,
        shelfStatus: 'off_shelf',
        },
      })
      await updateCollabAssetStatus(tx, approved, 'approved')
      return approved
    })

    // 修改版通过时：将变更字段覆写回原作品
    if (work.isRevision && work.originalWorkId) {
      const cl = safeJson(work.changeLog)
      const patch = {}
      if (cl.title)                      patch.title        = cl.title.new
      if (cl.description !== undefined)  patch.description  = cl.description?.new ?? null
      if (cl.supportedSkus)              patch.supportedSkus = JSON.stringify(cl.supportedSkus.new)
      if (Object.keys(patch).length) {
        await prisma.collabWork.update({ where: { id: work.originalWorkId }, data: patch })
      }
    }

    // 写通知
    const notifType = work.isRevision ? 'revision_approved' : 'approved'
    const notifMsg  = work.isRevision
      ? `你对《${work.title}》的修改版已审核通过，修改内容已同步至展示库`
      : creatorFinanceEnabled
        ? `你的作品《${work.title}》已审核通过，分红率 ${(rate * 100).toFixed(1)}%`
        : `你的作品《${work.title}》已审核通过，合作与结算方式请以线下确认记录为准`
    await prisma.creatorNotification.create({
      data: { userId: work.creatorId, type: notifType, workId: work.id, workTitle: work.title, message: notifMsg }
    }).catch(() => {})

    // 异步生成 hover GIF（不阻塞审核响应）
    const frameKeys = safeJson(work.animationFrames)
    // data URI 无法从服务器端 fetch，跳过 GIF 生成（新申请的作品帧已上传到 OSS）
    const ossFrameKeys = frameKeys.filter(k => k && !k.startsWith('data:') && !k.startsWith('http'))
    if (ossFrameKeys.length > 0) {
      setImmediate(async () => {
        try {
          const frameUrls = ossFrameKeys.map(k => fastify.ossPresignGet(k, 7200))
          const gifKey = await generateAndUploadHoverGif({
            collabWorkId: work.id,
            frameUrls,
            oss: fastify.oss,
          })
          await prisma.collabWork.update({
            where: { id: work.id },
            data: { hoverGifUrl: gifKey },
          })
          fastify.log.info(`[hover-gif] 生成完成: ${gifKey}`)
        } catch (e) {
          fastify.log.warn('[hover-gif] 生成失败: ' + e.message)
        }
      })
    }

    return reply.send({
      success: true,
      data: { ...updated, revenueRateBreakdown: breakdown },
    })
  })


  // ─────────────────────────────────────────────
  // 重新生成 hover GIF（用于已审核通过但 GIF 为空/损坏的作品）
  // ─────────────────────────────────────────────

  /**
   * POST /api/admin/collab/:id/regen-gif
   * 立即重新生成 hover GIF 并更新 hoverGifUrl
   */
  fastify.post('/admin/collab/:id/regen-gif', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved') return reply.code(400).send({ success: false, message: '仅已审核通过的作品可重新生成 GIF' })

    const frameKeys = safeJson(work.animationFrames).filter(k => k && !k.startsWith('data:') && !k.startsWith('http'))
    if (frameKeys.length === 0)
      return reply.code(400).send({ success: false, message: '没有可用的 OSS 帧图（帧图可能仍为 data URI 格式）' })

    try {
      const frameUrls = frameKeys.map(k => fastify.ossPresignGet(k, 7200))
      const gifKey = await generateAndUploadHoverGif({ collabWorkId: work.id, frameUrls, oss: fastify.oss })
      await prisma.collabWork.update({ where: { id: work.id }, data: { hoverGifUrl: gifKey } })
      return reply.send({ success: true, data: { hoverGifUrl: gifKey } })
    } catch (e) {
      fastify.log.warn('[hover-gif] 重新生成失败: ' + e.message)
      return reply.code(500).send({ success: false, message: 'GIF 生成失败: ' + e.message })
    }
  })

  // ─────────────────────────────────────────────
  // 联名作品货架状态管理
  // ─────────────────────────────────────────────

  /**
   * PUT /api/admin/collab/:id/shelf
   * 保留兼容旧接口，内部转为 shelfStatus
   */
  fastify.put('/admin/collab/:id/shelf', { preHandler: requireAdmin }, async (req, reply) => {
    const { action } = req.body
    if (!['on', 'off'].includes(action))
      return reply.code(400).send({ success: false, message: "action 必须是 'on' 或 'off'" })
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved')
      return reply.code(400).send({ success: false, message: '只有审核通过的作品才能上下架' })
    if (action === 'on' && !(await requireSaleReady(req.params.id, reply))) return
    const now = new Date()
    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        isOnShelf:   action === 'on',
        shelfAt:     action === 'on' ? now : work.shelfAt,
        shelfStatus: action === 'on' ? 'on_sale' : 'off_shelf',
        offShelfAt:  action === 'on' ? null : now,
        offShelfType: action === 'on' ? null : 'platform_force',
      },
    })
    return reply.send({ success: true, message: action === 'on' ? '已上架' : '已下架', data: updated })
  })

  /**
   * PUT /api/admin/collab/:id/suspend
   * 管理员暂停销售
   */
  fastify.put('/admin/collab/:id/suspend', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved')
      return reply.code(400).send({ success: false, message: '只有审核通过的作品才能暂停' })
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
      return reply.code(400).send({ success: false, message: '只有审核通过的作品才能下架' })

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
        canResubmit:    true,
        suspendedAt:    null,
        suspendedBy:    null,
      },
    })

    // 通知创作者
    await prisma.creatorNotification.create({
      data: {
        userId:    work.creatorId,
        type:      'offshelf',
        workId:    work.id,
        workTitle: work.title,
        message:   notice.trim(),
      },
    }).catch(() => {})

    return reply.send({ success: true, message: '已强制下架并通知创作者', data: updated })
  })

  /**
   * PUT /api/admin/collab/:id/relist
   * 管理员重新上架已下架作品（无需重新审核）
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
        canResubmit:    false,
      },
    })
    return reply.send({ success: true, message: '已重新上架', data: updated })
  })

  /**
   * PUT /api/admin/collab/:id/approve-delist
   * 管理员审批创作者的下架申请
   * Body: { approve: true/false, adminNote? }
   */
  fastify.put('/admin/collab/:id/approve-delist', { preHandler: requireAdmin }, async (req, reply) => {
    const { approve, adminNote } = req.body
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.shelfStatus !== 'pending_delist')
      return reply.code(400).send({ success: false, message: '作品不在申请处理中状态' })

    if (approve === false && !(await requireSaleReady(req.params.id, reply))) return

    const now = new Date()
    const data = approve
      ? {
          shelfStatus:  'off_shelf',
          isOnShelf:    false,
          offShelfAt:   now,
          offShelfType: 'creator_request',
          offShelfReason: adminNote?.trim() || '创作者申请下架，管理员同意',
          canResubmit:  false,
        }
      : {
          shelfStatus: 'on_sale',
          isOnShelf:   true,
          delistRequestedAt: null,
          delistReason: null,
        }

    const updated = await prisma.collabWork.update({ where: { id: req.params.id }, data })

    await prisma.creatorNotification.create({
      data: {
        userId:    work.creatorId,
        type:      'delist_decision',
        workId:    work.id,
        workTitle: work.title,
        message:   approve
          ? `你的《${work.title}》下架申请已通过`
          : `你的《${work.title}》下架申请未通过${adminNote ? '：' + adminNote : '，作品维持上架'}`,
      },
    }).catch(() => {})

    return reply.send({ success: true, message: approve ? '已同意下架' : '已拒绝申请，作品恢复上架', data: updated })
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
        reviewStatus: work.status,
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
        isRevision: true,
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
    if (work.status !== 'approved' || work.isRevision) {
      return reply.code(409).send({ success: false, message: '只有审核通过的正式作品可以配置销售规格' })
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
    const legacyMarkups = Object.fromEntries(config.skus.map(row => [
      row.skuId,
      Number((row.finalPrice - Number(skuMap.get(row.skuId).price)).toFixed(2)),
    ]))

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
          creatorMarkups: JSON.stringify(legacyMarkups),
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
  // 活动管理
  // ─────────────────────────────────────────────

  /**
   * GET /api/admin/collab/activities
   * 活动列表
   */
  fastify.get('/admin/collab/activities', { preHandler: requireAdmin }, async (req, reply) => {
    const activities = await prisma.collabActivity.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ success: true, data: activities })
  })

  /**
   * POST /api/admin/collab/activities
   * 创建活动
   *
   * Body: { name, description?, revenueRate, startAt, endAt }
   */
  fastify.post('/admin/collab/activities', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, revenueRate, startAt, endAt } = req.body

    if (!name || revenueRate === undefined || !startAt || !endAt) {
      return reply.code(400).send({ success: false, message: '缺少必填字段' })
    }
    if (revenueRate <= 0 || revenueRate > 0.25) {
      return reply.code(400).send({ success: false, message: '活动分红率须在 0~25% 之间' })
    }
    if (new Date(endAt) <= new Date(startAt)) {
      return reply.code(400).send({ success: false, message: '结束时间必须晚于开始时间' })
    }

    const activity = await prisma.collabActivity.create({
      data: {
        name,
        description: description ?? null,
        revenueRate,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        isActive: true,
        createdBy: req.user.userId,
      },
    })

    return reply.code(201).send({ success: true, data: activity })
  })

  /**
   * PUT /api/admin/collab/activities/:id
   * 修改活动（只能改 isActive / endAt / description）
   */
  fastify.put('/admin/collab/activities/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { isActive, endAt, description } = req.body
    const activity = await prisma.collabActivity.findUnique({ where: { id: req.params.id } })
    if (!activity) return reply.code(404).send({ success: false, message: '活动不存在' })

    const data = {}
    if (isActive !== undefined) data.isActive = isActive
    if (endAt) data.endAt = new Date(endAt)
    if (description !== undefined) data.description = description

    const updated = await prisma.collabActivity.update({ where: { id: req.params.id }, data })

    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────
  // 违约政策配置
  // ─────────────────────────────────────────────

  const POLICY_KEY = 'collab_breach_policy'
  const DEFAULT_POLICY = {
    suspendMaxDays: 90,
    warnDay1: 60,
    warnDay2: 85,
    timeRates: [
      { minDays: 0,   maxDays: 30,  rate: 0.70 },
      { minDays: 31,  maxDays: 90,  rate: 0.50 },
      { minDays: 91,  maxDays: 180, rate: 0.30 },
      { minDays: 181, maxDays: null, rate: 0.15 },
    ],
    depositTiers: [
      { units: 10,  deposit: 500  },
      { units: 20,  deposit: 800  },
      { units: 50,  deposit: 1800 },
      { units: 100, deposit: 3200 },
    ],
  }

  /**
   * GET /api/admin/collab/policy
   * 读取违约政策配置，无记录时返回默认值
   */
  fastify.get('/admin/collab/policy', { preHandler: requireAdmin }, async (req, reply) => {
    const row = await prisma.platformConfig.findUnique({ where: { key: POLICY_KEY } })
    const policy = row ? JSON.parse(row.value) : DEFAULT_POLICY
    return reply.send({ success: true, data: policy })
  })

  /**
   * PUT /api/admin/collab/policy
   * 更新违约政策配置，仅 role=3 可操作
   */
  fastify.put('/admin/collab/policy', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.user.role < 3) {
      return reply.code(403).send({ success: false, message: '仅超级管理员可修改违约政策' })
    }

    const { suspendMaxDays, warnDay1, warnDay2, timeRates, depositTiers } = req.body

    if (!Number.isInteger(suspendMaxDays) || suspendMaxDays < 1) {
      return reply.code(400).send({ success: false, message: '最长暂停天数无效' })
    }
    if (warnDay1 >= suspendMaxDays || warnDay2 >= suspendMaxDays || warnDay1 >= warnDay2) {
      return reply.code(400).send({ success: false, message: '预警天数设置有误：预警1 < 预警2 < 最长天数' })
    }
    if (!Array.isArray(timeRates) || timeRates.length === 0) {
      return reply.code(400).send({ success: false, message: '时间系数不能为空' })
    }
    if (!Array.isArray(depositTiers) || depositTiers.length === 0) {
      return reply.code(400).send({ success: false, message: '押金分档不能为空' })
    }

    const policy = { suspendMaxDays, warnDay1, warnDay2, timeRates, depositTiers }

    await prisma.platformConfig.upsert({
      where:  { key: POLICY_KEY },
      update: { value: JSON.stringify(policy) },
      create: { key: POLICY_KEY, value: JSON.stringify(policy) },
    })

    return reply.send({ success: true, data: policy })
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

  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      const user = fastify.jwt.decode(token)
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
