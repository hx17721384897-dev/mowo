import { FILE_PURPOSE, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'
import { createCustomizationRequestNo, normalizeKeyList } from '../lib/customization-request.js'

const MODES = new Set(['SELF', 'HUMAN'])

function text(value, max) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}

async function validateModelAndSku(prisma, machineModelId, desiredSkuId) {
  if (!machineModelId) return { error: '请选择定制款式' }
  const model = await prisma.machineModel.findFirst({ where: { id: machineModelId, isActive: true } })
  if (!model) return { error: '所选款式不存在或暂不可用' }
  let sku = null
  if (desiredSkuId) {
    sku = await prisma.machineModelSku.findFirst({
      where: { id: desiredSkuId, modelId: machineModelId, isActive: true }
    })
    if (!sku) return { error: '所选规格不存在、已停用或不属于当前款式' }
  }
  return { model, sku }
}

async function validateSelectedFrames(prisma, userId, keys, customProductId) {
  if (!keys.length) return []
  const files = await prisma.privateFile.findMany({ where: {
    objectKey: { in: keys }, ownerUserId: userId,
    purpose: FILE_PURPOSE.CUSTOMIZATION_FRAME, status: 'READY',
    ...(customProductId ? {
      OR: [
        { linkedResourceId: null },
        { linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: customProductId }
      ]
    } : { linkedResourceId: null })
  } })
  if (files.length !== keys.length) throw new Error('选中帧不存在、未上传完成或不属于当前账号')
  return files
}

async function decorateRequests(prisma, requests) {
  const modelIds = [...new Set(requests.map(item => item.machineModelId).filter(Boolean))]
  const skuIds = [...new Set(requests.map(item => item.desiredSkuId).filter(Boolean))]
  const [models, skus] = await Promise.all([
    modelIds.length ? prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true, previewImage: true } }) : [],
    skuIds.length ? prisma.machineModelSku.findMany({ where: { id: { in: skuIds } }, select: { id: true, size: true, material: true, frameCount: true, colorName: true, price: true } }) : []
  ])
  const modelMap = new Map(models.map(item => [item.id, item]))
  const skuMap = new Map(skus.map(item => [item.id, item]))
  return requests.map(item => ({ ...item, model: modelMap.get(item.machineModelId) || null, desiredSku: skuMap.get(item.desiredSkuId) || null }))
}

export default async function customizationRequestRoutes(fastify) {
  const { prisma } = fastify

  // 保存自己筛选流程的云端草稿。草稿没有对外定制编号，不进入员工队列。
  fastify.post('/draft', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const body = request.body || {}
    const clientDraftKey = text(body.clientDraftKey, 80)
    if (!clientDraftKey) return reply.code(400).send({ success: false, message: '草稿标识无效' })

    const existing = await prisma.customizationRequest.findUnique({ where: { clientDraftKey } })
    if (existing) {
      if (existing.userId !== userId) return reply.code(409).send({ success: false, message: '草稿标识冲突，请刷新后重试' })
      return reply.send({ success: true, data: existing, reused: true })
    }

    let sourceKeys
    let selectedFrameKeys
    try {
      sourceKeys = normalizeKeyList(body.sourceKeys, { required: true })
      selectedFrameKeys = normalizeKeyList(body.selectedFrameKeys)
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }
    const selection = await validateModelAndSku(prisma, body.machineModelId, null)
    if (selection.error) return reply.code(400).send({ success: false, message: selection.error })

    let sources
    try {
      sources = await findOwnedReadyFiles(prisma, sourceKeys, userId, [FILE_PURPOSE.CUSTOMIZATION_SOURCE])
      await validateSelectedFrames(prisma, userId, selectedFrameKeys, body.customProductId || null)
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    const created = await prisma.$transaction(async tx => {
      const row = await tx.customizationRequest.create({ data: {
        userId, mode: 'SELF', status: 'DRAFT', clientDraftKey,
        customProductId: body.customProductId || null,
        machineModelId: body.machineModelId,
        sourceKeys, selectedFrameKeys,
        screeningData: body.screeningData || undefined,
        editorData: body.editorData || undefined
      } })
      await linkFiles(tx, sources, 'CUSTOMIZATION_REQUEST', row.id)
      await tx.customizationRequestEvent.create({ data: {
        requestId: row.id, actorUserId: userId, actorType: 'USER',
        eventType: 'DRAFT_SAVED', toStatus: 'DRAFT'
      } })
      return row
    })
    return reply.code(201).send({ success: true, data: created })
  })

  // 人工筛选入口：上传原素材后直接正式提交。
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const body = request.body || {}
    const mode = String(body.mode || '').toUpperCase()
    if (!MODES.has(mode)) return reply.code(400).send({ success: false, message: '筛选方式无效' })
    if (mode === 'SELF') return reply.code(400).send({ success: false, message: '自己筛选请先保存筛选结果' })
    const clientRequestKey = text(body.clientRequestKey, 80)
    if (!clientRequestKey) return reply.code(400).send({ success: false, message: '提交标识无效，请刷新后重试' })
    const existing = await prisma.customizationRequest.findUnique({ where: { clientDraftKey: clientRequestKey } })
    if (existing) {
      if (existing.userId !== userId || existing.mode !== 'HUMAN') {
        return reply.code(409).send({ success: false, message: '提交标识冲突，请刷新后重试' })
      }
      return reply.send({ success: true, data: existing, reused: true })
    }

    let sourceKeys
    try {
      sourceKeys = normalizeKeyList(body.sourceKeys, { required: true })
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }
    const selection = await validateModelAndSku(prisma, body.machineModelId, body.desiredSkuId || null)
    if (selection.error) return reply.code(400).send({ success: false, message: selection.error })

    let sources
    try {
      sources = await findOwnedReadyFiles(prisma, sourceKeys, userId, [FILE_PURPOSE.CUSTOMIZATION_SOURCE])
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    const requestNo = await createCustomizationRequestNo(prisma)
    let created
    try {
      created = await prisma.$transaction(async tx => {
        const row = await tx.customizationRequest.create({ data: {
          requestNo, userId, mode, status: 'SUBMITTED', version: 1,
          clientDraftKey: clientRequestKey,
          machineModelId: body.machineModelId,
          desiredSkuId: body.desiredSkuId || null,
          sourceKeys,
          screeningData: body.screeningData || undefined,
          userNote: text(body.userNote, 1000),
          creatorDeclared: body.creatorDeclared === true,
          copyrightConfirmed: body.copyrightConfirmed === true,
          cooperationInterested: body.cooperationInterested === true,
          submittedAt: new Date()
        } })
        await linkFiles(tx, sources, 'CUSTOMIZATION_REQUEST', row.id)
        await tx.customizationRequestEvent.create({ data: {
          requestId: row.id, actorUserId: userId, actorType: 'USER',
          eventType: 'SUBMITTED', toStatus: 'SUBMITTED', publicMessage: '定制需求已提交，等待工作人员处理'
        } })
        return row
      })
    } catch (error) {
      if (error.code !== 'P2002') throw error
      created = await prisma.customizationRequest.findUnique({ where: { clientDraftKey: clientRequestKey } })
      if (!created || created.userId !== userId || created.mode !== 'HUMAN') throw error
      return reply.send({ success: true, data: created, reused: true })
    }
    return reply.code(201).send({ success: true, data: created })
  })

  // 自己筛选草稿选择规格后正式提交，编号只在这里生成。
  fastify.post('/:id/submit', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const item = await prisma.customizationRequest.findUnique({ where: { id: request.params.id } })
    if (!item) return reply.code(404).send({ success: false, message: '定制草稿不存在' })
    if (item.userId !== userId) return reply.code(403).send({ success: false, message: '无权提交该定制草稿' })
    if (item.status !== 'DRAFT') {
      if (item.requestNo && item.status !== 'EXPIRING') {
        return reply.send({ success: true, data: item, reused: true })
      }
      return reply.code(409).send({ success: false, message: '该草稿正在清理或已失效，请返回“我的定制”查看' })
    }

    const body = request.body || {}
    const selection = await validateModelAndSku(prisma, item.machineModelId, body.desiredSkuId)
    if (selection.error) return reply.code(400).send({ success: false, message: selection.error })
    if (!Array.isArray(item.selectedFrameKeys) || item.selectedFrameKeys.length === 0) {
      return reply.code(400).send({ success: false, message: '请先完成帧图筛选' })
    }

    const requestNo = await createCustomizationRequestNo(prisma)
    const updated = await prisma.$transaction(async tx => {
      const changed = await tx.customizationRequest.updateMany({ where: { id: item.id, status: 'DRAFT' }, data: {
        requestNo, status: 'SUBMITTED', desiredSkuId: body.desiredSkuId,
        userNote: text(body.userNote, 1000),
        editorData: body.editorData || item.editorData || undefined,
        creatorDeclared: body.creatorDeclared === true,
        copyrightConfirmed: body.copyrightConfirmed === true,
        cooperationInterested: body.cooperationInterested === true,
        submittedAt: new Date()
      } })
      if (changed.count !== 1) return null
      await tx.customizationRequestEvent.create({ data: {
        requestId: item.id, actorUserId: userId, actorType: 'USER', eventType: 'SUBMITTED',
        fromStatus: 'DRAFT', toStatus: 'SUBMITTED', publicMessage: '定制需求已提交，等待工作人员处理'
      } })
      return tx.customizationRequest.findUnique({ where: { id: item.id } })
    })
    if (!updated) {
      const current = await prisma.customizationRequest.findUnique({ where: { id: item.id } })
      if (current?.requestNo && current.userId === userId) {
        return reply.send({ success: true, data: current, reused: true })
      }
      return reply.code(409).send({ success: false, message: '草稿状态已变化，请返回“我的定制”查看' })
    }
    return reply.send({ success: true, data: updated })
  })

  fastify.get('/mine', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const page = Math.max(1, Number(request.query.page || 1))
    const limit = Math.min(50, Math.max(1, Number(request.query.limit || 20)))
    const where = { userId: request.user.userId }
    if (request.query.status) where.status = String(request.query.status).toUpperCase()
    const [items, total] = await Promise.all([
      prisma.customizationRequest.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.customizationRequest.count({ where })
    ])
    return reply.send({ success: true, data: { items: await decorateRequests(prisma, items), total, page, hasMore: page * limit < total } })
  })

  fastify.get('/mine/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const item = await prisma.customizationRequest.findUnique({
      where: { id: request.params.id }, include: { events: { orderBy: { createdAt: 'asc' } } }
    })
    if (!item) return reply.code(404).send({ success: false, message: '定制记录不存在' })
    if (item.userId !== request.user.userId) return reply.code(403).send({ success: false, message: '无权查看该定制记录' })
    const [decorated] = await decorateRequests(prisma, [item])
    return reply.send({ success: true, data: decorated })
  })
}
