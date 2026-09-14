// src/plugins/jwt.js
// JWT 插件：生成/验证登录 token
// v1 升级：兼容新旧双 Payload 格式（{ userId } 和 { sub }），新增 requireNotLimited

import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { isUserLimited } from '../lib/security.js'
import { effectiveStaffRole, hasPermission } from '../lib/permissions.js'

async function jwtPlugin(fastify) {
  fastify.register(fastifyJwt, {
    secret: fastify.config.jwtSecret
  })

  async function verifyActiveSession(request, reply) {
    try {
      await request.jwtVerify()
      if (!request.user.userId && request.user.sub) {
        request.user.userId = request.user.sub
      }

      const userId = request.user.userId
      const sessionId = request.user.sid
      if (!userId || !sessionId) {
        reply.code(401).send({
          success: false,
          message: '登录状态已升级，请重新登录',
          code: 'SESSION_REQUIRED'
        })
        return false
      }

      const session = await fastify.prisma.refreshToken.findFirst({
        where: {
          userId,
          sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() }
        },
        select: {
          id: true,
          user: {
            select: {
              role: true,
              staffRole: true,
              isBanned: true,
              status: true
            }
          }
        }
      })
      const user = session?.user

      if (!session) {
        reply.code(401).send({
          success: false,
          message: '当前设备已退出登录，请重新登录',
          code: 'SESSION_REVOKED'
        })
        return false
      }

      if (!user || user.isBanned || ['SUSPENDED', 'DELETED'].includes(user.status)) {
        reply.code(403).send({
          success: false,
          message: '账号已停用，请联系客服',
          code: 'ACCOUNT_DISABLED'
        })
        return false
      }

      // 后台权限以数据库当前值为准，角色调整后立即生效。
      request.user.role = user.role
      request.user.staffRole = effectiveStaffRole(user)
      request.user.accountStatus = user.status
      if (user.status === 'PENDING_DELETE' && !pendingDeletionActionAllowed(request)) {
        reply.code(403).send({
          success: false,
          message: '账号正在注销处理中，不能新增业务；您可以查看已有订单或撤销注销',
          code: 'ACCOUNT_DELETION_PENDING'
        })
        return false
      }
      return true
    } catch {
      reply.code(401).send({ success: false, message: '请先登录', code: 'AUTH_REQUIRED' })
      return false
    }
  }

  fastify.decorate('authenticate', verifyActiveSession)

  fastify.decorate('optionalAuthenticate', async function (request, reply) {
    const authorization = String(request.headers.authorization || '')
    if (!authorization.startsWith('Bearer ') || authorization.slice(7).trim() === '') return true
    return verifyActiveSession(request, reply)
  })

  // ── 角色校验中间件工厂（role >= minRole）──
  fastify.decorate('requireRole', function (minRole) {
    return async function (request, reply) {
      const active = await verifyActiveSession(request, reply)
      if (!active) return

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

  fastify.decorate('requirePermission', function (permission) {
    return async function (request, reply) {
      const active = await verifyActiveSession(request, reply)
      if (!active) return
      if (!hasPermission(request.user, permission)) {
        return reply.code(403).send({
          success: false,
          message: '当前员工岗位无权执行此操作',
          code: 'STAFF_PERMISSION_DENIED'
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

  // 保留给旧路由组合使用；基础 authenticate 已统一执行账号状态检查。
  fastify.decorate('requireNotBanned', async function (request, reply) {
    return verifyActiveSession(request, reply)
  })
}

export default fp(jwtPlugin)
  function pendingDeletionActionAllowed(request) {
    const path = request.url.split('?')[0]
    if (request.method === 'GET') {
      // 查询本身可用，但这些旧 GET 接口会创建购物车或签发新的上传权限。
      return path !== '/api/cart' && !path.includes('/upload-url')
    }
    if (request.method === 'DELETE') return true
    if ([
      '/api/v1/account/deactivate/cancel',
      '/api/v1/auth/logout',
      '/api/v1/auth/logout-all'
    ].includes(path)) return true
    return /^\/api\/(orders\/[^/]+\/(confirm-receipt|cancel|aftersale)|customize-orders\/[^/]+\/cancel)$/.test(path)
  }
