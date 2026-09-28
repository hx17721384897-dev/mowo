import crypto from 'crypto'
import { createAnimationAssetNo } from '../lib/animation-assets.js'
import { FILE_PURPOSE } from '../lib/private-files.js'

const SOURCE_TYPES = new Set(['VIDEO', 'GIF', 'IMAGES'])
const SOURCE_CHANNELS = new Set(['OFFLINE_CUSTOM', 'CREATOR_SUBMISSION', 'INTERNAL_CREATED'])
const USAGE_TYPES = new Set(['PRIVATE_CUSTOM', 'COLLAB_SALE', 'COMPANY_PRODUCT', 'INTERNAL_TEST', 'UNDECIDED'])
const RIGHTS_TYPES = new Set(['USER', 'OFFLINE_CUSTOMER', 'CREATOR', 'COMPANY', 'UNCONFIRMED'])
const AUTH_STATUSES = new Set(['PRIVATE_ONLY', 'PENDING', 'AUTHORIZED'])
const RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16'])

function clean(value, max = 200) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}

function stringList(value, limit = 100, max = 500) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => clean(item, max)).filter(Boolean))].slice(0, limit)
}

function orderedKeys(value, limit = 50) {
  return (Array.isArray(value) ? value : []).map(item => clean(item, 500)).filter(Boolean).slice(0, limit)
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function draftNo() {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `FD-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

function manifestHash(keys, files, editorData) {
  const hashes = new Map(files.map(file => [file.objectKey, file.sha256 || '']))
  return crypto.createHash('sha256').update(JSON.stringify({
    frames: keys.map(key => ({ key, sha256: hashes.get(key) || '' })), editorData: jsonObject(editorData)
  })).digest('hex')
}

function validateBusiness(data) {
  if (!SOURCE_CHANNELS.has(data.sourceChannel)) return '素材来源无效'
  if (!USAGE_TYPES.has(data.usageType)) return '当前用途无效'
  if (!RIGHTS_TYPES.has(data.rightsHolderType)) return '权利主体类型无效'
  if (!AUTH_STATUSES.has(data.authorizationStatus)) return '授权状态无效'
  if (!RATIOS.has(data.targetRatio)) return '画面比例无效'
  if (data.sourceChannel === 'OFFLINE_CUSTOM' && !data.rightsHolderName) return '线下定制必须填写客户或权利人名称'
  if (['COLLAB_SALE', 'COMPANY_PRODUCT'].includes(data.usageType) && data.authorizationStatus !== 'AUTHORIZED') {
    return '没有明确授权的素材不能用于联名销售或公司商品'
  }
  return null
}

async function replaceTags(tx, assetId, names) {
  for (const name of stringList(names, 30, 40)) {
    const tag = await tx.animationTag.upsert({ where: { name }, update: {}, create: { name } })
    await tx.animationAssetTag.create({ data: { assetId, tagId: tag.id } })
  }
}

function isOwner(request) {
  return request.user?.staffRole === 'OWNER'
}

export default async function frameMakingRoutes(fastify) {
  const { prisma } = fastify

  fastify.get('/drafts', async request => {
    const status = clean(request.query.status, 20) || 'DRAFT'
    const where = status === 'ALL' ? {} : { status }
    const rows = await prisma.frameAssetDraft.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: 100,
      include: {
        createdByStaff: { select: { profile: { select: { nickname: true } } } },
        lastEditedBy: { select: { profile: { select: { nickname: true } } } },
        animationAsset: { select: { id: true, assetNo: true } }
      }
    })
    return { success: true, data: rows.map(row => ({
      id: row.id, draftNo: row.draftNo, status: row.status, title: row.title,
      sourceType: row.sourceType, sourceCount: Array.isArray(row.sourceKeys) ? row.sourceKeys.length : 0,
      targetRatio: row.targetRatio, updatedAt: row.updatedAt, createdAt: row.createdAt,
      creatorName: row.createdByStaff.profile?.nickname || '未命名员工',
      editorName: row.lastEditedBy.profile?.nickname || '未命名员工',
      animationAsset: row.animationAsset
    })) }
  })

  fastify.post('/drafts', async (request, reply) => {
    const body = request.body || {}
    const clientRequestId = clean(body.clientRequestId, 80)
    const sourceKeys = stringList(body.sourceKeys, 50, 500).filter(key => key.startsWith('private/'))
    const sourceType = clean(body.sourceType, 20)
    const targetRatio = clean(body.targetRatio, 20) || '1:1'
    if (!SOURCE_TYPES.has(sourceType)) return reply.code(400).send({ success: false, message: '原素材类型无效' })
    if (!RATIOS.has(targetRatio)) return reply.code(400).send({ success: false, message: '画面比例无效' })
    if (!sourceKeys.length || sourceKeys.length !== (Array.isArray(body.sourceKeys) ? body.sourceKeys.length : 0)) {
      return reply.code(400).send({ success: false, message: '请选择一个视频/GIF，或 1 至 50 张图片' })
    }
    if (sourceType !== 'IMAGES' && sourceKeys.length !== 1) {
      return reply.code(400).send({ success: false, message: '视频或 GIF 每个草稿只能上传一个文件' })
    }
    if (clientRequestId) {
      const existing = await prisma.frameAssetDraft.findUnique({ where: { clientRequestId } })
      if (existing) {
        const sameRequest = existing.createdByStaffId === request.user.userId &&
          existing.sourceType === sourceType && existing.targetRatio === targetRatio &&
          JSON.stringify(existing.sourceKeys) === JSON.stringify(sourceKeys)
        if (!sameRequest) {
          return reply.code(409).send({ success: false, message: '创建标识已被其他草稿使用，请重新选择素材' })
        }
        return reply.send({ success: true, data: {
          id: existing.id, draftNo: existing.draftNo, revision: existing.revision
        } })
      }
    }
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: sourceKeys }, ownerUserId: request.user.userId,
      purpose: FILE_PURPOSE.LIBRARY_SOURCE, status: 'READY', deletedAt: null, linkedResourceId: null
    } })
    if (files.length !== sourceKeys.length) return reply.code(400).send({ success: false, message: '原素材不存在、未上传完成或已经被使用' })
    let draft
    try {
      draft = await prisma.$transaction(async tx => {
        let created = null
        for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
          try {
            created = await tx.frameAssetDraft.create({ data: {
              draftNo: draftNo(), clientRequestId,
              createdByStaffId: request.user.userId, lastEditedByStaffId: request.user.userId,
              sourceKeys, sourceType, sourceMetadata: jsonObject(body.sourceMetadata), targetRatio,
              title: clean(body.title, 200) || '未命名动画', rightsHolderName: '哞屋'
            } })
          } catch (error) {
            if (error.code !== 'P2002' || attempt === 4 || clientRequestId) throw error
          }
        }
        const linked = await tx.privateFile.updateMany({ where: {
          id: { in: files.map(file => file.id) }, linkedResourceId: null
        }, data: {
          linkedResourceType: 'FRAME_ASSET_DRAFT', linkedResourceId: created.id
        } })
        if (linked.count !== files.length) {
          throw Object.assign(new Error('原素材已经被其他制作草稿使用'), { statusCode: 409 })
        }
        await tx.auditLog.create({ data: {
          userId: request.user.userId, action: 'FRAME_MAKING_DRAFT_CREATED', targetId: created.id,
          detail: { draftNo: created.draftNo, sourceType, sourceCount: sourceKeys.length }, ip: request.ip
        } })
        return created
      })
    } catch (error) {
      if (error.code !== 'P2002' || !clientRequestId) throw error
      const existing = await prisma.frameAssetDraft.findUnique({ where: { clientRequestId } })
      const sameRequest = existing && existing.createdByStaffId === request.user.userId &&
        existing.sourceType === sourceType && existing.targetRatio === targetRatio &&
        JSON.stringify(existing.sourceKeys) === JSON.stringify(sourceKeys)
      if (!sameRequest) throw error
      return reply.send({ success: true, data: {
        id: existing.id, draftNo: existing.draftNo, revision: existing.revision
      } })
    }
    return reply.code(201).send({ success: true, data: { id: draft.id, draftNo: draft.draftNo, revision: draft.revision } })
  })

  fastify.get('/drafts/:id', async (request, reply) => {
    const draft = await prisma.frameAssetDraft.findUnique({ where: { id: request.params.id }, include: {
      createdByStaff: { select: { profile: { select: { nickname: true } } } },
      lastEditedBy: { select: { profile: { select: { nickname: true } } } },
      animationAsset: { select: { id: true, assetNo: true } }
    } })
    if (!draft) return reply.code(404).send({ success: false, message: '制作草稿不存在' })
    const keys = Array.isArray(draft.sourceKeys) ? draft.sourceKeys : []
    const files = await prisma.privateFile.findMany({ where: { objectKey: { in: keys }, status: 'READY', deletedAt: null } })
    const byKey = new Map(files.map(file => [file.objectKey, file]))
    return reply.send({ success: true, data: {
      ...draft,
      sourceKeys: undefined,
      sources: keys.map((key, index) => {
        const file = byKey.get(key)
        return { index, name: file?.originalName || `素材 ${index + 1}`, type: file?.detectedMimeType || file?.declaredMimeType || '',
          size: file?.sizeBytes || file?.declaredSizeBytes || 0, url: fastify.storagePresignGet(key, 1800) }
      }),
      creatorName: draft.createdByStaff.profile?.nickname || '未命名员工',
      editorName: draft.lastEditedBy.profile?.nickname || '未命名员工',
      createdByStaff: undefined, lastEditedBy: undefined
    } })
  })

  fastify.patch('/drafts/:id', async (request, reply) => {
    const body = request.body || {}
    const draft = await prisma.frameAssetDraft.findUnique({ where: { id: request.params.id } })
    if (!draft) return reply.code(404).send({ success: false, message: '制作草稿不存在' })
    const canEdit = draft.status === 'DRAFT' || (draft.status === 'READY_FOR_REVIEW' && isOwner(request))
    if (!canEdit) return reply.code(409).send({ success: false, message: '当前草稿状态不能修改' })
    const expectedRevision = Number(body.revision)
    if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) {
      return reply.code(409).send({ success: false, message: '草稿已被其他工作人员更新，请刷新后继续', code: 'DRAFT_REVISION_CONFLICT' })
    }
    const data = {
      title: clean(body.title, 200) || draft.title,
      targetRatio: clean(body.targetRatio, 20) || draft.targetRatio,
      sourceChannel: clean(body.sourceChannel, 30) || draft.sourceChannel,
      usageType: clean(body.usageType, 30) || draft.usageType,
      rightsHolderType: clean(body.rightsHolderType, 30) || draft.rightsHolderType,
      rightsHolderName: body.rightsHolderName === undefined ? draft.rightsHolderName : clean(body.rightsHolderName, 120),
      rightsHolderContact: body.rightsHolderContact === undefined ? draft.rightsHolderContact : clean(body.rightsHolderContact, 200),
      authorizationStatus: clean(body.authorizationStatus, 30) || draft.authorizationStatus
    }
    const businessError = validateBusiness(data)
    if (businessError) return reply.code(400).send({ success: false, message: businessError })
    let ownerUserId = draft.ownerUserId
    const ownerPhone = clean(body.ownerPhone, 20)
    if (ownerPhone) {
      const owner = await prisma.user.findUnique({ where: { phone: ownerPhone }, select: { id: true } })
      if (!owner) return reply.code(400).send({ success: false, message: '绑定手机号还没有网站账号' })
      ownerUserId = owner.id
    }
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.frameAssetDraft.updateMany({ where: {
        id: draft.id, revision: expectedRevision, status: draft.status
      }, data: {
        ...data, ownerUserId, editorData: body.editorData === undefined ? draft.editorData : jsonObject(body.editorData),
        sourceMetadata: body.sourceMetadata === undefined ? draft.sourceMetadata : jsonObject(body.sourceMetadata),
        tags: body.tags === undefined ? draft.tags : stringList(body.tags, 30, 40),
        internalNotes: body.internalNotes === undefined ? draft.internalNotes : clean(body.internalNotes, 4000),
        lastEditedByStaffId: request.user.userId, revision: { increment: 1 }
      } })
      if (result.count !== 1) {
        throw Object.assign(new Error('草稿已被其他工作人员更新，请刷新后继续'), {
          statusCode: 409, code: 'DRAFT_REVISION_CONFLICT'
        })
      }
      return tx.frameAssetDraft.findUniqueOrThrow({ where: { id: draft.id } })
    })
    return reply.send({ success: true, data: { id: updated.id, revision: updated.revision, updatedAt: updated.updatedAt } })
  })

  fastify.post('/drafts/:id/abandon', async (request, reply) => {
    const draft = await prisma.frameAssetDraft.findUnique({ where: { id: request.params.id } })
    if (!draft) return reply.code(404).send({ success: false, message: '制作草稿不存在' })
    if (!isOwner(request) && draft.createdByStaffId !== request.user.userId) {
      return reply.code(403).send({ success: false, message: '只能放弃自己建立的草稿' })
    }
    if (!['DRAFT', 'READY_FOR_REVIEW'].includes(draft.status)) return reply.code(409).send({ success: false, message: '该草稿不能放弃' })
    await prisma.$transaction(async tx => {
      const result = await tx.frameAssetDraft.updateMany({ where: {
        id: draft.id, revision: draft.revision, status: draft.status
      }, data: {
        status: 'ABANDONED', abandonedAt: new Date(), lastEditedByStaffId: request.user.userId, revision: { increment: 1 }
      } })
      if (result.count !== 1) {
        throw Object.assign(new Error('草稿已被其他工作人员更新，请刷新后继续'), { statusCode: 409 })
      }
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'FRAME_MAKING_DRAFT_ABANDONED', targetId: draft.id,
        detail: { draftNo: draft.draftNo }, ip: request.ip
      } })
    })
    return reply.send({ success: true })
  })

  fastify.post('/drafts/:id/submit-review', async (request, reply) => {
    const body = request.body || {}
    const draft = await prisma.frameAssetDraft.findUnique({ where: { id: request.params.id } })
    if (!draft) return reply.code(404).send({ success: false, message: '制作草稿不存在' })
    if (draft.status === 'READY_FOR_REVIEW') return reply.send({ success: true, data: { status: draft.status } })
    if (draft.status !== 'DRAFT') return reply.code(409).send({ success: false, message: '当前草稿不能提交确认' })
    const expectedRevision = Number(body.revision)
    if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) {
      return reply.code(409).send({ success: false, message: '草稿已被其他工作人员更新，请刷新后继续', code: 'DRAFT_REVISION_CONFLICT' })
    }
    const updated = await prisma.$transaction(async tx => {
      const changed = await tx.frameAssetDraft.updateMany({ where: {
        id: draft.id, revision: expectedRevision, status: 'DRAFT'
      }, data: {
        status: 'READY_FOR_REVIEW', lastEditedByStaffId: request.user.userId, revision: { increment: 1 }
      } })
      if (changed.count !== 1) {
        throw Object.assign(new Error('草稿已被其他工作人员更新，请刷新后继续'), {
          statusCode: 409, code: 'DRAFT_REVISION_CONFLICT'
        })
      }
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'FRAME_MAKING_DRAFT_SUBMITTED', targetId: draft.id,
        detail: { draftNo: draft.draftNo }, ip: request.ip
      } })
      return tx.frameAssetDraft.findUniqueOrThrow({ where: { id: draft.id } })
    })
    return reply.send({ success: true, data: { status: updated.status, revision: updated.revision, updatedAt: updated.updatedAt } })
  })

  fastify.post('/drafts/:id/publish', async (request, reply) => {
    if (!isOwner(request)) return reply.code(403).send({ success: false, message: '只有负责人可以确认入库' })
    const body = request.body || {}
    const draft = await prisma.frameAssetDraft.findUnique({ where: { id: request.params.id }, include: { animationAsset: true } })
    if (!draft) return reply.code(404).send({ success: false, message: '制作草稿不存在' })
    if (draft.status === 'PUBLISHED' && draft.animationAsset) {
      return reply.send({ success: true, data: { id: draft.animationAsset.id, assetNo: draft.animationAsset.assetNo, versionNo: 1 } })
    }
    if (!['DRAFT', 'READY_FOR_REVIEW'].includes(draft.status)) return reply.code(409).send({ success: false, message: '该草稿不能入库' })
    const keys = orderedKeys(body.frameKeys).filter(key => key.startsWith('private/'))
    if (!keys.length || keys.length !== (Array.isArray(body.frameKeys) ? body.frameKeys.length : 0)) {
      return reply.code(400).send({ success: false, message: '请选择 1 至 50 张最终帧图' })
    }
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: [...new Set(keys)] }, ownerUserId: request.user.userId,
      purpose: FILE_PURPOSE.LIBRARY_FRAME, status: 'READY', deletedAt: null, linkedResourceId: null
    } })
    if (files.length !== new Set(keys).size) return reply.code(400).send({ success: false, message: '最终帧图不存在、未上传完成或已经被使用' })
    const business = {
      targetRatio: draft.targetRatio, sourceChannel: draft.sourceChannel, usageType: draft.usageType,
      rightsHolderType: draft.rightsHolderType, rightsHolderName: draft.rightsHolderName,
      authorizationStatus: draft.authorizationStatus
    }
    const businessError = validateBusiness(business)
    if (businessError) return reply.code(400).send({ success: false, message: businessError })
    const editorData = { ...jsonObject(draft.editorData), targetRatio: draft.targetRatio }
    const result = await prisma.$transaction(async tx => {
      const current = await tx.frameAssetDraft.findUnique({ where: { id: draft.id }, include: { animationAsset: true } })
      if (current.status === 'PUBLISHED' && current.animationAsset) return current.animationAsset
      if (!['DRAFT', 'READY_FOR_REVIEW'].includes(current.status)) throw Object.assign(new Error('草稿状态已经改变'), { statusCode: 409 })
      const asset = await tx.animationAsset.create({ data: {
        assetNo: await createAnimationAssetNo(tx), ownerUserId: draft.ownerUserId, title: draft.title,
        sourceType: 'STAFF_CREATED', sourceChannel: draft.sourceChannel, usageType: draft.usageType,
        assetType: draft.usageType === 'COLLAB_SALE' ? 'COLLAB' : 'PRIVATE', status: 'ACTIVE',
        collabStatus: draft.usageType === 'COLLAB_SALE' ? 'AUTHORIZED' : 'NONE',
        rightsHolderType: draft.rightsHolderType, rightsHolderName: draft.rightsHolderName,
        rightsHolderContact: draft.rightsHolderContact, authorizationStatus: draft.authorizationStatus,
        internalNotes: draft.internalNotes, createdByStaffId: request.user.userId, currentVersionNo: 1
      } })
      await tx.animationAssetVersion.create({ data: {
        assetId: asset.id, versionNo: 1, sourceKey: `FRAME_ASSET_DRAFT:${draft.id}`,
        sourceType: 'STAFF_CREATED', createdByUserId: request.user.userId, frameKeys: keys,
        baseFrameCount: keys.length, editorData, manifestHash: manifestHash(keys, files, editorData)
      } })
      await tx.privateFile.updateMany({ where: { id: { in: files.map(file => file.id) } }, data: {
        ownerUserId: draft.ownerUserId, linkedResourceType: 'ANIMATION_ASSET', linkedResourceId: asset.id
      } })
      await replaceTags(tx, asset.id, draft.tags)
      await tx.frameAssetDraft.update({ where: { id: draft.id }, data: {
        status: 'PUBLISHED', animationAssetId: asset.id, publishedAt: new Date(),
        lastEditedByStaffId: request.user.userId, revision: { increment: 1 }
      } })
      await tx.auditLog.create({ data: {
        userId: request.user.userId, action: 'FRAME_MAKING_DRAFT_PUBLISHED', targetId: asset.id,
        detail: { draftNo: draft.draftNo, assetNo: asset.assetNo, frameCount: keys.length }, ip: request.ip
      } })
      return asset
    })
    return reply.code(201).send({ success: true, data: { id: result.id, assetNo: result.assetNo, versionNo: 1 } })
  })
}
