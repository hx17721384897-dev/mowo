// src/plugins/oss.js
// 阿里云OSS客户端插件

import fp from 'fastify-plugin'
import OSS from 'ali-oss'

export default fp(async function (fastify) {
  const client = new OSS({
    region:          process.env.OSS_REGION,
    accessKeyId:     process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket:          process.env.OSS_BUCKET,
  })

  // 挂载到 fastify 实例，路由里用 fastify.oss 访问
  fastify.decorate('oss', client)

  // 生成预签名下载URL（用于安全访问私有Bucket中的文件）
  // objectKey: OSS文件路径，如 'customize/abc123/001.jpg'
  // expireSeconds: URL有效期，默认1小时
  fastify.decorate('ossPresignGet', (objectKey, expireSeconds = 3600) => {
    return client.signatureUrl(objectKey, { expires: expireSeconds })
  })
})
