import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyCookie from '@fastify/cookie'
import { loadConfig } from './config/env.js'

import prismaPlugin from './plugins/prisma.js'
import jwtPlugin from './plugins/jwt.js'
import ossPlugin from './plugins/oss.js'
import authRoutes from './routes/auth.js'
import { authV1Routes, userV1Routes } from './routes/auth-v1.js'
import machineModelRoutes from './routes/machine-models.js'
import uploadRoutes from './routes/upload.js'
import customizeOrderRoutes from './routes/customize-orders.js'
import adminRoutes from './routes/admin.js'
import collabRoutes from './routes/collab.js'
import adminCollabRoutes from './routes/admin-collab.js'
import inventoryRoutes from './routes/inventory.js'
import multipart from '@fastify/multipart'
import contactRoutes      from './routes/contact.js'
import adminContactRoutes from './routes/admin-contact.js'
import cartRoutes          from './routes/cart.js'
import customProductRoutes from './routes/custom-products.js'
import animationAssetRoutes from './routes/animation-assets.js'
import paymentRoutes       from './routes/payment.js'
import addressRoutes       from './routes/addresses.js'
import orderRoutes         from './routes/orders.js'
import customizationRequestRoutes from './routes/customization-requests.js'
import adminCustomizationRequestRoutes from './routes/admin-customization-requests.js'
import materialsRoutes    from './routes/materials.js'
import framePacksRoutes  from './routes/frame-packs.js'
import productionBatchRoutes from './routes/production-batches.js'
import productionWorkflowRoutes from './routes/production-workflow.js'
import printProductionRoutes from './routes/print-production.js'
import frameLibraryRoutes from './routes/frame-library.js'
import frameMakingRoutes from './routes/frame-making.js'
import frameImportRoutes from './routes/frame-imports.js'
import accountRoutes     from './routes/account.js'
import { startScheduler }     from './lib/scheduler.js'
import { hasPermission, requiredPermissionForRequest } from './lib/permissions.js'
import { auditOutcome, serializeSafeAuditBody } from './lib/audit.js'
import { publicFeatureFlags, requiredFeatureForRequest } from './lib/features.js'
import { isClosedLegacyProductionEndpoint } from './lib/legacy-production-endpoints.js'

const config = loadConfig()
const fastify = Fastify({
  logger: {
    // Keep runtime diagnostics useful without relying on Pino/Fastify defaults
    // to protect session credentials when serializers change in the future.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'err.headers.authorization',
        'err.headers.cookie'
      ],
      censor: '[REDACTED]'
    }
  },
  bodyLimit: 10 * 1024 * 1024
})
fastify.decorate('config', config)
fastify.setErrorHandler((error, request, reply) => {
  const statusCode = Number(error.statusCode || 500)
  // A file route may already have selected an image/document content type before
  // an asynchronous storage failure reaches this handler. Always restore JSON so
  // the controlled error body is serialised correctly instead of crashing Fastify.
  reply.type('application/json; charset=utf-8')
  if (statusCode >= 500) {
    request.log.error({ err: error }, 'Unhandled request error')
    return reply.code(500).send({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器暂时无法处理请求，请稍后重试'
    })
  }
  return reply.code(statusCode).send({
    success: false,
    code: error.code || 'REQUEST_ERROR',
    message: error.message || '请求处理失败'
  })
})

async function start() {
  try {
    // CORS：允许凭证（HttpOnly Cookie 需要），开发环境放行本地前端地址
    await fastify.register(cors, {
      origin: (origin, cb) => {
        if (!origin) { cb(null, true); return } // 服务端直接调用/curl
        if (config.corsOrigins.includes(origin) || !config.isProduction) { cb(null, true); return }
        cb(new Error('不允许的跨域来源'), false)
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    })

    // Cookie 插件（HttpOnly Refresh Token）
    await fastify.register(fastifyCookie, {
      secret: config.cookieSecret
    })

    await fastify.register(prismaPlugin)
    await fastify.register(jwtPlugin)
    await fastify.register(ossPlugin)
    await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })

    fastify.addHook('onSend', async (request, reply, payload) => {
      const resourcePath = request.url.split('?')[0]
      const isBrowserImageResource = request.method === 'GET' && (
        resourcePath.startsWith('/api/upload/public/') ||
        resourcePath === '/api/storage/local'
      )
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('X-Frame-Options', 'DENY')
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
      reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      // Static pages and the local API use different ports during development.
      // Only public avatars and signed storage reads need cross-origin embedding.
      reply.header('Cross-Origin-Resource-Policy', isBrowserImageResource ? 'cross-origin' : 'same-site')
      reply.header('Cache-Control', request.url.startsWith('/api/v1/auth') ? 'no-store' : 'no-cache')
      if (config.isProduction) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      return payload
    })

    // 暂时关闭但保留的能力由服务端开关控制；已物理退役能力不再注册路由。
    fastify.addHook('preHandler', async (request, reply) => {
      const feature = requiredFeatureForRequest(request.url)
      if (!feature || config.features[feature]) return
      return reply.code(404).send({
        success: false,
        message: '该功能在当前测试阶段暂未开放',
        code: 'FEATURE_NOT_AVAILABLE'
      })
    })

    fastify.get('/api/config/features', async () => ({
      success: true,
      data: publicFeatureFlags(config)
    }))

    // 所有员工后台请求统一检查岗位权限，避免单个路由遗漏鉴权。
    fastify.addHook('preHandler', async (request, reply) => {
      const permission = requiredPermissionForRequest(request.method, request.url)
      if (!permission) return

      request.staffPermission = permission
      await fastify.authenticate(request, reply)
      if (reply.sent) return

      if (!hasPermission(request.user, permission)) {
        return reply.code(403).send({
          success: false,
          message: '当前员工岗位无权访问此功能',
          code: 'STAFF_PERMISSION_DENIED'
        })
      }
    })

    // 已确认无当前页面/脚本消费者的旧生产入口保留源码但停止执行。
    // 权限校验先运行，因此未登录请求仍返回 401，不暴露内部历史能力。
    fastify.addHook('preHandler', async (request, reply) => {
      if (!isClosedLegacyProductionEndpoint(request.method, request.url)) return
      if (!request.user) {
        await fastify.authenticate(request, reply)
        if (reply.sent) return
      }
      return reply.code(410).send({
        success: false,
        code: 'LEGACY_ENDPOINT_CLOSED',
        message: '旧生产入口已关闭，请使用正式订单与生产工作流'
      })
    })

    // ── 审计日志 Hook ──
    fastify.addHook('onResponse', async (request, reply) => {
      const method = request.method
      const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      const isDenied = [401, 403].includes(reply.statusCode)
      if (!isMutation && !(request.staffPermission && isDenied)) return
      if (!request.user && !(request.staffPermission && isDenied)) return

      try {
        const operationAudit = request.operationAudit || null
        await fastify.prisma.operationLog.create({
          data: {
            userId:   request.user?.userId || 'anonymous',
            userRole: request.user?.role ?? 0,
            method,
            path:     request.url.split('?')[0],
            action:   operationAudit?.action || null,
            target:   operationAudit?.target || null,
            targetId: operationAudit?.targetId || null,
            before:   serializeSafeAuditBody(operationAudit?.before),
            ip:       request.ip || null,
            after:    serializeSafeAuditBody(operationAudit?.after ?? request.body),
            outcome:  auditOutcome(reply.statusCode),
            statusCode: reply.statusCode,
            sessionId: request.user?.sid || null,
            userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || null
          }
        })
      } catch(e) {
        fastify.log.warn('审计日志写入失败：' + e.message)
      }
    })

    // ── 账户系统 v1（双路由共存：旧 /api/auth 保留，新 /api/v1 新增）──
    await fastify.register(authV1Routes,         { prefix: '/api/v1/auth' })
    await fastify.register(userV1Routes,         { prefix: '/api/v1/user' })
    await fastify.register(accountRoutes,        { prefix: '/api/v1/account' })

    // ── 用户接口（旧版，保留向后兼容）──
    await fastify.register(authRoutes,           { prefix: '/api/auth' })
    await fastify.register(machineModelRoutes,   { prefix: '/api/machine-models' })
    await fastify.register(uploadRoutes,         { prefix: '/api/upload' })
    await fastify.register(customizeOrderRoutes, { prefix: '/api/customize-orders' })

    // ── 管理员接口 ──
    await fastify.register(adminRoutes,          { prefix: '/api/admin' })

    // ── 联名系统 ──
    await fastify.register(collabRoutes,         { prefix: '/api' })
    await fastify.register(adminCollabRoutes,    { prefix: '/api' })
    await fastify.register(inventoryRoutes,      { prefix: '/api/inventory' })

    fastify.get('/', async () => ({
      success: true, message: '哞屋 MOWO API 服务运行中 🐄'
    }))

    // ── 联络表单 ──
    await fastify.register(contactRoutes,        { prefix: '/api/contact' })
    await fastify.register(adminContactRoutes,   { prefix: '/api/admin/contact' })
    await fastify.register(adminCustomizationRequestRoutes, { prefix: '/api/admin/customization-requests' })

    // ── 购物车系统 ──
    await fastify.register(cartRoutes,           { prefix: '/api/cart' })
    await fastify.register(customProductRoutes,  { prefix: '/api/custom-products' })
    await fastify.register(animationAssetRoutes, { prefix: '/api/animation-assets' })
    await fastify.register(customizationRequestRoutes, { prefix: '/api/customization-requests' })
    await fastify.register(paymentRoutes,        { prefix: '/api/payment' })
    await fastify.register(addressRoutes,        { prefix: '/api/addresses' })
    await fastify.register(orderRoutes,          { prefix: '/api/orders' })
    await fastify.register(materialsRoutes,      { prefix: '/api/materials' })
    await fastify.register(framePacksRoutes,    { prefix: '/api/frame-packs' })
    await fastify.register(productionBatchRoutes, { prefix: '/api/admin/production-batches' })
    await fastify.register(productionWorkflowRoutes, { prefix: '/api/admin/production-workflow' })
    await fastify.register(printProductionRoutes, { prefix: '/api/admin/print-production' })
    await fastify.register(frameLibraryRoutes, { prefix: '/api/admin/frame-library' })
    await fastify.register(frameMakingRoutes, { prefix: '/api/admin/frame-making' })
    await fastify.register(frameImportRoutes, { prefix: '/api/admin/frame-imports' })

    await fastify.listen({ port: config.port, host: config.host })
    startScheduler(fastify)

  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
