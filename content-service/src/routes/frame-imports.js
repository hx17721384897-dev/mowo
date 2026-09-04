import crypto from 'crypto'
import path from 'path'
import { createAnimationAssetNo } from '../lib/animation-assets.js'
import { FILE_PURPOSE, validateUploadRequest } from '../lib/private-files.js'

const MAX_GROUPS = 100
const MAX_FILES = 2000
const MAX_TOTAL_BYTES = 500 * 1024 * 1024
const MAX_FRAMES = 50
const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000
const SOURCE_CHANNELS = new Set(['OFFLINE_CUSTOM', 'INTERNAL_CREATED'])
const USAGE_TYPES = new Set(['PRIVATE_CUSTOM', 'COMPANY_PRODUCT', 'INTERNAL_TEST', 'UNDECIDED'])
const RIGHTS_TYPES = new Set(['USER', 'OFFLINE_CUSTOMER', 'COMPANY', 'UNCONFIRMED'])
const AUTH_STATUSES = new Set(['PRIVATE_ONLY', 'PENDING', 'AUTHORIZED'])

function clean(value, max = 200) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}

function stringList(value, limit = 30, max = 40) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => clean(item, max)).filter(Boolean))].slice(0, limit)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function numericStem(fileName) {
  const stem = path.basename(String(fileName || ''), path.extname(String(fileName || '')))
  return /^\d+$/.test(stem) ? Number(stem) : null
}

function createBatchNo() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `FI-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

function absoluteApiUrl(request, relativePath) {
  return `${request.protocol}://${request.headers.host}${relativePath}`
}

function ownerOnly(request, reply) {
  if (request.user?.staffRole === 'OWNER') return true
  reply.code(403).send({ success: false, message: '只有负责人可以批量导入正式帧图资产' })
  return false
}

function defaultsFor(batchType) {
  return batchType === 'CUSTOMER'
    ? { sourceChannel: 'OFFLINE_CUSTOM', usageType: 'PRIVATE_CUSTOM', rightsHolderType: 'OFFLINE_CUSTOMER', authorizationStatus: 'PRIVATE_ONLY' }
    : { sourceChannel: 'INTERNAL_CREATED', usageType: 'INTERNAL_TEST', rightsHolderType: 'COMPANY', authorizationStatus: 'PRIVATE_ONLY' }
}

function metadata(input, fallback) {
  return {
    sourceChannel: clean(input?.sourceChannel, 30) || fallback.sourceChannel,
    usageType: clean(input?.usageType, 30) || fallback.usageType,
    rightsHolderType: clean(input?.rightsHolderType, 30) || fallback.rightsHolderType,
    rightsHolderName: clean(input?.rightsHolderName, 120),
    rightsHolderContact: clean(input?.rightsHolderContact, 200),
    authorizationStatus: clean(input?.authorizationStatus, 30) || fallback.authorizationStatus,
    ownerPhone: clean(input?.ownerPhone, 20),
    tags: stringList(input?.tags),
    internalNotes: clean(input?.internalNotes, 4000)
  }
}

function validateMetadata(data) {
  if (!SOURCE_CHANNELS.has(data.sourceChannel)) return '素材来源无效'
  if (!USAGE_TYPES.has(data.usageType)) return '素材用途无效'
  if (!RIGHTS_TYPES.has(data.rightsHolderType)) return '权利主体无效'
  if (!AUTH_STATUSES.has(data.authorizationStatus)) return '授权状态无效'
  if (data.sourceChannel === 'OFFLINE_CUSTOM' && !data.rightsHolderName) return '客户素材必须填写客户或权利人名称'
  if (data.usageType === 'PRIVATE_CUSTOM' && !['USER', 'OFFLINE_CUSTOMER'].includes(data.rightsHolderType)) return '私人定制必须标明客户权利主体'
  if (data.usageType === 'COMPANY_PRODUCT' && data.authorizationStatus !== 'AUTHORIZED') return '公司商品用途必须明确标记为已授权'
  return null
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (mimeType === 'image/jpeg' && buffer.length >= 4) {
    let offset = 2
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
      const length = buffer.readUInt16BE(offset + 2)
      if (sof.has(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      if (length < 2) break
      offset += 2 + length
    }
  }
  return null
}

async function replaceTags(tx, assetId, names) {
  for (const name of stringList(names)) {
    const tag = await tx.animationTag.upsert({ where: { name }, update: {}, create: { name } })
    await tx.animationAssetTag.create({ data: { assetId, tagId: tag.id } })
  }
}

function summarize(batch) {
  return {
    id: batch.id,
    batchNo: batch.batchNo,
    batchType: batch.batchType,
    status: batch.status,
    totalItems: batch.totalItems,
    totalFiles: batch.totalFiles,
    totalBytes: Number(batch.totalBytes),
    importedItems: batch.importedItems,
    failedItems: batch.failedItems,
    skippedItems: batch.skippedItems,
    preflightedAt: batch.preflightedAt,
    completedAt: batch.completedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt
  }
}

async function updateBatchCounts(prisma, batchId) {
  const items = await prisma.frameAssetImportItem.findMany({ where: { batchId }, select: { status: true } })
  const importedItems = items.filter(item => item.status === 'IMPORTED').length
  const failedItems = items.filter(item => ['FAILED', 'BLOCKED'].includes(item.status)).length
  const skippedItems = items.filter(item => item.status === 'SKIPPED_DUPLICATE').length
  const terminal = importedItems + skippedItems + failedItems === items.length
  const status = terminal
    ? (failedItems ? (importedItems || skippedItems ? 'PARTIAL' : 'FAILED') : 'COMPLETED')
    : 'READY'
  return prisma.frameAssetImportBatch.update({ where: { id: batchId }, data: {
    status, importedItems, failedItems, skippedItems, completedAt: terminal ? new Date() : null
  } })
}

export default async function frameImportRoutes(fastify) {
  const { prisma } = fastify

  fastify.get('/', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const batches = await prisma.frameAssetImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
    return { success: true, data: batches.map(summarize) }
  })

  fastify.get('/:id', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const batch = await prisma.frameAssetImportBatch.findUnique({
      where: { id: request.params.id }, include: { items: { orderBy: { position: 'asc' }, include: { animationAsset: { select: { assetNo: true } } } } }
    })
    if (!batch) return reply.code(404).send({ success: false, message: '导入批次不存在' })
    return reply.send({ success: true, data: {
      ...summarize(batch), defaults: batch.defaults,
      items: batch.items.map(item => {
        const manifest = Array.isArray(item.fileManifest) ? item.fileManifest : []
        const first = manifest[0]
        return {
          id: item.id, position: item.position, folderName: item.folderName, relativePath: item.relativePath,
          status: item.status, title: item.title, sourceChannel: item.sourceChannel, usageType: item.usageType,
          rightsHolderType: item.rightsHolderType, rightsHolderName: item.rightsHolderName,
          rightsHolderContact: item.rightsHolderContact, authorizationStatus: item.authorizationStatus,
          ownerPhone: item.ownerPhone, tags: item.tags || [], internalNotes: item.internalNotes,
          frameCount: item.frameCount, fingerprint: item.fingerprint, duplicateAssetId: item.duplicateAssetId,
          allowDuplicate: item.allowDuplicate, issues: item.issues || [], animationAssetId: item.animationAssetId,
          assetNo: item.animationAsset?.assetNo || null,
          previewUrl: first?.objectKey && !['UPLOADING', 'BLOCKED'].includes(item.status) ? fastify.storagePresignGet(first.objectKey, 900) : null
        }
      })
    } })
  })

  fastify.post('/', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const body = request.body || {}
    const batchType = body.batchType === 'CUSTOMER' ? 'CUSTOMER' : 'COMPANY'
    const groups = Array.isArray(body.groups) ? body.groups : []
    if (!groups.length || groups.length > MAX_GROUPS) {
      return reply.code(400).send({ success: false, message: `一次需要选择 1 至 ${MAX_GROUPS} 个动画文件夹` })
    }
    const folderNames = new Set()
    let totalFiles = 0
    let totalBytes = 0
    const fallback = { ...defaultsFor(batchType), ...metadata(body.defaults, defaultsFor(batchType)) }
    const itemRows = []
    const privateRows = []
    const uploadRows = []
    const batchId = crypto.randomUUID()
    const ownerUserId = request.user.userId
    const ownerPath = ownerUserId
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS)

    for (let position = 0; position < groups.length; position += 1) {
      const group = groups[position] || {}
      const folderName = clean(group.folderName, 255)
      if (!folderName || folderNames.has(folderName)) return reply.code(400).send({ success: false, message: '第一层子文件夹名称不能为空或重复' })
      folderNames.add(folderName)
      const files = Array.isArray(group.files) ? group.files : []
      if (files.length < 2 || files.length > MAX_FRAMES) {
        return reply.code(400).send({ success: false, message: `“${folderName}”需要 2 至 ${MAX_FRAMES} 张序列帧` })
      }
      const numbered = files.map(file => ({ ...file, order: numericStem(file.name) }))
      if (numbered.some(file => file.order === null)) return reply.code(400).send({ success: false, message: `“${folderName}”中存在未按数字命名的图片` })
      if (new Set(numbered.map(file => file.order)).size !== numbered.length) return reply.code(400).send({ success: false, message: `“${folderName}”中存在重复帧序号` })
      numbered.sort((a, b) => a.order - b.order)
      const itemId = crypto.randomUUID()
      const manifest = []
      for (const file of numbered) {
        const fileName = path.basename(String(file.name || ''))
        const fileType = String(file.type || '')
        const fileSize = Number(file.size)
        const validation = validateUploadRequest({ purpose: FILE_PURPOSE.LIBRARY_FRAME, fileName, fileType, fileSize })
        if (validation || !['image/png', 'image/jpeg'].includes(fileType)) {
          return reply.code(400).send({ success: false, message: `“${folderName}/${fileName}”：${validation || '批量导入只支持 PNG 和 JPG'}` })
        }
        totalFiles += 1
        totalBytes += fileSize
        const token = crypto.randomBytes(32).toString('hex')
        const fileId = crypto.randomUUID()
        const extension = path.extname(fileName).slice(1).toLowerCase() === 'jpeg' ? 'jpg' : path.extname(fileName).slice(1).toLowerCase()
        const objectKey = `private/library_frame/${ownerPath}/${fileId}.${extension}`
        privateRows.push({
          id: fileId, ownerUserId, purpose: FILE_PURPOSE.LIBRARY_FRAME, storageProvider: fastify.storageProvider,
          objectKey, originalName: fileName, declaredMimeType: fileType, declaredSizeBytes: fileSize,
          uploadTokenHash: sha256(token), uploadExpiresAt: expiresAt
        })
        manifest.push({ fileId, objectKey, name: fileName, order: file.order, type: fileType, size: fileSize })
        const uploadUrl = fastify.storageProvider === 'local'
          ? absoluteApiUrl(request, `/api/upload/local/${fileId}?token=${token}`)
          : fastify.storagePresignPut(objectKey, fileType, Math.floor(UPLOAD_TTL_MS / 1000))
        uploadRows.push({ itemId, fileId, objectKey, uploadUrl, completeUrl: absoluteApiUrl(request, `/api/upload/files/${fileId}/complete`) })
      }
      const itemMeta = metadata(group, fallback)
      itemRows.push({
        id: itemId, batchId, position: position + 1, folderName, relativePath: clean(group.relativePath, 500) || folderName,
        title: clean(group.title, 200) || folderName, ...itemMeta, fileManifest: manifest, frameCount: manifest.length
      })
    }
    if (totalFiles > MAX_FILES) return reply.code(400).send({ success: false, message: `一次最多上传 ${MAX_FILES} 张图片，请拆成多个批次` })
    if (totalBytes > MAX_TOTAL_BYTES) return reply.code(400).send({ success: false, message: '一次导入不能超过 500MB，请拆成多个批次' })
    const batchNo = createBatchNo()
    await prisma.$transaction([
      prisma.frameAssetImportBatch.create({ data: {
        id: batchId, batchNo, batchType, status: 'UPLOADING', defaults: fallback,
        totalItems: itemRows.length, totalFiles, totalBytes: BigInt(totalBytes), createdByStaffId: ownerUserId
      } }),
      prisma.frameAssetImportItem.createMany({ data: itemRows }),
      prisma.privateFile.createMany({ data: privateRows })
    ])
    await prisma.auditLog.create({ data: {
      userId: ownerUserId, action: 'FRAME_LIBRARY_BATCH_IMPORT_CREATED', targetId: batchId,
      detail: { batchNo, batchType, totalItems: itemRows.length, totalFiles, totalBytes }, ip: request.ip
    } })
    return reply.code(201).send({ success: true, data: { id: batchId, batchNo, uploads: uploadRows } })
  })

  fastify.patch('/:id/items/:itemId', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const item = await prisma.frameAssetImportItem.findFirst({ where: { id: request.params.itemId, batchId: request.params.id } })
    if (!item) return reply.code(404).send({ success: false, message: '导入项目不存在' })
    if (['IMPORTED', 'SKIPPED_DUPLICATE'].includes(item.status)) return reply.code(409).send({ success: false, message: '已经处理的项目不能再修改资料' })
    const body = request.body || {}
    const current = metadata(item, defaultsFor(item.sourceChannel === 'OFFLINE_CUSTOM' ? 'CUSTOMER' : 'COMPANY'))
    const next = metadata({ ...current, ...body, tags: body.tags === undefined ? current.tags : body.tags }, current)
    const updated = await prisma.frameAssetImportItem.update({ where: { id: item.id }, data: {
      title: clean(body.title, 200) || item.title, ...next,
      allowDuplicate: body.allowDuplicate === undefined ? item.allowDuplicate : Boolean(body.allowDuplicate)
    } })
    return reply.send({ success: true, data: updated })
  })

  fastify.patch('/:id/items', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const body = request.body || {}
    const ids = [...new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map(String))].slice(0, MAX_GROUPS)
    const items = await prisma.frameAssetImportItem.findMany({ where: { batchId: request.params.id, id: { in: ids }, status: { notIn: ['IMPORTED', 'SKIPPED_DUPLICATE'] } } })
    for (const item of items) {
      const tags = new Set(stringList(item.tags))
      for (const tag of stringList(body.addTags)) tags.add(tag)
      for (const tag of stringList(body.removeTags)) tags.delete(tag)
      const data = { tags: [...tags] }
      if (body.usageType && USAGE_TYPES.has(body.usageType)) data.usageType = body.usageType
      if (body.rightsHolderName !== undefined) data.rightsHolderName = clean(body.rightsHolderName, 120)
      if (body.rightsHolderContact !== undefined) data.rightsHolderContact = clean(body.rightsHolderContact, 200)
      await prisma.frameAssetImportItem.update({ where: { id: item.id }, data })
    }
    return reply.send({ success: true, data: { updated: items.length } })
  })

  fastify.post('/:id/preflight', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const batch = await prisma.frameAssetImportBatch.findUnique({ where: { id: request.params.id }, include: { items: { orderBy: { position: 'asc' } } } })
    if (!batch) return reply.code(404).send({ success: false, message: '导入批次不存在' })
    const seen = new Map()
    for (const item of batch.items) {
      if (item.status === 'IMPORTED') continue
      const manifest = Array.isArray(item.fileManifest) ? item.fileManifest : []
      const files = await prisma.privateFile.findMany({ where: { id: { in: manifest.map(frame => frame.fileId) } } })
      const byId = new Map(files.map(file => [file.id, file]))
      const issues = []
      const hashes = []
      const sizes = new Set()
      for (const frame of manifest) {
        const file = byId.get(frame.fileId)
        if (!file || file.status !== 'READY' || file.deletedAt) {
          issues.push({ level: 'ERROR', code: 'UPLOAD_INCOMPLETE', message: `${frame.name} 尚未上传或校验失败` })
          continue
        }
        let digest = file.sha256
        const buffer = await fastify.storageGetBuffer(file.objectKey)
        if (!digest) {
          digest = sha256(buffer)
          await prisma.privateFile.update({ where: { id: file.id }, data: { sha256: digest } })
        }
        hashes.push(digest)
        const dimensions = imageDimensions(buffer, file.detectedMimeType)
        if (!dimensions?.width || !dimensions?.height) issues.push({ level: 'ERROR', code: 'IMAGE_INVALID', message: `${frame.name} 无法读取图片尺寸` })
        else sizes.add(`${dimensions.width}×${dimensions.height}`)
      }
      if (sizes.size > 1) issues.push({ level: 'WARNING', code: 'MIXED_DIMENSIONS', message: `同组图片包含 ${sizes.size} 种尺寸，请确认播放效果` })
      const orders = manifest.map(frame => Number(frame.order)).sort((a, b) => a - b)
      if (orders.some((value, index) => index && value !== orders[index - 1] + 1)) {
        issues.push({ level: 'WARNING', code: 'FRAME_GAP', message: '帧序号不连续，系统仍会按数字从小到大排列' })
      }
      const fingerprint = hashes.length === manifest.length ? sha256(JSON.stringify(hashes)) : null
      let duplicateAssetId = null
      if (fingerprint) {
        const duplicateVersion = await prisma.animationAssetVersion.findFirst({ where: { manifestHash: fingerprint }, select: { assetId: true } })
        const duplicateItem = await prisma.frameAssetImportItem.findFirst({
          where: { fingerprint, id: { not: item.id }, status: 'IMPORTED' }, select: { animationAssetId: true }
        })
        duplicateAssetId = duplicateVersion?.assetId || duplicateItem?.animationAssetId || seen.get(fingerprint) || null
        if (duplicateAssetId) issues.push({ level: 'WARNING', code: 'EXACT_DUPLICATE', message: '图片内容和顺序与已有动画完全相同，默认跳过' })
        else seen.set(fingerprint, item.id)
      }
      const metaError = validateMetadata(metadata(item, defaultsFor(batch.batchType)))
      if (metaError) issues.push({ level: 'ERROR', code: 'METADATA_INVALID', message: metaError })
      const status = issues.some(issue => issue.level === 'ERROR') ? 'BLOCKED' : issues.length ? 'WARNING' : 'READY'
      await prisma.frameAssetImportItem.update({ where: { id: item.id }, data: { fingerprint, duplicateAssetId, issues, status } })
    }
    await prisma.frameAssetImportBatch.update({ where: { id: batch.id }, data: { status: 'READY', preflightedAt: new Date() } })
    const refreshed = await prisma.frameAssetImportItem.findMany({ where: { batchId: batch.id }, select: { status: true } })
    return reply.send({ success: true, data: {
      ready: refreshed.filter(item => ['READY', 'WARNING'].includes(item.status)).length,
      blocked: refreshed.filter(item => item.status === 'BLOCKED').length
    } })
  })

  fastify.post('/:id/commit', async (request, reply) => {
    if (!ownerOnly(request, reply)) return
    const requestedIds = Array.isArray(request.body?.itemIds) ? request.body.itemIds.map(String) : null
    const batch = await prisma.frameAssetImportBatch.findUnique({ where: { id: request.params.id } })
    if (!batch) return reply.code(404).send({ success: false, message: '导入批次不存在' })
    await prisma.frameAssetImportBatch.update({ where: { id: batch.id }, data: { status: 'IMPORTING' } })
    const items = await prisma.frameAssetImportItem.findMany({ where: {
      batchId: batch.id,
      ...(requestedIds ? { id: { in: requestedIds } } : {}),
      status: { in: ['READY', 'WARNING', 'FAILED'] }
    }, orderBy: { position: 'asc' } })
    const results = []
    for (const item of items) {
      if (item.duplicateAssetId && !item.allowDuplicate) {
        await prisma.frameAssetImportItem.update({ where: { id: item.id }, data: { status: 'SKIPPED_DUPLICATE' } })
        results.push({ id: item.id, status: 'SKIPPED_DUPLICATE' })
        continue
      }
      try {
        const data = metadata(item, defaultsFor(batch.batchType))
        const businessError = validateMetadata(data)
        if (businessError) throw new Error(businessError)
        let ownerUserId = null
        if (data.ownerPhone) {
          const owner = await prisma.user.findUnique({ where: { phone: data.ownerPhone }, select: { id: true } })
          if (!owner) throw new Error('绑定手机号还没有网站账号')
          ownerUserId = owner.id
        }
        const manifest = Array.isArray(item.fileManifest) ? item.fileManifest : []
        const frameKeys = manifest.map(frame => frame.objectKey)
        const files = await prisma.privateFile.findMany({ where: {
          id: { in: manifest.map(frame => frame.fileId) }, status: 'READY', deletedAt: null, linkedResourceId: null
        } })
        if (files.length !== manifest.length) throw new Error('部分帧图已经失效或被其他资料使用')
        const result = await prisma.$transaction(async tx => {
          const asset = await tx.animationAsset.create({ data: {
            assetNo: await createAnimationAssetNo(tx), ownerUserId, title: item.title, sourceType: 'STAFF_CREATED',
            sourceChannel: data.sourceChannel, usageType: data.usageType,
            assetType: data.usageType === 'COLLAB_SALE' ? 'COLLAB' : 'PRIVATE', collabStatus: 'NONE',
            rightsHolderType: data.rightsHolderType, rightsHolderName: data.rightsHolderName,
            rightsHolderContact: data.rightsHolderContact, authorizationStatus: data.authorizationStatus,
            internalNotes: data.internalNotes, createdByStaffId: request.user.userId, currentVersionNo: 1
          } })
          await tx.animationAssetVersion.create({ data: {
            assetId: asset.id, versionNo: 1, sourceKey: `FRAME_LIBRARY_BATCH_IMPORT:${item.id}`,
            sourceType: 'STAFF_CREATED', createdByUserId: request.user.userId, frameKeys,
            baseFrameCount: frameKeys.length, manifestHash: item.fingerprint || sha256(JSON.stringify(frameKeys))
          } })
          const linked = await tx.privateFile.updateMany({ where: {
            id: { in: files.map(file => file.id) }, linkedResourceId: null
          }, data: { ownerUserId, linkedResourceType: 'ANIMATION_ASSET', linkedResourceId: asset.id } })
          if (linked.count !== files.length) throw new Error('帧图归属发生冲突，请重新预检')
          await replaceTags(tx, asset.id, data.tags)
          await tx.frameAssetImportItem.update({ where: { id: item.id }, data: {
            status: 'IMPORTED', animationAssetId: asset.id, importedAt: new Date(), issues: item.issues || []
          } })
          await tx.auditLog.create({ data: {
            userId: request.user.userId, action: 'FRAME_LIBRARY_BATCH_ITEM_IMPORTED', targetId: asset.id,
            detail: { batchNo: batch.batchNo, folderName: item.folderName, assetNo: asset.assetNo, frameCount: frameKeys.length }, ip: request.ip
          } })
          return asset
        })
        results.push({ id: item.id, status: 'IMPORTED', assetNo: result.assetNo })
      } catch (error) {
        const issues = [...(Array.isArray(item.issues) ? item.issues : []).filter(issue => issue.code !== 'IMPORT_FAILED'), {
          level: 'ERROR', code: 'IMPORT_FAILED', message: String(error.message || '导入失败').slice(0, 300)
        }]
        await prisma.frameAssetImportItem.update({ where: { id: item.id }, data: { status: 'FAILED', issues } })
        results.push({ id: item.id, status: 'FAILED', message: error.message })
      }
    }
    const updatedBatch = await updateBatchCounts(prisma, batch.id)
    return reply.send({ success: true, data: { batch: summarize(updatedBatch), results } })
  })
}
