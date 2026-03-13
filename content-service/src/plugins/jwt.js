// src/plugins/jwt.js
// JWT 插件，负责生成和验证登录 token

import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'

async function jwtPlugin(fastify) {
  // 注册 JWT 插件，secret 是加密密钥，从环境变量读取
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'mowo_dev_secret_change_in_production'
  })

  // 添加一个验证身份的方法，路由里调用 fastify.authenticate 来保护接口
  // 没有 token 或 token 无效的请求会直接返回 401 错误
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({ success: false, message: '请先登录' })
    }
  })
}

export default fp(jwtPlugin)