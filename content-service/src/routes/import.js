// src/routes/import.js
// 多平台订单导入接口
// 注册前缀：/api/admin/import

import { lockInventory, makeIdempotencyKey, ensureInventoryRecord } from '../lib/inventory.js'

// 手机号校验：大陆11位
const PHONE_REGEX = /^1[3-9]\d{9}$/

// 淘宝 CSV 中文表头 → 系统字段映射
const TB_HEADER_MAP = {
  '订单编号':   'externalOrderId',
  '付款时间':   'paidAt',
  '收货人姓名': 'receiverName',
  '联系手机':   'receiverPhone',
  '省':         'province',
  '市':         'city',
  '区':         'district',
  '详细地址':   'detail',
  '宝贝标题':   'itemTitle',
  '宝贝种类':   'itemSpec',
  '数量':       'qty',
  '买家留言':   'buyerNote',
}

export default async function importRoutes(fastify) {

  // ─────────────────────────────────────────────
  // POST /api/admin/import/taobao
  // 上传淘宝 CSV，批量创建订单
  // multipart/form-data: { file }
  // ─────────────────────────────────────────────
  fastify.post('/taobao', { preHandler: requireAdmin }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ success: false, message: '请上传淘宝导出CSV文件' })

    const chunks = []
    for await (const chunk of data.file) chunks.push(chunk)
    const csvText = Buffer.concat(chunks).toString('utf-8')

    const rows = parseCsv(csvText)
    if (!rows.length) return reply.code(400).send({ success: false, message: 'CSV解析失败或文件为空' })

    const results = { created: 0, skipped: 0, pendingInfo: 0, pendingSku: 0, errors: [] }

    for (const row of rows) {
      try {
        const externalOrderId = row['externalOrderId']?.trim()
        if (!externalOrderId) continue

        // 幂等：已存在则跳过
        const existing = await fastify.prisma.customizeOrder.findFirst({
          where: { platform: 'TAOBAO', externalOrderId }
        })
        if (existing) { results.skipped++; continue }

        // 拼接地址
        const address = [row.province, row.city, row.district, row.detail].filter(Boolean).join('')

        // 校验锁
        const phoneOk   = PHONE_REGEX.test(row.receiverPhone?.trim())
        const addressOk = address.length >= 10
        const externalDesc = `${row.itemTitle ?? ''} ${row.itemSpec ?? ''}`.trim()

        // SKU映射
        const mapping = externalDesc
          ? await fastify.prisma.platformSkuMapping.findFirst({
              where: { platform: 'TB', externalDesc: { contains: externalDesc.substring(0, 20) } }
            })
          : null

        // 确定 importStatus
        let importStatus = null
        if (!phoneOk || !addressOk) importStatus = 'pending_info'
        else if (!mapping)          importStatus = 'pending_sku'

        // 找到内部 skuId
        let skuId = null
        let skuForModel = null
        if (mapping) {
          skuForModel = await fastify.prisma.machineModelSku.findFirst({ where: { skuCode: mapping.internalSkuCode } })
          skuId = skuForModel?.id ?? null
        }

        // 联名款判断
        const isCollab = !!mapping?.collabWorkId

        // 创建订单
        const orderNo = `TB${Date.now()}${Math.random().toString(36).slice(2,5).toUpperCase()}`
        await fastify.prisma.customizeOrder.create({
          data: {
            orderNo,
            userId:         req.user.userId,  // 导入操作员
            modelId:        skuForModel?.modelId ?? '',
            modelName:      row.itemTitle ?? '',
            frameCount:     0,
            size:           skuForModel?.size ?? '',
            material:       skuForModel?.material ?? '',
            color:          skuForModel?.colorHex ?? '',
            colorName:      skuForModel?.colorName ?? '',
            skuId:          skuId ?? '',
            ossPath:        '',
            frameUrls:      '[]',
            status:         importStatus ? 'pending' : 'paid',
            platform:       'TAOBAO',
            externalOrderId,
            importStatus,
            sourceType:     isCollab ? 'collab' : 'custom',
            collabWorkId:   isCollab ? mapping.collabWorkId : null,
            receiverName:   row.receiverName?.trim()  ?? '',
            receiverPhone:  row.receiverPhone?.trim() ?? '',
            receiverAddress: address,
            receiverCity:   row.city?.trim() ?? '',
            buyerNote:      row.buyerNote?.trim() ?? null,
          }
        })

        // 若信息完整，触发库存锁定
        if (!importStatus && skuId) {
          await ensureInventoryRecord(fastify.prisma, skuId)
          try {
            await lockInventory(
              fastify.prisma, skuId, 1, orderNo,
              makeIdempotencyKey('tb_lock', externalOrderId)
            )
          } catch (e) {
            // 库存不足：标记 inventory_status = insufficient
            await fastify.prisma.customizeOrder.updateMany({
              where: { orderNo },
              data:  { inventoryStatus: 'insufficient' }
            })
          }
        }

        if (importStatus === 'pending_info') results.pendingInfo++
        else if (importStatus === 'pending_sku') results.pendingSku++
        else results.created++

      } catch (err) {
        results.errors.push({ row: row.externalOrderId, error: err.message })
      }
    }

    return reply.send({ success: true, data: results })
  })

  // ─────────────────────────────────────────────
  // POST /api/admin/import/manual
  // 手动录入单条订单（抖音/小红书人工补录）
  // Body: { platform, externalOrderId, receiverName, receiverPhone, receiverAddress, receiverCity,
  //         skuCode, qty?, buyerNote? }
  // ─────────────────────────────────────────────
  fastify.post('/manual', { preHandler: requireAdmin }, async (req, reply) => {
    const {
      platform, externalOrderId, receiverName, receiverPhone,
      receiverAddress, receiverCity, skuCode, buyerNote, collabWorkId
    } = req.body

    if (!platform || !externalOrderId)
      return reply.code(400).send({ success: false, message: '缺少平台或原始订单号' })
    if (!['DOUYIN', 'XHS', 'TAOBAO', 'SELF'].includes(platform))
      return reply.code(400).send({ success: false, message: '不支持的平台类型' })

    // 幂等
    const existing = await fastify.prisma.customizeOrder.findFirst({
      where: { platform, externalOrderId }
    })
    if (existing) return reply.code(409).send({ success: false, message: '该平台订单号已存在' })

    // 校验锁
    const phoneOk   = PHONE_REGEX.test(receiverPhone?.trim())
    const addressOk = (receiverAddress?.length ?? 0) >= 10

    let skuId = null
    let skuData = null
    if (skuCode) {
      skuData = await fastify.prisma.machineModelSku.findFirst({ where: { skuCode } })
      skuId   = skuData?.id ?? null
    }

    // 若传入 collabWorkId，验证联名作品存在
    let resolvedCollabWorkId = null
    if (collabWorkId) {
      const work = await fastify.prisma.collabWork.findUnique({ where: { id: collabWorkId } })
      if (!work) return reply.code(404).send({ success: false, message: '联名作品不存在' })
      resolvedCollabWorkId = collabWorkId
    }
    const isCollab = !!resolvedCollabWorkId

    let importStatus = null
    if (!phoneOk || !addressOk) importStatus = 'pending_info'
    else if (!skuId)            importStatus = 'pending_sku'

    const orderNo = `${platform.slice(0,2)}${Date.now()}${Math.random().toString(36).slice(2,5).toUpperCase()}`

    const order = await fastify.prisma.customizeOrder.create({
      data: {
        orderNo,
        userId:         req.user.userId,
        modelId:        skuData?.modelId ?? '',
        modelName:      skuCode ?? '',
        frameCount:     0,
        size:           skuData?.size ?? '',
        material:       skuData?.material ?? '',
        color:          skuData?.colorHex ?? '',
        colorName:      skuData?.colorName ?? '',
        skuId:          skuId ?? '',
        ossPath:        '',
        frameUrls:      '[]',
        status:         importStatus ? 'pending' : 'paid',
        platform,
        externalOrderId,
        importStatus,
        sourceType:     isCollab ? 'collab' : 'custom',
        collabWorkId:   resolvedCollabWorkId,
        receiverName:   receiverName?.trim()  ?? '',
        receiverPhone:  receiverPhone?.trim() ?? '',
        receiverAddress: receiverAddress?.trim() ?? '',
        receiverCity:   receiverCity?.trim() ?? '',
        buyerNote:      buyerNote?.trim() ?? null,
      }
    })

    // 锁库存
    if (!importStatus && skuId) {
      await ensureInventoryRecord(fastify.prisma, skuId)
      try {
        await lockInventory(
          fastify.prisma, skuId, 1, orderNo,
          makeIdempotencyKey('manual_lock', externalOrderId)
        )
      } catch (e) {
        await fastify.prisma.customizeOrder.update({
          where: { id: order.id },
          data:  { inventoryStatus: 'insufficient' }
        })
      }
    }

    return reply.send({ success: true, data: { orderNo, importStatus } })
  })

  // ─────────────────────────────────────────────
  // GET /api/admin/import/pending
  // 查看异常订单（待补全 / SKU待确认）
  // ─────────────────────────────────────────────
  fastify.get('/pending', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = 1, limit = 50, type } = req.query
    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const where = { importStatus: { not: null } }
    if (type) where.importStatus = type  // 'pending_info' | 'pending_sku'

    const [orders, total] = await Promise.all([
      fastify.prisma.customizeOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit) }),
      fastify.prisma.customizeOrder.count({ where })
    ])

    return reply.send({ success: true, data: { orders, total, page: parseInt(page) } })
  })

  // ─────────────────────────────────────────────
  // PUT /api/admin/import/:orderId/resolve
  // 人工补全收件信息 或 指定SKU映射
  // Body: { receiverName?, receiverPhone?, receiverAddress?, receiverCity?,
  //         skuCode?, saveMapping?, externalDesc? }
  // ─────────────────────────────────────────────
  fastify.put('/:orderId/resolve', { preHandler: requireAdmin }, async (req, reply) => {
    const { orderId } = req.params
    const {
      receiverName, receiverPhone, receiverAddress, receiverCity,
      skuCode, saveMapping, externalDesc, collabWorkId
    } = req.body

    const order = await fastify.prisma.customizeOrder.findUnique({ where: { id: orderId } })
    if (!order) return reply.code(404).send({ success: false, message: '订单不存在' })

    const updateData = {}

    // 补全收件信息
    if (receiverName)    updateData.receiverName    = receiverName.trim()
    if (receiverPhone)   updateData.receiverPhone   = receiverPhone.trim()
    if (receiverAddress) updateData.receiverAddress = receiverAddress.trim()
    if (receiverCity)    updateData.receiverCity    = receiverCity.trim()

    // 补全 SKU
    let skuId = order.skuId
    if (skuCode) {
      const sku = await fastify.prisma.machineModelSku.findFirst({ where: { skuCode } })
      if (!sku) return reply.code(404).send({ success: false, message: `sku_code ${skuCode} 不存在` })
      skuId = sku.id
      updateData.skuId    = skuId
      updateData.modelId  = sku.modelId
      updateData.size     = sku.size
      updateData.material = sku.material
      updateData.colorName = sku.colorName
      updateData.color    = sku.colorHex

      // 联名款：更新订单的 sourceType 和 collabWorkId
      if (collabWorkId !== undefined) {
        if (collabWorkId) {
          const work = await fastify.prisma.collabWork.findUnique({ where: { id: collabWorkId } })
          if (!work) return reply.code(404).send({ success: false, message: '联名作品不存在' })
          updateData.sourceType   = 'collab'
          updateData.collabWorkId = collabWorkId
        } else {
          updateData.sourceType   = 'custom'
          updateData.collabWorkId = null
        }
      }

      // 询问是否写入映射表
      if (saveMapping && externalDesc && order.platform !== 'SELF') {
        const platformCode = order.platform === 'TAOBAO' ? 'TB' : order.platform === 'DOUYIN' ? 'DY' : 'XHS'
        const mappingCollabWorkId = (collabWorkId !== undefined ? collabWorkId : null) || null
        await fastify.prisma.platformSkuMapping.upsert({
          where: { id: `${platformCode}_${externalDesc.substring(0, 30)}` },
          create: { platform: platformCode, externalDesc, internalSkuCode: skuCode, collabWorkId: mappingCollabWorkId },
          update: { internalSkuCode: skuCode, collabWorkId: mappingCollabWorkId }
        }).catch(() =>
          fastify.prisma.platformSkuMapping.create({
            data: { platform: platformCode, externalDesc, internalSkuCode: skuCode, collabWorkId: mappingCollabWorkId }
          })
        )
      }
    }

    // 重新验证
    const finalPhone   = updateData.receiverPhone   ?? order.receiverPhone
    const finalAddress = updateData.receiverAddress ?? order.receiverAddress
    const phoneOk      = PHONE_REGEX.test(finalPhone?.trim())
    const addressOk    = (finalAddress?.length ?? 0) >= 10
    const skuOk        = !!skuId

    if (phoneOk && addressOk && skuOk) {
      updateData.importStatus = null
      updateData.status       = 'paid'

      // 触发库存锁定
      await ensureInventoryRecord(fastify.prisma, skuId)
      try {
        await lockInventory(
          fastify.prisma, skuId, 1, order.orderNo,
          makeIdempotencyKey('resolve_lock', order.id)
        )
      } catch (e) {
        updateData.inventoryStatus = 'insufficient'
      }
    } else {
      updateData.importStatus = !phoneOk || !addressOk ? 'pending_info' : 'pending_sku'
    }

    const updated = await fastify.prisma.customizeOrder.update({ where: { id: orderId }, data: updateData })
    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────
  // 辅助函数
  // ─────────────────────────────────────────────

  function requireAdmin(req, reply, done) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      fastify.jwt.verify(token)
      const user = fastify.jwt.decode(token)
      if (!user || user.role < 2)
        return reply.code(403).send({ success: false, message: '权限不足' })
      req.user = user
      done()
    } catch {
      reply.code(401).send({ success: false, message: '未登录或token已过期' })
    }
  }

  // 极简 CSV 解析（支持淘宝中文表头，带引号字段）
  function parseCsv(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    const rawHeaders = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
    const headers    = rawHeaders.map(h => TB_HEADER_MAP[h] || h)

    return lines.slice(1).map(line => {
      const cells = splitCsvLine(line)
      const obj   = {}
      headers.forEach((h, i) => { obj[h] = cells[i]?.replace(/^"|"$/g, '').trim() ?? '' })
      return obj
    }).filter(r => r.externalOrderId)
  }

  function splitCsvLine(line) {
    const result = []
    let current  = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
      else { current += ch }
    }
    result.push(current)
    return result
  }
}
