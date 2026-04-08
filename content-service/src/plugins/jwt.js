// src/plugins/jwt.js
// JWT 插件，负责生成和验证登录 token

import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'

async function jwtPlugin(fastify) {
  // 注册 JWT 插件
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'mowo_dev_secret_change_in_production'
  })

  // ── 基础身份验证：只要登录就能访问 ──
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({ success: false, message: '请先登录' })
    }
  })

  // ── 角色校验中间件工厂 ──
  // 用法：preHandler: [fastify.requireRole(2)]
  // 含义：role >= minRole 才能访问
  // 0=User 1=Production 2=Admin 3=SuperAdmin
  fastify.decorate('requireRole', function (minRole) {
    return async function (request, reply) {
      // 先验证token
      try {
        await request.jwtVerify()
      } catch (err) {
        return reply.code(401).send({ success: false, message: '请先登录' })
      }

      // 再验证角色
      const userRole = request.user.role ?? 0
      if (userRole < minRole) {
        return reply.code(403).send({
          success: false,
          message: '权限不足',
          required: minRole,
          current: userRole
        })
      }
    }
  })
}

export default fp(jwtPlugin)