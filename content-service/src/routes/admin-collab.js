// src/routes/admin-collab.js — 管理员联名审核 + 活动管理
// 全部需要 role >= 2

import { calcRevenueRate } from '../lib/revenue.js'

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
      return {
        ...w,
        animationFrames: safeJson(w.animationFrames),
        supportedSkus: safeJson(w.supportedSkus),
        creator: profileMap[w.creatorId] ?? null,
        creatorLevel: { bullEnergy: cp.bullLevel ?? 1, isExclusive: cp.isExclusive ?? false },
        revenueRatePreview: preview.rate,
      }
    })

    return reply.send({ success: true, data: { works: result, total, page: Number(page), limit: Number(limit) } })
  })

  /**
   * GET /api/admin/collab/works/:id
   * 联名作品详情（审核用，含帧图预签名URL）
   */
  fastify.get('/admin/collab/works/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })

    const frameKeys = safeJson(work.animationFrames)
    const frameUrls = frameKeys.map(key => fastify.ossPresignGet(key, 3600))
    const coverUrl = work.coverUrl ? fastify.ossPresignGet(work.coverUrl, 3600) : null

    return reply.send({
      success: true,
      data: { ...work, animationFrames: frameUrls, coverUrl, supportedSkus: safeJson(work.supportedSkus) },
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

      const updated = await prisma.collabWork.update({
        where: { id: req.params.id },
        data: { status: 'rejected', rejectReason, approvedAt: null, approvedBy: null },
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
    // 获取创作者等级信息（计算分红率快照）
    const creatorProfile = await prisma.creatorProfile.findUnique({
      where: { userId: work.creatorId },
    })

    // 查询活动分红率
    let activityRate = null
    if (work.activityId) {
      const activity = await prisma.collabActivity.findUnique({ where: { id: work.activityId } })
      if (activity && activity.isActive && new Date() <= activity.endAt) {
        activityRate = activity.revenueRate
      }
    }

    // 计算分红率快照
    const now = new Date()
    const newbieExpiredAt = work.isNewbieWork
      ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      : null

    const { rate, breakdown } = calcRevenueRate({
      bullEnergy: creatorProfile?.bullLevel ?? 1,
      isExclusive: creatorProfile?.isExclusive ?? false,
      isNewbieWork: work.isNewbieWork,
      newbieExpiredAt,
      activityRate,
    })

    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        status: 'approved',
        approvedAt: now,
        approvedBy: adminId,
        rejectReason: null,
        isExclusiveWork: creatorProfile?.isExclusive ?? false,
        newbieExpiredAt,
        revenueRate: rate,
      },
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
      : `你的作品《${work.title}》已审核通过，分红率 ${(rate * 100).toFixed(1)}%`
    await prisma.creatorNotification.create({
      data: { userId: work.creatorId, type: notifType, workId: work.id, workTitle: work.title, message: notifMsg }
    }).catch(() => {})

    return reply.send({
      success: true,
      data: { ...updated, revenueRateBreakdown: breakdown },
    })
  })


  // ─────────────────────────────────────────────
  // 联名作品上下架
  // ─────────────────────────────────────────────

  /**
   * PUT /api/admin/collab/:id/shelf
   * 上架或下架联名作品
   * Body: { action: 'on' | 'off' }
   */
  fastify.put('/admin/collab/:id/shelf', { preHandler: requireAdmin }, async (req, reply) => {
    const { action } = req.body
    if (!['on', 'off'].includes(action))
      return reply.code(400).send({ success: false, message: "action 必须是 'on' 或 'off'" })

    const work = await prisma.collabWork.findUnique({ where: { id: req.params.id } })
    if (!work) return reply.code(404).send({ success: false, message: '作品不存在' })
    if (work.status !== 'approved')
      return reply.code(400).send({ success: false, message: '只有审核通过的作品才能上下架' })

    const updated = await prisma.collabWork.update({
      where: { id: req.params.id },
      data: {
        isOnShelf: action === 'on',
        shelfAt:   action === 'on' ? new Date() : null,
      },
    })

    if (action === 'off') {
      await prisma.creatorNotification.create({
        data: {
          userId:    work.creatorId,
          type:      'offshelf',
          workId:    work.id,
          workTitle: work.title,
          message:   `你的作品《${work.title}》已被下架，如有疑问请联系平台`,
        }
      }).catch(() => {})
    }

    return reply.send({ success: true, message: action === 'on' ? '已上架' : '已下架', data: updated })
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
  // 辅助
  // ─────────────────────────────────────────────

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
