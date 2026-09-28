import crypto from 'crypto'
import { createAnimationAssetNo } from '../lib/animation-assets.js'
import { FILE_PURPOSE } from '../lib/private-files.js'
import { generateProductionFile } from '../lib/production-artifacts.js'

const SOURCE_CHANNELS = new Set(['WEB_CUSTOM', 'OFFLINE_CUSTOM', 'CREATOR_SUBMISSION', 'INTERNAL_CREATED'])
const USAGE_TYPES = new Set(['PRIVATE_CUSTOM', 'COLLAB_SALE', 'COMPANY_PRODUCT', 'INTERNAL_TEST', 'UNDECIDED'])
const RIGHTS_TYPES = new Set(['USER', 'OFFLINE_CUSTOMER', 'CREATOR', 'COMPANY', 'UNCONFIRMED'])
const AUTH_STATUSES = new Set(['PRIVATE_ONLY', 'PENDING', 'AUTHORIZED'])

function clean(value, max = 200) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}
function list(value, limit = 30) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => clean(item, 40)).filter(Boolean))].slice(0, limit)
}

function frameKeys(value) {
  return (Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'string' && item.startsWith('private/'))
    .slice(0, 50)
}

function manifestHash(keys, files) {
  const hashes = new Map(files.map(file => [file.objectKey, file.sha256 || '']))
  return crypto.createHash('sha256')
    .update(JSON.stringify(keys.map(key => ({ key, sha256: hashes.get(key) || '' }))))
    .digest('hex')
}

function signedUrl(fastify, key, seconds = 1800) {
  if (!key) return null
  if (key.startsWith('data:') || key.startsWith('http://') || key.startsWith('https://')) return key
  try { return fastify.storagePresignGet(key, seconds) } catch { return null }
}

function maskedPhone(phone) {
  const value = String(phone || '')
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : null
}

function maskedContact(contact) {
  const value = String(contact || '').trim()
  if (!value) return null
  if (/^1\d{10}$/.test(value)) return `${value.slice(0, 3)}****${value.slice(-4)}`
  return value.length > 4 ? `${value.slice(0, 2)}***${value.slice(-2)}` : '***'
}

function ownerOnly(request, reply) {
  if (request.user?.staffRole === 'OWNER') return true
  reply.code(403).send({ success: false, message: '只有负责人可以执行这项操作', code: 'FRAME_LIBRARY_OWNER_REQUIRED' })
  return false
}

function validateBusinessRules(data) {
  if (!SOURCE_CHANNELS.has(data.sourceChannel)) return '帧图来源无效'
  if (!USAGE_TYPES.has(data.usageType)) return '当前用途无效'
  if (!RIGHTS_TYPES.has(data.rightsHolderType)) return '权利主体类型无效'
  if (!AUTH_STATUSES.has(data.authorizationStatus)) return '授权状态无效'
  if (data.sourceChannel === 'OFFLINE_CUSTOM' && !clean(data.rightsHolderName, 120)) return '线下定制必须填写客户或权利人名称'
  if (['COLLAB_SALE', 'COMPANY_PRODUCT'].includes(data.usageType) && data.authorizationStatus !== 'AUTHORIZED') {
    return '没有明确授权的素材只能用于私人定制或内部确认'
  }
  return null
}

async function replaceTags(tx, assetId, names) {
  await tx.animationAssetTag.deleteMany({ where: { assetId } })
  for (const name of list(names)) {
    const tag = await tx.animationTag.upsert({
      where: { name }, update: {}, create: { name }
    })
    await tx.animationAssetTag.create({ data: { assetId, tagId: tag.id } })
  }
}

function categoryWhere(category) {
  if (category === 'private') return { usageType: 'PRIVATE_CUSTOM', status: { not: 'ARCHIVED' } }
  if (category === 'collab') return { usageType: 'COLLAB_SALE', status: { not: 'ARCHIVED' } }
  if (category === 'company') return { usageType: 'COMPANY_PRODUCT', status: { not: 'ARCHIVED' } }
  if (category === 'internal') return { usageType: 'INTERNAL_TEST', status: { not: 'ARCHIVED' } }
  if (category === 'incomplete') return { OR: [{ currentVersionNo: 0 }, { rightsHolderType: 'UNCONFIRMED' }], status: { not: 'ARCHIVED' } }
  if (category === 'user_deleted') return { status: 'USER_DELETED' }
  if (category === 'archived') return { status: 'ARCHIVED' }
  return { status: { not: 'ARCHIVED' } }
}

export default async function frameLibraryRoutes(fastify) {
  const { prisma } = fastify

  fastify.get('/stats', async () => {
    const [all, privateCount, collab, company, internal, incomplete, userDeleted, archived] = await Promise.all([
      prisma.animationAsset.count({ where: { status: { not: 'ARCHIVED' } } }),
      prisma.animationAsset.count({ where: categoryWhere('private') }),
      prisma.animationAsset.count({ where: categoryWhere('collab') }),
      prisma.animationAsset.count({ where: categoryWhere('company') }),
      prisma.animationAsset.count({ where: categoryWhere('internal') }),
      prisma.animationAsset.count({ where: categoryWhere('incomplete') }),
      prisma.animationAsset.count({ where: categoryWhere('user_deleted') }),
      prisma.animationAsset.count({ where: categoryWhere('archived') })
    ])
    const tags = await prisma.animationTag.findMany({
      where: { assets: { some: {} } }, orderBy: { name: 'asc' }, take: 100,
      select: { id: true, name: true, color: true, _count: { select: { assets: true } } }
    })
    return { success: true, data: { all, private: privateCount, collab, company, internal, incomplete, userDeleted, archived, tags } }
  })

  fastify.get('/', async (request) => {
    const page = Math.max(1, Number(request.query.page || 1))
    const limit = Math.min(48, Math.max(1, Number(request.query.limit || 24)))
    const category = clean(request.query.category, 30) || 'all'
    const keyword = clean(request.query.keyword, 80)
    const tag = clean(request.query.tag, 40)
    const where = categoryWhere(category)
    const filters = []
    if (keyword) filters.push({ OR: [
      { assetNo: { contains: keyword, mode: 'insensitive' } },
      { title: { contains: keyword, mode: 'insensitive' } },
      { rightsHolderName: { contains: keyword, mode: 'insensitive' } },
      { owner: { is: { phone: { contains: keyword } } } },
      { owner: { is: { profile: { is: { nickname: { contains: keyword, mode: 'insensitive' } } } } } },
      { customizationRequests: { some: { requestNo: { contains: keyword, mode: 'insensitive' } } } },
      { salesOrderItems: { some: { salesOrder: { orderNo: { contains: keyword, mode: 'insensitive' } } } } },
      { tags: { some: { tag: { name: { contains: keyword, mode: 'insensitive' } } } } }
    ] })
    if (tag) filters.push({ tags: { some: { tag: { name: tag } } } })
    if (filters.length) where.AND = filters

    const [assets, total] = await Promise.all([
      prisma.animationAsset.findMany({
        where, orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit,
        include: {
          owner: { select: { phone: true, profile: { select: { nickname: true } } } },
          tags: { include: { tag: true } },
          collabWorks: { select: { id: true, status: true, shelfStatus: true } },
          productionFiles: { where: { status: 'READY' }, orderBy: { createdAt: 'desc' }, take: 6,
            include: { templateVersion: { include: { group: { select: { name: true } } } } } },
          _count: { select: { versions: true, customizationRequests: true, salesOrderItems: true, collabWorks: true } }
        }
      }),
      prisma.animationAsset.count({ where })
    ])
    const versions = assets.length ? await prisma.animationAssetVersion.findMany({
      where: { assetId: { in: assets.map(asset => asset.id) } }, orderBy: { versionNo: 'desc' },
      select: { assetId: true, versionNo: true, baseFrameCount: true, frameKeys: true, createdAt: true }
    }) : []
    const currentMap = new Map()
    for (const version of versions) {
      const asset = assets.find(item => item.id === version.assetId)
      if (asset && version.versionNo === asset.currentVersionNo) currentMap.set(version.assetId, version)
    }
    return { success: true, data: {
      items: assets.map(asset => {
        const current = currentMap.get(asset.id)
        const coverKey = Array.isArray(current?.frameKeys) ? current.frameKeys[0] : null
        return {
          id: asset.id, assetNo: asset.assetNo, title: asset.title, sourceType: asset.sourceType,
          sourceChannel: asset.sourceChannel, usageType: asset.usageType, assetType: asset.assetType,
          status: asset.status, collabStatus: asset.collabStatus, rightsHolderType: asset.rightsHolderType,
          rightsHolderName: asset.rightsHolderName, authorizationStatus: asset.authorizationStatus,
          currentVersionNo: asset.currentVersionNo, baseFrameCount: current?.baseFrameCount || 0,
          coverUrl: signedUrl(fastify, coverKey, 900), createdAt: asset.createdAt, updatedAt: asset.updatedAt,
          owner: asset.owner ? { nickname: asset.owner.profile?.nickname || '未设置昵称', phone: maskedPhone(asset.owner.phone) } : null,
          tags: asset.tags.map(link => ({ name: link.tag.name, color: link.tag.color })), counts: asset._count,
          productionFiles: asset.productionFiles.map(file => ({
            id: file.id, displayName: file.displayName, createdAt: file.createdAt,
            downloadUrl: signedUrl(fastify, file.objectKey, 900)
          })),
          canDelete: request.user.staffRole === 'OWNER'
        }
      }),
      total, page, limit, hasMore: page * limit < total
    } }
  })

  fastify.get('/:id/versions/:versionNo', async (request, reply) => {
    const asset = await prisma.animationAsset.findUnique({ where: { id: request.params.id }, select: { id: true, assetNo: true } })
    if (!asset) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    const version = await prisma.animationAssetVersion.findUnique({
      where: { assetId_versionNo: { assetId: asset.id, versionNo: Number(request.params.versionNo) } }
    })
    if (!version) return reply.code(404).send({ success: false, message: '动画版本不存在' })
    const keys = Array.isArray(version.frameKeys) ? version.frameKeys : []
    await prisma.auditLog.create({ data: {
      userId: request.user.userId, action: 'FRAME_LIBRARY_VERSION_VIEWED', targetId: version.id,
      detail: { assetNo: asset.assetNo, versionNo: version.versionNo, frameCount: keys.length }, ip: request.ip
    } })
    return reply.send({ success: true, data: {
      id: version.id, versionNo: version.versionNo, sourceType: version.sourceType,
      baseFrameCount: version.baseFrameCount, manifestHash: version.manifestHash,
      editorData: version.editorData, createdAt: version.createdAt,
      frames: keys.map((key, index) => ({ index: index + 1, url: signedUrl(fastify, key) }))
    } })
  })

  fastify.get('/:id', async (request, reply) => {
    const asset = await prisma.animationAsset.findUnique({
      where: { id: request.params.id }, include: {
        owner: { select: { id: true, phone: true, profile: { select: { nickname: true } } } },
        createdByStaff: { select: { profile: { select: { nickname: true } } } },
        versions: { orderBy: { versionNo: 'desc' }, select: { id: true, versionNo: true, sourceType: true, baseFrameCount: true, manifestHash: true, createdAt: true } },
        tags: { include: { tag: true } },
        customizationRequests: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, requestNo: true, mode: true, status: true, createdAt: true } },
        salesOrderItems: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, itemNo: true, skuCode: true, quantity: true, salesOrder: { select: { orderNo: true, status: true } } } },
        collabWorks: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, title: true, status: true, shelfStatus: true, createdAt: true } },
        productionFiles: { orderBy: [{ createdAt: 'desc' }], include: {
          animationVersion: { select: { versionNo: true, baseFrameCount: true } },
          templateVersion: { include: { group: true } },
          render: { select: { size: true, widthPx: true, heightPx: true, markerEnabled: true, frameKeys: true } }
        } },
        _count: { select: { customProducts: true, versions: true, customizationRequests: true, salesOrderItems: true, collabWorks: true } }
      }
    })
    if (!asset) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    return reply.send({ success: true, data: {
      ...asset,
      owner: asset.owner ? { id: asset.owner.id, nickname: asset.owner.profile?.nickname || '未设置昵称', phone: maskedPhone(asset.owner.phone) } : null,
      rightsHolderContact: request.user.staffRole === 'OWNER' ? asset.rightsHolderContact : null,
      rightsHolderContactMasked: maskedContact(asset.rightsHolderContact),
      tags: asset.tags.map(link => ({ id: link.tag.id, name: link.tag.name, color: link.tag.color })),
      createdByStaffName: asset.createdByStaff?.profile?.nickname || null,
      productionFiles: asset.productionFiles.map(file => ({
        id: file.id, displayName: file.displayName, targetFrameCount: file.targetFrameCount,
        fileVersionNo: file.fileVersionNo, sourceType: file.sourceType, productionBatchId: file.productionBatchId,
        status: file.status, createdAt: file.createdAt, animationVersionNo: file.animationVersion.versionNo,
        groupName: file.templateVersion.group.name, templateVersionNo: file.templateVersion.versionNo,
        renderedFrameCount: Array.isArray(file.render.frameKeys) ? file.render.frameKeys.length : 0,
        renderSize: file.render.size, canDelete: request.user.staffRole === 'OWNER' && !file.productionBatchId,
        deleteBlockedReason: file.productionBatchId ? '已绑定生产批次，不能删除' : null,
        downloadUrl: signedUrl(fastify, file.objectKey, 900)
      })),
      createdByStaff: undefined
    } })
  })

  fastify.get('/:id/production-options', async (request, reply) => {
    const asset = await prisma.animationAsset.findUnique({
      where: { id: request.params.id },
      include: { versions: { orderBy: { versionNo: 'desc' } } }
    })
    if (!asset) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    const groups = await prisma.printCutGroup.findMany({
      where: { isActive: true, templates: { some: { status: 'ACTIVE' } } },
      include: { templates: { where: { status: 'ACTIVE' }, orderBy: { versionNo: 'desc' }, take: 1 } },
      orderBy: { sortOrder: 'asc' }
    })
    return reply.send({ success: true, data: {
      versions: asset.versions.map(version => ({ id: version.id, versionNo: version.versionNo, baseFrameCount: version.baseFrameCount })),
      templates: groups.map(group => ({
        id: group.templates[0].id, templateVersionNo: group.templates[0].versionNo, groupId: group.id,
        groupName: group.name, size: group.size, paperSize: group.paperSize, paperType: group.paperType,
        orientation: group.orientation, framesPerSheet: group.framesPerSheet, renderDpi: group.renderDpi
      }))
    } })
  })

  fastify.post('/:id/production-files', async (request, reply) => {
    if (!['OWNER', 'PRODUCTION'].includes(request.user.staffRole)) {
      return reply.code(403).send({ success: false, message: '只有负责人或生产人员可以生成生产文件' })
    }
    try {
      const file = await generateProductionFile(fastify, {
        assetId: request.params.id,
        animationVersionId: clean(request.body?.animationVersionId, 50),
        templateVersionId: clean(request.body?.templateVersionId, 50),
        targetFrameCount: Number(request.body?.targetFrameCount),
        markerEnabled: request.body?.markerEnabled !== false,
        createdBy: request.user.userId,
        sourceType: 'MANUAL'
      })
      return reply.code(201).send({ success: true, message: '生产文件已经生成', data: {
        id: file.id, displayName: file.displayName, downloadUrl: signedUrl(fastify, file.objectKey, 900)
      } })
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }
  })

  fastify.get('/:id/production-files/:fileId/frames', async (request, reply) => {
    const file = await prisma.productionPrintFile.findFirst({
      where: { id: request.params.fileId, assetId: request.params.id },
      include: {
        asset: { select: { assetNo: true } },
        animationVersion: { select: { versionNo: true } },
        render: true
      }
    })
    if (!file) return reply.code(404).send({ success: false, message: '生产文件不存在' })
    const keys = Array.isArray(file.render.frameKeys) ? file.render.frameKeys : []
    await prisma.auditLog.create({ data: {
      userId: request.user.userId, action: 'PRODUCTION_RENDER_FRAMES_VIEWED', targetId: file.id,
      detail: { assetNo: file.asset.assetNo, animationVersionNo: file.animationVersion.versionNo, frameCount: keys.length }, ip: request.ip
    } })
    return reply.send({ success: true, data: {
      fileId: file.id, displayName: file.displayName, animationVersionNo: file.animationVersion.versionNo,
      size: file.render.size, widthPx: file.render.widthPx, heightPx: file.render.heightPx,
      markerEnabled: file.render.markerEnabled,
      frames: keys.map((key, index) => ({
        index: index + 1, name: `frame-${String(index + 1).padStart(3, '0')}.png`, url: signedUrl(fastify, key, 900)
      }))
    } })
  })

  fastify.delete('/:id/production-files/:fileId', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const file = await prisma.productionPrintFile.findFirst({
      where: { id: request.params.fileId, assetId: request.params.id },
      include: { asset: { select: { assetNo: true } } }
    })
    if (!file) return reply.code(404).send({ success: false, message: '生产文件不存在' })
    if (file.productionBatchId) {
      return reply.code(409).send({ success: false, message: '该文件已经绑定生产批次，不能删除；请在生产异常流程中处理' })
    }
    await prisma.$transaction(async tx => {
      await tx.productionPrintFile.delete({ where: { id: file.id } })
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'PRODUCTION_PRINT_FILE_DELETED', targetId: file.id,
        detail: { assetNo: file.asset.assetNo, displayName: file.displayName, objectKey: file.objectKey }, ip: request.ip
      } })
    })
    await fastify.storageDelete(file.objectKey).catch(error => fastify.log.warn({ error, key: file.objectKey }, '生产文件物理清理失败'))
    return reply.send({ success: true, message: '生产文件已删除' })
  })

  fastify.post('/', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const body = request.body || {}
    const data = {
      sourceChannel: clean(body.sourceChannel, 30) || 'INTERNAL_CREATED',
      usageType: clean(body.usageType, 30) || 'INTERNAL_TEST',
      rightsHolderType: clean(body.rightsHolderType, 30) || 'COMPANY',
      authorizationStatus: clean(body.authorizationStatus, 30) || 'PRIVATE_ONLY',
      rightsHolderName: clean(body.rightsHolderName, 120)
    }
    const businessError = validateBusinessRules(data)
    if (businessError) return reply.code(400).send({ success: false, message: businessError })
    const keys = frameKeys(body.frameKeys)
    if (!keys.length || keys.length !== (Array.isArray(body.frameKeys) ? body.frameKeys.length : 0)) {
      return reply.code(400).send({ success: false, message: '需要上传 1 至 50 张有效帧图' })
    }
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: [...new Set(keys)] }, ownerUserId: request.user.userId,
      purpose: FILE_PURPOSE.LIBRARY_FRAME, status: 'READY', deletedAt: null, linkedResourceId: null
    } })
    if (files.length !== new Set(keys).size) return reply.code(400).send({ success: false, message: '帧图不存在、未上传完成或已被其他资料使用' })
    let ownerUserId = clean(body.ownerUserId, 50)
    const ownerPhone = clean(body.ownerPhone, 20)
    if (ownerPhone) {
      const owner = await prisma.user.findUnique({ where: { phone: ownerPhone }, select: { id: true } })
      if (!owner) return reply.code(400).send({ success: false, message: '该手机号还没有网站账号，可以先留空，日后再绑定' })
      ownerUserId = owner.id
    } else if (ownerUserId && !await prisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true } })) {
      return reply.code(400).send({ success: false, message: '要绑定的网站账号不存在' })
    }
    const sourceKey = `FRAME_LIBRARY_IMPORT:${crypto.randomUUID()}`
    const result = await prisma.$transaction(async tx => {
      const asset = await tx.animationAsset.create({ data: {
        assetNo: await createAnimationAssetNo(tx), ownerUserId: ownerUserId || null,
        title: clean(body.title, 200) || '未命名动画', sourceType: 'STAFF_CREATED',
        sourceChannel: data.sourceChannel, usageType: data.usageType,
        assetType: data.usageType === 'COLLAB_SALE' ? 'COLLAB' : 'PRIVATE',
        collabStatus: data.usageType === 'COLLAB_SALE' ? 'AUTHORIZED' : 'NONE',
        rightsHolderType: data.rightsHolderType, rightsHolderName: data.rightsHolderName,
        rightsHolderContact: clean(body.rightsHolderContact, 200), authorizationStatus: data.authorizationStatus,
        internalNotes: clean(body.internalNotes, 4000), createdByStaffId: request.user.userId, currentVersionNo: 1
      } })
      const version = await tx.animationAssetVersion.create({ data: {
        assetId: asset.id, versionNo: 1, sourceKey, sourceType: 'STAFF_CREATED',
        createdByUserId: request.user.userId, frameKeys: keys, baseFrameCount: keys.length,
        manifestHash: manifestHash(keys, files)
      } })
      await tx.privateFile.updateMany({ where: { id: { in: files.map(file => file.id) } }, data: {
        ownerUserId: ownerUserId || null, linkedResourceType: 'ANIMATION_ASSET', linkedResourceId: asset.id
      } })
      await replaceTags(tx, asset.id, body.tags)
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'FRAME_LIBRARY_ASSET_CREATED', targetId: asset.id,
        detail: { assetNo: asset.assetNo, sourceChannel: data.sourceChannel, usageType: data.usageType, frameCount: keys.length }, ip: request.ip
      } })
      return { asset, version }
    })
    return reply.code(201).send({ success: true, data: { id: result.asset.id, assetNo: result.asset.assetNo, versionNo: 1 } })
  })

  fastify.patch('/:id', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const current = await prisma.animationAsset.findUnique({ where: { id: request.params.id }, include: { collabWorks: { select: { id: true } } } })
    if (!current) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    const body = request.body || {}
    const data = {
      sourceChannel: clean(body.sourceChannel, 30) || current.sourceChannel,
      usageType: clean(body.usageType, 30) || current.usageType,
      rightsHolderType: clean(body.rightsHolderType, 30) || current.rightsHolderType,
      authorizationStatus: clean(body.authorizationStatus, 30) || current.authorizationStatus,
      rightsHolderName: body.rightsHolderName === undefined ? current.rightsHolderName : clean(body.rightsHolderName, 120)
    }
    const businessError = validateBusinessRules(data)
    if (businessError) return reply.code(400).send({ success: false, message: businessError })
    if (current.collabWorks.length && data.usageType !== 'COLLAB_SALE') {
      return reply.code(409).send({ success: false, message: '已经关联联名作品，不能改为非联名用途' })
    }
    let ownerUserId = current.ownerUserId
    const ownerPhone = clean(body.ownerPhone, 20)
    if (ownerPhone) {
      const owner = await prisma.user.findUnique({ where: { phone: ownerPhone }, select: { id: true } })
      if (!owner) return reply.code(400).send({ success: false, message: '该手机号还没有网站账号，请先完成注册后再绑定' })
      ownerUserId = owner.id
    }
    const updated = await prisma.$transaction(async tx => {
      const asset = await tx.animationAsset.update({ where: { id: current.id }, data: {
        title: clean(body.title, 200) || current.title, sourceChannel: data.sourceChannel,
        usageType: data.usageType, assetType: data.usageType === 'COLLAB_SALE' ? 'COLLAB' : 'PRIVATE',
        collabStatus: data.usageType === 'COLLAB_SALE' && data.authorizationStatus === 'AUTHORIZED'
          ? 'AUTHORIZED'
          : (current.collabWorks.length ? current.collabStatus : 'NONE'),
        rightsHolderType: data.rightsHolderType, rightsHolderName: data.rightsHolderName,
        rightsHolderContact: body.rightsHolderContact === undefined ? current.rightsHolderContact : clean(body.rightsHolderContact, 200),
        authorizationStatus: data.authorizationStatus, ownerUserId,
        internalNotes: body.internalNotes === undefined ? current.internalNotes : clean(body.internalNotes, 4000)
      } })
      if (ownerUserId !== current.ownerUserId) {
        await tx.privateFile.updateMany({
          where: { linkedResourceType: 'ANIMATION_ASSET', linkedResourceId: current.id },
          data: { ownerUserId }
        })
      }
      if (Array.isArray(body.tags)) await replaceTags(tx, current.id, body.tags)
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'FRAME_LIBRARY_ASSET_UPDATED', targetId: current.id,
        detail: { assetNo: current.assetNo, changedFields: Object.keys(body).filter(key => key !== 'rightsHolderContact') }, ip: request.ip
      } })
      return asset
    })
    return reply.send({ success: true, data: { id: updated.id, assetNo: updated.assetNo } })
  })

  fastify.post('/:id/archive', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const asset = await prisma.animationAsset.findUnique({ where: { id: request.params.id } })
    if (!asset) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    if (asset.status === 'USER_DELETED') return reply.code(409).send({ success: false, message: '用户已删除的私人资产已经受控隐藏，无需再次归档' })
    await prisma.$transaction(async tx => {
      await tx.animationAsset.update({ where: { id: asset.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
      await tx.auditLog.create({ data: { userId: request.user.userId, action: 'FRAME_LIBRARY_ASSET_ARCHIVED', targetId: asset.id, detail: { assetNo: asset.assetNo }, ip: request.ip } })
    })
    return reply.send({ success: true })
  })

  fastify.post('/:id/restore', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const asset = await prisma.animationAsset.findUnique({ where: { id: request.params.id } })
    if (!asset) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    if (asset.status !== 'ARCHIVED') return reply.code(409).send({ success: false, message: '只有已归档资料可以恢复' })
    await prisma.$transaction(async tx => {
      await tx.animationAsset.update({ where: { id: asset.id }, data: { status: 'ACTIVE', archivedAt: null } })
      await tx.auditLog.create({ data: { userId: request.user.userId, action: 'FRAME_LIBRARY_ASSET_RESTORED', targetId: asset.id, detail: { assetNo: asset.assetNo }, ip: request.ip } })
    })
    return reply.send({ success: true })
  })

  fastify.delete('/:id', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const asset = await prisma.animationAsset.findUnique({ where: { id: request.params.id }, include: {
      versions: { select: { id: true, frameKeys: true, _count: { select: { productionRenders: true } } } },
      _count: { select: { customProducts: true, customizationRequests: true, salesOrderItems: true, collabWorks: true, productionFiles: true } }
    } })
    if (!asset) return reply.code(404).send({ success: false, message: '帧图资产不存在' })
    const blockers = []
    if (asset.usageType !== 'INTERNAL_TEST' || asset.sourceChannel !== 'INTERNAL_CREATED') blockers.push('只有无业务关系的内部测试素材可以永久删除')
    if (asset._count.customProducts || asset._count.customizationRequests) blockers.push('存在定制或编辑记录')
    if (asset._count.salesOrderItems) blockers.push('存在订单或生产关系')
    if (asset._count.collabWorks || asset.assetType === 'COLLAB') blockers.push('存在联名关系')
    if (asset._count.productionFiles || asset.versions.some(version => version._count.productionRenders)) blockers.push('存在生产文件或已拼接帧')
    if (asset.versions.length > 1) blockers.push('存在历史版本')
    if (blockers.length) return reply.code(409).send({ success: false, message: '该素材不能永久删除', data: { blockers } })
    const keys = [...new Set(asset.versions.flatMap(version => Array.isArray(version.frameKeys) ? version.frameKeys : []).filter(key => typeof key === 'string' && key.startsWith('private/')))]
    await prisma.$transaction(async tx => {
      await tx.animationAssetTag.deleteMany({ where: { assetId: asset.id } })
      await tx.animationAssetVersion.deleteMany({ where: { assetId: asset.id } })
      await tx.privateFile.deleteMany({ where: { linkedResourceType: 'ANIMATION_ASSET', linkedResourceId: asset.id } })
      await tx.animationAsset.delete({ where: { id: asset.id } })
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'FRAME_LIBRARY_ASSET_PERMANENTLY_DELETED', targetId: asset.id,
        detail: { assetNo: asset.assetNo, frameCount: keys.length }, ip: request.ip
      } })
    })
    for (const key of keys) await fastify.storageDelete(key).catch(error => fastify.log.warn({ error, key }, '帧图物理文件清理失败'))
    return reply.send({ success: true })
  })
}
