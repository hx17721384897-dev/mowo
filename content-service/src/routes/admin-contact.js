// src/routes/admin-contact.js
// 管理员联络留言管理接口（role >= 2）

export default async function adminContactRoutes(fastify) {

  // ══════════════════════════════════════════
  // GET /api/admin/contact — 留言列表
  // query: page, limit, type, status, starred, keyword
  // starred=1 只看星标
  // ══════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { page = 1, limit = 20, type, status, starred, keyword } = request.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}

    if (type) where.type = type

    if (status === 'spam') {
      where.status = 'spam'
    } else if (status) {
      where.status = status
    } else {
      where.status = { not: 'spam' }
    }

    if (starred === '1') where.isStarred = true

    if (keyword) {
      where.OR = [
        { name:    { contains: keyword, mode: 'insensitive' } },
        { contact: { contains: keyword, mode: 'insensitive' } },
        { message: { contains: keyword, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      fastify.prisma.contactSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        select: {
          id: true, type: true, name: true, contact: true,
          message: true, extra: true, attachments: true,
          status: true, isStarred: true,
          spamScore: true, isBlocked: true,
          submitterUserId: true,
          handledBy: true, handledAt: true, note: true,
          ip: true, createdAt: true, updatedAt: true
        }
      }),
      fastify.prisma.contactSubmission.count({ where })
    ])

    return reply.send({
      success: true,
      data: {
        items: items.map(item => ({
          ...item,
          extra:       item.extra       ? JSON.parse(item.extra)       : null,
          attachments: item.attachments ? JSON.parse(item.attachments) : [],
        })),
        pagination: { page: parseInt(page), limit: parseInt(limit), total }
      }
    })
  })

  // ══════════════════════════════════════════
  // GET /api/admin/contact/stats
  // ══════════════════════════════════════════
  fastify.get('/stats', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const types    = ['artist', 'channel', 'media', 'join', 'feedback', 'factory']
    const statuses = ['pending', 'processing', 'done', 'spam']

    const [byType, byStatus, total, pendingTotal, starredTotal] = await Promise.all([
      Promise.all(types.map(t =>
        fastify.prisma.contactSubmission.count({ where: { type: t, status: { not: 'spam' } } })
          .then(count => ({ type: t, count }))
      )),
      Promise.all(statuses.map(s =>
        fastify.prisma.contactSubmission.count({ where: { status: s } })
          .then(count => ({ status: s, count }))
      )),
      fastify.prisma.contactSubmission.count({ where: { status: { not: 'spam' } } }),
      fastify.prisma.contactSubmission.count({ where: { status: 'pending' } }),
      fastify.prisma.contactSubmission.count({ where: { isStarred: true } })
    ])

    return reply.send({
      success: true,
      data: {
        total,
        pendingTotal,
        starredTotal,
        byType:   Object.fromEntries(byType.map(r   => [r.type,   r.count])),
        byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
      }
    })
  })

  // ══════════════════════════════════════════
  // GET /api/admin/contact/:id — 单条详情
  // ══════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { id } = request.params
    const item = await fastify.prisma.contactSubmission.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ success: false, message: '记录不存在' })

    let attachmentUrls = []
    try {
      const keys = item.attachments ? JSON.parse(item.attachments) : []
      attachmentUrls = keys.map(key => ({
        key,
        url:      fastify.oss.signatureUrl(key, { expires: 3600 }),
        filename: key.split('/').pop()
      }))
    } catch(e) {}

    return reply.send({
      success: true,
      data: {
        ...item,
        extra:          item.extra ? JSON.parse(item.extra) : null,
        attachments:    item.attachments ? JSON.parse(item.attachments) : [],
        attachmentUrls
      }
    })
  })

  // ══════════════════════════════════════════
  // PUT /api/admin/contact/:id/status
  // body: { status, note? }
  // ══════════════════════════════════════════
  fastify.put('/:id/status', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { id }           = request.params
    const { status, note } = request.body

    const validStatus = ['pending', 'processing', 'done', 'spam']
    if (!validStatus.includes(status))
      return reply.code(400).send({ success: false, message: '无效的状态值' })

    const item = await fastify.prisma.contactSubmission.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ success: false, message: '记录不存在' })

    const oldStatus = item.status
    const updated = await fastify.prisma.contactSubmission.update({
      where: { id },
      data: {
        status,
        note:      note !== undefined ? note : item.note,
        handledBy: request.user.userId,
        handledAt: new Date()
      }
    })

    const statusLabel = { pending:'待处理', processing:'处理中', done:'已处理', spam:'垃圾信息' }

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId:   request.user.userId,
          userRole: request.user.role ?? 0,
          method:   'PUT', path: request.url,
          action:   `将联络留言 [${item.type}] ${item.name} 状态从「${statusLabel[oldStatus]}」改为「${statusLabel[status]}」`,
          targetId: id,
          before:   JSON.stringify({ status: oldStatus }),
          after:    JSON.stringify({ status }),
          ip:       request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: '状态已更新', data: updated })
  })

  // ══════════════════════════════════════════
  // PUT /api/admin/contact/:id/star — 切换星标（独立于状态）
  // body: { isStarred: true | false }
  // ══════════════════════════════════════════
  fastify.put('/:id/star', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { id }        = request.params
    const { isStarred } = request.body

    if (typeof isStarred !== 'boolean')
      return reply.code(400).send({ success: false, message: 'isStarred 必须为布尔值' })

    const item = await fastify.prisma.contactSubmission.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ success: false, message: '记录不存在' })

    await fastify.prisma.contactSubmission.update({
      where: { id },
      data:  { isStarred }
    })

    return reply.send({
      success: true,
      message: isStarred ? '已加星标' : '已取消星标',
      data:    { isStarred }
    })
  })

  // ══════════════════════════════════════════
  // PUT /api/admin/contact/:id/note — 更新备注
  // ══════════════════════════════════════════
  fastify.put('/:id/note', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { id }   = request.params
    const { note } = request.body

    const item = await fastify.prisma.contactSubmission.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ success: false, message: '记录不存在' })

    await fastify.prisma.contactSubmission.update({
      where: { id },
      data:  { note, handledBy: request.user.userId }
    })

    return reply.send({ success: true, message: '备注已保存' })
  })

  // ══════════════════════════════════════════
  // DELETE /api/admin/contact/:id（仅超管）
  // ══════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requireRole(3)]
  }, async (request, reply) => {
    const { id } = request.params
    const item = await fastify.prisma.contactSubmission.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ success: false, message: '记录不存在' })

    await fastify.prisma.contactSubmission.delete({ where: { id } })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId:   request.user.userId,
          userRole: request.user.role ?? 0,
          method:   'DELETE', path: request.url,
          action:   `删除联络留言 [${item.type}] ${item.name}（${item.contact}）`,
          targetId: id,
          ip:       request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: '已删除' })
  })

  // ══════════════════════════════════════════
  // POST /api/admin/contact/ban-ip（超管）
  // ══════════════════════════════════════════
  fastify.post('/ban-ip', {
    preHandler: [fastify.requireRole(3)]
  }, async (request, reply) => {
    const { ip, reason } = request.body
    if (!ip) return reply.code(400).send({ success: false, message: 'IP不能为空' })

    const result = await fastify.prisma.contactSubmission.updateMany({
      where: { ip },
      data:  { isBlocked: true, status: 'spam' }
    })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId:   request.user.userId,
          userRole: request.user.role ?? 0,
          method:   'POST', path: request.url,
          action:   `手动封禁IP ${ip}，共影响 ${result.count} 条记录${reason ? '，原因：' + reason : ''}`,
          ip:       request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: `IP ${ip} 已封禁`, data: { affectedCount: result.count } })
  })

}
