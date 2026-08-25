import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import {
  FILE_PURPOSE,
  anonymousOwnerHash,
  canStaffReadFile,
  detectMimeType,
  detectedTypeAllowed,
  normalizePurpose,
  uploadPolicy,
  validateUploadRequest
} from '../lib/private-files.js'
import { enforceRateLimit } from '../lib/rate-limit.js'

const UPLOAD_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', 'application/x-zip-compressed'
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function objectExtension(fileName) {
  return path.basename(fileName).split('.').pop().toLowerCase()
}

function absoluteApiUrl(request, relativePath) {
  return `${request.protocol}://${request.headers.host}${relativePath}`
}

async function createPendingFile(fastify, request, input) {
  const purpose = normalizePurpose(input.purpose, input.folder)
  const error = validateUploadRequest({ ...input, purpose })
  if (error) return { error }

  if ([FILE_PURPOSE.LIBRARY_SOURCE, FILE_PURPOSE.LIBRARY_FRAME].includes(purpose) && !['OWNER', 'PRODUCTION'].includes(request.user?.staffRole)) {
    return { error: '只有工作人员可以上传帧图资产库素材' }
  }

  const ownerUserId = request.user?.userId || null
  const anonymousHash = ownerUserId ? null : anonymousOwnerHash(
    fastify.config.storage.signingSecret,
    request.headers['x-upload-session']
  )
  if (!ownerUserId && ![FILE_PURPOSE.CONTACT_PORTFOLIO, FILE_PURPOSE.CONTACT_RESUME].includes(purpose)) {
    return { error: '该文件用途需要先登录' }
  }
  if (!ownerUserId && !anonymousHash) return { error: '匿名上传会话无效，请刷新页面重试' }

  const token = crypto.randomBytes(32).toString('hex')
  const id = crypto.randomUUID()
  const extension = objectExtension(input.fileName)
  const ownerPath = ownerUserId || `guest-${anonymousHash.slice(0, 16)}`
  const objectKey = `private/${purpose.toLowerCase()}/${ownerPath}/${id}.${extension}`
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  const file = await fastify.prisma.privateFile.create({
    data: {
      id,
      ownerUserId,
      anonymousOwnerHash: anonymousHash,
      purpose,
      storageProvider: fastify.storageProvider,
      objectKey,
      originalName: path.basename(input.fileName).slice(0, 255),
      declaredMimeType: input.fileType,
      declaredSizeBytes: Number(input.fileSize),
      uploadTokenHash: sha256(token),
      uploadExpiresAt: expiresAt
    }
  })

  const uploadUrl = fastify.storageProvider === 'local'
    ? absoluteApiUrl(request, `/api/upload/local/${file.id}?token=${token}`)
    : fastify.storagePresignPut(file.objectKey, file.declaredMimeType, 900)
  const completeUrl = absoluteApiUrl(request, `/api/upload/files/${file.id}/complete`)
  const accessUrl = purpose === FILE_PURPOSE.AVATAR
    ? absoluteApiUrl(request, `/api/upload/public/${file.id}`)
    : null

  return { file, uploadUrl, completeUrl, accessUrl }
}

async function finalizeStoredFile(fastify, file) {
  const head = await fastify.storageHead(file.objectKey)
  const size = Number(head.size || head.res?.headers?.['content-length'])
  const header = await fastify.storageReadHeader(file.objectKey)
  const detectedMimeType = detectMimeType(header)
  if (!Number.isInteger(size) || size <= 0 || size !== file.declaredSizeBytes) {
    await fastify.storageDelete(file.objectKey).catch(() => {})
    await fastify.prisma.privateFile.update({ where: { id: file.id }, data: { status: 'REJECTED' } })
    throw new Error('文件实际大小与上传申请不一致')
  }
  if (!detectedTypeAllowed(file.purpose, detectedMimeType, file.declaredMimeType)) {
    await fastify.storageDelete(file.objectKey).catch(() => {})
    await fastify.prisma.privateFile.update({ where: { id: file.id }, data: { status: 'REJECTED', detectedMimeType } })
    throw new Error('文件真实内容与声明类型不一致')
  }
  return fastify.prisma.privateFile.update({
    where: { id: file.id },
    data: { status: 'READY', sizeBytes: size, detectedMimeType, uploadedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null }
  })
}

export default async function uploadRoutes(fastify) {
  for (const contentType of UPLOAD_TYPES) {
    if (!fastify.hasContentTypeParser(contentType)) {
      fastify.addContentTypeParser(contentType, (request, payload, done) => done(null, payload))
    }
  }

  async function allowUploadRegistration(request, reply, cost = 1) {
    const ownerUserId = request.user?.userId || null
    const anonymousHash = ownerUserId ? null : anonymousOwnerHash(
      fastify.config.storage.signingSecret,
      request.headers['x-upload-session']
    )
    return enforceRateLimit(fastify, request, reply, ownerUserId ? {
      scope: 'UPLOAD_ACCOUNT_10_MINUTES', subject: ownerUserId,
      windowMs: 10 * 60 * 1000, limit: fastify.config.rateLimits.uploadAccountPer10Minutes,
      cost, message: '上传申请过于频繁，请10分钟后再试'
    } : {
      scope: 'UPLOAD_ANONYMOUS_HOURLY', subject: anonymousHash || request.ip,
      windowMs: 60 * 60 * 1000, limit: fastify.config.rateLimits.uploadAnonymousPerHour,
      cost, message: '匿名上传申请过于频繁，请一小时后再试'
    })
  }

  fastify.post('/presign', { preHandler: [fastify.optionalAuthenticate] }, async (request, reply) => {
    if (!await allowUploadRegistration(request, reply)) return
    const result = await createPendingFile(fastify, request, request.body || {})
    if (result.error) return reply.code(400).send({ success: false, message: result.error })
    return reply.send({
      success: true,
      data: {
        fileId: result.file.id,
        url: result.uploadUrl,
        key: result.file.objectKey,
        uploadUrl: result.uploadUrl,
        objectKey: result.file.objectKey,
        completeUrl: result.completeUrl,
        accessUrl: result.accessUrl,
        purpose: result.file.purpose,
        maxBytes: uploadPolicy(result.file.purpose).maxBytes
      }
    })
  })

  fastify.post('/presign-batch', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { files, purpose = FILE_PURPOSE.CUSTOMIZATION_FRAME } = request.body || {}
    if (!Array.isArray(files) || files.length === 0 || files.length > 50) {
      return reply.code(400).send({ success: false, message: '单次需上传 1 至 50 个文件' })
    }
    if (!await allowUploadRegistration(request, reply, files.length)) return
    const results = []
    for (let index = 0; index < files.length; index += 1) {
      const result = await createPendingFile(fastify, request, { ...files[index], purpose })
      if (result.error) return reply.code(400).send({ success: false, message: `第 ${index + 1} 个文件：${result.error}` })
      results.push({
        index, frameNo: String(index + 1).padStart(3, '0'), fileId: result.file.id,
        uploadUrl: result.uploadUrl, objectKey: result.file.objectKey,
        completeUrl: result.completeUrl, accessUrl: null
      })
    }
    return reply.send({ success: true, data: results })
  })

  fastify.post('/presign-avatar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!await allowUploadRegistration(request, reply)) return
    const result = await createPendingFile(fastify, request, {
      purpose: FILE_PURPOSE.AVATAR,
      fileName: `avatar.${String(request.body?.fileType || '').split('/')[1] || 'jpg'}`,
      fileType: request.body?.fileType,
      fileSize: request.body?.fileSize
    })
    if (result.error) return reply.code(400).send({ success: false, message: result.error })
    return reply.send({ success: true, data: {
      fileId: result.file.id, uploadUrl: result.uploadUrl, objectKey: result.file.objectKey,
      completeUrl: result.completeUrl, accessUrl: result.accessUrl
    } })
  })

  fastify.put('/local/:id', { bodyLimit: 210 * 1024 * 1024 }, async (request, reply) => {
    if (fastify.storageProvider !== 'local') return reply.code(404).send({ success: false, message: '接口不存在' })
    const file = await fastify.prisma.privateFile.findUnique({ where: { id: request.params.id } })
    const tokenHash = sha256(String(request.query.token || ''))
    if (!file || file.status !== 'PENDING' || !file.uploadTokenHash || file.uploadTokenHash !== tokenHash || !file.uploadExpiresAt || file.uploadExpiresAt < new Date()) {
      return reply.code(403).send({ success: false, message: '上传链接无效或已过期' })
    }
    if (request.headers['content-type']?.split(';')[0] !== file.declaredMimeType) {
      return reply.code(400).send({ success: false, message: '上传类型与申请不一致' })
    }

    const target = fastify.storageObjectPath(file.objectKey)
    const temp = `${target}.part`
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    let size = 0
    const headerChunks = []
    let headerSize = 0
    const hash = crypto.createHash('sha256')
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length
        if (size > file.declaredSizeBytes || size > uploadPolicy(file.purpose).maxBytes) {
          callback(new Error('文件大小超过申请值'))
          return
        }
        if (headerSize < 64) {
          const slice = chunk.subarray(0, 64 - headerSize)
          headerChunks.push(slice)
          headerSize += slice.length
        }
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    try {
      await pipeline(request.body, meter, fs.createWriteStream(temp, { flags: 'wx' }))
      if (size !== file.declaredSizeBytes) throw new Error('文件实际大小与申请值不一致')
      const detectedMimeType = detectMimeType(Buffer.concat(headerChunks))
      if (!detectedTypeAllowed(file.purpose, detectedMimeType, file.declaredMimeType)) {
        throw new Error('文件真实内容与声明类型不一致')
      }
      await fs.promises.rename(temp, target)
      await fastify.prisma.privateFile.update({
        where: { id: file.id },
        data: {
          status: 'READY', sizeBytes: size, detectedMimeType, sha256: hash.digest('hex'),
          uploadedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null
        }
      })
      return reply.code(204).send()
    } catch (error) {
      await fs.promises.rm(temp, { force: true }).catch(() => {})
      await fastify.prisma.privateFile.update({ where: { id: file.id }, data: { status: 'REJECTED' } }).catch(() => {})
      return reply.code(400).send({ success: false, message: error.message || '文件上传失败' })
    }
  })

  fastify.post('/files/:id/complete', { preHandler: [fastify.optionalAuthenticate] }, async (request, reply) => {
    const ownerUserId = request.user?.userId || null
    const anonymousHash = ownerUserId ? null : anonymousOwnerHash(
      fastify.config.storage.signingSecret,
      request.headers['x-upload-session']
    )
    const file = await fastify.prisma.privateFile.findFirst({ where: {
      id: request.params.id,
      ...(ownerUserId ? { ownerUserId } : { ownerUserId: null, anonymousOwnerHash: anonymousHash || '__invalid__' })
    } })
    if (!file) return reply.code(404).send({ success: false, message: '文件记录不存在' })
    if (file.status === 'READY') return reply.send({ success: true, data: { objectKey: file.objectKey } })
    if (file.status !== 'PENDING') return reply.code(400).send({ success: false, message: '文件状态不可确认' })
    try {
      const ready = await finalizeStoredFile(fastify, file)
      return reply.send({ success: true, data: { objectKey: ready.objectKey } })
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message || '文件确认失败' })
    }
  })

  fastify.post('/files/:id/use-as-avatar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId
    const file = await fastify.prisma.privateFile.findFirst({ where: {
      id: request.params.id,
      ownerUserId: userId,
      purpose: FILE_PURPOSE.AVATAR,
      status: 'READY'
    } })
    if (!file) {
      return reply.code(404).send({ success: false, message: '头像文件不存在、尚未上传完成或不属于当前账号' })
    }

    const avatarUrl = absoluteApiUrl(request, `/api/upload/public/${file.id}`)
    const adopted = await fastify.prisma.$transaction(async tx => {
      const claimed = await tx.privateFile.updateMany({
        where: {
          id: file.id,
          ownerUserId: userId,
          purpose: FILE_PURPOSE.AVATAR,
          status: 'READY',
          OR: [
            { linkedResourceId: null },
            { linkedResourceType: 'USER_PROFILE', linkedResourceId: userId }
          ]
        },
        data: { linkedResourceType: 'USER_PROFILE', linkedResourceId: userId }
      })
      if (claimed.count !== 1) return false

      await tx.userProfile.update({ where: { userId }, data: { avatarUrl } })
      await tx.privateFile.updateMany({
        where: {
          id: { not: file.id },
          ownerUserId: userId,
          purpose: FILE_PURPOSE.AVATAR,
          linkedResourceType: 'USER_PROFILE',
          linkedResourceId: userId
        },
        data: { linkedResourceType: null, linkedResourceId: null }
      })
      return true
    })
    if (!adopted) {
      return reply.code(409).send({ success: false, message: '头像已进入清理流程，请重新上传' })
    }

    return reply.send({ success: true, data: { avatarUrl, fileId: file.id } })
  })

  fastify.get('/presign-get', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const file = await fastify.prisma.privateFile.findUnique({ where: { objectKey: request.query.key || '' } })
    if (!file || file.status !== 'READY') return reply.code(404).send({ success: false, message: '文件不存在' })
    const isOwner = file.ownerUserId === request.user.userId
    const isAuthorizedStaff = canStaffReadFile(request.user.staffRole, file)
    if (!isOwner && !isAuthorizedStaff) {
      await fastify.prisma.operationLog.create({ data: {
        userId: request.user.userId, userRole: request.user.role ?? 0,
        method: 'GET', path: '/api/upload/presign-get', target: 'private_file', targetId: file.id,
        outcome: 'DENIED', statusCode: 403, sessionId: request.user.sid || null,
        ip: request.ip || null, userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null
      } }).catch(() => {})
      return reply.code(403).send({ success: false, message: '无权查看该文件' })
    }
    await fastify.prisma.operationLog.create({ data: {
      userId: request.user.userId, userRole: request.user.role ?? 0,
      method: 'GET', path: '/api/upload/presign-get', target: 'private_file', targetId: file.id,
      outcome: 'SUCCESS', statusCode: 200, sessionId: request.user.sid || null,
      ip: request.ip || null, userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null
    } }).catch(() => {})
    const url = fastify.storagePresignGet(file.objectKey, 300)
    return reply.send({ success: true, data: { url: url.startsWith('/') ? absoluteApiUrl(request, url) : url, expiresIn: 300 } })
  })

  fastify.get('/public/:id', async (request, reply) => {
    const file = await fastify.prisma.privateFile.findFirst({ where: {
      id: request.params.id,
      purpose: FILE_PURPOSE.AVATAR,
      status: 'READY',
      linkedResourceType: 'USER_PROFILE',
      linkedResourceId: { not: null }
    } })
    if (!file) return reply.code(404).send({ success: false, message: '头像不存在' })
    const url = fastify.storagePresignGet(file.objectKey, 300)
    return reply.redirect(url.startsWith('/') ? absoluteApiUrl(request, url) : url)
  })
}
