import { loadPrintCutConfig, printSpecKey } from '../lib/print-production.js'

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

export default async function printProductionRoutes(fastify) {
  const requireAdmin = fastify.requireRole(2)

  fastify.get('/', { preHandler: requireAdmin }, async (_req, reply) => {
    const [groups, skus] = await Promise.all([
      loadPrintCutConfig(fastify.prisma, { activeOnly: false }),
      fastify.prisma.machineModelSku.findMany({
        where: { isActive: true, model: { isActive: true } },
        select: {
          id: true, size: true, frameCount: true,
          model: { select: { id: true, name: true, sortOrder: true } }
        },
        orderBy: [{ size: 'asc' }, { frameCount: 'asc' }]
      })
    ])
    const ruleBySpec = new Map(groups.flatMap(group => group.rules.map(rule => [
      printSpecKey(rule.size, rule.frameCount), { ruleId: rule.id, groupId: group.id, groupName: group.name, active: group.isActive && rule.isActive }
    ])))
    const specifications = [...new Map(skus.map(sku => {
      const key = printSpecKey(sku.size, sku.frameCount)
      return [key, {
        key,
        size: sku.size,
        frameCount: sku.frameCount,
        modelNames: [],
        skuCount: 0,
        assignment: ruleBySpec.get(key) || null
      }]
    })).values()]
    for (const specification of specifications) {
      const matching = skus.filter(sku => printSpecKey(sku.size, sku.frameCount) === specification.key)
      specification.skuCount = matching.length
      specification.modelNames = [...new Set(matching.sort((a, b) => a.model.sortOrder - b.model.sortOrder).map(sku => sku.model.name))]
    }
    return reply.send({ success: true, data: { groups, specifications } })
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
      code: createGroupCode(),
      name,
      size,
      paperSize: text(req.body?.paperSize, 20) || 'A4',
      framesPerSheet,
      cuttingTool: text(req.body?.cuttingTool, 80) || null,
      templateKey: text(req.body?.templateKey, 120) || null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdBy: req.user.userId
    } })
    return reply.code(201).send({ success: true, data: group })
  })

  fastify.put('/groups/reorder', { preHandler: requireAdmin }, async (req, reply) => {
    const groupIds = [...new Set(Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter(Boolean) : [])]
    if (!groupIds.length) return reply.code(400).send({ success: false, message: '请选择需要排序的打印裁切组' })
    const count = await fastify.prisma.printCutGroup.count({ where: { id: { in: groupIds } } })
    if (count !== groupIds.length) return reply.code(400).send({ success: false, message: '部分打印裁切组不存在' })
    await fastify.prisma.$transaction(groupIds.map((id, sortOrder) => fastify.prisma.printCutGroup.update({ where: { id }, data: { sortOrder } })))
    return reply.send({ success: true, message: '生产顺序已保存' })
  })

  fastify.put('/groups/:groupId', { preHandler: requireAdmin }, async (req, reply) => {
    const group = await fastify.prisma.printCutGroup.findUnique({ where: { id: req.params.groupId }, include: { rules: true } })
    if (!group) return reply.code(404).send({ success: false, message: '打印裁切组不存在' })
    const name = text(req.body?.name ?? group.name, 80)
    const size = text(req.body?.size ?? group.size, 20)
    const framesPerSheet = positiveInt(req.body?.framesPerSheet ?? group.framesPerSheet)
    if (!name || !size || !framesPerSheet) return reply.code(400).send({ success: false, message: '组名、尺寸和每页帧数不能为空' })
    if (size !== group.size && group.rules.length) {
      return reply.code(409).send({ success: false, message: '该组已有适用规则，请先移动或删除规则后再修改尺寸' })
    }
    const updated = await fastify.prisma.$transaction(async tx => {
      const saved = await tx.printCutGroup.update({ where: { id: group.id }, data: {
        name,
        size,
        framesPerSheet,
        paperSize: text(req.body?.paperSize ?? group.paperSize, 20) || 'A4',
        cuttingTool: text(req.body?.cuttingTool, 80) || null,
        templateKey: text(req.body?.templateKey, 120) || null,
        isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : group.isActive
      } })
      if (framesPerSheet !== group.framesPerSheet && group.rules.length) {
        for (const rule of group.rules) {
          await tx.printCutRule.update({ where: { id: rule.id }, data: { pagesPerUnit: Math.ceil(rule.frameCount / framesPerSheet) } })
        }
      }
      return saved
    })
    return reply.send({ success: true, data: updated })
  })

  fastify.post('/rules', { preHandler: requireAdmin }, async (req, reply) => {
    const group = await fastify.prisma.printCutGroup.findUnique({ where: { id: req.body?.groupId }, include: { rules: true } })
    if (!group) return reply.code(404).send({ success: false, message: '打印裁切组不存在' })
    const frameCount = positiveInt(req.body?.frameCount)
    if (!frameCount) return reply.code(400).send({ success: false, message: '成品帧数必须是正整数' })
    const existing = await fastify.prisma.printCutRule.findUnique({ where: { size_frameCount: { size: group.size, frameCount } } })
    if (existing) return reply.code(409).send({ success: false, message: `${group.size} ${frameCount}帧已经配置了生产规则` })
    const rule = await fastify.prisma.printCutRule.create({ data: {
      groupId: group.id,
      size: group.size,
      frameCount,
      pagesPerUnit: Math.ceil(frameCount / group.framesPerSheet),
      sortOrder: group.rules.length
    } })
    return reply.code(201).send({ success: true, data: rule })
  })

  fastify.put('/rules/reorder', { preHandler: requireAdmin }, async (req, reply) => {
    const ruleIds = [...new Set(Array.isArray(req.body?.ruleIds) ? req.body.ruleIds.filter(Boolean) : [])]
    if (!ruleIds.length) return reply.code(400).send({ success: false, message: '请选择需要排序的规则' })
    const rules = await fastify.prisma.printCutRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, groupId: true } })
    if (rules.length !== ruleIds.length || new Set(rules.map(rule => rule.groupId)).size !== 1) {
      return reply.code(400).send({ success: false, message: '只能调整同一打印裁切组内的规则' })
    }
    await fastify.prisma.$transaction(ruleIds.map((id, sortOrder) => fastify.prisma.printCutRule.update({ where: { id }, data: { sortOrder } })))
    return reply.send({ success: true, message: '组内顺序已保存' })
  })

  fastify.delete('/rules/:ruleId', { preHandler: requireAdmin }, async (req, reply) => {
    const rule = await fastify.prisma.printCutRule.findUnique({ where: { id: req.params.ruleId } })
    if (!rule) return reply.code(404).send({ success: false, message: '适用规则不存在' })
    await fastify.prisma.printCutRule.delete({ where: { id: rule.id } })
    return reply.send({ success: true, message: '适用规则已删除；已有批次的历史顺序不受影响' })
  })
}
