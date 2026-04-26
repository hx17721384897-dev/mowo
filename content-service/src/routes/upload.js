// src/routes/upload.js
// 文件上传相关接口

export default async function uploadRoutes(fastify) {

  // ─────────────────────────────────────────
  // POST /api/upload/presign
  // 生成OSS预签名上传URL（前端直传OSS，不经过我们服务器）
  // ─────────────────────────────────────────
  // 需要登录
  // 前端拿到URL后直接PUT上传文件到OSS
  fastify.post('/presign', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { fileName, fileType, folder } = request.body
    const userId = request.user.userId

    // 校验文件类型
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
      // 文档类型（简历/作品集用）
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip', 'application/x-zip-compressed',
      'application/octet-stream', // 兜底，部分浏览器对doc/docx识别为此类型
    ]
    if (!allowedTypes.includes(fileType)) {
      return reply.code(400).send({ success: false, message: '不支持的文件类型' })
    }

    // 构建OSS存储路径
    // folder 由前端指定，如 'customize'、'avatar'、'animation'
    const safeFolder = (folder || 'misc').replace(/[^a-zA-Z0-9_-]/g, '')
    const ext        = fileName.split('.').pop().toLowerCase()
    const timestamp  = Date.now()
    const objectKey  = `${safeFolder}/${userId.slice(-8)}/${timestamp}.${ext}`

    // 生成预签名URL，有效期15分钟
    const url = fastify.oss.signatureUrl(objectKey, {
      method:  'PUT',
      expires: 900,
      'Content-Type': fileType,
    })

    return reply.send({
      success: true,
      data: {
        url:       url,        // 前端 contact.html 用 data.url
        key:       objectKey,  // 前端 contact.html 用 data.key
        uploadUrl: url,        // 兼容其他页面
        objectKey,
        accessUrl: `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${objectKey}`
      }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/upload/presign-batch
  // 批量生成预签名URL（定制帧图片上传用）
  // ─────────────────────────────────────────
  fastify.post('/presign-batch', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { files, folder, orderNo } = request.body
    const userId = request.user.userId

    if (!Array.isArray(files) || files.length === 0) {
      return reply.code(400).send({ success: false, message: 'files不能为空' })
    }
    if (files.length > 50) {
      return reply.code(400).send({ success: false, message: '单次最多50个文件' })
    }

    const safeFolder = (folder || 'customize').replace(/[^a-zA-Z0-9_-]/g, '')
    const safeOrder  = (orderNo || 'draft').replace(/[^a-zA-Z0-9_-]/g, '')
    const uid8       = userId.slice(-8)

    const results = files.map((file, index) => {
      // 帧图片命名：001.jpg、002.jpg...
      const frameNo    = String(index + 1).padStart(3, '0')
      const ext        = (file.fileName || 'frame.jpg').split('.').pop().toLowerCase()
      const objectKey  = `${safeFolder}/${uid8}/${safeOrder}/${frameNo}.${ext}`

      const uploadUrl = fastify.oss.signatureUrl(objectKey, {
        method:  'PUT',
        expires: 1800, // 30分钟，给用户足够的上传时间
        'Content-Type': file.fileType || 'image/jpeg',
      })

      return {
        index,
        frameNo,
        uploadUrl,
        objectKey,
        accessUrl: `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${objectKey}`
      }
    })

    return reply.send({ success: true, data: results })
  })

  // ─────────────────────────────────────────
  // POST /api/upload/presign-avatar
  // 用户头像上传预签名URL
  // ─────────────────────────────────────────
  fastify.post('/presign-avatar', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { fileType } = request.body
    const userId = request.user.userId

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(fileType)) {
      return reply.code(400).send({ success: false, message: '头像只支持 JPG/PNG/WEBP' })
    }

    const ext       = fileType.split('/')[1]
    const objectKey = `avatars/${userId.slice(-8)}/${Date.now()}.${ext}`

    const uploadUrl = fastify.oss.signatureUrl(objectKey, {
      method:  'PUT',
      expires: 300,
      'Content-Type': fileType,
    })

    return reply.send({
      success: true,
      data: {
        uploadUrl,
        objectKey,
        accessUrl: `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${objectKey}`
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/upload/presign-get?key=xxx
  // 获取 OSS 对象的预签名读取 URL（管理员用）
  // ─────────────────────────────────────────
  fastify.get('/presign-get', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { key } = request.query
    if (!key) return reply.code(400).send({ success: false, message: 'key 参数必填' })
    const url = fastify.ossPresignGet(key, 3600)
    return reply.send({ success: true, data: { url } })
  })
}