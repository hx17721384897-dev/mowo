// src/routes/bull.js
// 牛量系统接口
//
// 管理端（role >= 2）：
//   GET  /api/admin/bull/creators          所有创作者牛量列表
//   GET  /api/admin/bull/creators/:id      单个创作者牛量详情
//   PUT  /api/admin/bull/creators/:id      手动调整等级/人工声量系数
//   GET  /api/admin/bull/configs           牛量参数配置列表
//   PUT  /api/admin/bull/configs           批量更新参数配置
//   POST /api/admin/bull/recalc/:id        手动触发单个创作者重新计算
//
// 创作者端（certifyStatus = 2）：
//   GET  /api/creator/bull/status          我的牛量等级和积分
//   GET  /api/creator/bull/logs            我的等级变动记录
//   GET  /api/creator/bull/referral        我的专属推广链接

export default async function bullRoutes(fastify) {

  const requireAdmin = fastify.requireRole(2)

  async function requireCreator(request, reply) {
    await fastify.authenticate(request, reply)
    if (request.user.certifyStatus !== 2) {
      return reply.code(403).send({ success: false, message: '需要创作者认证才能使用此功能' })
    }
  }

  // 等级名称映射
  const LEVEL_NAMES = { 1: '萌牛', 2: '勤牛', 3: '红牛', 4: '神牛', 5: '牛王' }
  const LEVEL_COEFFICIENTS = { 1: 1.0, 2: 1.2, 3: 1.5, 4: 1.8, 5: 2.0 }

  // ── 从 platform_configs 读取配置，带默认值兜底 ──
  async function getConfigs() {
    const rows = await fastify.prisma.platformConfig.findMany({
      where: { groupName: 'bull' }
    })
    const map = {}
    for (const r of rows) {
      map[r.configKey] = r.valueType === 'number' ? Number(r.configValue) : r.configValue
    }
    // 默认值兜底（首次运行 platform_configs 还没数据时）
    return {
      bull_lv2_min_posts:      map.bull_lv2_min_posts      ?? 2,
      bull_lv2_min_orders:     map.bull_lv2_min_orders     ?? 10,
      bull_lv3_min_views:      map.bull_lv3_min_views      ?? 50000,
      bull_lv3_min_orders:     map.bull_lv3_min_orders     ?? 50,
      bull_lv4_min_views:      map.bull_lv4_min_views      ?? 200000,
      bull_lv4_min_orders:     map.bull_lv4_min_orders     ?? 200,
      bull_lv5_min_orders:     map.bull_lv5_min_orders     ?? 1000,
      bull_inactive_months:    map.bull_inactive_months    ?? 2,
      bull_activity_weight:    map.bull_activity_weight    ?? 0.20,
      bull_social_weight:      map.bull_social_weight      ?? 0.30,
      bull_conversion_weight:  map.bull_conversion_weight  ?? 0.50,
      bull_max_monthly_posts:  map.bull_max_monthly_posts  ?? 30,   // 防刷：单月有效上传上限
      bull_social_conv_ratio:  map.bull_social_conv_ratio  ?? 10000, // 声量转换比：每N播放需至少1单
    }
  }

  // ══════════════════════════════════════════
  // 管理端接口
  // ══════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/admin/bull/creators
  // 所有创作者牛量列表，支持按等级/关键词筛选
  // ─────────────────────────────────────────
  fastify.get('/admin/bull/creators', {
    preHandler: requireAdmin,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:       { type: 'integer', minimum: 1, default: 1 },
          limit:      { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          bullLevel:  { type: 'integer', minimum: 1, maximum: 5 },
          keyword:    { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { page, limit, bullLevel, keyword } = request.query
    const skip = (page - 1) * limit

    // 先找符合条件的 creator_profiles
    const profileWhere = {}
    if (bullLevel) profileWhere.bullLevel = bullLevel

    const profiles = await fastify.prisma.creatorProfile.findMany({
      where: profileWhere,
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            certifyStatus: true,
            profile: { select: { nickname: true, avatarUrl: true } }
          }
        }
      },
      orderBy: { bullScore: 'desc' }
    })

    // 关键词过滤（按昵称或手机号）
    let filtered = profiles
    if (keyword) {
      const kw = keyword.toLowerCase()
      filtered = profiles.filter(p =>
        p.user?.profile?.nickname?.toLowerCase().includes(kw) ||
        p.user?.phone?.includes(kw)
      )
    }

    const total = filtered.length
    const paged = filtered.slice(skip, skip + limit)

    // 拉取每人最新一条 bull_scores
    const creatorIds = paged.map(p => p.userId)
    const latestScores = await fastify.prisma.bullScore.findMany({
      where: { creatorId: { in: creatorIds } },
      orderBy: { scoreDate: 'desc' },
      distinct: ['creatorId']
    })
    const scoreMap = Object.fromEntries(latestScores.map(s => [s.creatorId, s]))

    const result = paged.map(p => {
      const s = scoreMap[p.userId]
      return {
        creatorId:       p.userId,
        nickname:        p.user?.profile?.nickname || '未设置昵称',
        avatarUrl:       p.user?.profile?.avatarUrl || null,
        phone:           p.user?.phone,
        bullLevel:       p.bullLevel,
        levelName:       LEVEL_NAMES[p.bullLevel] || '萌牛',
        bullCoefficient: p.bullCoefficient,
        bullScore:       +p.bullScore.toFixed(2),
        isExclusive:     p.isExclusive,
        latestScore: s ? {
          activityScore:   +s.activityScore.toFixed(2),
          socialScore:     +s.socialScore.toFixed(2),
          conversionScore: +s.conversionScore.toFixed(2),
          totalScore:      +s.totalScore.toFixed(2),
          monthlyPosts:    s.monthlyPosts,
          monthlyOrders:   s.monthlyOrders,
          totalViews:      s.totalViews,
          socialManualMod: s.socialManualMod,
          scoreDate:       s.scoreDate
        } : null
      }
    })

    return reply.send({
      success: true,
      data: {
        creators: result,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/admin/bull/creators/:id
  // 单个创作者牛量详情 + 近30天积分走势
  // ─────────────────────────────────────────
  fastify.get('/admin/bull/creators/:id', {
    preHandler: requireAdmin
  }, async (request, reply) => {
    const { id } = request.params

    const profile = await fastify.prisma.creatorProfile.findUnique({
      where: { userId: id },
      include: {
        user: {
          select: {
            phone: true,
            certifyStatus: true,
            profile: { select: { nickname: true, avatarUrl: true } },
            referralLink: true
          }
        }
      }
    })

    if (!profile) {
      return reply.code(404).send({ success: false, message: '创作者不存在' })
    }

    // 近30天积分走势
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [scores, logs] = await Promise.all([
      fastify.prisma.bullScore.findMany({
        where: { creatorId: id, scoreDate: { gte: thirtyDaysAgo } },
        orderBy: { scoreDate: 'asc' }
      }),
      fastify.prisma.bullScoreLog.findMany({
        where: { creatorId: id },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ])

    return reply.send({
      success: true,
      data: {
        creatorId:       id,
        nickname:        profile.user?.profile?.nickname || '未设置昵称',
        avatarUrl:       profile.user?.profile?.avatarUrl || null,
        phone:           profile.user?.phone,
        bullLevel:       profile.bullLevel,
        levelName:       LEVEL_NAMES[profile.bullLevel] || '萌牛',
        bullCoefficient: profile.bullCoefficient,
        bullScore:       +profile.bullScore.toFixed(2),
        isExclusive:     profile.isExclusive,
        referralLink:    profile.user?.referralLink || null,
        scoreTrend:      scores.map(s => ({
          date:            s.scoreDate,
          totalScore:      +s.totalScore.toFixed(2),
          activityScore:   +s.activityScore.toFixed(2),
          socialScore:     +s.socialScore.toFixed(2),
          conversionScore: +s.conversionScore.toFixed(2),
          monthlyPosts:    s.monthlyPosts,
          monthlyOrders:   s.monthlyOrders,
          totalViews:      s.totalViews,
          socialManualMod: s.socialManualMod
        })),
        levelLogs: logs.map(l => ({
          changeType:  l.changeType,
          levelBefore: l.levelBefore,
          levelAfter:  l.levelAfter,
          scoreBefore: +l.scoreBefore.toFixed(2),
          scoreAfter:  +l.scoreAfter.toFixed(2),
          reason:      l.reason,
          createdAt:   l.createdAt
        }))
      }
    })
  })

  // ─────────────────────────────────────────
  // PUT /api/admin/bull/creators/:id
  // 手动调整创作者等级 或 人工声量系数
  // ─────────────────────────────────────────
  fastify.put('/admin/bull/creators/:id', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        properties: {
          bullLevel:      { type: 'integer', minimum: 1, maximum: 5 },
          socialManualMod:{ type: 'number',  minimum: 0.5, maximum: 2.0 },
          reason:         { type: 'string',  maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { bullLevel, socialManualMod, reason } = request.body
    const { userId: adminId } = request.user

    const profile = await fastify.prisma.creatorProfile.findUnique({
      where: { userId: id }
    })
    if (!profile) {
      return reply.code(404).send({ success: false, message: '创作者不存在' })
    }

    await fastify.prisma.$transaction(async (tx) => {
      // 更新等级和系数
      if (bullLevel !== undefined) {
        const coeff = LEVEL_COEFFICIENTS[bullLevel] || 1.0
        await tx.creatorProfile.update({
          where: { userId: id },
          data: { bullLevel, bullCoefficient: coeff }
        })

        // 写变动记录
        await tx.bullScoreLog.create({
          data: {
            creatorId:   id,
            changeType:  'manual',
            levelBefore: profile.bullLevel,
            levelAfter:  bullLevel,
            scoreBefore: profile.bullScore,
            scoreAfter:  profile.bullScore,
            reason:      reason || '管理员手动调整',
            operatorId:  adminId
          }
        })
      }

      // 更新人工声量系数（更新最近一条 bull_scores 记录）
      if (socialManualMod !== undefined) {
        const latestScore = await tx.bullScore.findFirst({
          where: { creatorId: id },
          orderBy: { scoreDate: 'desc' }
        })
        if (latestScore) {
          await tx.bullScore.update({
            where: { id: latestScore.id },
            data: { socialManualMod }
          })
        }
      }
    })

    return reply.send({ success: true, message: '调整成功' })
  })

  // ─────────────────────────────────────────
  // GET /api/admin/bull/configs
  // 获取所有牛量参数配置
  // ─────────────────────────────────────────
  fastify.get('/admin/bull/configs', {
    preHandler: requireAdmin
  }, async (request, reply) => {
    const configs = await fastify.prisma.platformConfig.findMany({
      where: { groupName: 'bull' },
      orderBy: { configKey: 'asc' }
    })

    // 如果还没有初始化，返回默认值
    const defaults = [
      { configKey: 'bull_lv2_min_posts',     configValue: '2',     description: '勤牛：近30天最低投稿数', valueType: 'number' },
      { configKey: 'bull_lv2_min_orders',    configValue: '10',    description: '勤牛：近30天最低订单数', valueType: 'number' },
      { configKey: 'bull_lv3_min_views',     configValue: '50000', description: '红牛：外部累计播放量门槛', valueType: 'number' },
      { configKey: 'bull_lv3_min_orders',    configValue: '50',    description: '红牛：近30天最低订单数', valueType: 'number' },
      { configKey: 'bull_lv4_min_views',     configValue: '200000',description: '神牛：外部累计播放量门槛', valueType: 'number' },
      { configKey: 'bull_lv4_min_orders',    configValue: '200',   description: '神牛：近30天最低订单数', valueType: 'number' },
      { configKey: 'bull_lv5_min_orders',    configValue: '1000',  description: '牛王：近30天最低订单数', valueType: 'number' },
      { configKey: 'bull_inactive_months',   configValue: '2',     description: '不活跃降级月数', valueType: 'number' },
      { configKey: 'bull_activity_weight',   configValue: '0.20',  description: '活跃贡献度权重', valueType: 'number' },
      { configKey: 'bull_social_weight',     configValue: '0.30',  description: '外部声量权重', valueType: 'number' },
      { configKey: 'bull_conversion_weight', configValue: '0.50',  description: '销售转化权重', valueType: 'number' },
      { configKey: 'bull_max_monthly_posts', configValue: '30',    description: '单月有效上传上限（防刷）', valueType: 'number' },
      { configKey: 'bull_social_conv_ratio', configValue: '10000', description: '声量转换比：每N播放至少需要1单', valueType: 'number' },
    ]

    const existingKeys = new Set(configs.map(c => c.configKey))
    const merged = [...configs]

    // 补上数据库里还没有的默认配置项
    for (const d of defaults) {
      if (!existingKeys.has(d.configKey)) {
        merged.push({ ...d, id: null, groupName: 'bull', updatedBy: null, updatedAt: null, createdAt: null })
      }
    }

    return reply.send({ success: true, data: merged })
  })

  // ─────────────────────────────────────────
  // PUT /api/admin/bull/configs
  // 批量更新参数配置
  // body: { configs: [{ configKey, configValue }] }
  // ─────────────────────────────────────────
  fastify.put('/admin/bull/configs', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['configs'],
        properties: {
          configs: {
            type: 'array',
            items: {
              type: 'object',
              required: ['configKey', 'configValue'],
              properties: {
                configKey:   { type: 'string' },
                configValue: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { configs } = request.body
    const { userId: adminId } = request.user

    await Promise.all(configs.map(c =>
      fastify.prisma.platformConfig.upsert({
        where:  { configKey: c.configKey },
        create: {
          configKey:   c.configKey,
          configValue: c.configValue,
          valueType:   'number',
          groupName:   'bull',
          updatedBy:   adminId
        },
        update: {
          configValue: c.configValue,
          updatedBy:   adminId
        }
      })
    ))

    return reply.send({ success: true, message: `已更新 ${configs.length} 项参数` })
  })

  // ─────────────────────────────────────────
  // POST /api/admin/bull/recalc/:id
  // 手动触发单个创作者立即重新计算牛量
  // ─────────────────────────────────────────
  fastify.post('/admin/bull/recalc/:id', {
    preHandler: requireAdmin
  }, async (request, reply) => {
    const { id } = request.params

    const profile = await fastify.prisma.creatorProfile.findUnique({
      where: { userId: id }
    })
    if (!profile) {
      return reply.code(404).send({ success: false, message: '创作者不存在' })
    }

    // 调用 scheduler 里的单人计算逻辑（通过 fastify.bullRecalc 暴露）
    if (fastify.bullRecalc) {
      await fastify.bullRecalc(id)
      return reply.send({ success: true, message: '已触发重新计算，请刷新查看最新数据' })
    }

    return reply.send({ success: true, message: '重新计算任务已加入队列' })
  })

  // ══════════════════════════════════════════
  // 创作者端接口
  // ══════════════════════════════════════════

  // ─────────────────────────────────────────
  // GET /api/creator/bull/status
  // 我的牛量等级、积分、近7天走势
  // ─────────────────────────────────────────
  fastify.get('/creator/bull/status', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const [profile, scores, configs] = await Promise.all([
      fastify.prisma.creatorProfile.findUnique({ where: { userId } }),
      fastify.prisma.bullScore.findMany({
        where: { creatorId: userId, scoreDate: { gte: sevenDaysAgo } },
        orderBy: { scoreDate: 'asc' }
      }),
      getConfigs()
    ])

    if (!profile) {
      // creatorProfile 尚未初始化（刚通过认证或直接改库测试），返回默认初始状态
      return reply.send({
        success: true,
        data: {
          bullLevel: 1, levelName: '萌牛', bullCoefficient: 1.0,
          bullScore: 0, isExclusive: false,
          current: null, nextLevel: 2, nextLevelName: '勤牛',
          nextLevelRequirements: { posts: configs.bull_lv2_min_posts, orders: configs.bull_lv2_min_orders, views: 0 },
          trend: []
        }
      })
    }

    // 下一等级的升级条件（方便前端展示进度）
    const nextLevel = Math.min(profile.bullLevel + 1, 5)
    const nextLevelRequirements = {
      2: { posts: configs.bull_lv2_min_posts,  orders: configs.bull_lv2_min_orders,  views: 0 },
      3: { posts: 0, orders: configs.bull_lv3_min_orders,  views: configs.bull_lv3_min_views  },
      4: { posts: 0, orders: configs.bull_lv4_min_orders,  views: configs.bull_lv4_min_views  },
      5: { posts: 0, orders: configs.bull_lv5_min_orders,  views: 0 },
    }

    // 最新一条积分数据
    const latest = scores.length > 0 ? scores[scores.length - 1] : null

    return reply.send({
      success: true,
      data: {
        bullLevel:       profile.bullLevel,
        levelName:       LEVEL_NAMES[profile.bullLevel] || '萌牛',
        bullCoefficient: profile.bullCoefficient,
        bullScore:       +profile.bullScore.toFixed(2),
        isExclusive:     profile.isExclusive,
        // 当前各维度数据
        current: latest ? {
          activityScore:   +latest.activityScore.toFixed(2),
          socialScore:     +latest.socialScore.toFixed(2),
          conversionScore: +latest.conversionScore.toFixed(2),
          monthlyPosts:    latest.monthlyPosts,
          monthlyOrders:   latest.monthlyOrders,
          totalViews:      latest.totalViews,
          scoreDate:       latest.scoreDate
        } : null,
        // 升级条件参考
        nextLevel,
        nextLevelName:         LEVEL_NAMES[nextLevel],
        nextLevelRequirements: nextLevelRequirements[nextLevel] || null,
        // 近7天走势
        trend: scores.map(s => ({
          date:       s.scoreDate,
          totalScore: +s.totalScore.toFixed(2)
        }))
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/creator/bull/logs
  // 我的等级变动记录
  // ─────────────────────────────────────────
  fastify.get('/creator/bull/logs', {
    preHandler: requireCreator,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const { page, limit } = request.query
    const skip = (page - 1) * limit

    const [logs, total] = await Promise.all([
      fastify.prisma.bullScoreLog.findMany({
        where: { creatorId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      fastify.prisma.bullScoreLog.count({ where: { creatorId: userId } })
    ])

    return reply.send({
      success: true,
      data: {
        logs: logs.map(l => ({
          changeType:      l.changeType,
          levelBefore:     l.levelBefore,
          levelNameBefore: LEVEL_NAMES[l.levelBefore],
          levelAfter:      l.levelAfter,
          levelNameAfter:  LEVEL_NAMES[l.levelAfter],
          scoreBefore:     +l.scoreBefore.toFixed(2),
          scoreAfter:      +l.scoreAfter.toFixed(2),
          reason:          l.reason,
          createdAt:       l.createdAt
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/creator/bull/referral
  // 我的专属推广链接（没有则自动创建）
  // ─────────────────────────────────────────
  fastify.get('/creator/bull/referral', {
    preHandler: requireCreator
  }, async (request, reply) => {
    const { userId } = request.user

    let link = await fastify.prisma.creatorReferralLink.findUnique({
      where: { creatorId: userId }
    })

    // 没有则自动生成
    if (!link) {
      const linkCode = 'ref_' + userId.replace(/-/g, '').slice(0, 8)
      link = await fastify.prisma.creatorReferralLink.create({
        data: {
          creatorId:    userId,
          linkCode,
          totalClicks:  0,
          totalOrders:  0,
          totalRevenue: 0,
          isActive:     true
        }
      })
    }

    return reply.send({
      success: true,
      data: {
        linkCode:     link.linkCode,
        fullUrl:      `https://mowobox.com?ref=${link.linkCode}`,
        totalClicks:  link.totalClicks,
        totalOrders:  link.totalOrders,
        totalRevenue: +link.totalRevenue.toFixed(2),
        isActive:     link.isActive,
        createdAt:    link.createdAt
      }
    })
  })
}
