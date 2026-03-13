// src/plugins/prisma.js
// 把 Prisma 客户端做成 Fastify 插件
// 整个应用只初始化一次数据库连接，所有路由通过 fastify.prisma 使用

import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'

async function prismaPlugin(fastify) {
  const prisma = new PrismaClient()

  // 启动时连接数据库
  await prisma.$connect()
  fastify.log.info('数据库连接成功')

  // 把 prisma 挂载到 fastify 实例上，所有路由都能用 fastify.prisma
  fastify.decorate('prisma', prisma)

  // 应用关闭时断开数据库连接，防止连接泄漏
  fastify.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect()
  })
}

export default fp(prismaPlugin)