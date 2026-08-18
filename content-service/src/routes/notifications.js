// src/routes/notifications.js
// 创作者通知系统
// 注册前缀：/api/creator（与 creator.js 同前缀，但独立文件）

export default async function notificationsRoutes(fastify) {
  const { prisma } = fastify

  async function requireCreator(req, reply) {
    const active = await fastify.authenticate(req, reply)
    if (!active) return
    if (req.user.role < 1 || req.user.certifyStatus !== 2) {
      return reply.code(403).send({ success: false, message: '权限不足，需要创作者身份' })
    }
  }

  // ── GET /api/creator/notifications/unread-count ──
  // ⚠️ 必须在 /:id 路由之前注册
  fastify.get('/notifications/unread-count', {
    preHandler: [requireCreator]
  }, async (req, reply) => {
    const count = await prisma.creatorNotification.count({
      where: { userId: req.user.userId, isRead: false }
    })
    return reply.send({ success: true, data: { count } })
  })

  // ── POST /api/creator/notifications/read-all ──
  fastify.post('/notifications/read-all', {
    preHandler: [requireCreator]
  }, async (req, reply) => {
    await prisma.creatorNotification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data:  { isRead: true }
    })
    return reply.send({ success: true, message: '已全部标记已读' })
  })

  // ── GET /api/creator/notifications ──
  fastify.get('/notifications', {
    preHandler: [requireCreator]
  }, async (req, reply) => {
    const page   = Math.max(1, Number(req.query.page  || 1))
    const limit  = Math.min(50, Math.max(1, Number(req.query.limit || 20)))
    const skip   = (page - 1) * limit
    const where  = { userId: req.user.userId }
    if (req.query.unread === 'true') where.isRead = false

    const [notifications, total] = await Promise.all([
      prisma.creatorNotification.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' }
      }),
      prisma.creatorNotification.count({ where })
    ])

    return reply.send({ success: true, data: { notifications, total, page, limit } })
  })

  // ── POST /api/creator/notifications/:id/read ──
  fastify.post('/notifications/:id/read', {
    preHandler: [requireCreator]
  }, async (req, reply) => {
    const notif = await prisma.creatorNotification.findFirst({
      where: { id: req.params.id, userId: req.user.userId }
    })
    if (!notif) return reply.code(404).send({ success: false, message: '通知不存在' })
    await prisma.creatorNotification.update({
      where: { id: req.params.id },
      data:  { isRead: true }
    })
    return reply.send({ success: true })
  })
}
