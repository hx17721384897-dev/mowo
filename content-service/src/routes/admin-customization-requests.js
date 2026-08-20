export default async function adminCustomizationRequestRoutes(fastify) {
  const { prisma } = fastify

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
        where, orderBy: { submittedAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
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
        modelName: modelMap.get(item.machineModelId) || '未知款式'
      })),
      total, page, hasMore: page * limit < total
    } })
  })

  fastify.get('/stats', async () => {
    const statuses = ['SUBMITTED', 'REVIEWING', 'NEEDS_SUPPLEMENT', 'OPTIONS_READY', 'UNAVAILABLE', 'CONFIRMED', 'CLOSED']
    const rows = await Promise.all(statuses.map(status => prisma.customizationRequest.count({ where: { status } }).then(count => [status, count])))
    return { success: true, data: Object.fromEntries(rows) }
  })

  fastify.get('/:id', async (request, reply) => {
    const item = await prisma.customizationRequest.findUnique({
      where: { id: request.params.id },
      include: {
        user: { select: { phone: true, profile: { select: { nickname: true } } } },
        events: { orderBy: { createdAt: 'asc' } }
      }
    })
    if (!item || ['DRAFT', 'EXPIRING'].includes(item.status)) return reply.code(404).send({ success: false, message: '定制申请不存在' })

    const keys = [...new Set([...(Array.isArray(item.sourceKeys) ? item.sourceKeys : []), ...(Array.isArray(item.selectedFrameKeys) ? item.selectedFrameKeys : [])])]
    const files = keys.length ? await prisma.privateFile.findMany({ where: {
      objectKey: { in: keys }, ownerUserId: item.userId, status: 'READY',
      OR: [
        { linkedResourceType: 'CUSTOMIZATION_REQUEST', linkedResourceId: item.id },
        ...(item.customProductId ? [{ linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: item.customProductId }] : [])
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
      method: 'GET', path: '/api/admin/customization-requests/:id',
      target: 'private_file', targetId: file.id, outcome: 'SUCCESS', statusCode: 200,
      sessionId: request.user.sid || null, ip: request.ip || null,
      userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null
    } }).catch(() => {})))

    const [model, sku] = await Promise.all([
      item.machineModelId ? prisma.machineModel.findUnique({ where: { id: item.machineModelId }, select: { id: true, name: true } }) : null,
      item.desiredSkuId ? prisma.machineModelSku.findUnique({ where: { id: item.desiredSkuId }, select: { id: true, size: true, material: true, frameCount: true, colorName: true, price: true } }) : null
    ])
    return reply.send({ success: true, data: {
      ...item,
      user: { nickname: item.user.profile?.nickname || '未设置昵称', phoneTail: item.user.phone ? item.user.phone.slice(-4) : null },
      model, desiredSku: sku,
      sourceFiles: (Array.isArray(item.sourceKeys) ? item.sourceKeys : []).map(fileInfo).filter(Boolean),
      selectedFrames: (Array.isArray(item.selectedFrameKeys) ? item.selectedFrameKeys : []).map(fileInfo).filter(Boolean)
    } })
  })
}
