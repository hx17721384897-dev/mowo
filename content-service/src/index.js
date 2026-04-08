import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

import prismaPlugin from './plugins/prisma.js'
import jwtPlugin from './plugins/jwt.js'
import ossPlugin from './plugins/oss.js'
import authRoutes from './routes/auth.js'
import articleRoutes from './routes/articles.js'
import userRoutes from './routes/users.js'
import certifyRoutes from './routes/certify.js'
import animationRoutes from './routes/animations.js'
import productRoutes from './routes/products.js'
import earningRoutes from './routes/earnings.js'
import feedRoutes from './routes/feed.js'
import machineModelRoutes from './routes/machine-models.js'
import uploadRoutes from './routes/upload.js'
import customizeOrderRoutes from './routes/customize-orders.js'
import adminRoutes from './routes/admin.js'
import collabRoutes from './routes/collab.js'
import adminCollabRoutes from './routes/admin-collab.js'
import creatorRoutes from './routes/creator.js'
import inventoryRoutes from './routes/inventory.js'
import multipart from '@fastify/multipart'
import contactRoutes      from './routes/contact.js'
import adminContactRoutes from './routes/admin-contact.js'
import settlementRoutes   from './routes/settlement.js'

const fastify = Fastify({ logger: true })

async function start() {
  try {
    await fastify.register(cors, {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    })
    await fastify.register(prismaPlugin)
    await fastify.register(jwtPlugin)
    await fastify.register(ossPlugin)
    await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
    // ── 审计日志 Hook ──
    // 拦截所有 POST/PUT/DELETE 请求，自动记录到 operation_logs 表
    // 只记录已登录用户的操作（有 token 的请求）
    fastify.addHook('onResponse', async (request, reply) => {
      const method = request.method
      if (!['POST', 'PUT', 'DELETE'].includes(method)) return
      if (!request.user) return  // 未登录的请求不记录

      try {
        await fastify.prisma.operationLog.create({
          data: {
            userId:   request.user.userId,
            userRole: request.user.role ?? 0,
            method,
            path:     request.url,
            ip:       request.ip || null,
            after:    request.body ? JSON.stringify(request.body).slice(0, 2000) : null
          }
        })
      } catch(e) {
        // 日志写入失败不影响主流程
        fastify.log.warn('审计日志写入失败：' + e.message)
      }
    })

    // ── 用户接口 ──
    await fastify.register(authRoutes,          { prefix: '/api/auth' })
    await fastify.register(articleRoutes,       { prefix: '/api/articles' })
    await fastify.register(userRoutes,          { prefix: '/api/users' })
    await fastify.register(certifyRoutes,       { prefix: '/api/certify' })
    await fastify.register(animationRoutes,     { prefix: '/api/animations' })
    await fastify.register(productRoutes,       { prefix: '/api/products' })
    await fastify.register(earningRoutes,       { prefix: '/api/earnings' })
    await fastify.register(feedRoutes,          { prefix: '/api/feed' })
    await fastify.register(machineModelRoutes,  { prefix: '/api/machine-models' })
    await fastify.register(uploadRoutes,        { prefix: '/api/upload' })
    await fastify.register(customizeOrderRoutes,{ prefix: '/api/customize-orders' })

    // ── 管理员接口（role >= 2） ──
    await fastify.register(adminRoutes,         { prefix: '/api/admin' })

    // ── 联名系统 ──
    await fastify.register(collabRoutes,        { prefix: '/api' })
    await fastify.register(adminCollabRoutes,   { prefix: '/api' })
    await fastify.register(creatorRoutes,       { prefix: '/api/creator' })
    await fastify.register(inventoryRoutes, { prefix: '/api/inventory' })
    fastify.get('/', async () => ({
      success: true, message: '哞屋 MOWO API 服务运行中 🐄'
    }))

    // ── 联络表单 ──
    await fastify.register(contactRoutes,      { prefix: '/api/contact' })
    await fastify.register(adminContactRoutes, { prefix: '/api/admin/contact' })

    // ── 分红结算系统 ──
    await fastify.register(settlementRoutes,    { prefix: '/api' })

    await fastify.listen({ port: 3001, host: '0.0.0.0' })

    
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
