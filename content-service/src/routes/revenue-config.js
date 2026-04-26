// src/routes/revenue-config.js — 分红参数配置接口
//
//   GET  /api/admin/revenue/configs   role>=2 可读
//   PUT  /api/admin/revenue/configs   role=3 超级管理员专属

const REVENUE_KEYS = [
  { key: 'revenue_max_rate',        label: '分红上限',           unit: '%', default: 0.25 },
  { key: 'revenue_newbie_rate',     label: '新手期固定分红率',    unit: '%', default: 0.15 },
  { key: 'revenue_newbie_works',    label: '新手期作品数量上限',  unit: '款', default: 3,   valueType: 'integer' },
  { key: 'revenue_newbie_days',     label: '新手期天数（审核通过起）', unit: '天', default: 14,  valueType: 'integer' },
  { key: 'revenue_exclusive_bonus', label: '独家加成',            unit: '%', default: 0.08 },
  { key: 'revenue_bull_coeff_1',    label: '1级牛量系数（萌牛）', unit: '×', default: 1.0 },
  { key: 'revenue_bull_coeff_2',    label: '2级牛量系数（勤牛）', unit: '×', default: 1.1 },
  { key: 'revenue_bull_coeff_3',    label: '3级牛量系数（红牛）', unit: '×', default: 1.2 },
  { key: 'revenue_bull_coeff_4',    label: '4级牛量系数（神牛）', unit: '×', default: 1.4 },
  { key: 'revenue_bull_coeff_5',    label: '5级牛量系数（牛王）', unit: '×', default: 1.6 },
]

function requireAdmin(request, reply, done) {
  try {
    request.jwtVerify()
    if ((request.user?.role ?? 0) < 2) {
      reply.code(403).send({ success: false, message: '无权限' })
    } else {
      done()
    }
  } catch {
    reply.code(401).send({ success: false, message: '未登录' })
  }
}

function requireSuperAdmin(request, reply, done) {
  try {
    request.jwtVerify()
    if ((request.user?.role ?? 0) < 3) {
      reply.code(403).send({ success: false, message: '仅超级管理员可修改分红规则' })
    } else {
      done()
    }
  } catch {
    reply.code(401).send({ success: false, message: '未登录' })
  }
}

export default async function revenueConfigRoutes(fastify) {
  const { prisma } = fastify

  // ─── GET /api/admin/revenue/configs ───
  fastify.get('/admin/revenue/configs', { preHandler: requireAdmin }, async (req, reply) => {
    const rows = await prisma.platformConfig.findMany({
      where: { groupName: 'revenue' },
    })
    const map = Object.fromEntries(rows.map(r => [r.configKey, r]))

    const result = REVENUE_KEYS.map(def => {
      const row = map[def.key]
      return {
        key:       def.key,
        label:     def.label,
        unit:      def.unit,
        valueType: def.valueType ?? 'number',
        value:     row ? Number(row.configValue) : def.default,
        default:   def.default,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      }
    })

    return reply.send({ success: true, data: result })
  })

  // ─── PUT /api/admin/revenue/configs ───
  fastify.put('/admin/revenue/configs', { preHandler: requireSuperAdmin }, async (req, reply) => {
    const updates = req.body // { key: value, ... }
    if (!updates || typeof updates !== 'object') {
      return reply.code(400).send({ success: false, message: '请求体格式错误' })
    }

    const adminId = req.user.userId
    const allowedKeys = new Set(REVENUE_KEYS.map(d => d.key))
    const ops = []

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.has(key)) continue
      const numVal = Number(value)
      if (isNaN(numVal)) {
        return reply.code(400).send({ success: false, message: `${key} 必须是数字` })
      }
      // 简单合法性校验
      if (key === 'revenue_max_rate' && (numVal <= 0 || numVal > 1)) {
        return reply.code(400).send({ success: false, message: '分红上限须在 0~100% 之间' })
      }
      if (key.startsWith('revenue_bull_coeff') && numVal <= 0) {
        return reply.code(400).send({ success: false, message: '牛量系数必须大于 0' })
      }
      if ((key === 'revenue_newbie_works' || key === 'revenue_newbie_days') && numVal < 0) {
        return reply.code(400).send({ success: false, message: `${key} 不能为负数` })
      }

      ops.push(
        prisma.platformConfig.upsert({
          where:  { configKey: key },
          update: { configValue: String(numVal), updatedBy: adminId },
          create: {
            configKey:   key,
            configValue: String(numVal),
            valueType:   'number',
            description: REVENUE_KEYS.find(d => d.key === key)?.label ?? key,
            groupName:   'revenue',
            updatedBy:   adminId,
          },
        })
      )
    }

    if (ops.length === 0) {
      return reply.code(400).send({ success: false, message: '没有可更新的参数' })
    }

    await Promise.all(ops)
    return reply.send({ success: true, message: `已更新 ${ops.length} 项分红参数` })
  })
}
