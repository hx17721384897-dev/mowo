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
