import crypto from 'crypto'
import { createCustomizationRequestNo } from '../lib/customization-request.js'
import { createAnimationAssetVersion } from '../lib/animation-assets.js'

function pageNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function absoluteUrl(fastify, request, objectKey, expiresIn = 300) {
  const signed = fastify.storagePresignGet(objectKey, expiresIn)
  return signed.startsWith('/') ? `${request.protocol}://${request.headers.host}${signed}` : signed
}

async function frameFiles(prisma, ownerUserId, versions) {
  const keys = [...new Set(versions.flatMap(version => Array.isArray(version?.frameKeys) ? version.frameKeys : []))]
  if (!keys.length) return new Map()
  const files = await prisma.privateFile.findMany({ where: {
    objectKey: { in: keys }, ownerUserId, status: 'READY', deletedAt: null
  } })
  return new Map(files.map(file => [file.objectKey, file]))
}

export default async function animationAssetRoutes(fastify) {
  const { prisma } = fastify

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const page = pageNumber(request.query.page, 1)
    const limit = Math.min(50, pageNumber(request.query.limit, 20))
    const where = { ownerUserId: userId, status: 'ACTIVE', frontDeletedAt: null }
    const [items, total] = await Promise.all([
      prisma.animationAsset.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } }
      }),
      prisma.animationAsset.count({ where })
    ])
    const currentVersions = items.map(item => item.versions[0]).filter(Boolean)
    const files = await frameFiles(prisma, userId, currentVersions)
    const data = items.map(item => {
      const version = item.versions[0] || null
      const firstKey = Array.isArray(version?.frameKeys) ? version.frameKeys[0] : null
      return {
        id: item.id, assetNo: item.assetNo, title: item.title,
        sourceType: item.sourceType, assetType: item.assetType,
        status: item.status, collabStatus: item.collabStatus,
        currentVersionNo: item.currentVersionNo,
        currentVersion: version ? {
          id: version.id, versionNo: version.versionNo,
          baseFrameCount: version.baseFrameCount, manifestHash: version.manifestHash,
          sourceCustomProductId: version.sourceCustomProductId,
          previewFrameUrl: firstKey && files.has(firstKey) ? absoluteUrl(fastify, request, firstKey) : null,
          createdAt: version.createdAt
        } : null,
        createdAt: item.createdAt, updatedAt: item.updatedAt
      }
    })
    return reply.send({ success: true, data: { items: data, total, page, hasMore: page * limit < total } })
  })

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const asset = await prisma.animationAsset.findUnique({
      where: { id: request.params.id },
      include: { versions: { orderBy: { versionNo: 'desc' } } }
    })
    if (!asset || asset.ownerUserId !== request.user.userId || asset.status !== 'ACTIVE' || asset.frontDeletedAt) {
      return reply.code(404).send({ success: false, message: '动画资产不存在' })
    }
    const files = await frameFiles(prisma, request.user.userId, asset.versions)
    const versions = asset.versions.map(version => ({
      id: version.id, versionNo: version.versionNo,
      sourceType: version.sourceType, baseFrameCount: version.baseFrameCount,
      manifestHash: version.manifestHash, editorData: version.editorData,
      frames: (Array.isArray(version.frameKeys) ? version.frameKeys : []).map(key => ({
        key,
        url: files.has(key) ? absoluteUrl(fastify, request, key, 1800) : null
      })),
      createdAt: version.createdAt
    }))
    return reply.send({ success: true, data: {
      id: asset.id, assetNo: asset.assetNo, title: asset.title,
      sourceType: asset.sourceType, assetType: asset.assetType,
      status: asset.status, collabStatus: asset.collabStatus,
      currentVersionNo: asset.currentVersionNo, versions,
      createdAt: asset.createdAt, updatedAt: asset.updatedAt
    } })
  })

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const title = String(request.body?.title || '').trim()
    if (!title || title.length > 200) return reply.code(400).send({ success: false, message: '动画名称需要包含 1 至 200 个字符' })
    const asset = await prisma.animationAsset.findUnique({ where: { id: request.params.id } })
    if (!asset || asset.ownerUserId !== request.user.userId || asset.status !== 'ACTIVE' || asset.frontDeletedAt) {
      return reply.code(404).send({ success: false, message: '动画资产不存在' })
    }
    const updated = await prisma.animationAsset.update({ where: { id: asset.id }, data: { title } })
    return reply.send({ success: true, data: updated })
  })

  // 用户从当前版本继续编辑。旧版本不可覆盖，成功后只追加 V2/V3。
  fastify.post('/:id/versions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const body = request.body || {}
    const baseVersionId = String(body.baseVersionId || '').trim()
    const clientVersionKey = String(body.clientVersionKey || '').trim()
    const sourceKey = `ANIMATION_ASSET_EDIT:${request.params.id}:${clientVersionKey}`
    if (!baseVersionId || !/^[a-zA-Z0-9_-]{16,80}$/.test(clientVersionKey)) {
      return reply.code(400).send({ success: false, message: '动画修改标识无效，请刷新后重试' })
    }
    const frameKeys = Array.isArray(body.frameKeys)
      ? body.frameKeys.filter(key => typeof key === 'string' && key.startsWith('private/'))
      : []
    if (!frameKeys.length || frameKeys.length > 50 || frameKeys.length !== (body.frameKeys || []).length) {
      return reply.code(400).send({ success: false, message: '修改后的动画需要包含 1 至 50 帧有效图片' })
    }

    const previous = await prisma.animationAssetVersion.findUnique({
      where: { sourceKey }, include: { asset: true }
    })
    if (previous) {
      if (previous.assetId !== request.params.id || previous.asset.ownerUserId !== userId) {
        return reply.code(409).send({ success: false, message: '动画修改标识冲突，请刷新后重试' })
      }
      return reply.send({ success: true, reused: true, data: { asset: previous.asset, version: previous } })
    }

    const asset = await prisma.animationAsset.findUnique({
      where: { id: request.params.id },
      include: { versions: { where: { id: baseVersionId }, take: 1 } }
    })
    if (!asset || asset.ownerUserId !== userId || asset.status !== 'ACTIVE' || asset.frontDeletedAt) {
      return reply.code(404).send({ success: false, message: '动画资产不存在或已从动画库删除' })
    }
    if (asset.assetType === 'COLLAB' || !['NONE', 'STOPPED'].includes(asset.collabStatus)) {
      return reply.code(409).send({ success: false, message: '联名动画不能直接修改，请通过联名内容变更流程处理' })
    }
    if (!asset.versions[0] || asset.currentVersionNo !== asset.versions[0].versionNo) {
      return reply.code(409).send({ success: false, message: '动画已有更新，请返回“我的动画”重新进入最新版本' })
    }

    const compatibleSku = await prisma.machineModelSku.findFirst({
      where: { isActive: true, frameCount: { gte: frameKeys.length }, model: { isActive: true } },
      select: { frameCount: true }
    })
    if (!compatibleSku) {
      return reply.code(400).send({ success: false, message: `修改后的 ${frameKeys.length} 帧暂时没有可制作的在售规格` })
    }
    const activeSkuFrames = await prisma.machineModelSku.findMany({
      where: { isActive: true, model: { isActive: true } }, select: { frameCount: true }, distinct: ['frameCount']
    })
    if (!activeSkuFrames.some(sku => sku.frameCount && sku.frameCount % frameKeys.length === 0)) {
      return reply.code(400).send({ success: false, message: `修改后的 ${frameKeys.length} 帧不能整除任何在售规格的目标帧数` })
    }

    const uniqueKeys = [...new Set(frameKeys)]
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: uniqueKeys }, ownerUserId: userId, status: 'READY', deletedAt: null
    } })
    if (files.length !== uniqueKeys.length) {
      return reply.code(400).send({ success: false, message: '修改后的动画帧不存在、尚未上传完成或不属于当前账号' })
    }

    try {
      const created = await prisma.$transaction(async tx => {
        const current = await tx.animationAsset.findUnique({
          where: { id: asset.id },
          include: { versions: { where: { id: baseVersionId }, take: 1 } }
        })
        if (!current || !current.versions[0] || current.currentVersionNo !== current.versions[0].versionNo) {
          const stale = new Error('动画已有更新，请返回“我的动画”重新进入最新版本')
          stale.code = 'STALE_ANIMATION_VERSION'
          throw stale
        }
        const animation = await createAnimationAssetVersion(tx, {
          ownerUserId: userId,
          title: current.title,
          sourceType: 'USER_EDITED',
          sourceKey,
          createdByUserId: userId,
          frameKeys,
          editorData: {
            ...(body.editorData && typeof body.editorData === 'object' ? body.editorData : {}),
            baseVersionId,
            baseVersionNo: current.currentVersionNo
          },
          animationAssetId: current.id
        })
        const unlinked = files.filter(file => !file.linkedResourceId)
        if (unlinked.length) {
          await tx.privateFile.updateMany({
            where: { id: { in: unlinked.map(file => file.id) }, linkedResourceId: null },
            data: { linkedResourceType: 'ANIMATION_ASSET_VERSION', linkedResourceId: animation.version.id }
          })
        }
        await tx.auditLog.create({ data: {
          userId,
          action: 'ANIMATION_VERSION_CREATED',
          targetId: current.id,
          detail: {
            baseVersionId,
            animationVersionId: animation.version.id,
            versionNo: animation.version.versionNo,
            frameCount: animation.version.baseFrameCount,
            requestHash: crypto.createHash('sha256').update(clientVersionKey).digest('hex')
          },
          ip: request.ip
        } })
        return animation
      })
      return reply.code(201).send({ success: true, data: created })
    } catch (error) {
      if (error.code === 'STALE_ANIMATION_VERSION') {
        return reply.code(409).send({ success: false, message: error.message })
      }
      if (error.code === 'P2002') {
        const retry = await prisma.animationAssetVersion.findUnique({ where: { sourceKey }, include: { asset: true } })
        if (retry?.assetId === asset.id && retry.asset.ownerUserId === userId) {
          return reply.send({ success: true, reused: true, data: { asset: retry.asset, version: retry } })
        }
        return reply.code(409).send({ success: false, message: '动画版本已变化，请重新进入最新版本' })
      }
      throw error
    }
  })

  // 使用已确认的动画版本创建新的购买记录，不复制帧文件，也不生成新动画版本。
  fastify.post('/:id/reuse', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const body = request.body || {}
    const clientRequestKey = String(body.clientRequestKey || '').trim().slice(0, 80)
    const machineModelId = String(body.machineModelId || '').trim()
    const desiredSkuId = String(body.desiredSkuId || '').trim()
    if (!clientRequestKey || !machineModelId || !desiredSkuId) {
      return reply.code(400).send({ success: false, message: '请选择需要再次制作的款式和规格' })
    }

    const existing = await prisma.customizationRequest.findUnique({ where: { clientDraftKey: clientRequestKey } })
    if (existing) {
      if (existing.userId !== userId || existing.animationAssetId !== request.params.id) {
        return reply.code(409).send({ success: false, message: '本次购买标识冲突，请刷新后重试' })
      }
      return reply.send({ success: true, reused: true, data: { request: existing, customProductId: existing.customProductId } })
    }

    const asset = await prisma.animationAsset.findUnique({
      where: { id: request.params.id },
      include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } }
    })
    if (!asset || asset.ownerUserId !== userId || asset.status !== 'ACTIVE' || asset.frontDeletedAt) {
      return reply.code(404).send({ success: false, message: '动画资产不存在或已从动画库删除' })
    }
    const version = asset.versions[0]
    if (!version || version.versionNo !== asset.currentVersionNo) {
      return reply.code(409).send({ success: false, message: '动画版本信息不完整，请联系客服处理' })
    }

    const sku = await prisma.machineModelSku.findFirst({
      where: { id: desiredSkuId, modelId: machineModelId, isActive: true },
      include: { model: { select: { id: true, name: true, isActive: true } } }
    })
    if (!sku || !sku.model?.isActive) {
      return reply.code(400).send({ success: false, message: '所选款式或规格不存在、已停用' })
    }
    if (!version.baseFrameCount || !sku.frameCount || sku.frameCount % version.baseFrameCount !== 0) {
      return reply.code(400).send({
        success: false,
        message: `该动画为 ${version.baseFrameCount} 帧，不能用于当前 ${sku.frameCount} 帧规格`
      })
    }

    const frameKeys = Array.isArray(version.frameKeys) ? version.frameKeys : []
    const uniqueKeys = [...new Set(frameKeys)]
    const readyFileCount = uniqueKeys.length ? await prisma.privateFile.count({ where: {
      objectKey: { in: uniqueKeys }, ownerUserId: userId, status: 'READY', deletedAt: null
    } }) : 0
    if (!uniqueKeys.length || readyFileCount !== uniqueKeys.length) {
      return reply.code(409).send({ success: false, message: '动画素材不完整，暂时不能再次制作，请联系客服' })
    }

    const requestedOptions = Array.isArray(body.requestedOptions)
      ? body.requestedOptions.slice(0, 20).map(item => ({
          skuId: String(item?.skuId || ''),
          frame: Number(item?.frame || 0),
          size: String(item?.size || '').slice(0, 60),
          material: String(item?.material || '').slice(0, 60),
          colorName: String(item?.colorName || '').slice(0, 60),
          referencePrice: Number(item?.referencePrice || 0)
        }))
      : []
    const requestNo = await createCustomizationRequestNo(prisma)
    let created
    try {
      created = await prisma.$transaction(async tx => {
        const product = await tx.customProduct.create({ data: {
          userId,
          animationFrames: JSON.stringify(frameKeys),
          draftData: JSON.stringify({
            version: 1,
            source: 'animation-asset-reuse',
            animationAssetId: asset.id,
            animationVersionId: version.id,
            animationVersionNo: version.versionNo
          }),
          draftExpiresAt: null,
          configJson: JSON.stringify({
            animName: asset.title,
            frameCount: version.baseFrameCount,
            modelId: machineModelId,
            modelName: sku.model.name
          }),
          hardwareSkuId: sku.id,
          frameCount: version.baseFrameCount,
          animationAssetId: asset.id,
          animationVersionId: version.id,
          status: 'draft'
        } })
        const customization = await tx.customizationRequest.create({ data: {
          requestNo,
          userId,
          mode: 'SELF',
          status: 'CONFIRMED',
          clientDraftKey: clientRequestKey,
          customProductId: product.id,
          machineModelId,
          desiredSkuId: sku.id,
          animationAssetId: asset.id,
          acceptedAnimationVersionId: version.id,
          sourceKeys: [],
          selectedFrameKeys: frameKeys,
          screeningData: { source: 'ANIMATION_ASSET_REUSE', assetNo: asset.assetNo, versionNo: version.versionNo },
          editorData: { requestedOptions },
          userNote: String(body.userNote || '').trim().slice(0, 1000) || null,
          submittedAt: new Date()
        } })
        await tx.customizationRequestEvent.create({ data: {
          requestId: customization.id,
          actorUserId: userId,
          actorType: 'USER',
          eventType: 'ANIMATION_ASSET_REUSED',
          toStatus: 'CONFIRMED',
          publicMessage: `已使用动画 ${asset.assetNo} V${version.versionNo} 选择新款式`,
          detail: { animationAssetId: asset.id, animationVersionId: version.id, desiredSkuId: sku.id }
        } })
        return { request: customization, customProductId: product.id }
      })
    } catch (error) {
      if (error.code !== 'P2002') throw error
      const retry = await prisma.customizationRequest.findUnique({ where: { clientDraftKey: clientRequestKey } })
      if (!retry || retry.userId !== userId || retry.animationAssetId !== asset.id) throw error
      return reply.send({ success: true, reused: true, data: { request: retry, customProductId: retry.customProductId } })
    }
    return reply.code(201).send({ success: true, data: created })
  })

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const asset = await prisma.animationAsset.findUnique({ where: { id: request.params.id } })
    if (!asset || asset.ownerUserId !== request.user.userId) {
      return reply.code(404).send({ success: false, message: '动画资产不存在' })
    }
    if (asset.status === 'USER_DELETED') return reply.send({ success: true, reused: true })
    if (asset.assetType === 'COLLAB' || !['NONE', 'STOPPED'].includes(asset.collabStatus)) {
      return reply.code(409).send({ success: false, message: '联名动画不能删除，只能按合作流程下架或归档' })
    }
    await prisma.animationAsset.update({
      where: { id: asset.id }, data: { status: 'USER_DELETED', frontDeletedAt: new Date() }
    })
    return reply.send({ success: true })
  })
}
