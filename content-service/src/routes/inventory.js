// src/routes/inventory.js
// 库存管理接口（v2：4态库存 + 三级预警 + 渠道配额 + 快照查询）

import {
  manualAdjust,
  calcAvailable,
  getInventoryWithAlert,
  makeIdempotencyKey
} from '../lib/inventory.js'

export default async function inventoryRoutes(fastify) {

  // ─────────────────────────────────────────────
  // 管理员接口（role >= 2）
  // ─────────────────────────────────────────────

  // GET /api/inventory
  // 所有SKU库存列表（含款式/SKU信息 + 4态库存 + 三级预警）
  fastify.get('/', { preHandler: requireAdmin }, async (req, reply) => {
    const inventories = await fastify.prisma.skuInventory.findMany({
      orderBy: { createdAt: 'asc' }
    })

    const skuIds  = inventories.map(i => i.skuId)
    const skus    = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const skuMap  = Object.fromEntries(skus.map(s => [s.id, s]))
    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models  = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    // 批量查近30天出货量（用于预警计算）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const deductAggs = await fastify.prisma.inventoryLog.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds }, type: 'wip_deduct', createdAt: { gte: thirtyDaysAgo } },
      _sum: { quantity: true }
    })
    const deductMap = Object.fromEntries(deductAggs.map(a => [a.skuId, a._sum.quantity || 0]))

    const result = inventories.map(inv => {
      const sku       = skuMap[inv.skuId] ?? {}
      const skuSpec   = sku.size
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : '—'
      const available = calcAvailable(inv)
      const dailySales = (deductMap[inv.skuId] || 0) / 30
      const effectiveDailySales = dailySales * (inv.safetyFactor || 1.0)

      let alertLevel = 'OK'
      if (effectiveDailySales > 0) {
        const daysLeft = available / effectiveDailySales
        if (daysLeft < 7)  alertLevel = 'CRITICAL'
        else if (daysLeft < 14) alertLevel = 'WARNING'
        else if (daysLeft < 30) alertLevel = 'SUGGEST'
      } else if (available <= inv.safetyStock) {
        alertLevel = 'WARNING'  // 无销量时仍按安全库存线判断
      }

      return {
        ...inv,
        skuName:        skuSpec,
        skuCode:        sku.skuCode    ?? null,
        skuBarcode:     sku.skuBarcode ?? null,
        skuType:        sku.skuType ?? 'KIT',
        licenseStatus:  sku.licenseStatus ?? null,
        licenseExpireDate: sku.licenseExpireDate ?? null,
        modelName:      modelMap[sku.modelId] ?? '—',
        size:           sku.size       ?? '',
        material:       sku.material   ?? '',
        frameCount:     sku.frameCount ?? '',
        colorName:      sku.colorName  ?? '',
        colorHex:       sku.colorHex   ?? '',
        availableQty:   available,
        // 兼容旧字段名
        availableStock: available,
        isLow:          alertLevel !== 'OK',
        alertLevel,
        dailySales:     Math.round(dailySales * 10) / 10,
      }
    })

    return reply.send({ success: true, data: result })
  })

  // GET /api/inventory/:skuId
  // 单个SKU库存详情 + 最近100条变动记录
  fastify.get('/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const invData = await getInventoryWithAlert(fastify.prisma, skuId)
    if (!invData) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const logs = await fastify.prisma.inventoryLog.findMany({
      where: { skuId },
      orderBy: { createdAt: 'desc' },
      take: 100
    })

    return reply.send({
      success: true,
      data: {
        ...invData,
        availableStock: invData.availableQty,
        logs
      }
    })
  })

  // POST /api/inventory/:skuId/restock
  // 手动盘点入库（通过 InventoryService 保证幂等 + 审计日志）
  // Body: { quantity, note?, reason? }
  fastify.post('/:skuId/restock', { preHandler: requireProduction }, async (req, reply) => {
    const { skuId }          = req.params
    const { quantity, note, reason } = req.body
    const operatorId         = req.user.userId
    const userRole           = req.user.role ?? 0

    if (!quantity || quantity === 0)
      return reply.code(400).send({ success: false, message: '数量不能为0' })
    if (userRole < 2 && quantity < 0)
      return reply.code(403).send({ success: false, message: '生产端只能录入正数' })

    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })
    if (quantity < 0 && inv.currentStock + quantity < 0)
      return reply.code(400).send({ success: false, message: `调减数量超出当前库存（当前：${inv.currentStock}）` })

    const idempotencyKey = makeIdempotencyKey('restock', skuId, operatorId)
    const adjustReason   = reason || note || (quantity > 0 ? '手动入库' : '手动调减')

    try {
      await manualAdjust(fastify.prisma, skuId, quantity, adjustReason, operatorId, idempotencyKey)
    } catch (err) {
      return reply.code(400).send({ success: false, message: err.message })
    }

    const updated = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    const actionWord = quantity > 0 ? `入库 ${quantity} 个` : `调减 ${Math.abs(quantity)} 个`
    return reply.send({
      success: true,
      message: `✓ 已${actionWord}，当前库存 ${updated.currentStock}`,
      data:    { ...updated, availableQty: calcAvailable(updated) }
    })
  })

  // PUT /api/inventory/:skuId/settings
  // 修改预警设置 + 流量因子
  // Body: { safetyStock?, maxOrderLimit?, safetyFactor? }
  fastify.put('/:skuId/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { safetyStock, maxOrderLimit, safetyFactor } = req.body

    const inv = await fastify.prisma.skuInventory.findUnique({ where: { skuId } })
    if (!inv) return reply.code(404).send({ success: false, message: '库存记录不存在' })

    const data = {}
    if (safetyStock   !== undefined) data.safetyStock   = safetyStock
    if (maxOrderLimit !== undefined) data.maxOrderLimit = maxOrderLimit
    if (safetyFactor  !== undefined) data.safetyFactor  = safetyFactor

    const updated = await fastify.prisma.skuInventory.update({ where: { skuId }, data })
    return reply.send({ success: true, data: { ...updated, availableQty: calcAvailable(updated) } })
  })

  // GET /api/inventory/logs — 全局变动记录（管理员）
  fastify.get('/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = 1, limit = 50, skuId, type } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (skuId) where.skuId = skuId
    if (type)  where.type  = type

    const [logs, total] = await Promise.all([
      fastify.prisma.inventoryLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit) }),
      fastify.prisma.inventoryLog.count({ where })
    ])

    const skuIds   = [...new Set(logs.map(l => l.skuId))]
    const skus     = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const modelIds = [...new Set(skus.map(s => s.modelId))]
    const models   = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const skuMap   = Object.fromEntries(skus.map(s => [s.id, s]))
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = logs.map(l => {
      const sku  = skuMap[l.skuId] ?? {}
      const spec = sku.size
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : '—'
      return { ...l, skuSpec: spec, modelName: modelMap[sku.modelId] ?? '—' }
    })

    return reply.send({ success: true, data: { logs: result, total, page: parseInt(page), limit: parseInt(limit) } })
  })

  // GET /api/inventory/snapshots — 历史快照（管理员）
  // Query: ?date=2026-04-14 or ?skuId=xxx&page=1
  fastify.get('/snapshots', { preHandler: requireAdmin }, async (req, reply) => {
    const { date, skuId, page = 1, limit = 50 } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (skuId) where.skuId = skuId
    if (date) {
      const d = new Date(date)
      const dNext = new Date(d)
      dNext.setDate(dNext.getDate() + 1)
      where.snapshotDate = { gte: d, lt: dNext }
    }

    const [snapshots, total] = await Promise.all([
      fastify.prisma.inventorySnapshot.findMany({ where, orderBy: { snapshotDate: 'desc' }, skip, take: parseInt(limit) }),
      fastify.prisma.inventorySnapshot.count({ where })
    ])

    return reply.send({ success: true, data: { snapshots, total, page: parseInt(page) } })
  })

  // GET /api/inventory/channel-quotas — 查看渠道配额建议
  fastify.get('/channel-quotas', { preHandler: requireAdmin }, async (req, reply) => {
    const inventories = await fastify.prisma.skuInventory.findMany()
    const quotas      = await fastify.prisma.channelQuota.findMany()
    const quotaMap    = Object.fromEntries(quotas.map(q => [q.skuId, q]))

    const skuIds = inventories.map(i => i.skuId)
    const skus   = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const skuMap = Object.fromEntries(skus.map(s => [s.id, s]))

    const modelIds = [...new Set(skus.map(s => s.modelId).filter(Boolean))]
    const models   = await fastify.prisma.machineModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]))

    const result = inventories.map(inv => {
      const available = calcAvailable(inv)
      const quota     = quotaMap[inv.skuId]
      const buffer    = quota?.bufferPool ?? 10
      const allocatable = Math.max(0, available - buffer)

      const sku  = skuMap[inv.skuId]
      const spec = sku
        ? [sku.size, sku.material, sku.frameCount ? `${sku.frameCount}帧` : '', sku.colorName].filter(Boolean).join(' · ')
        : ''

      return {
        skuId:         inv.skuId,
        skuCode:       sku?.skuCode   ?? null,
        modelName:     sku ? (modelMap[sku.modelId] ?? '—') : '—',
        skuSpec:       spec,
        available,
        bufferPool:    buffer,
        allocatable,
        suggestTaobao: Math.floor(allocatable * 0.35),
        suggestDouyin: Math.floor(allocatable * 0.35),
        suggestXhs:    Math.floor(allocatable * 0.30),
        taobaoQty:     quota?.taobaoQty ?? 0,
        douyinQty:     quota?.douyinQty ?? 0,
        xhsQty:        quota?.xhsQty ?? 0,
        livestreamMode: quota?.livestreamMode ?? false,
      }
    })

    return reply.send({ success: true, data: result })
  })

  // PUT /api/inventory/channel-quotas/:skuId — 更新渠道配额
  fastify.put('/channel-quotas/:skuId', { preHandler: requireAdmin }, async (req, reply) => {
    const { skuId } = req.params
    const { taobaoQty, douyinQty, xhsQty, bufferPool, livestreamMode } = req.body

    const data = {}
    if (taobaoQty     !== undefined) data.taobaoQty     = taobaoQty
    if (douyinQty     !== undefined) data.douyinQty     = douyinQty
    if (xhsQty        !== undefined) data.xhsQty        = xhsQty
    if (bufferPool    !== undefined) data.bufferPool    = bufferPool
    if (livestreamMode !== undefined) data.livestreamMode = livestreamMode

    const updated = await fastify.prisma.channelQuota.upsert({
      where:  { skuId },
      create: { skuId, ...data },
      update: data
    })
    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────
  // 生产端扫码发货（role >= 1）
  // ─────────────────────────────────────────────

  // POST /api/inventory/ship
  // 扫码发货：订单码 + SKU条形码 + 快递单号
  fastify.post('/ship', { preHandler: requireProduction }, async (req, reply) => {
    const { orderNo, skuBarcode, trackingNo, trackingCompany } = req.body
    const operatorId = req.user.userId

    if (!orderNo)         return reply.code(400).send({ success: false, message: '缺少订单号' })
    if (!skuBarcode)      return reply.code(400).send({ success: false, message: '缺少SKU条形码' })
    if (!trackingNo)      return reply.code(400).send({ success: false, message: '缺少快递单号' })
    if (!trackingCompany) return reply.code(400).send({ success: false, message: '缺少快递公司' })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { orderNo } })
    if (!order) return reply.code(404).send({ success: false, message: `订单号 ${orderNo} 不存在` })
    if (order.status === 'shipped') return reply.code(400).send({ success: false, message: '该订单已发货' })
    if (!['paid', 'producing', 'done'].includes(order.status))
      return reply.code(400).send({ success: false, message: `订单状态「${order.status}」不可发货` })

    const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuBarcode } })
    if (!sku) return reply.code(404).send({ success: false, message: `SKU条形码 ${skuBarcode} 不存在` })
    if (sku.id !== order.skuId) return reply.code(400).send({ success: false, message: 'SKU不匹配，请检查材料包是否正确' })

    // 生成正版验证码：{年2位}{随机6位大写}{校验字母}
    const year      = new Date().getFullYear().toString().slice(2)
    const random    = Math.random().toString(36).slice(2, 8).toUpperCase()
    const checkChar = String.fromCharCode(65 + (orderNo.length + sku.id.length) % 26)
    const authCode  = `${year}${random}${checkChar}`

    await fastify.prisma.$transaction([
      fastify.prisma.customizeOrder.update({
        where: { orderNo },
        data:  { status: 'shipped', trackingNo, trackingCompany }
      }),
      fastify.prisma.inventoryLog.create({
        data: {
          skuId: sku.id, type: 'out', quantity: 1,
          orderId: order.id, operatorId,
          note: `发货：订单${orderNo}，${trackingCompany} ${trackingNo}`
        }
      }),
      fastify.prisma.authCode.create({
        data: { code: authCode, orderId: order.id, skuId: sku.id, issuedAt: new Date() }
      })
    ])

    // 自动扣减绑定材料（若 materialsRoutes 已注册则调用）
    if (fastify.deductMaterialsForSku) {
      fastify.deductMaterialsForSku(sku.id, order.id, operatorId).catch(() => {})
    }

    return reply.send({ success: true, message: '✓ 发货成功', data: { orderNo, trackingNo, trackingCompany, authCode } })
  })

  // ─────────────────────────────────────────────
  // 公开接口（无需登录）
  // ─────────────────────────────────────────────

  // GET /api/inventory/verify/:code — 正版验证
  fastify.get('/verify/:code', async (req, reply) => {
    const { code } = req.params

    const auth = await fastify.prisma.authCode.findUnique({ where: { code } })
    if (!auth) {
      return reply.send({ success: true, data: { valid: false, message: '未找到此验证码，请确认是否为正版哞屋动画机' } })
    }

    await fastify.prisma.authCode.update({
      where: { code },
      data:  { queriedCount: { increment: 1 }, lastQueriedAt: new Date() }
    })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { id: auth.orderId } })
    const sku   = await fastify.prisma.machineModelSku.findUnique({ where: { id: auth.skuId } })
    const model = sku ? await fastify.prisma.machineModel.findUnique({ where: { id: sku.modelId }, select: { name: true } }) : null

    return reply.send({
      success: true,
      data: {
        valid: true, code,
        issuedAt:     auth.issuedAt,
        modelName:    model?.name   ?? '—',
        size:         sku?.size     ?? '—',
        material:     sku?.material ?? '—',
        shippedAt:    order?.updatedAt ?? null,
        queriedCount: auth.queriedCount,
      }
    })
  })

  // ─────────────────────────────────────────────
  // 辅助函数
  // ─────────────────────────────────────────────

  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || (user.role ?? user.certifyStatus) < 2 && !user.role)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }

  function requireProduction(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || user.role < 1)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }
}
