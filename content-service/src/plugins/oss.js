// Storage adapter: private local files for development, private Aliyun OSS for production.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import fp from 'fastify-plugin'
import OSS from 'ali-oss'

function safeObjectPath(root, objectKey) {
  const normalized = String(objectKey || '').replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Invalid storage object key')
  }
  const target = path.resolve(root, ...normalized.split('/'))
  const prefix = `${path.resolve(root)}${path.sep}`
  if (!target.startsWith(prefix)) throw new Error('Invalid storage object path')
  return target
}

function localSignature(secret, method, objectKey, expiresAt) {
  return crypto.createHmac('sha256', secret)
    .update(`${method}\n${objectKey}\n${expiresAt}`)
    .digest('hex')
}

export default fp(async function storagePlugin(fastify) {
  const provider = fastify.config.storage.provider
  fastify.decorate('storageProvider', provider)

  if (provider === 'oss') {
    const client = new OSS({
      region: fastify.config.oss.region,
      accessKeyId: fastify.config.oss.accessKeyId,
      accessKeySecret: fastify.config.oss.accessKeySecret,
      bucket: fastify.config.oss.bucket,
      secure: true
    })
    fastify.decorate('oss', client)
    fastify.decorate('storagePut', (key, data, options) => client.put(key, data, options))
    fastify.decorate('storageDelete', key => client.delete(key))
    fastify.decorate('storagePresignGet', (key, seconds = 300) => client.signatureUrl(key, { expires: seconds }))
    fastify.decorate('storagePresignPut', (key, contentType, seconds = 900) => client.signatureUrl(key, {
      method: 'PUT', expires: seconds, 'Content-Type': contentType
    }))
    fastify.decorate('storageHead', key => client.head(key))
    fastify.decorate('storageReadHeader', async key => {
      const result = await client.getStream(key, { headers: { Range: 'bytes=0-63' } })
      const chunks = []
      for await (const chunk of result.stream) chunks.push(chunk)
      return Buffer.concat(chunks).subarray(0, 64)
    })
    fastify.decorate('ossPresignGet', (key, seconds = 300) => fastify.storagePresignGet(key, seconds))
    return
  }

  const root = path.resolve(process.cwd(), fastify.config.storage.localDir)
  await fs.promises.mkdir(root, { recursive: true })

  fastify.decorate('storageRoot', root)
  fastify.decorate('storageObjectPath', key => safeObjectPath(root, key))
  fastify.decorate('storagePut', async (key, data) => {
    const target = safeObjectPath(root, key)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data)
    await fs.promises.writeFile(target, body, { flag: 'wx' })
    return { name: key, url: key }
  })
  fastify.decorate('storageDelete', async key => {
    const target = safeObjectPath(root, key)
    await fs.promises.rm(target, { force: true })
  })
  fastify.decorate('storageHead', async key => {
    const stat = await fs.promises.stat(safeObjectPath(root, key))
    return { res: { headers: { 'content-length': String(stat.size) } }, size: stat.size }
  })
  fastify.decorate('storageReadHeader', async key => {
    const handle = await fs.promises.open(safeObjectPath(root, key), 'r')
    try {
      const buffer = Buffer.alloc(64)
      const { bytesRead } = await handle.read(buffer, 0, 64, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  })
  fastify.decorate('storagePresignGet', (key, seconds = 300) => {
    const expiresAt = Math.floor(Date.now() / 1000) + seconds
    const signature = localSignature(fastify.config.storage.signingSecret, 'GET', key, expiresAt)
    return `http://127.0.0.1:${fastify.config.port}/api/storage/local?key=${encodeURIComponent(key)}&expires=${expiresAt}&signature=${signature}`
  })
  fastify.decorate('storagePresignPut', () => {
    throw new Error('Local uploads must use the registered private-file endpoint')
  })
  fastify.decorate('ossPresignGet', (key, seconds = 300) => fastify.storagePresignGet(key, seconds))

  // Compatibility for server-generated files. Browser uploads must use /api/upload.
  fastify.decorate('oss', {
    put: (key, data, options) => fastify.storagePut(key, data, options),
    delete: key => fastify.storageDelete(key),
    signatureUrl: (key, options = {}) => {
      if (String(options.method || 'GET').toUpperCase() !== 'GET') {
        throw new Error('Local browser uploads require the private-file API')
      }
      return fastify.storagePresignGet(key, options.expires || 300)
    }
  })

  fastify.get('/api/storage/local', async (request, reply) => {
    const { key, expires, signature } = request.query
    const expiresAt = Number(expires)
    if (!key || !Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
      return reply.code(403).send({ success: false, message: '文件访问链接已失效' })
    }
    const expected = localSignature(fastify.config.storage.signingSecret, 'GET', key, expiresAt)
    const supplied = String(signature || '')
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return reply.code(403).send({ success: false, message: '文件访问签名无效' })
    }
    try {
      const file = await fastify.prisma.privateFile.findUnique({ where: { objectKey: key } })
      const target = safeObjectPath(root, key)
      if (file && file.status !== 'READY') return reply.code(404).send({ success: false, message: '文件不可用' })
      if (file?.detectedMimeType) reply.type(file.detectedMimeType)
      reply.header('Cache-Control', 'private, max-age=60')
      return reply.send(fs.createReadStream(target))
    } catch {
      return reply.code(404).send({ success: false, message: '文件不存在' })
    }
  })
})
