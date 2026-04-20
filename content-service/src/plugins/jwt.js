// src/plugins/jwt.js
// JWT 插件：生成/验证登录 token
// v1 升级：兼容新旧双 Payload 格式（{ userId } 和 { sub }），新增 requireNotLimited

import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { isUserBanned, isUserLimited } from '../lib/security.js'

async function jwtPlugin(fastify) {
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'mowo_dev_secret_change_in_production'
  })

  // ── 基础身份验证（兼容旧 payload { userId } 和新 payload { sub }）──
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify()
      // 统一：无论哪种 payload，都确保 userId 字段存在
      if (!request.user.userId && request.user.sub) {
        request.user.userId = request.user.sub
      }
    } catch (err) {
      reply.code(401).send({ success: false, message: '请先登录' })
    }
  })

  // ── 角色校验中间件工厂（role >= minRole）──
  fastify.decorate('requireRole', function (minRole) {
    return async function (request, reply) {
      try {
        await request.jwtVerify()
        if (!request.user.userId && request.user.sub) {
          request.user.userId = request.user.sub
        }
      } catch (err) {
        return reply.code(401).send({ success: false, message: '请先登录' })
      }

      const userRole = request.user.role ?? 0
      if (userRole < minRole) {
        return reply.code(403).send({
          success:  false,
          message:  '权限不足',
          required: minRole,
          current:  userRole
        })
      }
    }
  })

  // ── 限制状态检查中间件（灰度封禁，禁止资金操作）──
  fastify.decorate('requireNotLimited', async function (request, reply) {
    const userId = request.user?.userId ?? request.user?.sub
    if (!userId) return
    if (await isUserLimited(userId, fastify.prisma)) {
      return reply.code(403).send({
        success: false,
        message: '账号处于限制状态，资金操作暂不可用',
        code:    'ACCOUNT_LIMITED'
      })
    }
  })

  // ── 封禁检查中间件（结合 TokenBlacklist 即时封禁）──
  fastify.decorate('requireNotBanned', async function (request, reply) {
    const userId = request.user?.userId ?? request.user?.sub
    if (!userId) return
    if (await isUserBanned(userId, fastify.prisma)) {
      return reply.code(403).send({
        success: false,
        message: '账号已被封禁，请联系客服',
        code:    'ACCOUNT_BANNED'
      })
    }
  })
}

export default fp(jwtPlugin)
