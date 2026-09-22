// src/routes/contracts.js
// 大IP商务合同管理（仅合作运营权限）
//
//   GET  /api/admin/contracts              合同列表（分页/状态/类型筛选）
//   GET  /api/admin/contracts/:id          合同详情
//   POST /api/admin/contracts              新建合同
//   PUT  /api/admin/contracts/:id          编辑合同
//   PUT  /api/admin/contracts/:id/status   更新合同状态
//   POST /api/admin/contracts/:id/settle   录入一条打款记录
//   DELETE /api/admin/contracts/:id        删除合同（仅负责人）

import { PERMISSION } from '../lib/permissions.js'

export default async function contractsRoutes(fastify) {

  const requireCollab = fastify.requirePermission(PERMISSION.COLLAB)
  const requireCollabAdmin = fastify.requirePermission(PERMISSION.COLLAB_ADMIN)

  const CONTRACT_TYPE_LABELS = {
    revenue_share:   '纯分红',
    guarantee_plus:  '保底 + 分红',
    buyout:          '买断',
    custom:          '自定义'
  }

  const STATUS_LABELS = {
    active:     '生效中',
    expired:    '已到期',
    terminated: '已终止'
  }

  // ─────────────────────────────────────────
  // GET /api/admin/contracts
  // 合同列表
  // ─────────────────────────────────────────
  fastify.get('/admin/contracts', {
    preHandler: requireCollab,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:         { type: 'integer', minimum: 1, default: 1 },
          limit:        { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          status:       { type: 'string', enum: ['active','expired','terminated'] },
          contractType: { type: 'string' },
          keyword:      { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, status, contractType, keyword } = request.query
    const skip = (page - 1) * limit

    const where = {}
    if (status)       where.status       = status
    if (contractType) where.contractType = contractType
    if (keyword) {
      where.creatorName = { contains: keyword, mode: 'insensitive' }
    }

    const [contracts, total] = await Promise.all([
      fastify.prisma.creatorContract.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            select: {
              profile: { select: { nickname: true, avatarUrl: true } }
            }
          },
          createdByUser: {
            select: { profile: { select: { nickname: true } } }
          }
        }
      }),
      fastify.prisma.creatorContract.count({ where })
    ])

    return reply.send({
      success: true,
      data: {
        contracts: contracts.map(c => formatContract(c)),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/admin/contracts/:id
  // 合同详情
  // ─────────────────────────────────────────
  fastify.get('/admin/contracts/:id', {
    preHandler: requireCollab
  }, async (request, reply) => {
    const { id } = request.params

    const contract = await fastify.prisma.creatorContract.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            profile: { select: { nickname: true, avatarUrl: true } }
          }
        },
        createdByUser: {
          select: { profile: { select: { nickname: true } } }
        }
      }
    })

    if (!contract) return reply.code(404).send({ success: false, message: '合同不存在' })

    return reply.send({ success: true, data: formatContract(contract) })
  })

  // ─────────────────────────────────────────
  // POST /api/admin/contracts
  // 新建合同
  // ─────────────────────────────────────────
  fastify.post('/admin/contracts', {
    preHandler: requireCollab,
    schema: {
      body: {
        type: 'object',
        required: ['creatorName', 'contractType', 'startAt'],
        properties: {
          creatorId:       { type: 'string' },
          creatorName:     { type: 'string', minLength: 1, maxLength: 100 },
          contractType:    { type: 'string', enum: ['revenue_share','guarantee_plus','buyout','custom'] },
          revenueRate:     { type: 'number',  minimum: 0, maximum: 1 },
          guaranteeAmount: { type: 'number',  minimum: 0 },
          buyoutAmount:    { type: 'number',  minimum: 0 },
          startAt:         { type: 'string' },
          endAt:           { type: 'string' },
          terms:           { type: 'string' },
          note:            { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId: adminId } = request.user
    const {
      creatorId, creatorName, contractType,
      revenueRate, guaranteeAmount, buyoutAmount,
      startAt, endAt, terms, note
    } = request.body

    // 如果提供了 creatorId，验证该用户存在
    if (creatorId) {
      const user = await fastify.prisma.user.findUnique({ where: { id: creatorId } })
      if (!user) return reply.code(400).send({ success: false, message: '关联的创作者账号不存在' })
    }

    const contract = await fastify.prisma.creatorContract.create({
      data: {
        creatorId:       creatorId || null,
        creatorName,
        contractType,
        revenueRate:     revenueRate     ?? null,
        guaranteeAmount: guaranteeAmount ?? null,
        buyoutAmount:    buyoutAmount    ?? null,
        startAt:         new Date(startAt),
        endAt:           endAt ? new Date(endAt) : null,
        terms:           terms || null,
        note:            note  || null,
        status:          'active',
        settlementLogs:  JSON.stringify([]),
        createdBy:       adminId
      }
    })

    return reply.code(201).send({ success: true, data: formatContract(contract) })
  })

  // ─────────────────────────────────────────
  // PUT /api/admin/contracts/:id
  // 编辑合同基本信息
  // ─────────────────────────────────────────
  fastify.put('/admin/contracts/:id', {
    preHandler: requireCollab,
    schema: {
      body: {
        type: 'object',
        properties: {
          creatorName:     { type: 'string', maxLength: 100 },
          contractType:    { type: 'string', enum: ['revenue_share','guarantee_plus','buyout','custom'] },
          revenueRate:     { type: 'number',  minimum: 0, maximum: 1 },
          guaranteeAmount: { type: 'number',  minimum: 0 },
          buyoutAmount:    { type: 'number',  minimum: 0 },
          startAt:         { type: 'string' },
          endAt:           { type: 'string' },
          terms:           { type: 'string' },
          note:            { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const body   = request.body

    const contract = await fastify.prisma.creatorContract.findUnique({ where: { id } })
    if (!contract) return reply.code(404).send({ success: false, message: '合同不存在' })

    const updateData = {}
    if (body.creatorName     !== undefined) updateData.creatorName     = body.creatorName
    if (body.contractType    !== undefined) updateData.contractType    = body.contractType
    if (body.revenueRate     !== undefined) updateData.revenueRate     = body.revenueRate
    if (body.guaranteeAmount !== undefined) updateData.guaranteeAmount = body.guaranteeAmount
    if (body.buyoutAmount    !== undefined) updateData.buyoutAmount    = body.buyoutAmount
    if (body.startAt         !== undefined) updateData.startAt         = new Date(body.startAt)
    if (body.endAt           !== undefined) updateData.endAt           = body.endAt ? new Date(body.endAt) : null
    if (body.terms           !== undefined) updateData.terms           = body.terms
    if (body.note            !== undefined) updateData.note            = body.note

    const updated = await fastify.prisma.creatorContract.update({ where: { id }, data: updateData })
    return reply.send({ success: true, data: formatContract(updated) })
  })

  // ─────────────────────────────────────────
  // PUT /api/admin/contracts/:id/status
  // 更新合同状态（生效/到期/终止）
  // ─────────────────────────────────────────
  fastify.put('/admin/contracts/:id/status', {
    preHandler: requireCollab,
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['active','expired','terminated'] },
          note:   { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const { id }     = request.params
    const { status, note } = request.body

    const contract = await fastify.prisma.creatorContract.findUnique({ where: { id } })
    if (!contract) return reply.code(404).send({ success: false, message: '合同不存在' })

    const updateData = { status }
    if (note) {
      // 把状态变更备注追加到 note 字段
      const existing = contract.note || ''
      const ts = new Date().toLocaleDateString('zh-CN')
      updateData.note = existing
        ? existing + '\n' + ts + ' 状态变更为「' + STATUS_LABELS[status] + '」：' + note
        : ts + ' 状态变更为「' + STATUS_LABELS[status] + '」：' + note
    }

    await fastify.prisma.creatorContract.update({ where: { id }, data: updateData })
    return reply.send({ success: true, message: '状态已更新为「' + STATUS_LABELS[status] + '」' })
  })

  // ─────────────────────────────────────────
  // POST /api/admin/contracts/:id/settle
  // 录入一条打款记录
  // body: { amount, note, settledAt }
  // ─────────────────────────────────────────
  fastify.post('/admin/contracts/:id/settle', {
    preHandler: requireCollab,
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount:    { type: 'number', minimum: 0 },
          note:      { type: 'string', maxLength: 200 },
          settledAt: { type: 'string' },
          clientRequestId: { type: 'string', minLength: 1, maxLength: 80 }
        }
      }
    }
  }, async (request, reply) => {
    const { id }              = request.params
    const { amount, note, settledAt, clientRequestId } = request.body
    const { userId: adminId } = request.user

    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ success: false, message: '打款金额必须大于零' })
    // 合同记录用同一提交键重试；CAS 避免两个并发请求覆盖或重复追加 JSON 日志。
    for (let attempt = 0; attempt < 5; attempt++) {
      const contract = await fastify.prisma.creatorContract.findUnique({ where: { id }, select: { settlementLogs: true } })
      if (!contract) return reply.code(404).send({ success: false, message: '合同不存在' })
      let logs
      try { logs = JSON.parse(contract.settlementLogs || '[]') } catch { return reply.code(409).send({ success: false, message: '历史打款记录格式异常，请联系管理员' }) }
      if (!Array.isArray(logs)) return reply.code(409).send({ success: false, message: '历史打款记录格式异常，请联系管理员' })
      const existing = clientRequestId && logs.find(row => row.clientRequestId === clientRequestId)
      if (existing) {
        if (Number(existing.amount) !== amount || String(existing.note || '') !== String(note || '')) {
          return reply.code(409).send({ success: false, message: '提交键已用于其他打款记录' })
        }
        const totalPaid = logs.reduce((sum, row) => sum + Number(row.amount || 0), 0)
        return reply.send({ success: true, message: '打款记录已录入', data: { logCount: logs.length, totalPaid: +totalPaid.toFixed(2) } })
      }
      const next = [...logs, {
        id: crypto.randomUUID(), amount, note: note || '', settledAt: settledAt || new Date().toISOString(),
        recordedBy: adminId, recordedAt: new Date().toISOString(), ...(clientRequestId ? { clientRequestId } : {}),
      }]
      const result = await fastify.prisma.creatorContract.updateMany({
        where: { id, settlementLogs: contract.settlementLogs },
        data: { settlementLogs: JSON.stringify(next) },
      })
      if (result.count === 1) {
        const totalPaid = next.reduce((sum, row) => sum + Number(row.amount || 0), 0)
        return reply.send({ success: true, message: '打款记录已录入', data: { logCount: next.length, totalPaid: +totalPaid.toFixed(2) } })
      }
    }
    return reply.code(409).send({ success: false, message: '打款记录正在更新，请使用原提交键重试' })
  })

  // ─────────────────────────────────────────
  // DELETE /api/admin/contracts/:id
  // 删除合同（仅超管）
  // ─────────────────────────────────────────
  fastify.delete('/admin/contracts/:id', {
    preHandler: requireCollabAdmin
  }, async (request, reply) => {
    const { id } = request.params

    const contract = await fastify.prisma.creatorContract.findUnique({ where: { id } })
    if (!contract) return reply.code(404).send({ success: false, message: '合同不存在' })

    await fastify.prisma.creatorContract.delete({ where: { id } })
    return reply.send({ success: true, message: '合同已删除' })
  })

  // ── 格式化辅助函数 ──
  function formatContract(c) {
    let settlementLogs = []
    try { settlementLogs = JSON.parse(c.settlementLogs || '[]') } catch(e) {}
    const totalPaid = settlementLogs.reduce((s, l) => s + (l.amount || 0), 0)

    return {
      id:              c.id,
      creatorId:       c.creatorId,
      creatorName:     c.creatorName,
      creatorNickname: c.creator?.profile?.nickname || null,
      creatorAvatar:   c.creator?.profile?.avatarUrl || null,
      contractType:    c.contractType,
      contractTypeLabel: CONTRACT_TYPE_LABELS[c.contractType] || c.contractType,
      revenueRate:     c.revenueRate,
      guaranteeAmount: c.guaranteeAmount,
      buyoutAmount:    c.buyoutAmount,
      startAt:         c.startAt,
      endAt:           c.endAt,
      terms:           c.terms,
      status:          c.status,
      statusLabel:     STATUS_LABELS[c.status] || c.status,
      settlementLogs,
      totalPaid:       +totalPaid.toFixed(2),
      note:            c.note,
      createdBy:       c.createdByUser?.profile?.nickname || null,
      createdAt:       c.createdAt,
      updatedAt:       c.updatedAt
    }
  }
}
