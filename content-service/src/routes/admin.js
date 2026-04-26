// src/routes/admin.js
// 管理员后台接口（role >= 2）

import archiver from 'archiver'
import https    from 'https'
import http     from 'http'
import bwipjs   from 'bwip-js'
import crypto   from 'crypto'
import { Document, Packer, Paragraph, Table, TableRow, TableCell,
         ImageRun, AlignmentType, WidthType, BorderStyle,
         VerticalAlign, TextRun, ShadingType } from 'docx'
import { startWipFrame, makeIdempotencyKey } from '../lib/inventory.js'

export default async function adminRoutes(fastify) {

  // ── 辅助函数：订单确认收货时处理联名分红 ──
  // 在 adminRoutes 函数内部定义，供状态更新接口调用
  async function handleReceivedOrder(tx, order) {
    // 只处理联名订单
    if (order.sourceType !== 'collab' || !order.collabWorkId) return

    // 查联名作品信息（获取分红率）
    const collabWork = await tx.collabWork.findUnique({
      where: { id: order.collabWorkId },
      select: { id: true, creatorId: true, revenueRate: true, status: true }
    })
    if (!collabWork || collabWork.status !== 'approved') return

    // 防重复：检查该订单是否已有 collab_order 记录
    const existing = await tx.collabOrder.findFirst({
      where: { orderId: order.id }
    })
    if (existing) return

    // 计算分红金额
    // salePrice 用 SKU 价格，如果取不到就用0（后续完善）
    const sku = order.skuId ? await tx.machineModelSku.findUnique({
      where: { id: order.skuId },
      select: { price: true }
    }) : null
    const salePrice     = sku ? Number(sku.price) : 0
    const revenueRate   = collabWork.revenueRate || 0
    const revenueAmount = +(salePrice * revenueRate).toFixed(4)
    const reserveRate   = 0.15
    const reserveAmount = +(revenueAmount * reserveRate).toFixed(4)
    const payoutAmount  = +(revenueAmount - reserveAmount).toFixed(4)
    const coolingEndAt  = new Date(Date.now() + 15 * 24 * 3600 * 1000) // 15天后
    const now           = new Date()

    // 1. 创建 collab_order 记录，状态为冷却中
    const collabOrder = await tx.collabOrder.create({
      data: {
        orderId:         order.id,
        collabWorkId:    order.collabWorkId,
        creatorId:       collabWork.creatorId,
        salePrice,
        revenueRate,
        revenueAmount,
        reserveRate,
        reserveAmount,
        payoutAmount,
        revenueStatus:   'cooling',   // 确认收货 → 冷却中
        coolingEndAt,
        settlementStatus: 'pending'
      }
    })

    // 2. 写储备金扣入记录
    // upsert creator_reserve（如果没有则自动创建）
    const reserve = await tx.creatorReserve.upsert({
      where:  { creatorId: collabWork.creatorId },
      create: {
        creatorId:        collabWork.creatorId,
        totalReserved:    reserveAmount,
        frozenAmount:     0,
        releasableAmount: reserveAmount,
        releasedAmount:   0,
        nextReleaseAt:    new Date(coolingEndAt.getTime() + 75 * 24 * 3600 * 1000), // 冷却15天+储备金90天
        nextReleaseAmount: reserveAmount
      },
      update: {
        totalReserved:    { increment: reserveAmount },
        releasableAmount: { increment: reserveAmount }
      }
    })

    // 写储备金流水
    if (reserveAmount > 0) {
      await tx.reserveLog.create({
        data: {
          creatorId:     collabWork.creatorId,
          reserveId:     reserve.id,
          collabOrderId: collabOrder.id,
          actionType:    'deduct',
          amount:        reserveAmount,
          balanceAfter:  reserve.releasableAmount,
          releaseAt:     new Date(coolingEndAt.getTime() + 75 * 24 * 3600 * 1000), // 收货+90天解冻
          note:          `订单 ${order.orderNo} 联名分红储备金`
        }
      })
    }
  }

  // GET /api/admin/stats — 订单统计
  fastify.get('/stats', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const [pending, paid, locked, processing, producing, shipped, received, aftersale, total] = await Promise.all([
      fastify.prisma.customizeOrder.count({ where: { status: 'pending' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'paid' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'locked' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'processing' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'producing' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'shipped' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'received' } }),
      fastify.prisma.customizeOrder.count({ where: { status: 'aftersale' } }),
      fastify.prisma.customizeOrder.count()
    ])
    return reply.send({ success: true, data: { pending, paid, locked, processing, producing, shipped, received, aftersale, total } })
  })

  // GET /api/admin/orders — 订单列表（支持 batchId 过滤）
  fastify.get('/orders', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { page = 1, limit = 20, status, batchId } = request.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = {}
    if (status)  where.status  = status
    if (batchId) where.batchId = batchId

    const [orders, total] = await Promise.all([
      fastify.prisma.customizeOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit),
        include: { user: { select: { id: true, phone: true, profile: { select: { nickname: true } } } } }
      }),
      fastify.prisma.customizeOrder.count({ where })
    ])

    return reply.send({
      success: true,
      data: {
        orders: orders.map(o => ({
          ...o,
          frameUrls: JSON.parse(o.frameUrls || '[]'),
          userName: o.user?.profile?.nickname || o.user?.phone || '未知用户'
        })),
        pagination: { page: parseInt(page), limit: parseInt(limit), total }
      }
    })
  })

  // GET /api/admin/orders/:orderNo — 订单详情（含预签名下载链接）
  fastify.get('/orders/:orderNo', {
    preHandler: [fastify.requireRole(1)]
  }, async (request, reply) => {
    const { orderNo } = request.params
    const order = await fastify.prisma.customizeOrder.findUnique({
      where: { orderNo },
      include: { user: { select: { id: true, phone: true, profile: { select: { nickname: true } } } } }
    })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const frameKeys    = JSON.parse(order.frameUrls || '[]')
    const downloadUrls = frameKeys.map(key => ({
      key, url: fastify.oss.signatureUrl(key, { expires: 3600 })
    }))

    return reply.send({
      success: true,
      data: {
        ...order, frameUrls: frameKeys, downloadUrls,
        userName: order.user?.profile?.nickname || order.user?.phone || '未知用户'
      }
    })
  })

  // GET /api/admin/orders/:orderNo/download-zip — 打包下载完整图纸包
  fastify.get('/orders/:orderNo/download-zip', {
    preHandler: [fastify.requireRole(1)]
  }, async (request, reply) => {
    const { orderNo } = request.params
    const order = await fastify.prisma.customizeOrder.findUnique({
      where: { orderNo },
      include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
    })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const frameKeys = JSON.parse(order.frameUrls || '[]')
    if (!frameKeys.length) return reply.code(400).send({ success: false, message: '该订单暂无帧图片' })

    // SKU编码规则：MOWO-{尺寸}-{帧数}F-{材质缩写}-{颜色缩写}
    const matCode   = { '椴木板':'BASS', '亚克力':'ACRY', '铝合金':'ALUM' }[order.material] || 'UNKN'
    const colCode   = { '原色':'NAT', '胡桃棕':'WAL', '透明':'CLR', '哑光黑':'BLK' }[order.colorName] || 'NAT'
    const sizeCode  = order.size.replace('x','x').replace('cm','')  // 5x5
    const skuCode   = `MOWO-${sizeCode}-${order.frameCount}F-${matCode}-${colCode}`
    const createdAt = new Date(order.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const userName  = order.user?.profile?.nickname || order.user?.phone || '未知用户'

    // ── 生成条形码PNG ──
    let barcodeBuffer
    try {
      barcodeBuffer = await bwipjs.toBuffer({
        bcid:        'code128',
        text:        orderNo,
        scale:       3,
        height:      12,
        includetext: true,
        textxalign:  'center',
        textsize:    10,
        paddingwidth: 10,
        paddingheight: 8,
      })
    } catch(e) {
      fastify.log.warn('条形码生成失败：' + e.message)
    }

    // ── config.json 内容 ──
    const config = {
      orderNo,
      userId:     order.userId.slice(-8),
      modelName:  order.modelName,
      skuId:      order.skuId,
      skuCode,
      frameCount: order.frameCount,
      size:       order.size,
      material:   order.material,
      color:      order.color,
      colorName:  order.colorName,
      template:   `${order.size}_${order.frameCount}帧`,
      createdAt
    }

    // ── 订单信息.txt 内容 ──
    const infoTxt = [
      '══════════════════════════════',
      '        哞屋 MOWO 生产单',
      '══════════════════════════════',
      `订单号：${orderNo}`,
      `用  户：${userName}`,
      `下单时间：${createdAt}`,
      '──────────────────────────────',
      '【生产规格】',
      `款  式：${order.modelName}`,
      `帧  数：${order.frameCount} 帧`,
      `尺  寸：${order.size}`,
      `材  质：${order.material}`,
      `颜  色：${order.colorName}`,
      `SKU编码：${skuCode}`,
      '══════════════════════════════',
    ].join('\n')

    // ── 处理说明.txt 内容 ──
    const instrTxt = [
      '══════════════════════════════',
      '        图纸处理说明',
      '══════════════════════════════',
      `订单号：${orderNo}`,
      `规  格：${order.size} · ${order.frameCount}帧 · ${order.material} · ${order.colorName}`,
      '',
      '【处理步骤】',
      '1. 运行图片处理脚本：',
      `   python mowo_process.py --input 原始帧 --output 处理后帧 --size ${order.size.replace('cm','')} --frames ${order.frameCount}`,
      '',
      `2. 打开Word模板：${order.size}_${order.frameCount}帧.docx`,
      '',
      '3. 将处理后的图片按顺序插入Word表格',
      '',
      '4. 打印并裁切页片',
      '',
      '5. 将 barcode.png 打印贴在材料包装袋上',
      '══════════════════════════════',
    ].join('\n')

    // ── 设置响应头 ──
    reply.raw.setHeader('Access-Control-Allow-Origin', '*')
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    reply.raw.setHeader('Content-Type', 'application/zip')
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${orderNo}_package.zip"`)

    // ── 打包 ──
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.pipe(reply.raw)

    const dir = `${orderNo}/`

    // 加入随单文件
    archive.append(JSON.stringify(config, null, 2), { name: dir + 'config.json' })
    archive.append(infoTxt,   { name: dir + '订单信息.txt' })
    archive.append(instrTxt,  { name: dir + '处理说明.txt' })
    if (barcodeBuffer) {
      archive.append(barcodeBuffer, { name: dir + 'barcode.png' })
    }

    // 加入原始帧图片（放在子文件夹）
    for (const key of frameKeys) {
      const signedUrl = fastify.oss.signatureUrl(key, { expires: 300 })
      const fileName  = key.split('/').pop()
      await new Promise((resolve, reject) => {
        const client = signedUrl.startsWith('https') ? https : http
        client.get(signedUrl, (res) => {
          archive.append(res, { name: dir + '原始帧/' + fileName })
          res.on('end', resolve)
          res.on('error', reject)
        }).on('error', reject)
      })
    }

    await archive.finalize()

    // ── 自动将订单状态改为生产中 ──
    try {
      await fastify.prisma.customizeOrder.update({
        where: { orderNo },
        data:  { status: 'producing' }   // 下载图纸包 → 生产中
      })
    } catch(e) {}

    // ── 审计日志 ──
    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId:   request.user.userId,
          userRole: request.user.role ?? 0,
          method:   'GET',
          path:     request.url,
          action:   `下载订单 ${orderNo} 图纸包，订单状态自动改为生产中`,
          targetId: orderNo,
          ip:       request.ip || null
        }
      })
    } catch(e) {}
  })

  // PUT /api/admin/orders/:orderNo/status — 更新订单状态
  fastify.put('/orders/:orderNo/status', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { orderNo } = request.params
    const { status }  = request.body
    const validStatus = ['pending', 'paid', 'locked', 'processing', 'producing', 'shipped', 'received', 'aftersale', 'cancelled']
    const statusLabel = { pending:'未付款', paid:'已付款', locked:'处理中', processing:'待生产', producing:'生产中', shipped:'已发货', received:'已收货', aftersale:'售后中', cancelled:'已取消' }

    if (!validStatus.includes(status))
      return reply.code(400).send({ success: false, message: '无效的状态值' })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { orderNo } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const oldStatus = order.status

    await fastify.prisma.$transaction(async (tx) => {
      // 1. 更新订单状态（shipped 时同步写入发货时间）
      await tx.customizeOrder.update({
        where: { orderNo },
        data: status === 'shipped'
          ? { status, shippedAt: new Date() }
          : { status }
      })

      // 2. 订单变为「已收货」时，触发联名分红逻辑
      if (status === 'received' && oldStatus !== 'received') {
        await handleReceivedOrder(tx, order)
      }

      // 3. 写审计日志
      try {
        await tx.operationLog.create({
          data: {
            userId: request.user.userId, userRole: request.user.role ?? 0,
            method: 'PUT', path: request.url,
            action: `将订单 ${orderNo} 状态从「${statusLabel[oldStatus]}」修改为「${statusLabel[status]}」`,
            targetId: orderNo,
            before: JSON.stringify({ status: oldStatus }),
            after:  JSON.stringify({ status }),
            ip: request.ip || null
          }
        })
      } catch(e) {}
    })

    return reply.send({
      success: true,
      message: status === 'received' && order.sourceType === 'collab'
        ? '状态已更新，联名分红已进入15天冷却期'
        : '状态已更新',
      data: { orderNo, status }
    })
  })

  // PUT /api/admin/orders/batch-status — 批量更新状态
  fastify.put('/orders/batch-status', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { orderNos, status } = request.body
    const validStatus = ['pending', 'paid', 'locked', 'processing', 'producing', 'shipped', 'received', 'aftersale', 'cancelled']
    const statusLabel = { pending:'未付款', paid:'已付款', locked:'处理中', processing:'待生产', producing:'生产中', shipped:'已发货', received:'已收货', aftersale:'售后中', cancelled:'已取消' }

    if (!Array.isArray(orderNos) || !orderNos.length)
      return reply.code(400).send({ success: false, message: 'orderNos不能为空' })
    if (!validStatus.includes(status))
      return reply.code(400).send({ success: false, message: '无效的状态值' })

    const result = await fastify.prisma.customizeOrder.updateMany({
      where: { orderNo: { in: orderNos } },
      data: status === 'shipped' ? { status, shippedAt: new Date() } : { status }
    })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: request.user.userId, userRole: request.user.role ?? 0,
          method: 'PUT', path: request.url,
          action: `批量更新 ${result.count} 个订单状态为「${statusLabel[status]}」`,
          targetId: orderNos.join(','),
          after: JSON.stringify({ status }),
          ip: request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: `已更新 ${result.count} 个订单`, data: { count: result.count } })
  })

  // PUT /api/admin/orders/:orderNo/tracking — 录入快递单号
  fastify.put('/orders/:orderNo/tracking', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { orderNo }                     = request.params
    const { trackingNo, trackingCompany } = request.body

    if (!trackingNo || !trackingCompany)
      return reply.code(400).send({ success: false, message: '快递单号和快递公司不能为空' })

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { orderNo } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const updated = await fastify.prisma.customizeOrder.update({
      where: { orderNo },
      data:  { trackingNo, trackingCompany, status: 'processing' },
      select: { orderNo: true, trackingNo: true, trackingCompany: true, status: true }
    })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: request.user.userId, userRole: request.user.role ?? 0,
          method: 'PUT', path: request.url,
          action: `录入订单 ${orderNo} 快递信息：${trackingCompany} ${trackingNo}`,
          targetId: orderNo,
          after: JSON.stringify({ trackingNo, trackingCompany }),
          ip: request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: '快递信息已录入，订单状态已更新为待生产', data: updated })
  })

  // GET /api/admin/users — 用户列表
  fastify.get('/users', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { page = 1, limit = 20, role } = request.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = role !== undefined ? { role: parseInt(role) } : {}

    const [users, total] = await Promise.all([
      fastify.prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit),
        select: {
          id: true, phone: true, role: true,
          certifyStatus: true, isBanned: true,
          createdAt: true, lastLoginAt: true,
          profile: { select: { nickname: true, avatarUrl: true } }
        }
      }),
      fastify.prisma.user.count({ where })
    ])

    return reply.send({
      success: true,
      data: { users, pagination: { page: parseInt(page), limit: parseInt(limit), total } }
    })
  })

  // PUT /api/admin/users/:id/role — 修改用户角色（仅SuperAdmin）
  fastify.put('/users/:id/role', {
    preHandler: [fastify.requireRole(3)]
  }, async (request, reply) => {
    const { id }   = request.params
    const { role } = request.body
    const roleLabel = { 0:'普通用户', 1:'生产端', 2:'管理员', 3:'超级管理员' }

    if (![0, 1, 2, 3].includes(role))
      return reply.code(400).send({ success: false, message: '无效的角色值' })

    const user    = await fastify.prisma.user.findUnique({ where: { id }, select: { role: true, phone: true } })
    const updated = await fastify.prisma.user.update({
      where: { id }, data: { role },
      select: { id: true, phone: true, role: true }
    })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: request.user.userId, userRole: request.user.role ?? 0,
          method: 'PUT', path: request.url,
          action: `将用户 ${user?.phone} 角色从「${roleLabel[user?.role]}」修改为「${roleLabel[role]}」`,
          targetId: id,
          before: JSON.stringify({ role: user?.role }),
          after:  JSON.stringify({ role }),
          ip: request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: '角色已更新', data: updated })
  })

  // PUT /api/admin/users/:id/ban — 封禁/解封用户
  fastify.put('/users/:id/ban', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { id }       = request.params
    const { isBanned } = request.body

    const updated = await fastify.prisma.user.update({
      where: { id }, data: { isBanned: !!isBanned },
      select: { id: true, phone: true, isBanned: true }
    })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: request.user.userId, userRole: request.user.role ?? 0,
          method: 'PUT', path: request.url,
          action: `${isBanned ? '封禁' : '解封'}用户 ${updated.phone}`,
          targetId: id, ip: request.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, message: isBanned ? '用户已封禁' : '用户已解封', data: updated })
  })

  // GET /api/admin/logs — 审计日志（仅SuperAdmin）
  fastify.get('/logs', {
    preHandler: [fastify.requireRole(3)]
    }, async (request, reply) => {
    const { page = 1, limit = 50, method } = request.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = method ? { method } : {}

    const [logs, total] = await Promise.all([
        fastify.prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip, take: parseInt(limit)
        }),
        fastify.prisma.operationLog.count({ where })
    ])

    return reply.send({
        success: true,
        data: { logs, pagination: { page: parseInt(page), limit: parseInt(limit), total } }
    })
    })



    // GET /api/admin/production/summary — 按款式汇总待生产数量
    fastify.get('/production/summary', {
    preHandler: [fastify.requireRole(2)]
    }, async (request, reply) => {
    const orders = await fastify.prisma.customizeOrder.findMany({
        where: { status: { in: ['processing', 'producing'] } },
        select: { size: true, frameCount: true, material: true, colorName: true, status: true }
    })

    const summary = {}
    for (const o of orders) {
        const key = `${o.size} · ${o.frameCount}帧 · ${o.material} · ${o.colorName}`
        summary[key] = (summary[key] || 0) + 1
    }

    return reply.send({ success: true, data: summary })
    })

    // GET /api/admin/production/orders — 待生产订单列表（含第一帧预览）
    fastify.get('/production/orders', {
    preHandler: [fastify.requireRole(2)]
    }, async (request, reply) => {
    const orders = await fastify.prisma.customizeOrder.findMany({
        where: { status: { in: ['processing', 'producing'] } },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
    })

    const result = orders.map(o => {
        const frameKeys  = JSON.parse(o.frameUrls || '[]')
        const previewUrl = frameKeys.length
        ? fastify.oss.signatureUrl(frameKeys[0], { expires: 3600 })
        : null
        return {
        ...o,
        frameUrls:  frameKeys,
        previewUrl,
        userName: o.user?.profile?.nickname || o.user?.phone || '未知用户'
        }
    })

    return reply.send({ success: true, data: result })
    })



  // ══════════════════════════════════════════
  // 导出收件地址（新流程）
  // ══════════════════════════════════════════

  // POST /api/admin/orders/export-address
  // 导出已付款订单地址，新排序规则：
  //   第一层：单款用户全部排前，多款用户排后
  //   第二层：组内按最高优先级SKU（globalSort）排
  //   第三层：多款组内同最高优先级时，按购买数量少的排前
  //   第四层：同数量时按第二高优先级SKU排（依此类推）
  // 导出后状态变 locked，同时把 seqNo 写回数据库（供导出帧图时使用）
  fastify.post('/orders/export-address', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { orderNos, format = 'json', limit: limitCount } = req.body

    // 1. 查订单
    let selectedOrders
    if (Array.isArray(orderNos) && orderNos.length) {
      selectedOrders = await fastify.prisma.customizeOrder.findMany({
        where: { orderNo: { in: orderNos }, status: 'paid' }
      })
    } else {
      selectedOrders = await fastify.prisma.customizeOrder.findMany({
        where: { status: 'paid' },
        take: limitCount ? parseInt(limitCount) : undefined
      })
    }

    if (!selectedOrders.length)
      return reply.code(400).send({ success: false, message: '没有可导出的已付款订单' })

    // 2. 查所有涉及的SKU和款式（计算 globalSort）
    const skuIds   = [...new Set(selectedOrders.map(o => o.skuId).filter(Boolean))]
    const skus     = await fastify.prisma.machineModelSku.findMany({
      where:  { id: { in: skuIds } },
      select: { id: true, sortOrder: true, modelId: true, size: true, frameCount: true, material: true, colorName: true }
    })
    const modelIds = [...new Set(skus.map(s => s.modelId).filter(Boolean))]
    const models   = await fastify.prisma.machineModel.findMany({
      where:  { id: { in: modelIds } },
      select: { id: true, sortOrder: true, name: true }
    })
    const modelMap = Object.fromEntries(models.map(m => [m.id, m]))
    const MAX_SORT = 99999999
    const skuMap   = Object.fromEntries(skus.map(s => {
      const modelSort = modelMap[s.modelId]?.sortOrder ?? 999
      return [s.id, { ...s, modelName: modelMap[s.modelId]?.name || '', globalSort: modelSort * 1000 + (s.sortOrder ?? 999) }]
    }))

    // 3. 给每个订单计算 globalSort
    selectedOrders.forEach(o => {
      o._skuSort = skuMap[o.skuId]?.globalSort ?? MAX_SORT
    })

    // 4. 按收件人分组
    const receiverMap = {}
    for (const o of selectedOrders) {
      if (!o.receiverName || !o.receiverPhone) continue
      const key = `${o.receiverName}|${o.receiverPhone}|${o.receiverAddress}`
      if (!receiverMap[key]) receiverMap[key] = {
        receiverName:    o.receiverName,
        receiverPhone:   o.receiverPhone,
        receiverCity:    o.receiverCity || '',
        receiverAddress: o.receiverAddress || '',
        orders:          []
      }
      receiverMap[key].orders.push(o)
    }

    // 5. 给每个收件人的订单按 globalSort 排好（供第四层比较用）
    Object.values(receiverMap).forEach(r => {
      r.orders.sort((a, b) => a._skuSort - b._skuSort)
      r.isSingle = r.orders.length === 1
      r.sortedSkus = r.orders.map(o => o._skuSort) // 已排好的sku优先级列表
    })

    // 6. 收件人排序
    //   第一层：单款组排前，多款组排后
    //   第二层：按最高优先级SKU排（sortedSkus[0]）
    //   第三层：多款组内同最高优先级时，购买数量少的排前
    //   第四层：同数量时按第二高优先级SKU排（sortedSkus[1]），依此类推
    //   兜底：最早下单时间
    const compareReceivers = (a, b) => {
      // 第一层：单款排前
      if (a.isSingle !== b.isSingle) return a.isSingle ? -1 : 1
      // 第二层：最高优先级SKU
      if (a.sortedSkus[0] !== b.sortedSkus[0]) return a.sortedSkus[0] - b.sortedSkus[0]
      // 第三层：购买数量少的排前
      if (a.orders.length !== b.orders.length) return a.orders.length - b.orders.length
      // 第四层：逐位比较第二高优先级及以后
      const len = Math.max(a.sortedSkus.length, b.sortedSkus.length)
      for (let i = 1; i < len; i++) {
        const av = a.sortedSkus[i] ?? MAX_SORT
        const bv = b.sortedSkus[i] ?? MAX_SORT
        if (av !== bv) return av - bv
      }
      // 兜底：最早下单时间
      const aTime = Math.min(...a.orders.map(o => new Date(o.createdAt).getTime()))
      const bTime = Math.min(...b.orders.map(o => new Date(o.createdAt).getTime()))
      return aTime - bTime
    }

    const sortedReceivers = Object.values(receiverMap).sort(compareReceivers)

    // 7. 生成批次ID：YYYYMMDD_HHMMSS（精确到秒，防止同分钟冲突）
    const batchNow = new Date()
    const batchId  = batchNow.getFullYear().toString() +
                     String(batchNow.getMonth()+1).padStart(2,'0') +
                     String(batchNow.getDate()).padStart(2,'0') + '_' +
                     String(batchNow.getHours()).padStart(2,'0') +
                     String(batchNow.getMinutes()).padStart(2,'0') +
                     String(batchNow.getSeconds()).padStart(2,'0')

    // 8. 展开为每行一个订单，分配全局 seqNo
    let seqNo = 1
    const rows = []
    const seqUpdates = [] // 用于写回数据库
    for (const r of sortedReceivers) {
      for (const o of r.orders) {
        const sku = skuMap[o.skuId]
        rows.push({
          seqNo:           seqNo,
          batchId,
          receiverName:    r.receiverName,
          receiverPhone:   r.receiverPhone,
          receiverCity:    r.receiverCity,
          receiverAddress: r.receiverAddress,
          orderNo:         o.orderNo,
          skuDesc:         sku ? `${sku.modelName}·${o.frameCount}帧·${o.size}·${o.material}·${o.colorName}` : `${o.modelName||''}·${o.frameCount}帧·${o.size}`,
          remark:          '哞屋动画机'
        })
        seqUpdates.push({ orderNo: o.orderNo, seqNo })
        seqNo++
      }
    }

    // 9. 状态变为 locked，同时写入 seqNo 和 batchId
    await Promise.all(seqUpdates.map(({ orderNo, seqNo }) =>
      fastify.prisma.customizeOrder.update({
        where: { orderNo },
        data:  { status: 'locked', seqNo, batchId, lockStatus: 'LOCKED' }
      })
    ))

    // 9.5 创建 Production_Batch 记录（若不存在）
    try {
      await fastify.prisma.productionBatch.upsert({
        where:  { id: batchId },
        create: { id: batchId, operatorId: req.user.userId, status: 'Open' },
        update: {}
      })
    } catch(e) {}

    try {
      const exportedNos = seqUpdates.map(u => u.orderNo)
      await fastify.prisma.operationLog.create({
        data: {
          userId: req.user.userId, userRole: req.user.role ?? 0,
          method: 'POST', path: req.url,
          action: `批次 ${batchId} 导出 ${exportedNos.length} 个订单地址，状态变为处理中`,
          targetId: exportedNos.join(',').slice(0, 200),
          ip: req.ip || null
        }
      })
    } catch(e) {}

    // 10. 返回（含 batchId 供前端命名文件）
    if (format === 'csv') {
      const header = '序号,收件人,电话,城市,地址,订单号,规格,备注'
      const lines  = rows.map(r =>
        [r.seqNo, r.receiverName, r.receiverPhone, r.receiverCity,
         `"${r.receiverAddress}"`, r.orderNo, `"${r.skuDesc}"`, r.remark].join(',')
      )
      const csv = '\uFEFF' + header + '\n' + lines.join('\n')
      reply.raw.setHeader('Content-Type', 'text/csv; charset=utf-8')
      reply.raw.setHeader('Content-Disposition', `attachment; filename="address_${Date.now()}.csv"`)
      return reply.send(csv)
    }

    return reply.send({ success: true, data: rows, exportedCount: seqUpdates.length, batchId, filename: `${batchId}_收件地址.xlsx` })
  })

  // POST /api/admin/orders/import-tracking — 批量录入快递单号（处理中→待生产）
  // body: { pairs: [{ orderNo, trackingNo, trackingCompany }] }
  fastify.post('/orders/import-tracking', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { pairs } = req.body
    if (!Array.isArray(pairs) || !pairs.length)
      return reply.code(400).send({ success: false, message: 'pairs不能为空' })

    const results = []
    const errors  = []

    for (const p of pairs) {
      const { orderNo, trackingNo, trackingCompany } = p
      if (!orderNo || !trackingNo || !trackingCompany) {
        errors.push(`${orderNo}: 参数不完整`)
        continue
      }
      try {
        await fastify.prisma.customizeOrder.update({
          where: { orderNo },
          data:  { trackingNo, trackingCompany, status: 'processing' }
        })
        results.push(orderNo)
      } catch(e) {
        errors.push(`${orderNo}: ${e.message}`)
      }
    }

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: req.user.userId, userRole: req.user.role ?? 0,
          method: 'POST', path: req.url,
          action: `批量录入快递单号 ${results.length} 个订单，状态变为待生产`,
          ip: req.ip || null
        }
      })
    } catch(e) {}

    return reply.send({
      success: errors.length === 0,
      message: `成功 ${results.length} 个${errors.length ? '，失败 ' + errors.length + ' 个' : ''}`,
      data: { success: results, errors }
    })
  })

  // ══════════════════════════════════════════
  // 批次管理（合并订单 + 导出 + 绑定快递）
  // ══════════════════════════════════════════

  // GET /api/admin/batches/preview — 预览可合并的批次（paid状态订单按收件人合并）
  fastify.get('/batches/preview', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const orders = await fastify.prisma.customizeOrder.findMany({
      where: { status: 'paid', batchId: null },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
    })

    // 按 收件人+电话+地址 分组
    const groups = {}
    for (const o of orders) {
      if (!o.receiverName || !o.receiverPhone) continue
      const key = `${o.receiverName}|${o.receiverPhone}|${o.receiverAddress}|${o.receiverCity}`
      if (!groups[key]) groups[key] = { receiverName: o.receiverName, receiverPhone: o.receiverPhone, receiverAddress: o.receiverAddress, receiverCity: o.receiverCity, orders: [] }
      groups[key].orders.push({
        orderNo:   o.orderNo,
        modelName: o.modelName,
        size:      o.size,
        material:  o.material,
        frameCount: o.frameCount,
        colorName: o.colorName,
        createdAt: o.createdAt,
        userName:  o.user?.profile?.nickname || o.user?.phone || '—'
      })
    }

    return reply.send({ success: true, data: Object.values(groups) })
  })

  // POST /api/admin/batches — 确认生成批次，订单状态改为 processing
  fastify.post('/batches', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { groups } = req.body
    // groups: [{ receiverName, receiverPhone, receiverAddress, receiverCity, orderNos: [] }]
    if (!Array.isArray(groups) || !groups.length)
      return reply.code(400).send({ success: false, message: 'groups不能为空' })

    const batches = []
    for (const g of groups) {
      if (!g.orderNos?.length) continue
      const batch = await fastify.prisma.shippingBatch.create({
        data: {
          receiverName:    g.receiverName,
          receiverPhone:   g.receiverPhone,
          receiverAddress: g.receiverAddress || '',
          receiverCity:    g.receiverCity || '',
          orderCount:      g.orderNos.length,
          status:          'pending'
        }
      })
      await fastify.prisma.customizeOrder.updateMany({
        where: { orderNo: { in: g.orderNos } },
        data:  { batchId: batch.id, status: 'processing' }
      })
      batches.push({ batchId: batch.id, orderCount: batch.orderCount, ...g })
    }

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: req.user.userId, userRole: req.user.role ?? 0,
          method: 'POST', path: req.url,
          action: `生成 ${batches.length} 个快递批次，共 ${batches.reduce((s,b)=>s+b.orderCount,0)} 个订单进入待生产`,
          ip: req.ip || null
        }
      })
    } catch(e) {}

    return reply.send({ success: true, data: batches, message: `已生成 ${batches.length} 个批次` })
  })

  // 旧批次系统（shippingBatch）已废弃，由 batchId 字段替代



  // ══════════════════════════════════════════
  // POST /api/admin/orders/batch-export-frames
  // 批量导出帧素材包 + 对照清单docx + 条形码清单docx（基于模板填充）
  // body: { orderNos: [] }
  // ══════════════════════════════════════════
  fastify.post('/orders/batch-export-frames', {
    preHandler: [fastify.requireRole(2)]
  }, async (request, reply) => {
    const { orderNos } = request.body
    if (!Array.isArray(orderNos) || !orderNos.length)
      return reply.code(400).send({ success: false, message: 'orderNos不能为空' })

    const orders = await fastify.prisma.customizeOrder.findMany({
      where: { orderNo: { in: orderNos }, status: 'processing' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
    })
    if (!orders.length)
      return reply.code(400).send({ success: false, message: '没有找到待生产订单' })

    // ── 授权到期检查：CBR SKU 过期则拒绝导出 ──
    const allSkuIdsForCheck = [...new Set(orders.map(o => o.skuId).filter(Boolean))]
    const expiredSkus = await fastify.prisma.machineModelSku.findMany({
      where: { id: { in: allSkuIdsForCheck }, licenseStatus: 'Expired' },
      select: { id: true, skuCode: true }
    })
    if (expiredSkus.length) {
      const codes = expiredSkus.map(s => s.skuCode || s.id).join(', ')
      return reply.code(400).send({ success: false, message: `以下 CBR SKU 授权已过期，无法导出：${codes}`, code: 'LICENSE_EXPIRED' })
    }

    // 用订单的 batchId 命名（与导出地址保持一致）
    // 取第一个有 batchId 的订单，如果没有则用当前时间兜底
    const firstBatchId = orders.find(o => o.batchId)?.batchId
    const now = new Date()
    const ts  = firstBatchId || (
                now.getFullYear().toString() +
                String(now.getMonth()+1).padStart(2,'0') +
                String(now.getDate()).padStart(2,'0') + '_' +
                String(now.getHours()).padStart(2,'0') +
                String(now.getMinutes()).padStart(2,'0'))

    // 辅助：从URL下载为Buffer
    const fetchBuffer = (url) => new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http
      const chunks = []
      client.get(url, (res) => {
        res.on('data', c => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }).on('error', reject)
    })

    // ── 查SKU和款式信息（用于分文件夹和排序）──
    const allSkuIds  = [...new Set(orders.map(o => o.skuId).filter(Boolean))]
    const allSkus    = await fastify.prisma.machineModelSku.findMany({
      where:  { id: { in: allSkuIds } },
      select: { id: true, sortOrder: true, modelId: true }
    })
    const allModelIds = [...new Set(allSkus.map(s => s.modelId).filter(Boolean))]
    const allModels   = await fastify.prisma.machineModel.findMany({
      where:  { id: { in: allModelIds } },
      select: { id: true, name: true, sortOrder: true }
    })
    const skuInfoMap   = Object.fromEntries(allSkus.map(s => [s.id, s]))
    const modelInfoMap = Object.fromEntries(allModels.map(m => [m.id, m]))

    // 给每个订单补充 modelName
    orders.forEach(o => {
      const sku      = skuInfoMap[o.skuId]
      o._modelName   = sku ? (modelInfoMap[sku.modelId]?.name || o.modelName) : o.modelName
    })

    // 按 seqNo 排序（导出地址时写入的全局序号，保证和快递面单一致）
    // 没有 seqNo 的订单排到最后
    orders.sort((a, b) => {
      const aSeq = a.seqNo ?? 99999
      const bSeq = b.seqNo ?? 99999
      return aSeq - bSeq
    })

    // 按SKU分组，文件夹名 = 款式_帧数_尺寸_材质_颜色
    // 文件夹内订单顺序 = seqNo 顺序（已排好，直接 push）
    const skuGroups = {}
    // 同时记录每个SKU文件夹的最小seqNo，用于文件夹本身的排序
    orders.forEach(o => {
      const folderName = `${o._modelName}_${o.frameCount}帧_${o.size}_${o.material}_${o.colorName}`
        .replace(/[\/\\:*?"<>|]/g, '_')
      if (!skuGroups[folderName]) skuGroups[folderName] = { folderName, orders: [], minSeqNo: o.seqNo ?? 99999 }
      skuGroups[folderName].orders.push(o)
    })

    // ── 预处理每个订单 ──
    const orderData = []
    let globalIdx = 1
    // 文件夹按各自最小seqNo排序（保证A款文件夹排在B款前）
    for (const group of Object.values(skuGroups).sort((a,b) => a.minSeqNo - b.minSeqNo)) {
      let groupIdx = 1
      for (const o of group.orders) {
        const idx         = String(globalIdx).padStart(2, '0')
        const groupIdxStr = String(groupIdx).padStart(2, '0')
        const frameKeys   = JSON.parse(o.frameUrls || '[]')
        // dirName 包含SKU文件夹路径
        const dirName    = `${group.folderName}/${groupIdxStr}_${o.orderNo}`
        // label 用全局 seqNo（快递面单序号），方便对照
        const label      = `${o.seqNo ?? globalIdx}：${o.orderNo}`
        globalIdx++
        groupIdx++

      // 条形码PNG
      let barcodeBuffer = null
      try {
        barcodeBuffer = await bwipjs.toBuffer({
          bcid: 'code128', text: o.orderNo,
          scale: 3, height: 12, includetext: true,
          textxalign: 'center', textsize: 10,
          paddingwidth: 6, paddingheight: 4,
        })
      } catch(e) { fastify.log.warn('条形码失败：' + e.message) }

      // 第一帧
      let firstFrameBuffer = null
      let firstFrameExt    = 'jpg'
      if (frameKeys.length) {
        try {
          const signedUrl  = fastify.oss.signatureUrl(frameKeys[0], { expires: 600 })
          firstFrameBuffer = await fetchBuffer(signedUrl)
          firstFrameExt    = (frameKeys[0].split('.').pop().toLowerCase() || 'jpg')
        } catch(e) { fastify.log.warn('第一帧下载失败：' + e.message) }
      }

        orderData.push({ o, idx, dirName, label, frameKeys, barcodeBuffer, firstFrameBuffer, firstFrameExt })
      }
    }

    // ── 填充docx模板（操作ZIP内XML）──
    const AdmZip = (await import('adm-zip')).default

    // 生成图片插入XML片段（EMU单位，1px ≈ 9525 EMU）
    // 对照清单格子: 1701 DXA * 635 EMU/DXA = 1079385 EMU，取整 1079400
    // 条形码格子: 1797 DXA * 635 = 1141095 EMU，取整
    const makeImgXml = (rId, widthEmu, heightEmu) => `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${rId}" name="img${rId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${rId}" name="img${rId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`

    const makeTextXml = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`

    // 往 <w:p> 的末尾 </w:p> 前插入内容
    const injectIntoParagraph = (tcXml, injection) => {
      return tcXml.replace(/<\/w:p>(?!.*<\/w:p>)/, injection + '</w:p>')
    }

    // 填充 checklist
    // 简单可靠的填充方式：把整个XML拆成单元格数组，按顺序替换，最后拼回去
    const fillDocx = async (templatePath, items, isChecklist) => {
      const zip  = new AdmZip(templatePath)
      let xml    = zip.readAsText('word/document.xml')
      let rels   = zip.readAsText('word/_rels/document.xml.rels')

      const existingRids = [...rels.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1]))
      let ridCounter = Math.max(...existingRids, 0)

      // 拆出所有单元格的位置（不用嵌套匹配，直接找开闭标签）
      const findCells = (xml) => {
        const cells = []
        let i = 0
        while (i < xml.length) {
          const start = xml.indexOf('<w:tc>', i)
          if (start < 0) break
          // 找匹配的 </w:tc>（可能嵌套，但docx里tc不会嵌套）
          const end = xml.indexOf('</w:tc>', start) + 7
          cells.push({ start, end, xml: xml.slice(start, end) })
          i = end
        }
        return cells
      }

      // 在单元格的 <w:p> 最后一个 </w:p> 之前插入内容
      const inject = (cellXml, injection) => {
        const lastP = cellXml.lastIndexOf('</w:p>')
        if (lastP < 0) return cellXml
        return cellXml.slice(0, lastP) + injection + cellXml.slice(lastP)
      }

      const makeImg = (rId, wEmu, hEmu) =>
        `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${wEmu}" cy="${hEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${rId}" name="img${rId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${rId}" name="img${rId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`

      const makeText = (text) =>
        `<w:r><w:rPr><w:lang w:val="zh-CN"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`

      const addRel = (rId, imgName) => {
        rels = rels.replace('</Relationships>',
          `<Relationship Id="rId${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imgName}"/></Relationships>`)
      }

      if (isChecklist) {
        // 对照清单：6列，奇数行图片，偶数行黄色文字
        // 找所有 <w:tr> 块
        const trRegex = /<w:tr[ >]/g
        const trStarts = []
        let m
        while ((m = trRegex.exec(xml)) !== null) trStarts.push(m.index)

        // 对每一行重新处理
        let xmlParts = []
        let lastEnd  = 0

        for (let r = 0; r < trStarts.length; r++) {
          const trStart = trStarts[r]
          const trEnd   = (r + 1 < trStarts.length)
            ? xml.lastIndexOf('</w:tr>', trStarts[r+1]) + 7
            : xml.indexOf('</w:tr>', trStart) + 7

          const trXml    = xml.slice(trStart, trEnd)
          const isImgRow = !trXml.includes('FFFF00')
          const rowIdx   = Math.floor(r / 2)

          // 找这一行所有单元格
          const cells = findCells(trXml)
          let newTrXml = trXml
          let offset   = 0

          for (let c = 0; c < cells.length; c++) {
            const itemIdx = rowIdx * 6 + c
            const item    = items[itemIdx]
            if (!item) continue

            const cell    = cells[c]
            let newCell   = cell.xml

            if (isImgRow && item.firstFrameBuffer) {
              ridCounter++
              const ext     = item.firstFrameExt === 'png' ? 'png' : 'jpeg'
              const imgName = `frame_${ridCounter}.${ext}`
              zip.addFile(`word/media/${imgName}`, item.firstFrameBuffer)
              addRel(ridCounter, imgName)
              // 1701 DXA * 635 = 1079385 EMU
              newCell = inject(newCell, makeImg(ridCounter, 1079385, 1079385))
            } else if (!isImgRow) {
              newCell = inject(newCell, makeText(item.label))
            }

            const pos = cell.start + offset
            newTrXml  = newTrXml.slice(0, pos) + newCell + newTrXml.slice(pos + cell.xml.length)
            offset   += newCell.length - cell.xml.length
          }

          xmlParts.push(xml.slice(lastEnd, trStart))
          xmlParts.push(newTrXml)
          lastEnd = trEnd
        }
        xmlParts.push(xml.slice(lastEnd))
        xml = xmlParts.join('')

      } else {
        // 条形码清单：每格直接放条形码图片
        const cells  = findCells(xml)
        let offset   = 0
        for (let i = 0; i < cells.length; i++) {
          const item = items[i]
          if (!item || !item.barcodeBuffer) continue

          ridCounter++
          const imgName = `barcode_${ridCounter}.png`
          zip.addFile(`word/media/${imgName}`, item.barcodeBuffer)
          addRel(ridCounter, imgName)

          const cell    = cells[i]
          // 1797 DXA * 635 = 1141095 EMU 宽；567 DXA * 635 = 360045 EMU 高
          const newCell = inject(cell.xml, makeImg(ridCounter, 1141095, 360045))
          xml    = xml.slice(0, cell.start + offset) + newCell + xml.slice(cell.end + offset)
          offset += newCell.length - cell.xml.length
        }
      }

      // Content-Types 里确保有 jpeg/png
      let ct = zip.readAsText('[Content_Types].xml')
      if (!ct.includes('image/jpeg')) ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>')
      if (!ct.includes('image/png'))  ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')

      zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'))
      zip.updateFile('word/_rels/document.xml.rels', Buffer.from(rels, 'utf8'))
      zip.updateFile('[Content_Types].xml', Buffer.from(ct, 'utf8'))
      return zip.toBuffer()
    }

    const checklistBuf = await fillDocx(
      process.cwd() + '/src/templates/checklist_template.docx',
      orderData, true
    )
    const barcodeBuf = await fillDocx(
      process.cwd() + '/src/templates/barcode_template.docx',
      orderData, false
    )



    // ── 打包 zip ──
    reply.raw.setHeader('Access-Control-Allow-Origin', '*')
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    reply.raw.setHeader('Content-Type', 'application/zip')
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${ts}_frames.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.pipe(reply.raw)

    archive.append(checklistBuf, { name: `对照清单/${ts}_对照清单.docx` })
    archive.append(barcodeBuf,   { name: `条形码清单/${ts}_条形码清单.docx` })

    // 各订单帧素材
    for (const { o, dirName, frameKeys } of orderData) {
      for (const key of frameKeys) {
        const signedUrl = fastify.oss.signatureUrl(key, { expires: 600 })
        const fileName  = key.split('/').pop()
        await new Promise((resolve, reject) => {
          const client = signedUrl.startsWith('https') ? https : http
          client.get(signedUrl, (res) => {
            archive.append(res, { name: `${dirName}/${fileName}` })
            res.on('end', resolve)
            res.on('error', reject)
          }).on('error', reject)
        })
      }
    }

    await archive.finalize()

    // ── 导出后处理：Production_Batch / Batch_Item / Frame_Instance / InventoryService ──
    try {
      // (a) 确保 Production_Batch 存在，状态置为 Locked
      await fastify.prisma.productionBatch.upsert({
        where:  { id: ts },
        create: { id: ts, operatorId: request.user.userId, status: 'Locked' },
        update: { status: 'Locked' }
      })

      // (b) 聚合各 SKU 计划数量 → Batch_Item
      const skuQtyMap = {}
      for (const o of orders) {
        skuQtyMap[o.skuId] = (skuQtyMap[o.skuId] || 0) + 1
      }
      for (const [skuId, qty] of Object.entries(skuQtyMap)) {
        const skuInfo = await fastify.prisma.machineModelSku.findUnique({ where: { id: skuId } })
        await fastify.prisma.batchItem.upsert({
          where:  { batchId_skuId: { batchId: ts, skuId } },
          create: { batchId: ts, skuId, skuCode: skuInfo?.skuCode ?? null, plannedQty: qty },
          update: { plannedQty: { increment: qty } }
        })
      }

      // (c) 创建 Frame_Instance 并锁定（content_hash 用 ossPath 计算）
      for (const o of orders) {
        const ossPath   = o.ossPath || ''
        const frameUrls = (() => { try { return JSON.parse(o.frameUrls) } catch { return [] } })()
        const hashInput = `${o.id}:${ossPath}:${frameUrls.join(',')}`
        const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex')

        await fastify.prisma.frameInstance.upsert({
          where:  { id: `fi_${o.id}` },
          create: {
            id: `fi_${o.id}`,
            orderId:         o.id,
            templateSkuCode: (await fastify.prisma.machineModelSku.findUnique({ where: { id: o.skuId } }))?.skuCode ?? '',
            imageUrl:        frameUrls[0] ?? null,
            printFileUrl:    ossPath || null,
            contentHash,
            status:          'Locked'
          },
          update: { contentHash, status: 'Locked' }
        })
      }

      // (d) 通过 InventoryService 将 locked → wip_frame + wip_kit（各1件/单）
      for (const [skuId, qty] of Object.entries(skuQtyMap)) {
        const batchOrderNos = orders.filter(o => o.skuId === skuId).map(o => o.orderNo).join(',')
        await startWipFrame(fastify.prisma, skuId, qty, ts, makeIdempotencyKey('wip_frame', ts, skuId))
          .catch(() => {})
      }
    } catch(e) {
      // 后处理失败不影响已发送的 ZIP，仅记录日志
      fastify.log.error('batch-export-frames post-processing error:', e)
    }

    // 更新状态为生产中
    try {
      await fastify.prisma.customizeOrder.updateMany({
        where: { orderNo: { in: orders.map(o => o.orderNo) } },
        data:  { status: 'producing', lockStatus: 'LOCKED' }
      })
    } catch(e) {}

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: request.user.userId, userRole: request.user.role ?? 0,
          method: 'POST', path: request.url,
          action: `批量导出 ${orders.length} 个订单帧素材包，状态变为生产中`,
          targetId: orderNos.join(',').slice(0, 200),
          ip: request.ip || null
        }
      })
    } catch(e) {}
  })




  // ══════════════════════════════════════════
  // 批次管理接口
  // ══════════════════════════════════════════

  // GET /api/admin/batches?status=locked|processing|producing|all
  // 查询批次列表（按 batch_id 分组），status 参数过滤只返回该状态下有订单的批次
  // 不传 status 或 status=all 时返回所有批次（全部视图用）
  fastify.get('/batches', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { status } = req.query
    // 查所有有 batchId 的订单
    const orders = await fastify.prisma.customizeOrder.findMany({
      where:  { batchId: { not: null } },
      select: { batchId: true, status: true }
    })

    // 按 batchId 分组统计
    const batchMap = {}
    for (const o of orders) {
      const bid = o.batchId
      if (!batchMap[bid]) {
        batchMap[bid] = {
          batchId:    bid,
          total:      0,
          locked:     0,
          processing: 0,
          producing:  0,
          shipped:    0,
          other:      0
        }
      }
      batchMap[bid].total++
      if (['locked','processing','producing','shipped'].includes(o.status)) {
        batchMap[bid][o.status]++
      } else {
        batchMap[bid].other++
      }
    }

    // 判断批次是否已完成（所有订单都是 shipped 或更后面的状态）
    const doneSt = new Set(['shipped','received','aftersale','cancelled'])
    let batches = Object.values(batchMap)
      .map(b => ({
        ...b,
        isDone:     b.total > 0 && (b.shipped + b.other) === b.total,
        hasPending: b.locked + b.processing + b.producing > 0
      }))
      .sort((a, b) => b.batchId.localeCompare(a.batchId)) // 新批次排前

    // 按 status 过滤：只返回该状态下有订单的批次
    if (status && status !== 'all') {
      batches = batches.filter(b => b[status] > 0)
    }

    return reply.send({ success: true, data: batches })
  })

  // GET /api/admin/batches/:batchId/stats
  // 查单个批次的统计
  fastify.get('/batches/:batchId/stats', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { batchId } = req.params
    const orders = await fastify.prisma.customizeOrder.findMany({
      where:  { batchId },
      select: { status: true }
    })
    if (!orders.length)
      return reply.code(404).send({ success: false, message: '批次不存在' })

    const stats = { total: orders.length, locked:0, processing:0, producing:0, shipped:0, other:0 }
    orders.forEach(o => {
      if (['locked','processing','producing','shipped'].includes(o.status)) stats[o.status]++
      else stats.other++
    })
    stats.isDone     = (stats.shipped + stats.other) === stats.total
    stats.hasPending = stats.locked + stats.processing + stats.producing > 0

    return reply.send({ success: true, data: { batchId, ...stats } })
  })

  // ══════════════════════════════════════════
  // 扫码查询接口（生产端使用）
  // ══════════════════════════════════════════

  // GET /api/admin/scan/sku/:barcode
  // 扫材料包条码，返回SKU规格信息
  fastify.get('/scan/sku/:barcode', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { barcode } = req.params

    const sku = await fastify.prisma.machineModelSku.findFirst({
      where: { skuBarcode: barcode },
      include: { model: { select: { name: true } } }
    })

    if (!sku)
      return reply.code(404).send({ success: false, message: '未找到对应的材料包规格，请确认条码是否正确' })

    return reply.send({
      success: true,
      type: 'sku',
      data: {
        skuId:      sku.id,
        skuBarcode: sku.skuBarcode,
        modelName:  sku.model?.name || '',
        size:       sku.size,
        frameCount: sku.frameCount,
        material:   sku.material,
        colorName:  sku.colorName,
        colorHex:   sku.colorHex,
        desc:       `${sku.model?.name || ''}·${sku.frameCount}帧·${sku.size}·${sku.material}·${sku.colorName}`
      }
    })
  })

  // GET /api/admin/scan/order/:orderNo
  // 扫订单码（帧素材包上的码），返回订单完整信息
  fastify.get('/scan/order/:orderNo', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { orderNo } = req.params

    const order = await fastify.prisma.customizeOrder.findUnique({
      where: { orderNo },
      include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
    })

    if (!order)
      return reply.code(404).send({ success: false, message: '未找到该订单，请确认订单码是否正确' })

    // 查材料包条码
    const sku = await fastify.prisma.machineModelSku.findUnique({
      where: { id: order.skuId },
      select: { skuBarcode: true }
    })

    // 查同一快递单下的所有订单，判断是否配齐
    let allOrdersForTracking = []
    let isComplete = false
    if (order.trackingNo) {
      allOrdersForTracking = await fastify.prisma.customizeOrder.findMany({
        where: { trackingNo: order.trackingNo },
        select: { orderNo: true, status: true, frameCount: true, size: true, material: true, colorName: true, modelName: true, seqNo: true }
      })
      isComplete = allOrdersForTracking.every(o => o.status === 'producing' || o.status === 'shipped')
    }

    const statusMap = {
      pending: '待付款', paid: '已付款', locked: '地址已导出',
      processing: '快递已录入', producing: '生产中', shipped: '已发货',
      received: '已签收', aftersale: '售后中', cancelled: '已取消'
    }

    return reply.send({
      success: true,
      type: 'order',
      data: {
        orderNo:        order.orderNo,
        seqNo:          order.seqNo,
        status:         order.status,
        statusLabel:    statusMap[order.status] || order.status,
        modelName:      order.modelName,
        frameCount:     order.frameCount,
        size:           order.size,
        material:       order.material,
        colorName:      order.colorName,
        skuDesc:        `${order.modelName}·${order.frameCount}帧·${order.size}·${order.material}·${order.colorName}`,
        skuBarcode:     sku?.skuBarcode || null,
        receiverName:   order.receiverName,
        receiverPhone:  order.receiverPhone,
        receiverCity:   order.receiverCity,
        receiverAddress: order.receiverAddress,
        trackingNo:     order.trackingNo,
        trackingCompany: order.trackingCompany,
        sourceType:     order.sourceType,
        // 同快递单配齐情况
        trackingOrders: allOrdersForTracking.map(o => ({
          orderNo:    o.orderNo,
          seqNo:      o.seqNo,
          status:     o.status,
          statusLabel: statusMap[o.status] || o.status,
          skuDesc:    `${o.modelName}·${o.frameCount}帧·${o.size}·${o.material}·${o.colorName}`,
          done:       o.status === 'producing' || o.status === 'shipped'
        })),
        isComplete
      }
    })
  })

  // GET /api/admin/scan/tracking/:trackingNo
  // 扫快递单号，返回该面单下所有订单及配齐状态
  fastify.get('/scan/tracking/:trackingNo', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { trackingNo } = req.params

    const orders = await fastify.prisma.customizeOrder.findMany({
      where: { trackingNo },
      orderBy: { seqNo: 'asc' },
      include: { user: { select: { phone: true, profile: { select: { nickname: true } } } } }
    })

    if (!orders.length)
      return reply.code(404).send({ success: false, message: '未找到该快递单号对应的订单，请确认单号是否正确' })

    const statusMap = {
      pending: '待付款', paid: '已付款', locked: '地址已导出',
      processing: '快递已录入', producing: '生产中', shipped: '已发货',
      received: '已签收', aftersale: '售后中', cancelled: '已取消'
    }

    // 查各订单的材料包条码
    const skuIds = [...new Set(orders.map(o => o.skuId).filter(Boolean))]
    const skus   = await fastify.prisma.machineModelSku.findMany({
      where: { id: { in: skuIds } },
      select: { id: true, skuBarcode: true }
    })
    const skuBarcodeMap = Object.fromEntries(skus.map(s => [s.id, s.skuBarcode]))

    const isComplete = orders.every(o => o.status === 'producing' || o.status === 'shipped')
    const doneCount  = orders.filter(o => o.status === 'producing' || o.status === 'shipped').length

    const o0 = orders[0]
    return reply.send({
      success: true,
      type: 'tracking',
      data: {
        trackingNo,
        trackingCompany:  o0.trackingCompany || '',
        receiverName:     o0.receiverName,
        receiverPhone:    o0.receiverPhone,
        receiverCity:     o0.receiverCity,
        receiverAddress:  o0.receiverAddress,
        totalCount:       orders.length,
        doneCount,
        isComplete,
        orders: orders.map(o => ({
          orderNo:    o.orderNo,
          seqNo:      o.seqNo,
          status:     o.status,
          statusLabel: statusMap[o.status] || o.status,
          skuDesc:    `${o.modelName}·${o.frameCount}帧·${o.size}·${o.material}·${o.colorName}`,
          skuBarcode: skuBarcodeMap[o.skuId] || null,
          done:       o.status === 'producing' || o.status === 'shipped',
          sourceType: o.sourceType
        }))
      }
    })
  })



  // ══════════════════════════════════════════
  // 发货流程接口
  // ══════════════════════════════════════════

  // POST /api/admin/scan/confirm-order
  // 扫码确认单个订单已打包（不改状态，只做归属校验）
  // body: { orderNo, trackingNo }
  // 逻辑：
  //   1. 检查订单是否属于传入的快递单 → 匹配则返回 matched:true
  //   2. 如果不属于，查找该订单属于哪个快递单 → 返回 matched:false + belongsTo
  fastify.post('/scan/confirm-order', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { orderNo, trackingNo } = req.body
    if (!orderNo || !trackingNo)
      return reply.code(400).send({ success: false, message: 'orderNo 和 trackingNo 不能为空' })

    const order = await fastify.prisma.customizeOrder.findUnique({
      where: { orderNo },
      select: {
        orderNo: true, trackingNo: true, status: true, seqNo: true,
        modelName: true, frameCount: true, size: true, material: true, colorName: true,
        receiverName: true, receiverPhone: true, skuId: true
      }
    })

    if (!order)
      return reply.code(404).send({ success: false, message: '订单不存在' })

    // 检查是否属于当前快递单
    if (order.trackingNo === trackingNo) {
      // 查该快递单所有订单，判断配齐状态
      const siblings = await fastify.prisma.customizeOrder.findMany({
        where: { trackingNo },
        select: { orderNo: true, status: true, modelName: true, frameCount: true, size: true, material: true, colorName: true, seqNo: true }
      })
      const statusMap = {
        pending:'待付款', paid:'已付款', locked:'地址已导出',
        processing:'快递已录入', producing:'生产中', shipped:'已发货'
      }
      return reply.send({
        success: true,
        matched: true,
        data: {
          orderNo:    order.orderNo,
          seqNo:      order.seqNo,
          skuDesc:    `${order.modelName}·${order.frameCount}帧·${order.size}·${order.material}·${order.colorName}`,
          status:     order.status,
          siblings:   siblings.map(s => ({
            orderNo:  s.orderNo,
            seqNo:    s.seqNo,
            skuDesc:  `${s.modelName}·${s.frameCount}帧·${s.size}·${s.material}·${s.colorName}`,
            status:   s.status,
            statusLabel: statusMap[s.status] || s.status,
            done:     s.status === 'producing' || s.status === 'shipped'
          }))
        }
      })
    }

    // 不属于当前快递单 → 返回它属于哪个快递单
    return reply.send({
      success: true,
      matched: false,
      data: {
        orderNo:      order.orderNo,
        seqNo:        order.seqNo,
        skuDesc:      `${order.modelName}·${order.frameCount}帧·${order.size}·${order.material}·${order.colorName}`,
        belongsTo:    order.trackingNo,
        receiverName: order.receiverName,
        receiverPhone: order.receiverPhone
      }
    })
  })

  // POST /api/admin/scan/ship-tracking
  // 确认整个快递单发货 → 所有订单状态变 shipped
  // body: { trackingNo, confirmedOrderNos: [] }
  // confirmedOrderNos：前端已扫码确认过的订单号列表，后端二次校验
  fastify.post('/scan/ship-tracking', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { trackingNo, confirmedOrderNos } = req.body
    if (!trackingNo)
      return reply.code(400).send({ success: false, message: 'trackingNo 不能为空' })

    const orders = await fastify.prisma.customizeOrder.findMany({
      where: { trackingNo },
      select: { orderNo: true, status: true }
    })

    if (!orders.length)
      return reply.code(404).send({ success: false, message: '未找到该快递单对应的订单' })

    // 校验：所有订单都在 confirmedOrderNos 里
    const confirmed = new Set(Array.isArray(confirmedOrderNos) ? confirmedOrderNos : [])
    const unconfirmed = orders.filter(o => !confirmed.has(o.orderNo) && o.status !== 'shipped')

    if (unconfirmed.length > 0) {
      return reply.code(400).send({
        success: false,
        message: `还有 ${unconfirmed.length} 个订单未扫码确认`,
        unconfirmedOrders: unconfirmed.map(o => o.orderNo)
      })
    }

    // 更新所有订单状态为 shipped，同步写入发货时间
    await fastify.prisma.customizeOrder.updateMany({
      where: { trackingNo, status: { not: 'shipped' } },
      data:  { status: 'shipped', shippedAt: new Date() }
    })

    try {
      await fastify.prisma.operationLog.create({
        data: {
          userId: req.user.userId, userRole: req.user.role ?? 0,
          method: 'POST', path: req.url,
          action: `快递单 ${trackingNo} 确认发货，共 ${orders.length} 个订单变为已发货`,
          targetId: trackingNo,
          ip: req.ip || null
        }
      })
    } catch(e) {}

    return reply.send({
      success: true,
      message: `发货成功，${orders.length} 个订单已标记为已发货`,
      shippedCount: orders.length
    })
  })

  // ══════════════════════════════════════════
  // Batch_Item 生产看板
  // ══════════════════════════════════════════

  // GET /api/admin/batches/:batchId/progress
  // 返回批次内各SKU的 planned/actual/defect/remaining
  fastify.get('/batches/:batchId/progress', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { batchId } = req.params
    const items = await fastify.prisma.batchItem.findMany({
      where: { batchId },
      orderBy: { skuCode: 'asc' }
    })
    if (!items.length)
      return reply.code(404).send({ success: false, message: '批次不存在或无 Batch_Item 记录' })

    const result = items.map(item => ({
      ...item,
      remaining: Math.max(0, item.plannedQty - item.actualQty - item.defectQty),
      completePct: item.plannedQty > 0 ? Math.round(item.actualQty / item.plannedQty * 100) : 0
    }))

    const total = result.reduce((acc, i) => {
      acc.planned += i.plannedQty
      acc.actual  += i.actualQty
      acc.defect  += i.defectQty
      return acc
    }, { planned: 0, actual: 0, defect: 0 })

    return reply.send({ success: true, data: { batchId, items: result, total } })
  })

  // POST /api/admin/batches/:batchId/items/:skuId/defect
  // 生产端点击「报废重制」：defect_qty +1
  fastify.post('/batches/:batchId/items/:skuId/defect', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { batchId, skuId } = req.params
    const item = await fastify.prisma.batchItem.findUnique({
      where: { batchId_skuId: { batchId, skuId } }
    })
    if (!item) return reply.code(404).send({ success: false, message: 'Batch_Item 记录不存在' })

    const updated = await fastify.prisma.batchItem.update({
      where: { batchId_skuId: { batchId, skuId } },
      data:  { defectQty: { increment: 1 } }
    })
    return reply.send({ success: true, data: updated })
  })

  // POST /api/admin/batches/:batchId/items/:skuId/complete
  // 扫码配对成功：actual_qty +1（生产端调用）
  fastify.post('/batches/:batchId/items/:skuId/complete', {
    preHandler: [fastify.requireRole(1)]
  }, async (req, reply) => {
    const { batchId, skuId } = req.params
    const item = await fastify.prisma.batchItem.findUnique({
      where: { batchId_skuId: { batchId, skuId } }
    })
    if (!item) return reply.code(404).send({ success: false, message: 'Batch_Item 记录不存在' })

    const updated = await fastify.prisma.batchItem.update({
      where: { batchId_skuId: { batchId, skuId } },
      data:  { actualQty: { increment: 1 } }
    })
    return reply.send({ success: true, data: updated })
  })

  // ══════════════════════════════════════════
  // 正版验证码打印接口（auth_codes）
  // ══════════════════════════════════════════

  // GET /api/admin/auth-codes/order/:orderId
  // 查看单个订单的正版验证码
  fastify.get('/auth-codes/order/:orderId', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { orderId } = req.params
    const codes = await fastify.prisma.authCode.findMany({
      where: { orderId },
      orderBy: { issuedAt: 'desc' }
    })
    return reply.send({ success: true, data: codes })
  })

  // GET /api/admin/auth-codes/batch/:batchId
  // 导出批次所有正版验证码（用于批量打印）
  // Query: ?format=csv（默认 JSON）
  fastify.get('/auth-codes/batch/:batchId', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { batchId }    = req.params
    const { format = 'json' } = req.query

    // 找到该批次所有订单
    const orders = await fastify.prisma.customizeOrder.findMany({
      where:  { batchId },
      select: { id: true, orderNo: true, receiverName: true, skuId: true }
    })
    if (!orders.length)
      return reply.code(404).send({ success: false, message: '批次不存在或无订单' })

    const orderIds = orders.map(o => o.id)
    const codes    = await fastify.prisma.authCode.findMany({ where: { orderId: { in: orderIds } } })

    const orderMap = Object.fromEntries(orders.map(o => [o.id, o]))
    const skuIds   = [...new Set(orders.map(o => o.skuId))]
    const skus     = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } } })
    const skuMap   = Object.fromEntries(skus.map(s => [s.id, s]))

    const result = codes.map(c => ({
      code:         c.code,
      orderNo:      orderMap[c.orderId]?.orderNo ?? '—',
      receiverName: orderMap[c.orderId]?.receiverName ?? '—',
      skuCode:      skuMap[orderMap[c.orderId]?.skuId]?.skuCode ?? '—',
      issuedAt:     c.issuedAt,
    }))

    if (format === 'csv') {
      const header = '验证码,订单号,收件人,SKU编码,发货时间'
      const lines  = result.map(r =>
        [r.code, r.orderNo, r.receiverName, r.skuCode, r.issuedAt?.toISOString() ?? ''].join(',')
      )
      const csv = '\uFEFF' + header + '\n' + lines.join('\n')
      reply.raw.setHeader('Content-Type', 'text/csv; charset=utf-8')
      reply.raw.setHeader('Content-Disposition', `attachment; filename="auth_codes_${batchId}.csv"`)
      return reply.send(csv)
    }

    return reply.send({ success: true, data: result })
  })

  // POST /api/admin/auth-codes/generate/:orderId
  // 手动生成正版验证码（发货时未自动生成的补救）
  fastify.post('/auth-codes/generate/:orderId', {
    preHandler: [fastify.requireRole(2)]
  }, async (req, reply) => {
    const { orderId } = req.params

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { id: orderId } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    // 已有则直接返回
    const existing = await fastify.prisma.authCode.findFirst({ where: { orderId } })
    if (existing) return reply.send({ success: true, data: existing, message: '该订单已有验证码' })

    const sku       = await fastify.prisma.machineModelSku.findUnique({ where: { id: order.skuId } })
    const year      = new Date().getFullYear().toString().slice(2)
    const random    = Math.random().toString(36).slice(2, 8).toUpperCase()
    const checkChar = String.fromCharCode(65 + ((order.orderNo?.length ?? 0) + (sku?.id?.length ?? 0)) % 26)
    const code      = `${year}${random}${checkChar}`

    const authCode = await fastify.prisma.authCode.create({
      data: { code, orderId, skuId: order.skuId, issuedAt: new Date() }
    })
    return reply.send({ success: true, data: authCode })
  })

  // ──────────────────────────────────────────────
  // GET /api/admin/aftersales
  // 售后申请列表，支持 status / page / limit 过滤
  // ──────────────────────────────────────────────
  fastify.get('/aftersales', async (req, reply) => {
    const { status = 'pending', page = 1, limit = 20 } = req.query
    const where = status === 'all' ? {} : { status }
    const skip  = (Number(page) - 1) * Number(limit)

    const [requests, total] = await Promise.all([
      fastify.prisma.aftersaleRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
        include: {
          order: {
            select: {
              orderNo:      true,
              status:       true,
              sourceType:   true,
              modelName:    true,
              size:         true,
              frameCount:   true,
              material:     true,
              colorName:    true,
              receiverName: true,
              collabWorkId: true,
              receivedAt:   true,
            },
          },
          user: { select: { id: true, phone: true } },
        },
      }),
      fastify.prisma.aftersaleRequest.count({ where }),
    ])

    // 图片预签名（OSS key → 临时访问 URL）
    const processed = requests.map(r => {
      let imageSignedUrls = []
      try {
        const keys = JSON.parse(r.imageUrls || '[]')
        imageSignedUrls = keys.map(k => {
          try { return fastify.ossPresignGet(k, 3600) } catch { return null }
        }).filter(Boolean)
      } catch {}
      return { ...r, imageSignedUrls }
    })

    return reply.send({
      success: true,
      data: { requests: processed, total, page: Number(page), limit: Number(limit) },
    })
  })

  // ──────────────────────────────────────────────
  // PUT /api/admin/aftersales/:id
  // 处理售后申请：approved（同意）/ rejected（拒绝）/ completed（已完成退款/换货）
  // ──────────────────────────────────────────────
  fastify.put('/aftersales/:id', async (req, reply) => {
    const adminId = req.user.userId
    const { id }  = req.params
    const { status, adminNote } = req.body

    const VALID = ['approved', 'rejected', 'completed']
    if (!VALID.includes(status)) {
      return reply.code(400).send({ success: false, message: '无效处理状态' })
    }

    const request = await fastify.prisma.aftersaleRequest.findUnique({
      where: { id },
      include: { order: true },
    })
    if (!request) return reply.code(404).send({ success: false, message: '售后申请不存在' })
    if (request.status !== 'pending') {
      return reply.code(400).send({ success: false, message: '该申请已处理，不可重复操作' })
    }

    await fastify.prisma.$transaction(async tx => {
      await tx.aftersaleRequest.update({
        where: { id },
        data: { status, adminNote: adminNote || null, adminId, processedAt: new Date() },
      })

      if (status === 'rejected') {
        // 拒绝：恢复订单到售后前的状态
        const prevStatus = request.order.receivedAt ? 'received' : 'shipped'
        await tx.customizeOrder.update({
          where: { id: request.orderId },
          data:  { status: prevStatus },
        })
        // 注意：联名分红已被申请时取消，拒绝后不自动恢复（需管理员人工在结算系统处理）
      }
      // approved / completed：订单保持 aftersale 状态，退款等操作线下处理
    })

    return reply.send({ success: true })
  })

}