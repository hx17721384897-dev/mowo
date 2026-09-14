// src/routes/collab.js — 联名公开货架接口

import crypto from 'crypto'
import { isCollabSkuFrameCompatible } from '../lib/collab-sale-config.js'
import {
  collabFinalPrice,
  publicCollabWorkWhere,
} from '../lib/collab-storefront.js'
import { enforceRateLimit } from '../lib/rate-limit.js'

export default async function collabRoutes(fastify) {
  const { prisma } = fastify

  // ─────────────────────────────────────────────
  // 公开接口（无需登录）
  // ─────────────────────────────────────────────

  /**
   * GET /api/collab/works
   * 联名商品列表（只返回当前公开销售的字段）
   * 查询参数：page / limit / creatorId / q / sort(recommended|latest|popular)
   */
  fastify.get('/collab/works', async (req, reply) => {
    const { page = 1, limit = 12, creatorId = '', q = '', sort = 'recommended' } = req.query
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1)
    const limitNumber = Math.min(24, Math.max(1, Number.parseInt(limit, 10) || 12))
    const skip = (pageNumber - 1) * limitNumber
    const creatorFilter = String(creatorId || '').trim()
    const query = String(q || '').trim().slice(0, 100)
    const sortMode = ['recommended', 'latest', 'popular'].includes(sort) ? sort : 'recommended'

    const creatorMatches = query ? await prisma.userProfile.findMany({
      where: { nickname: { contains: query, mode: 'insensitive' } },
      select: { userId: true },
      take: 50,
    }) : []
    const search = query ? {
      OR: [
        { storefrontTitle: { contains: query, mode: 'insensitive' } },
        { storefrontSummary: { contains: query, mode: 'insensitive' } },
        { storefrontDescription: { contains: query, mode: 'insensitive' } },
        { storefrontSeries: { contains: query, mode: 'insensitive' } },
        { storefrontKeywords: { contains: query, mode: 'insensitive' } },
        { storefrontTags: { contains: query, mode: 'insensitive' } },
        { creatorId: { in: creatorMatches.map(profile => profile.userId) } },
      ],
    } : {}
    const where = publicCollabWorkWhere({ ...(creatorFilter ? { creatorId: creatorFilter } : {}), ...search })
    const orderBy = sortMode === 'popular'
      ? [{ storefrontViewCount: 'desc' }, { approvedAt: 'desc' }, { id: 'asc' }]
      : sortMode === 'latest'
        ? [{ approvedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }]
        : [{ storefrontSortOrder: 'desc' }, { approvedAt: 'desc' }, { id: 'asc' }]

    const [works, total, creatorRows] = await Promise.all([
      prisma.collabWork.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy,
        select: {
          id: true,
          creatorId: true,
          title: true,
          storefrontTitle: true,
          description: true,
          storefrontDescription: true,
          storefrontSummary: true,
          coverUrl: true,
          storefrontCoverUrl: true,
          hoverGifUrl: true,
          approvedAt: true,
          createdAt: true,
          animationVersion: { select: { baseFrameCount: true, frameKeys: true } },
          saleSkus: {
            where: { isEnabled: true, sku: { isActive: true, model: { isActive: true } } },
            orderBy: { sortOrder: 'asc' },
            select: {
              finalPrice: true,
              leadTimeDays: true,
              fulfillmentMode: true,
              sku: { select: { id: true, size: true, frameCount: true } },
            },
          },
        },
      }),
      prisma.collabWork.count({ where }),
      pageNumber === 1 ? prisma.collabWork.findMany({
        where: publicCollabWorkWhere(),
        distinct: ['creatorId'],
        select: { creatorId: true },
        orderBy: { creatorId: 'asc' },
      }) : Promise.resolve([]),
    ])

    // 为每个作品附上创作者基础信息
    const creatorIds = [...new Set(works.map(w => w.creatorId))]
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, nickname: true, avatarUrl: true },
    })
    const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]))

    const result = works.map(work => {
      const saleSkus = work.saleSkus.filter(offer => isCollabSkuFrameCompatible(work.animationVersion?.baseFrameCount, offer.sku.frameCount))
      const prices = saleSkus.map(offer => collabFinalPrice(offer))
      return {
        id: work.id,
        creatorId: work.creatorId,
        title: work.storefrontTitle || work.title,
        description: work.storefrontSummary || work.storefrontDescription || work.description,
        coverUrl: presignOrPassthrough(work.storefrontCoverUrl || work.coverUrl, fastify, 3600),
        hoverGifUrl: presignOrNull(work.hoverGifUrl, fastify, 3600),
        approvedAt: work.approvedAt,
        creator: profileMap[work.creatorId] ?? { userId: work.creatorId, nickname: '创作者', avatarUrl: null },
        minPrice: prices.length ? Math.min(...prices) : null,
        availableSkuCount: saleSkus.length,
        availableSizes: [...new Set(saleSkus.map(offer => offer.sku.size).filter(Boolean))],
        minLeadTimeDays: saleSkus.length ? Math.min(...saleSkus.map(offer => offer.leadTimeDays)) : null,
        previewFrames: (Array.isArray(work.animationVersion?.frameKeys) ? work.animationVersion.frameKeys : [])
          .slice(0, 12)
          .map(key => presignOrPassthrough(key, fastify, 3600))
          .filter(Boolean),
      }
    }).filter(work => work.availableSkuCount > 0)

    const filterCreatorIds = creatorRows.map(row => row.creatorId)
    const filterProfiles = filterCreatorIds.length ? await prisma.userProfile.findMany({
      where: { userId: { in: filterCreatorIds } },
      select: { userId: true, nickname: true },
    }) : []
    const filterProfileMap = new Map(filterProfiles.map(profile => [profile.userId, profile.nickname]))
    const creators = creatorRows.map(row => ({
      id: row.creatorId,
      name: filterProfileMap.get(row.creatorId) || '创作者',
    }))

    return reply.send({
      success: true,
      data: {
        works: result,
        total,
        page: pageNumber,
        limit: limitNumber,
        hasMore: skip + works.length < total,
        sort: sortMode,
        creators,
      },
    })
  })

  // 顾客真实停留后由详情页上报；同一匿名访客每天只为同一商品计数一次。
  fastify.post('/collab/works/:id/view', async (req, reply) => {
    if (!await enforceRateLimit(fastify, req, reply, {
      scope: 'COLLAB_VIEW_IP_HOURLY', subject: req.ip, windowMs: 60 * 60 * 1000,
      limit: 120, message: '浏览记录提交过于频繁',
    })) return

    const visitorId = String(req.body?.visitorId || '').trim()
    if (!/^[A-Za-z0-9._-]{16,100}$/.test(visitorId)) {
      return reply.code(400).send({ success: false, message: '浏览标识无效' })
    }
    const work = await prisma.collabWork.findFirst({
      where: publicCollabWorkWhere({ id: req.params.id }),
      select: { id: true },
    })
    if (!work) return reply.code(404).send({ success: false, message: '商品不存在或已下架' })

    const fingerprintHash = crypto.createHmac('sha256', fastify.config.storage.signingSecret)
      .update(visitorId)
      .digest('hex')
    const now = new Date()
    const viewDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    let counted = false
    try {
      await prisma.$transaction(async tx => {
        await tx.collabStorefrontView.create({
          data: { collabWorkId: work.id, fingerprintHash, viewDate },
        })
        await tx.collabWork.update({
          where: { id: work.id }, data: { storefrontViewCount: { increment: 1 } },
        })
      })
      counted = true
    } catch (error) {
      if (error?.code !== 'P2002') throw error
    }
    return reply.send({ success: true, data: { counted } })
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
        storefrontTitle: true,
        storefrontMedia: true,
        storefrontTags: true,
        storefrontSeries: true,
        description: true,
        storefrontDescription: true,
        storefrontSummary: true,
        coverUrl: true,
        storefrontCoverUrl: true,
        hoverGifUrl: true,
        animationFrames: true,
        approvedAt: true,
        animationVersion: { select: { baseFrameCount: true } },
        saleSkus: {
          where: { isEnabled: true, sku: { isActive: true, model: { isActive: true } } },
          orderBy: { sortOrder: 'asc' },
          include: { sku: { include: { model: true } } },
        },
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

    // 为每个正式销售 SKU 附加公开媒体、最终售价和交期。
    const skus = work.saleSkus
      .filter(offer => isCollabSkuFrameCompatible(work.animationVersion?.baseFrameCount, offer.sku.frameCount))
      .map(offer => {
      const s = offer.sku
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
        finalPrice: collabFinalPrice(offer),
        fulfillmentMode: offer.fulfillmentMode,
        leadTimeDays: offer.leadTimeDays,
        exampleMedia: exampleUrls,
      }
      })
    if (!skus.length) {
      return reply.code(404).send({ success: false, message: '作品不存在或已下架' })
    }

    // 帧图：生成预签名URL
    const frameKeys = safeJson(work.animationFrames)
    const frameUrls = frameKeys.map(key => presignOrPassthrough(key, fastify, 3600))

    // hover GIF 预签名 URL（如已生成）
    const hoverGifUrl = presignOrNull(work.hoverGifUrl, fastify, 3600)

    // 封面图：data URI 直接透传，OSS key 才签名
    const coverUrl = presignOrPassthrough(work.storefrontCoverUrl || work.coverUrl, fastify, 3600)
    const storefrontMediaKeys = safeJson(work.storefrontMedia)
    const storefrontMediaFiles = storefrontMediaKeys.length ? await prisma.privateFile.findMany({
      where: { objectKey: { in: storefrontMediaKeys }, status: 'READY', deletedAt: null },
      select: { objectKey: true, detectedMimeType: true, declaredMimeType: true },
    }) : []
    const storefrontMediaKinds = new Map(storefrontMediaFiles.map(file => [
      file.objectKey,
      (file.detectedMimeType || file.declaredMimeType || '').startsWith('video/') ? 'video' : 'image',
    ]))
    // 受管对象必须仍是 READY 文件才可生成读取地址；保留 data/http 媒体，
    // 以兼容已明确作为公开资源配置的历史内容。
    const publicStorefrontMediaKeys = storefrontMediaKeys.filter(key => (
      typeof key === 'string' && (
        key.startsWith('data:') || key.startsWith('http://') || key.startsWith('https://') || storefrontMediaKinds.has(key)
      )
    ))

    return reply.send({
      success: true,
      data: {
        id: work.id,
        creatorId: work.creatorId,
        title: work.storefrontTitle || work.title,
        description: work.storefrontDescription || work.description,
        storefrontSummary: work.storefrontSummary,
        storefrontMedia: publicStorefrontMediaKeys.map(key => ({
          url: presignOrPassthrough(key, fastify, 3600),
          kind: storefrontMediaKinds.get(key) || 'image',
        })).filter(item => item.url),
        storefrontTags: safeJson(work.storefrontTags),
        storefrontSeries: work.storefrontSeries,
        animationFrames: frameUrls,
        hoverGifUrl,
        coverUrl,
        supportedSkus: skus,
        approvedAt: work.approvedAt,
        creator: profile ?? { userId: work.creatorId, nickname: '创作者', avatarUrl: null },
      },
    })
  })

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
