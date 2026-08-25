import { loadPrintCutConfig } from '../lib/print-production.js'

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max)
}

function positiveInt(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function createGroupCode() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `PCG-${stamp}-${random}`
}

function previewUrl(fastify, sku) {
  const key = sku.previewImage || sku.model?.previewImage
  if (!key) return null
  if (/^https?:\/\//i.test(key)) return key
  return fastify.ossPresignGet(key, 3600)
}

export default async function printProductionRoutes(fastify) {
  const requireAdmin = fastify.requireRole(2)

  fastify.get('/', { preHandler: requireAdmin }, async (_req, reply) => {
    const [groups, skus] = await Promise.all([
      loadPrintCutConfig(fastify.prisma, { activeOnly: false }),
      fastify.prisma.machineModelSku.findMany({
        include: { model: { select: { id: true, name: true, previewImage: true, isActive: true, sortOrder: true } } },
        orderBy: [{ model: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
      })
    ])
    const assignmentBySku = new Map(groups.flatMap(group => group.rules.map(rule => [rule.skuId, {
      ruleId: rule.id, groupId: group.id, groupName: group.name, active: group.isActive && rule.isActive
    }])))
    const skuRows = skus.map(sku => ({
      id: sku.id, skuCode: sku.skuCode, size: sku.size, material: sku.material,
      frameCount: sku.frameCount, colorName: sku.colorName, colorHex: sku.colorHex,
      isActive: sku.isActive, sortOrder: sku.sortOrder, modelId: sku.modelId,
      modelName: sku.model.name, modelActive: sku.model.isActive, modelSortOrder: sku.model.sortOrder,
      previewUrl: previewUrl(fastify, sku), assignment: assignmentBySku.get(sku.id) || null
    }))
    return reply.send({ success: true, data: { groups, skus: skuRows } })
  })

  fastify.post('/groups', { preHandler: requireAdmin }, async (req, reply) => {
    const name = text(req.body?.name, 80)
    const size = text(req.body?.size, 20)
    const framesPerSheet = positiveInt(req.body?.framesPerSheet)
    if (!name || !size || !framesPerSheet) {
      return reply.code(400).send({ success: false, message: '请填写组名、尺寸和每页帧数' })
    }
    const last = await fastify.prisma.printCutGroup.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const group = await fastify.prisma.printCutGroup.create({ data: {
      code: createGroupCode(), name, size,
      paperSize: text(req.body?.paperSize, 20) || 'A4', framesPerSheet,
      cuttingTool: text(req.body?.cuttingTool, 80) || null,
      templateKey: text(req.body?.templateKey, 120) || null,
      sortOrder: (last?.sortOrder ?? -1) + 1, createdBy: req.user.userId
    } })
    return reply.code(201).send({ success: true, data: group })
  })

  fastify.put('/groups/reorder', { preHandler: requireAdmin }, async (req, reply) => {
    const groupIds = [...new Set(Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter(Boolean) : [])]
    if (!groupIds.length) return reply.code(400).send({ success: false, message: '请选择需要排序的打印裁切组' })
    const count = await fastify.prisma.printCutGroup.count({ where: { id: { in: groupIds } } })
    if (count !== groupIds.length) return reply.code(400).send({ success: false, message: '部分打印裁切组不存在' })
    await fastify.prisma.$transaction(groupIds.map((id, sortOrder) => fastify.prisma.printCutGroup.update({ where: { id }, data: { sortOrder } })))
    return reply.send({ success: true, message: '打印裁切组顺序已保存' })
  })

  fastify.put('/groups/:groupId', { preHandler: requireAdmin }, async (req, reply) => {
    const group = await fastify.prisma.printCutGroup.findUnique({ where: { id: req.params.groupId }, include: { rules: true } })
    if (!group) return reply.code(404).send({ success: false, message: '打印裁切组不存在' })
    const name = text(req.body?.name ?? group.name, 80)
    const size = text(req.body?.size ?? group.size, 20)
    const framesPerSheet = positiveInt(req.body?.framesPerSheet ?? group.framesPerSheet)
    if (!name || !size || !framesPerSheet) return reply.code(400).send({ success: false, message: '组名、尺寸和每页帧数不能为空' })
    if (size !== group.size && group.rules.length) {
      return reply.code(409).send({ success: false, message: '该组已有 SKU，请先移出后再修改尺寸' })
    }
    const updated = await fastify.prisma.$transaction(async tx => {
      const saved = await tx.printCutGroup.update({ where: { id: group.id }, data: {
        name, size, framesPerSheet,
        paperSize: text(req.body?.paperSize ?? group.paperSize, 20) || 'A4',
        cuttingTool: text(req.body?.cuttingTool, 80) || null,
        templateKey: text(req.body?.templateKey, 120) || null,
        isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : group.isActive
      } })
      if (framesPerSheet !== group.framesPerSheet && group.rules.length) {
        const rules = await tx.printCutRule.findMany({ where: { groupId: group.id }, include: { sku: { select: { frameCount: true } } } })
        for (const rule of rules) {
          await tx.printCutRule.update({ where: { id: rule.id }, data: { pagesPerUnit: Math.ceil(rule.sku.frameCount / framesPerSheet) } })
        }
      }
      return saved
    })
    return reply.send({ success: true, data: updated })
  })

  fastify.post('/rules', { preHandler: requireAdmin }, async (req, reply) => {
    const group = await fastify.prisma.printCutGroup.findUnique({ where: { id: req.body?.groupId }, include: { rules: true } })
    if (!group) return reply.code(404).send({ success: false, message: '打印裁切组不存在' })
    const skuIds = [...new Set([...(Array.isArray(req.body?.skuIds) ? req.body.skuIds : []), req.body?.skuId].filter(Boolean))]
    if (!skuIds.length) return reply.code(400).send({ success: false, message: '请选择需要加入的 SKU' })
    const skus = await fastify.prisma.machineModelSku.findMany({ where: { id: { in: skuIds } }, select: { id: true, size: true, frameCount: true } })
    if (skus.length !== skuIds.length) return reply.code(400).send({ success: false, message: '部分 SKU 不存在' })
    if (skus.some(sku => sku.size !== group.size)) return reply.code(409).send({ success: false, message: `只能加入尺寸为 ${group.size} 的 SKU` })
    const assigned = await fastify.prisma.printCutRule.findMany({ where: { skuId: { in: skuIds } }, select: { skuId: true } })
    if (assigned.length) return reply.code(409).send({ success: false, message: '部分 SKU 已经分配，请刷新后重试', data: assigned.map(row => row.skuId) })
    const startOrder = group.rules.reduce((max, rule) => Math.max(max, rule.sortOrder), -1) + 1
    const skuMap = new Map(skus.map(sku => [sku.id, sku]))
    await fastify.prisma.printCutRule.createMany({ data: skuIds.map((skuId, index) => {
      const sku = skuMap.get(skuId)
      return {
      groupId: group.id, skuId: sku.id,
      pagesPerUnit: Math.ceil(sku.frameCount / group.framesPerSheet),
      sortOrder: startOrder + index
      }
    }) })
    return reply.code(201).send({ success: true, message: `已加入 ${skus.length} 个 SKU` })
  })

  fastify.put('/rules/reorder', { preHandler: requireAdmin }, async (req, reply) => {
    const ruleIds = [...new Set(Array.isArray(req.body?.ruleIds) ? req.body.ruleIds.filter(Boolean) : [])]
    if (!ruleIds.length) return reply.code(400).send({ success: false, message: '请选择需要排序的 SKU' })
    const rules = await fastify.prisma.printCutRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, groupId: true } })
    if (rules.length !== ruleIds.length || new Set(rules.map(rule => rule.groupId)).size !== 1) {
      return reply.code(400).send({ success: false, message: '只能调整同一打印裁切组内的 SKU 顺序' })
    }
    await fastify.prisma.$transaction(ruleIds.map((id, sortOrder) => fastify.prisma.printCutRule.update({ where: { id }, data: { sortOrder } })))
    return reply.send({ success: true, message: '组内 SKU 顺序已保存' })
  })

  fastify.put('/rules/:ruleId/move', { preHandler: requireAdmin }, async (req, reply) => {
    const [rule, group] = await Promise.all([
      fastify.prisma.printCutRule.findUnique({ where: { id: req.params.ruleId }, include: { sku: true } }),
      fastify.prisma.printCutGroup.findUnique({ where: { id: req.body?.groupId }, include: { rules: true } })
    ])
    if (!rule || !group) return reply.code(404).send({ success: false, message: 'SKU配置或目标打印组不存在' })
    if (rule.sku.size !== group.size) return reply.code(409).send({ success: false, message: `只能移入尺寸为 ${rule.sku.size} 的打印组` })
    const sortOrder = group.rules.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1
    const moved = await fastify.prisma.printCutRule.update({ where: { id: rule.id }, data: {
      groupId: group.id, pagesPerUnit: Math.ceil(rule.sku.frameCount / group.framesPerSheet), sortOrder
    } })
    return reply.send({ success: true, data: moved })
  })

  fastify.delete('/rules/:ruleId', { preHandler: requireAdmin }, async (req, reply) => {
    const rule = await fastify.prisma.printCutRule.findUnique({ where: { id: req.params.ruleId } })
    if (!rule) return reply.code(404).send({ success: false, message: 'SKU打印配置不存在' })
    await fastify.prisma.printCutRule.delete({ where: { id: rule.id } })
    return reply.send({ success: true, message: 'SKU已移回尚未配置区；已有批次不受影响' })
  })
}
