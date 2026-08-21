import { Prisma } from '@prisma/client'
import { FILE_PURPOSE } from '../lib/private-files.js'
import { normalizeKeyList } from '../lib/customization-request.js'

const EDIT_ROLES = new Set(['OWNER', 'PRODUCTION'])
const LOCK_MS = 10 * 60 * 1000

function text(value, max) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}

function canEdit(request) {
  return EDIT_ROLES.has(request.user?.staffRole)
}

function requireEditor(request, reply) {
  if (canEdit(request)) return true
  reply.code(403).send({ success: false, message: '当前岗位只能查看定制任务，不能编辑帧图', code: 'CUSTOMIZATION_EDIT_DENIED' })
  return false
}

function parseNumberList(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? [...new Set(parsed.map(Number).filter(item => Number.isInteger(item) && item > 0))] : []
  } catch {
    return []
  }
}

function safeDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {
    selectedIndexes: Array.isArray(value.selectedIndexes)
      ? [...new Set(value.selectedIndexes.map(Number).filter(item => Number.isInteger(item) && item >= 0))].slice(0, 150)
      : [],
    trimStart: Number.isFinite(Number(value.trimStart)) ? Number(value.trimStart) : null,
    trimEnd: Number.isFinite(Number(value.trimEnd)) ? Number(value.trimEnd) : null,
    staffMessage: text(value.staffMessage, 1000),
    internalNote: text(value.internalNote, 2000)
  }
  if (JSON.stringify(result).length > 20000) throw new Error('编辑草稿过大，请减少内容后重试')
  return result
}

export default async function adminCustomizationRequestRoutes(fastify) {
  const { prisma } = fastify

  async function claimOne(id, staffId) {
    const now = new Date()
    const current = await prisma.customizationRequest.findUnique({ where: { id } })
    if (!current || current.mode !== 'HUMAN' || !['SUBMITTED', 'REVIEWING'].includes(current.status)) {
      return { error: '该任务当前不能进入人工筛帧' }
    }
    if (current.assignedStaffId && current.assignedStaffId !== staffId && current.lockExpiresAt && current.lockExpiresAt > now) {
      return { conflict: true, error: '该任务正在由其他员工处理' }
    }
    const lockExpiresAt = new Date(now.getTime() + LOCK_MS)
    const claimed = await prisma.$transaction(async tx => {
      const changed = await tx.customizationRequest.updateMany({
        where: {
          id,
          status: { in: ['SUBMITTED', 'REVIEWING'] },
          OR: [
            { assignedStaffId: null },
            { assignedStaffId: staffId },
            { lockExpiresAt: null },
            { lockExpiresAt: { lte: now } }
          ]
        },
        data: {
          assignedStaffId: staffId,
          claimedAt: current.assignedStaffId === staffId && current.claimedAt ? current.claimedAt : now,
          lockExpiresAt,
          status: 'REVIEWING'
        }
      })
      if (changed.count !== 1) return null
      if (current.status !== 'REVIEWING' || current.assignedStaffId !== staffId) {
        await tx.customizationRequestEvent.create({ data: {
          requestId: id, actorUserId: staffId, actorType: 'STAFF', eventType: 'STAFF_CLAIMED',
          fromStatus: current.status, toStatus: 'REVIEWING', publicMessage: '工作人员已开始处理素材'
        } })
      }
      return tx.customizationRequest.findUnique({ where: { id } })
    })
    return claimed ? { data: claimed } : { conflict: true, error: '任务刚刚被其他员工领取，请刷新列表' }
  }

  async function claimNext(staffId) {
    const now = new Date()
    const candidates = await prisma.customizationRequest.findMany({
      where: {
        mode: 'HUMAN',
        OR: [
          { status: 'SUBMITTED' },
          { status: 'REVIEWING', OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lte: now } }] }
        ]
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }], select: { id: true }, take: 20
    })
    for (const candidate of candidates) {
      const result = await claimOne(candidate.id, staffId)
      if (result.data) return result.data
    }
    return null
  }

  fastify.get('/', async (request, reply) => {
    const page = Math.max(1, Number(request.query.page || 1))
    const limit = Math.min(50, Math.max(1, Number(request.query.limit || 20)))
    const where = { status: { notIn: ['DRAFT', 'EXPIRING'] } }
    if (request.query.status) where.status = String(request.query.status).toUpperCase()
    if (request.query.mode) where.mode = String(request.query.mode).toUpperCase()
    if (request.query.keyword) {
      const keyword = String(request.query.keyword).trim().slice(0, 50)
      where.OR = [
        { requestNo: { contains: keyword, mode: 'insensitive' } },
        { user: { profile: { nickname: { contains: keyword, mode: 'insensitive' } } } }
      ]
    }
    const [items, total] = await Promise.all([
      prisma.customizationRequest.findMany({
        where, orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * limit, take: limit,
        include: {
          user: { select: { phone: true, profile: { select: { nickname: true } } } },
          assignedStaff: { select: { profile: { select: { nickname: true } } } }
        }
      }),
      prisma.customizationRequest.count({ where })
    ])
    const modelIds = [...new Set(items.map(item => item.machineModelId).filter(Boolean))]
    const models = modelIds.length ? await prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } }) : []
    const modelMap = new Map(models.map(item => [item.id, item.name]))
    return reply.send({ success: true, data: {
      items: items.map(item => ({
        ...item,
        user: { nickname: item.user.profile?.nickname || '未设置昵称', phoneTail: item.user.phone ? item.user.phone.slice(-4) : null },
        assignedStaffName: item.assignedStaff?.profile?.nickname || null,
        assignedStaff: undefined,
        modelName: modelMap.get(item.machineModelId) || '未知款式',
        canEdit: canEdit(request)
      })),
      total, page, hasMore: page * limit < total
    } })
  })

  fastify.get('/stats', async () => {
    const statuses = ['SUBMITTED', 'REVIEWING', 'NEEDS_SUPPLEMENT', 'OPTIONS_READY', 'FRAME_ACCEPTED', 'STYLE_SELECTED', 'UNAVAILABLE', 'CONFIRMED', 'CLOSED']
    const rows = await Promise.all(statuses.map(status => prisma.customizationRequest.count({ where: { status } }).then(count => [status, count])))
    return { success: true, data: Object.fromEntries(rows) }
  })

  fastify.post('/claim-next', async (request, reply) => {
    if (!requireEditor(request, reply)) return
    const next = await claimNext(request.user.userId)
    return reply.send({ success: true, data: next, message: next ? null : '当前没有等待处理的人工筛选任务' })
  })

  fastify.post('/:id/claim', async (request, reply) => {
    if (!requireEditor(request, reply)) return
    const result = await claimOne(request.params.id, request.user.userId)
    if (!result.data) return reply.code(result.conflict ? 409 : 400).send({ success: false, message: result.error })
    return reply.send({ success: true, data: result.data })
  })

  fastify.post('/:id/heartbeat', async (request, reply) => {
    if (!requireEditor(request, reply)) return
    const lockExpiresAt = new Date(Date.now() + LOCK_MS)
    const changed = await prisma.customizationRequest.updateMany({
      where: { id: request.params.id, assignedStaffId: request.user.userId, status: 'REVIEWING' },
      data: { lockExpiresAt }
    })
    if (changed.count !== 1) return reply.code(409).send({ success: false, message: '任务编辑权已失效，请返回任务列表重新领取' })
    return reply.send({ success: true, data: { lockExpiresAt } })
  })

  fastify.put('/:id/frame-draft', async (request, reply) => {
    if (!requireEditor(request, reply)) return
    let data
    try { data = safeDraft(request.body) } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }
    const changed = await prisma.customizationRequest.updateMany({
      where: { id: request.params.id, assignedStaffId: request.user.userId, status: 'REVIEWING', lockExpiresAt: { gt: new Date() } },
      data: { staffDraftData: data, staffDraftUpdatedAt: new Date() }
    })
    if (changed.count !== 1) return reply.code(409).send({ success: false, message: '任务编辑权已失效，草稿没有覆盖其他员工的结果' })
    return reply.send({ success: true, data: { savedAt: new Date() } })
  })

  fastify.post('/:id/release', async (request, reply) => {
    if (!requireEditor(request, reply)) return
    const item = await prisma.customizationRequest.findUnique({ where: { id: request.params.id } })
    if (!item) return reply.code(404).send({ success: false, message: '定制任务不存在' })
    if (item.mode !== 'HUMAN' || item.status !== 'REVIEWING' || !item.assignedStaffId) {
      return reply.code(409).send({ success: false, message: '该任务当前不在人工筛帧处理中' })
    }
    if (request.user.staffRole !== 'OWNER' && item.assignedStaffId !== request.user.userId) {
      return reply.code(403).send({ success: false, message: '只能退回自己领取的任务' })
    }
    await prisma.$transaction([
      prisma.customizationRequest.update({ where: { id: item.id }, data: {
        status: 'SUBMITTED', assignedStaffId: null, claimedAt: null, lockExpiresAt: null
      } }),
      prisma.customizationRequestEvent.create({ data: {
        requestId: item.id, actorUserId: request.user.userId, actorType: 'STAFF', eventType: 'STAFF_RELEASED',
        fromStatus: item.status, toStatus: 'SUBMITTED', publicMessage: '定制素材正在等待工作人员继续处理'
      } })
    ])
    return reply.send({ success: true })
  })

  fastify.post('/:id/frame-selections', async (request, reply) => {
    if (!requireEditor(request, reply)) return
    const body = request.body || {}
    let frameKeys
    try { frameKeys = normalizeKeyList(body.frameKeys, { required: true }) } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }
    const item = await prisma.customizationRequest.findUnique({ where: { id: request.params.id } })
    if (!item) return reply.code(404).send({ success: false, message: '定制任务不存在' })
    if (item.mode !== 'HUMAN' || item.status !== 'REVIEWING' || item.assignedStaffId !== request.user.userId || !item.lockExpiresAt || item.lockExpiresAt <= new Date()) {
      return reply.code(409).send({ success: false, message: '任务编辑权已失效，请返回列表重新领取' })
    }
    const model = item.machineModelId ? await prisma.machineModel.findUnique({ where: { id: item.machineModelId } }) : null
    if (!model) return reply.code(400).send({ success: false, message: '所选型号已停用或不存在' })
    const targets = parseNumberList(model.frameOptions)
    const compatibleTargets = targets.filter(target => target >= frameKeys.length && target % frameKeys.length === 0)
    if (targets.length && compatibleTargets.length === 0) {
      return reply.code(400).send({ success: false, message: `当前选择 ${frameKeys.length} 帧，不符合该型号可用帧数 ${targets.join(' / ')}` })
    }
    const files = await prisma.privateFile.findMany({ where: {
      objectKey: { in: frameKeys }, ownerUserId: request.user.userId,
      purpose: FILE_PURPOSE.CUSTOMIZATION_FRAME, status: 'READY', linkedResourceId: null
    } })
    if (files.length !== frameKeys.length) return reply.code(400).send({ success: false, message: '筛选帧不存在、尚未上传完成或已被其他任务使用' })

    const result = await prisma.$transaction(async tx => {
      const latest = await tx.customizationFrameSelection.findFirst({ where: { requestId: item.id }, orderBy: { version: 'desc' }, select: { version: true } })
      const version = (latest?.version || 0) + 1
      const selection = await tx.customizationFrameSelection.create({ data: {
        requestId: item.id, version, selectedFrameKeys: frameKeys,
        editorData: body.editorData || undefined,
        staffMessage: text(body.staffMessage, 1000), internalNote: text(body.internalNote, 2000),
        createdByStaffId: request.user.userId
      } })
      const productData = {
        animationFrames: JSON.stringify(frameKeys), frameCount: frameKeys.length,
        draftData: JSON.stringify({ source: 'staff-frame-selection', requestId: item.id, selectionVersion: version }),
        configJson: JSON.stringify({ modelId: item.machineModelId, frameCount: frameKeys.length, compatibleTargets }),
        status: 'reviewing', draftExpiresAt: null
      }
      const product = item.customProductId
        ? await tx.customProduct.update({ where: { id: item.customProductId }, data: productData })
        : await tx.customProduct.create({ data: { userId: item.userId, ...productData } })
      const adopted = await tx.privateFile.updateMany({
        where: { id: { in: files.map(file => file.id) }, ownerUserId: request.user.userId, linkedResourceId: null, status: 'READY' },
        data: { ownerUserId: item.userId, linkedResourceType: 'CUSTOMIZATION_FRAME_SELECTION', linkedResourceId: selection.id }
      })
      if (adopted.count !== files.length) throw new Error('筛选帧归档失败，请重新提交')
      await tx.customizationFrameSelection.updateMany({
        where: { requestId: item.id, id: { not: selection.id }, status: 'SUBMITTED' }, data: { status: 'REPLACED' }
      })
      const updated = await tx.customizationRequest.update({ where: { id: item.id }, data: {
        status: 'OPTIONS_READY', version: { increment: 1 }, selectedFrameKeys: frameKeys,
        customProductId: product.id, editorData: body.editorData || undefined,
        staffDraftData: Prisma.JsonNull, staffDraftUpdatedAt: null, lockExpiresAt: null
      } })
      await tx.customizationRequestEvent.create({ data: {
        requestId: item.id, actorUserId: request.user.userId, actorType: 'STAFF', eventType: 'FRAME_SELECTION_SUBMITTED',
        fromStatus: 'REVIEWING', toStatus: 'OPTIONS_READY',
        publicMessage: text(body.staffMessage, 1000) || '工作人员已完成筛帧，请播放预览并确认结果',
        internalNote: text(body.internalNote, 2000), detail: { selectionId: selection.id, version, frameCount: frameKeys.length }
      } })
      return { request: updated, selection, customProductId: product.id }
    })

    const next = body.next === true ? await claimNext(request.user.userId) : null
    return reply.send({ success: true, data: { ...result, next } })
  })

  fastify.get('/:id', async (request, reply) => {
    const item = await prisma.customizationRequest.findUnique({
      where: { id: request.params.id },
      include: {
        user: { select: { phone: true, profile: { select: { nickname: true } } } },
        assignedStaff: { select: { id: true, profile: { select: { nickname: true } } } },
        events: { orderBy: { createdAt: 'asc' } },
        frameSelections: { orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, staffMessage: true, submittedAt: true } }
      }
    })
    if (!item || ['DRAFT', 'EXPIRING'].includes(item.status)) return reply.code(404).send({ success: false, message: '定制申请不存在' })

    const keys = [...new Set([...(Array.isArray(item.sourceKeys) ? item.sourceKeys : []), ...(Array.isArray(item.selectedFrameKeys) ? item.selectedFrameKeys : [])])]
    const selectionIds = item.frameSelections.map(selection => selection.id)
    const files = keys.length ? await prisma.privateFile.findMany({ where: {
      objectKey: { in: keys }, ownerUserId: item.userId, status: 'READY',
      OR: [
        { linkedResourceType: 'CUSTOMIZATION_REQUEST', linkedResourceId: item.id },
        ...(item.customProductId ? [{ linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: item.customProductId }] : []),
        ...(selectionIds.length ? [{ linkedResourceType: 'CUSTOMIZATION_FRAME_SELECTION', linkedResourceId: { in: selectionIds } }] : [])
      ]
    } }) : []
    const fileMap = new Map(files.map(file => [file.objectKey, file]))
    const fileInfo = key => {
      const file = fileMap.get(key)
      if (!file) return null
      const url = fastify.storagePresignGet(file.objectKey, 300)
      return {
        key, filename: file.originalName, mimeType: file.detectedMimeType || file.declaredMimeType,
        sizeBytes: file.sizeBytes, url: url.startsWith('/') ? `${request.protocol}://${request.headers.host}${url}` : url,
        expiresIn: 300
      }
    }
    await Promise.all(files.map(file => prisma.operationLog.create({ data: {
      userId: request.user.userId, userRole: request.user.role ?? 0,
      method: 'GET', path: '/api/admin/customization-requests/:id', target: 'private_file', targetId: file.id,
      outcome: 'SUCCESS', statusCode: 200, sessionId: request.user.sid || null, ip: request.ip || null,
      userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null
    } }).catch(() => {})))

    const [model, sku] = await Promise.all([
      item.machineModelId ? prisma.machineModel.findUnique({ where: { id: item.machineModelId }, select: {
        id: true, name: true, ratios: true, frameOptions: true, sizes: true, modelType: true
      } }) : null,
      item.desiredSkuId ? prisma.machineModelSku.findUnique({ where: { id: item.desiredSkuId }, select: { id: true, size: true, material: true, frameCount: true, colorName: true, price: true } }) : null
    ])
    return reply.send({ success: true, data: {
      ...item,
      user: { nickname: item.user.profile?.nickname || '未设置昵称', phoneTail: item.user.phone ? item.user.phone.slice(-4) : null },
      assignedStaffName: item.assignedStaff?.profile?.nickname || null,
      assignedStaff: undefined,
      model, desiredSku: sku, canEdit: canEdit(request),
      sourceFiles: (Array.isArray(item.sourceKeys) ? item.sourceKeys : []).map(fileInfo).filter(Boolean),
      selectedFrames: (Array.isArray(item.selectedFrameKeys) ? item.selectedFrameKeys : []).map(fileInfo).filter(Boolean)
    } })
  })
}
