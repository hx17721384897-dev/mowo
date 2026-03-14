// src/index.js
// 应用入口，组装所有插件和路由，启动服务器

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

import prismaPlugin from './plugins/prisma.js'
import jwtPlugin from './plugins/jwt.js'
import authRoutes from './routes/auth.js'
import articleRoutes from './routes/articles.js'
import userRoutes from './routes/users.js'
import certifyRoutes from './routes/certify.js'
import animationRoutes from './routes/animations.js'
import productRoutes from './routes/products.js'
import earningRoutes from './routes/earnings.js'
import feedRoutes from './routes/feed.js'

// 创建 Fastify 实例
// logger: true 会在终端打印每次请求的日志，方便开发调试
const fastify = Fastify({ logger: true })

async function start() {
  try {
    // 注册 CORS 插件
    // 允许前端页面跨域请求，origin: '*' 表示允许所有来源
    // 上线后改成你们的实际域名，如 'https://mowobox.com'
    await fastify.register(cors, { origin: '*' })

    // 注册数据库插件（必须在路由之前）
    await fastify.register(prismaPlugin)

    // 注册 JWT 插件（必须在路由之前）
    await fastify.register(jwtPlugin)

    // 注册路由，所有 auth 接口都挂载在 /api/auth 前缀下
    // 例如：register → POST /api/auth/register
    //        login    → POST /api/auth/login
    //        me       → GET  /api/auth/me
    await fastify.register(authRoutes, { prefix: '/api/auth' })
    await fastify.register(articleRoutes, { prefix: '/api/articles' })
    await fastify.register(userRoutes, { prefix: '/api/users' })
    await fastify.register(certifyRoutes, { prefix: '/api/certify' })
    await fastify.register(animationRoutes, { prefix: '/api/animations' })
    await fastify.register(productRoutes, { prefix: '/api/products' })
    await fastify.register(earningRoutes, { prefix: '/api/earnings' })
    await fastify.register(feedRoutes, { prefix: '/api/feed' })


    
    // 根路径健康检查，用来确认服务是否正常运行
    fastify.get('/', async () => {
      return { success: true, message: '哞屋 MOWO API 服务运行中 🐄' }
    })

    // 启动服务器，监听 3001 端口
    // host: '0.0.0.0' 表示允许局域网内其他设备访问，方便手机测试
    await fastify.listen({ port: 3001, host: '0.0.0.0' })

  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()