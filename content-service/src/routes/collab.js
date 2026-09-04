// src/routes/collab.js — 联名系统路由
// 公开接口 + 创作者申请

import { calcRevenueRate } from '../lib/revenue.js'
import { linkCollabWorkToAnimation } from '../lib/collab-animation-asset.js'
import { generateCoverThumb } from '../lib/thumbnail.js'
import {
  collabFinalPrice,
  parseJsonArray,
  publicCollabWorkWhere,
} from '../lib/collab-storefront.js'

export default async function collabRoutes(fastify) {
  const { prisma } = fastify

  // ─────────────────────────────────────────────
  // 公开接口（无需登录）
  // ─────────────────────────────────────────────

  /**
   * GET /api/collab/works
   * 联名商品列表（只返回当前公开销售的字段）
   * 查询参数：page / limit / creatorId
   */
  fastify.get('/collab/works', async (req, reply) => {
    const { page = 1, limit = 12, creatorId } = req.query
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1)
    const limitNumber = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 12))
    const skip = (pageNumber - 1) * limitNumber

    const where = publicCollabWorkWhere(creatorId ? { creatorId } : {})

    const [works, total] = await Promise.all([
      prisma.collabWork.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { approvedAt: 'desc' },
        select: {
          id: true,
          creatorId: true,
          title: true,
          description: true,
          coverUrl: true,
          hoverGifUrl: true,
          supportedSkus: true,
          creatorMarkups: true,
          isNewbieWork: true,
          isExclusiveWork: true,
          approvedAt: true,
          createdAt: true,
        },
      }),
      prisma.collabWork.count({ where }),
    ])

    // 为每个作品附上创作者基础信息
    const creatorIds = [...new Set(works.map(w => w.creatorId))]
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, nickname: true, avatarUrl: true },
    })
    const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]))

    const skuRefs = [...new Set(works.flatMap(work => parseJsonArray(work.supportedSkus)))]
    const skus = skuRefs.length
      ? await prisma.machineModelSku.findMany({
          where: {
            isActive: true,
            model: { isActive: true },
            OR: [{ id: { in: skuRefs } }, { skuCode: { in: skuRefs } }],
          },
          select: { id: true, skuCode: true, size: true, price: true },
        })
      : []
    const skuMap = new Map(skus.flatMap(sku => [[sku.id, sku], [sku.skuCode, sku]]).filter(([key]) => key))

    const result = works.map(work => {
      const availableSkus = [...new Map(
        parseJsonArray(work.supportedSkus)
          .map(ref => skuMap.get(ref))
          .filter(Boolean)
          .map(sku => [sku.id, sku]),
      ).values()]
      const prices = availableSkus.map(sku => collabFinalPrice(work, sku))
      return {
        id: work.id,
        creatorId: work.creatorId,
        title: work.title,
        description: work.description,
        coverUrl: presignOrPassthrough(work.coverUrl, fastify, 3600),
        hoverGifUrl: presignOrNull(work.hoverGifUrl, fastify, 3600),
        isNewbieWork: work.isNewbieWork,
        isExclusiveWork: work.isExclusiveWork,
        approvedAt: work.approvedAt,
        creator: profileMap[work.creatorId] ?? { userId: work.creatorId, nickname: '创作者', avatarUrl: null },
        minPrice: prices.length ? Math.min(...prices) : null,
        availableSkuCount: availableSkus.length,
        availableSizes: [...new Set(availableSkus.map(sku => sku.size).filter(Boolean))],
      }
    })

    return reply.send({ success: true, data: { works: result, total, page: pageNumber, limit: limitNumber } })
  })

  /**
   * GET /api/collab/works/:id
   * 联名作品详情（含帧图列表，供展示动画用）
   */
  fastify.get('/collab/works/:id', async (req, reply) => {
    const work = await prisma.collabWork.findFirst({
      where: publicCollabWorkWhere({ id: req.params.id }),
      select: {
        id: true,
        creatorId: true,
        title: true,
        description: true,
        coverUrl: true,
        hoverGifUrl: true,
        animationFrames: true,
        supportedSkus: true,
        creatorMarkups: true,
        isNewbieWork: true,
        isExclusiveWork: true,
        approvedAt: true,
      },
    })
    if (!work) {
      return reply.code(404).send({ success: false, message: '作品不存在' })
    }

    // 获取创作者信息
    const profile = await prisma.userProfile.findUnique({
      where: { userId: work.creatorId },
      select: { userId: true, nickname: true, avatarUrl: true },
    })

    // 获取支持的SKU详情（含 exampleMedia + 加价后价格）
    const skuRefs = parseJsonArray(work.supportedSkus)
    const rawSkus = skuRefs.length
      ? await prisma.machineModelSku.findMany({
          where: {
            isActive: true,
            model: { isActive: true },
            OR: [{ id: { in: skuRefs } }, { skuCode: { in: skuRefs } }],
          },
          select: {
            id: true,
            size: true,
            material: true,
            frameCount: true,
            colorName: true,
            colorHex: true,
            price: true,
            previewImage: true,
            exampleMedia: true,
            model: { select: { id: true, name: true } },
          },
        })
      : []

    // 为每个 SKU 附加 exampleMedia 预签名 URL 和最终价格（含创作者加价）
    const skus = rawSkus.map(s => {
      const exampleKeys = safeJson(s.exampleMedia, [])
      const exampleUrls = exampleKeys.map(k => presignOrPassthrough(k, fastify, 3600)).filter(Boolean)
      return {
        id: s.id,
        modelId: s.model.id,
        modelName: s.model.name,
        size: s.size,
        material: s.material,
        frameCount: s.frameCount,
        colorName: s.colorName,
        colorHex: s.colorHex,
        previewImage: presignOrPassthrough(s.previewImage, fastify, 3600),
        finalPrice: collabFinalPrice(work, s),
        exampleMedia: exampleUrls,
      }
    })

    // 帧图：生成预签名URL
    const frameKeys = safeJson(work.animationFrames)
    const frameUrls = frameKeys.map(key => presignOrPassthrough(key, fastify, 3600))

    // hover GIF 预签名 URL（如已生成）
    const hoverGifUrl = presignOrNull(work.hoverGifUrl, fastify, 3600)

    // 封面图：data URI 直接透传，OSS key 才签名
    const coverUrl = presignOrPassthrough(work.coverUrl, fastify, 3600)

    return reply.send({
      success: true,
      data: {
        id: work.id,
        creatorId: work.creatorId,
        title: work.title,
        description: work.description,
        animationFrames: frameUrls,
        hoverGifUrl,
        coverUrl,
        supportedSkus: skus,
        isNewbieWork: work.isNewbieWork,
        isExclusiveWork: work.isExclusiveWork,
        approvedAt: work.approvedAt,
        creator: profile ?? { userId: work.creatorId, nickname: '创作者', avatarUrl: null },
      },
    })
  })

  // ─────────────────────────────────────────────
  // 创作者接口（需登录 + certifyStatus=2）
  // ─────────────────────────────────────────────

  /**
   * GET /api/collab/my-works
   * 我的联名作品列表（含各种状态）
   */
  fastify.get('/collab/my-works', { preHandler: requireCertified }, async (req, reply) => {
    const works = await prisma.collabWork.findMany({
      where: { creatorId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({
      success: true,
      data: works.map(w => ({
        ...w,
        animationFrames: safeJson(w.animationFrames),
        supportedSkus: safeJson(w.supportedSkus),
      })),
    })
  })

  /**
   * POST /api/collab/apply
   * 申请联名
   *
   * Body:
   * {
   *   orderNo: string,         // 引用 customize_orders.orderNo，帧图来源
   *   title: string,
   *   description?: string,
   *   supportedSkus: string[], // SKU ID数组
   *   activityId?: string,     // 可选，参与活动
   *   agreementSigned: true,   // 必须为true，表示已同意授权协议
   * }
   */
  /**
   * POST /api/collab/apply
   * 批量提交联名申请（支持多款式一次提交）
   *
   * Body:
   * {
   *   variants: [
   *     { animationId?, orderNo?, title, description?, supportedSkus: string[] }
   *   ],
   *   agreementSigned: true,
   *   activityId?: string
   * }
   */
  fastify.post('/collab/apply', { preHandler: requireCertified }, async (req, reply) => {
    const { variants, agreementSigned, activityId } = req.body
    const userId = req.user.userId

    // 基础校验
    if (!agreementSigned) {
      return reply.code(400).send({ success: false, message: '必须同意联名授权协议' })
    }
    if (!Array.isArray(variants) || variants.length === 0) {
      return reply.code(400).send({ success: false, message: '请至少添加一款申请款式' })
    }
    if (variants.length > 20) {
      return reply.code(400).send({ success: false, message: '单次最多提交 20 款' })
    }

    // 验证活动（如果传了 activityId）
    if (activityId) {
      const activity = await prisma.collabActivity.findUnique({ where: { id: activityId } })
      if (!activity || !activity.isActive || new Date() > activity.endAt) {
        return reply.code(400).send({ success: false, message: '活动不存在或已结束' })
      }
    }

    // 读取新手期作品数量上限（从配置，默认3）
    const newbieWorksConfig = await prisma.platformConfig.findUnique({ where: { configKey: 'revenue_newbie_works' } })
    const newbieWorksLimit = Number(newbieWorksConfig?.configValue ?? 3)

    // 判断是否是创作者新手期（前 N 款）—— 在整批提交前计算
    const approvedCount = await prisma.collabWork.count({ where: { creatorId: userId, status: 'approved' } })
    const pendingCount  = await prisma.collabWork.count({ where: { creatorId: userId, status: 'pending' } })
    let workIndexOffset = approvedCount + pendingCount

    // 生成本批次 ID
    const submissionBatchId = variants.length > 1
      ? `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`
      : null

    const now = new Date()
    const createdWorks = []
    const errors = []

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]
      const { animationId, orderNo, title, description, supportedSkus } = v

      // 单项校验
      if (!title?.trim()) { errors.push(`第 ${i+1} 款：缺少作品标题`); continue }
      if (!supportedSkus?.length) { errors.push(`第 ${i+1} 款：请选择至少一个规格`); continue }
      if (!animationId && !orderNo) { errors.push(`第 ${i+1} 款：缺少动画来源`); continue }

      let animationFramesJson, coverKey, orderNoForRecord = null
      let sourceAnimationAssetId = null, sourceAnimationVersionId = null

      if (animationId) {
        const cp = await prisma.customProduct.findFirst({
          where: { id: animationId, userId, status: { not: 'removed' } },
        })
        if (!cp) { errors.push(`第 ${i+1} 款：动画作品不存在或不属于你`); continue }
        animationFramesJson = cp.animationFrames
        sourceAnimationAssetId = cp.animationAssetId
        sourceAnimationVersionId = cp.animationVersionId

        // 重复检测：同一动画 + 完全相同的 SKU 集合 = 重复
        const skuKey = JSON.stringify([...supportedSkus].sort())
        const existing = await prisma.collabWork.findFirst({
          where: { animationFrames: cp.animationFrames, creatorId: userId, status: { not: 'rejected' } },
        })
        if (existing) {
          const existingSkuKey = JSON.stringify(safeJson(existing.supportedSkus)?.slice().sort() ?? [])
          if (existingSkuKey === skuKey) {
            errors.push(`第 ${i+1} 款「${title}」：该动画 + 相同规格已申请过联名`); continue
          }
          // 相同动画不同 SKU 组合：允许
        }
      } else {
        const order = await prisma.customizeOrder.findFirst({ where: { orderNo, userId } })
        if (!order) { errors.push(`第 ${i+1} 款：订单不存在或不属于你`); continue }
        if (order.status === 'pending') { errors.push(`第 ${i+1} 款：订单尚未完成支付`); continue }
        const existing = await prisma.collabWork.findFirst({ where: { orderNo, creatorId: userId, status: { not: 'rejected' } } })
        if (existing) { errors.push(`第 ${i+1} 款：该订单已申请过联名`); continue }
        animationFramesJson = order.frameUrls
        orderNoForRecord = orderNo
      }

      // ① 生成封面缩略图（200×200 JPEG data URI，约 10~30KB）
      //    coverUrl 存小尺寸 data URI，前端直接渲染，无需 OSS 预签名，彻底规避 503 风险
      const rawFrames = safeJson(animationFramesJson, [])
      const firstRawFrame = rawFrames[0]
      coverKey = null
      if (firstRawFrame?.startsWith('data:')) {
        try {
          coverKey = await generateCoverThumb(firstRawFrame)
          fastify.log.info('[collab-apply] 封面缩略图生成完成')
        } catch (e) {
          fastify.log.warn('[collab-apply] 封面缩略图生成失败: ' + e.message)
        }
      } else if (firstRawFrame) {
        // 已是 OSS objectKey（如从订单帧来），直接用
        coverKey = firstRawFrame
      }

      // ② 上传完整帧图到 OSS（animationFrames 存 objectKey，用于 GIF 生成和详情页播放）
      try {
        animationFramesJson = await uploadDataUriFramesToOss(animationFramesJson, userId, fastify)
      } catch (e) {
        fastify.log.warn('[collab-apply] 帧图 OSS 上传失败: ' + e.message)
        // 失败不阻断申请，保留原始 data URI（detail 接口会直接透传给前端）
      }

      // 验证 SKU
      const skuRecords = await prisma.machineModelSku.findMany({ where: { id: { in: supportedSkus }, isActive: true } })
      if (skuRecords.length !== supportedSkus.length) { errors.push(`第 ${i+1} 款：部分规格不存在或已下架`); continue }

      const isNewbieWork = (workIndexOffset + i) < newbieWorksLimit

      try {
        const work = await prisma.$transaction(async tx => {
          const created = await tx.collabWork.create({ data: {
            creatorId:         userId,
            orderNo:           orderNoForRecord,
            title:             title.trim(),
            description:       description?.trim() ?? null,
            coverUrl:          coverKey,
            animationFrames:   animationFramesJson,
            supportedSkus:     JSON.stringify(supportedSkus),
            isNewbieWork,
            newbieExpiredAt:   null,
            activityId:        activityId ?? null,
            isExclusiveWork:   false,
            status:            'pending',
            agreementSignedAt: now,
            revenueRate:       0,
            submissionBatchId,
          } })
          await linkCollabWorkToAnimation(tx, created, {
            animationAssetId: sourceAnimationAssetId,
            animationVersionId: sourceAnimationVersionId
          })
          return tx.collabWork.findUnique({ where: { id: created.id } })
        })
        createdWorks.push({ id: work.id, title: work.title, status: 'pending' })
      } catch(e) {
        errors.push(`第 ${i+1} 款「${title}」：创建失败（${e.message}）`)
      }
    }

    if (createdWorks.length === 0) {
      return reply.code(400).send({ success: false, message: errors.join('；') || '提交失败' })
    }

    return reply.code(201).send({
      success: true,
      data: { submissionBatchId, works: createdWorks, errors }
    })
  })

  // ─────────────────────────────────────────────
  // 辅助函数
  // ─────────────────────────────────────────────

  async function requireCertified(req, reply) {
    const active = await fastify.authenticate(req, reply)
    if (!active) return
    if (req.user.certifyStatus !== 2) {
      return reply.code(403).send({ success: false, message: '需要创作者身份' })
    }
  }
}

function safeJson(str, fallback = []) {
  if (str == null) return fallback
  try { const v = JSON.parse(str); return v ?? fallback } catch { return fallback }
}

/**
 * 若 key 是 OSS objectKey（不以 data:/http 开头），返回预签名 URL；
 * 若 key 是 data URI 或完整 http URL，返回 null（list 不能返回大数据）；
 * 若 key 为空，返回 null。
 */
function presignOrNull(key, fastify, expires = 3600) {
  if (!key) return null
  if (key.startsWith('data:') || key.startsWith('http')) return null
  return fastify.ossPresignGet(key, expires)
}

/**
 * 同上，但 data URI 和完整 http URL 直接透传（detail 接口帧图用）。
 */
function presignOrPassthrough(key, fastify, expires = 3600) {
  if (!key) return null
  if (key.startsWith('data:') || key.startsWith('http')) return key
  return fastify.ossPresignGet(key, expires)
}

/**
 * 将 JSON 数组中的 data URI 帧图批量上传到 OSS，返回替换后的 JSON 字符串。
 * 已是 OSS objectKey 的帧保持不变。
 * @param {string} framesJson - JSON string of frame URLs/data URIs
 * @param {string} userId
 * @param {object} fastify
 */
async function uploadDataUriFramesToOss(framesJson, userId, fastify) {
  const frames = safeJson(framesJson, [])
  if (!frames.length) return framesJson

  // 如果没有 data URI，直接返回
  if (!frames.some(f => typeof f === 'string' && f.startsWith('data:'))) return framesJson

  const uid8 = userId.slice(-8)
  const ts   = Date.now()
  const { Buffer } = await import('buffer')
  const uploadedKeys = []

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    if (!frame || typeof frame !== 'string') { uploadedKeys.push(null); continue }

    if (!frame.startsWith('data:')) {
      uploadedKeys.push(frame) // 已是 objectKey，保留
      continue
    }

    const m = frame.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) { uploadedKeys.push(null); continue }

    const [, mimeType, b64] = m
    const buf = Buffer.from(b64, 'base64')
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const frameNo = String(i + 1).padStart(3, '0')
    const key = `collab/frames/${uid8}/${ts}/${frameNo}.${ext}`

    await fastify.oss.put(key, buf, { headers: { 'Content-Type': mimeType } })
    uploadedKeys.push(key)
  }

  return JSON.stringify(uploadedKeys.filter(Boolean))
}
