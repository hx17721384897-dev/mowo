// src/lib/bull-scheduler.js
// 牛量每日批处理
// 在 index.js 启动后调用 startBullScheduler(fastify) 即可
//
// 每天凌晨3点运行，对所有认证创作者：
//   1. 计算三维度积分
//   2. 判断是否升降级
//   3. 写入 bull_scores 快照
//   4. 写入 bull_score_logs 变动记录（如有等级变化）
//   5. 更新 creator_profiles.bullLevel / bullScore / bullCoefficient

const LEVEL_NAMES       = { 1: '萌牛', 2: '勤牛', 3: '红牛', 4: '神牛', 5: '牛王' }
const LEVEL_COEFFICIENTS = { 1: 1.0, 2: 1.2, 3: 1.5, 4: 1.8, 5: 2.0 }

// ── 从 platform_configs 读取配置 ──
async function getConfigs(prisma) {
  const rows = await prisma.platformConfig.findMany({ where: { groupName: 'bull' } })
  const map = {}
  for (const r of rows) map[r.configKey] = Number(r.configValue)
  return {
    lv2MinPosts:      map.bull_lv2_min_posts      ?? 2,
    lv2MinOrders:     map.bull_lv2_min_orders     ?? 10,
    lv3MinViews:      map.bull_lv3_min_views      ?? 50000,
    lv3MinOrders:     map.bull_lv3_min_orders     ?? 50,
    lv4MinViews:      map.bull_lv4_min_views      ?? 200000,
    lv4MinOrders:     map.bull_lv4_min_orders     ?? 200,
    lv5MinOrders:     map.bull_lv5_min_orders     ?? 1000,
    inactiveMonths:   map.bull_inactive_months    ?? 2,
    activityWeight:   map.bull_activity_weight    ?? 0.20,
    socialWeight:     map.bull_social_weight      ?? 0.30,
    conversionWeight: map.bull_conversion_weight  ?? 0.50,
    maxMonthlyPosts:  map.bull_max_monthly_posts  ?? 30,
    socialConvRatio:  map.bull_social_conv_ratio  ?? 10000,
  }
}

// ── 根据当前数据判断应该是几级 ──
function calcTargetLevel(monthlyOrders, totalViews, monthlyPosts, cfg) {
  if (monthlyOrders >= cfg.lv5MinOrders)                                      return 5
  if (totalViews   >= cfg.lv4MinViews   && monthlyOrders >= cfg.lv4MinOrders) return 4
  if (totalViews   >= cfg.lv3MinViews   && monthlyOrders >= cfg.lv3MinOrders) return 3
  if (monthlyPosts >= cfg.lv2MinPosts   && monthlyOrders >= cfg.lv2MinOrders) return 2
  return 1
}

// ── 计算单个创作者的牛量积分 ──
async function calcCreatorScore(prisma, creatorId, cfg) {
  const now       = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

  // ── 维度1：活跃贡献度 ──
  // 近30天上传的联名作品数（approved 状态）
  const monthlyWorks = await prisma.collabWork.count({
    where: {
      creatorId,
      status:    'approved',
      createdAt: { gte: thirtyDaysAgo }
    }
  })
  // 有效上传数，超过上限按上限算（防刷）
  const effectivePosts = Math.min(monthlyWorks, cfg.maxMonthlyPosts)
  // 归一化到0~100：达到上限拿满分
  const activityScore = Math.min((effectivePosts / Math.max(cfg.lv2MinPosts, 1)) * 60, 100)

  // ── 维度2：外部声量 ──
  // 取该创作者最新一条 bull_scores 里的声量数据（爬虫每日更新）
  // 初期声量数据来源：管理员审核时手动填，或爬虫写入（后期）
  const latestScore = await prisma.bullScore.findFirst({
    where:   { creatorId },
    orderBy: { scoreDate: 'desc' }
  })
  const totalViews     = latestScore?.totalViews     || 0
  const totalLikes     = latestScore?.totalLikes     || 0
  const socialManualMod = latestScore?.socialManualMod || 1.0

  // 近30天订单数（用于声量转换比校验）
  const monthlyOrders = await prisma.collabOrder.count({
    where: {
      creatorId,
      createdAt: { gte: thirtyDaysAgo }
    }
  })

  // 声量转换比校验：播放量/订单数 > 阈值则判定为异常，声量分归0
  let socialRaw = 0
  if (totalViews > 0) {
    const convRatio = monthlyOrders > 0 ? totalViews / monthlyOrders : Infinity
    if (convRatio <= cfg.socialConvRatio || monthlyOrders === 0) {
      // 正常：按播放量归一化
      socialRaw = Math.min((totalViews / Math.max(cfg.lv3MinViews, 1)) * 60, 100)
      // 点赞加成（最多+20分）
      const likeBonus = totalViews > 0 ? Math.min((totalLikes / totalViews) * 100, 20) : 0
      socialRaw = Math.min(socialRaw + likeBonus, 100)
    }
    // 异常：声量分归0（不记录，只是不计入）
  }
  const socialScore = Math.min(socialRaw * socialManualMod, 100)

  // ── 维度3：销售转化 ──
  // 近30天通过专属推广链接产生的订单数
  const referralLink = await prisma.creatorReferralLink.findUnique({
    where: { creatorId }
  })
  const referralOrders = referralLink ? await prisma.referralClick.count({
    where: {
      linkId:  referralLink.id,
      orderId: { not: null },
      createdAt: { gte: thirtyDaysAgo }
    }
  }) : 0

  // 归一化（达到 lv5 门槛拿满分）
  const conversionScore = Math.min((referralOrders / Math.max(cfg.lv5MinOrders * 0.1, 1)) * 100, 100)

  // ── 加权合成总分 ──
  const totalScore =
    activityScore   * cfg.activityWeight +
    socialScore     * cfg.socialWeight   +
    conversionScore * cfg.conversionWeight

  return {
    activityScore:   +activityScore.toFixed(2),
    socialScore:     +socialScore.toFixed(2),
    conversionScore: +conversionScore.toFixed(2),
    totalScore:      +totalScore.toFixed(2),
    monthlyPosts:    effectivePosts,
    monthlyOrders,
    totalViews,
    totalLikes,
    socialManualMod
  }
}

// ── 单个创作者完整计算流程（供手动触发复用）──
export async function recalcCreator(prisma, creatorId, cfg) {
  if (!cfg) cfg = await getConfigs(prisma)

  const profile = await prisma.creatorProfile.findUnique({ where: { userId: creatorId } })
  if (!profile) return

  const scoreData   = await calcCreatorScore(prisma, creatorId, cfg)
  const today       = new Date(); today.setHours(0, 0, 0, 0)
  const targetLevel = calcTargetLevel(scoreData.monthlyOrders, scoreData.totalViews, scoreData.monthlyPosts, cfg)

  // 写入每日快照（upsert，防止同天重复运行）
  await prisma.bullScore.upsert({
    where:  { creatorId_scoreDate: { creatorId, scoreDate: today } },
    create: { creatorId, scoreDate: today, ...scoreData },
    update: { ...scoreData }
  })

  // 判断是否需要变更等级
  const currentLevel = profile.bullLevel
  let   newLevel     = currentLevel

  if (targetLevel > currentLevel) {
    // 升级：直接升到目标等级
    newLevel = targetLevel
  } else if (targetLevel < currentLevel) {
    // 降级检测：检查近 inactiveMonths 个月是否都不达标
    const inactiveStart = new Date()
    inactiveStart.setMonth(inactiveStart.getMonth() - cfg.inactiveMonths)

    const recentScores = await prisma.bullScore.findMany({
      where:   { creatorId, scoreDate: { gte: inactiveStart } },
      orderBy: { scoreDate: 'asc' }
    })

    // 如果这段时间内所有快照的目标等级都低于当前等级，才降级
    const allBelowCurrent = recentScores.length > 0 && recentScores.every(s => {
      const t = calcTargetLevel(s.monthlyOrders, s.totalViews, s.monthlyPosts, cfg)
      return t < currentLevel
    })

    if (allBelowCurrent) newLevel = Math.max(currentLevel - 1, 1)
  }

  // 更新 creator_profiles
  const newCoeff = LEVEL_COEFFICIENTS[newLevel] || 1.0
  await prisma.creatorProfile.update({
    where: { userId: creatorId },
    data: {
      bullLevel:       newLevel,
      bullCoefficient: newCoeff,
      bullScore:       scoreData.totalScore
    }
  })

  // 如果等级有变化，写变动记录
  if (newLevel !== currentLevel) {
    const isUpgrade  = newLevel > currentLevel
    const reason     = isUpgrade
      ? `积分达标，${LEVEL_NAMES[currentLevel]} → ${LEVEL_NAMES[newLevel]}`
      : `连续 ${cfg.inactiveMonths} 个月未达标，${LEVEL_NAMES[currentLevel]} → ${LEVEL_NAMES[newLevel]}`

    await prisma.bullScoreLog.create({
      data: {
        creatorId,
        changeType:  isUpgrade ? 'upgrade' : 'downgrade',
        levelBefore: currentLevel,
        levelAfter:  newLevel,
        scoreBefore: profile.bullScore,
        scoreAfter:  scoreData.totalScore,
        reason
      }
    })
  }
}

// ── 主调度函数 ──
export function startBullScheduler(fastify) {
  const log    = fastify.log
  const prisma = fastify.prisma

  // 暴露单人重算接口，供 bull.js 路由调用
  fastify.bullRecalc = (creatorId) => recalcCreator(prisma, creatorId)

  async function runDailyBull() {
    log.info('[bull-scheduler] 开始每日牛量计算...')
    try {
      const cfg = await getConfigs(prisma)

      // 获取所有认证创作者
      const creators = await prisma.creatorProfile.findMany({
        select: { userId: true }
      })

      let success = 0, failed = 0
      for (const c of creators) {
        try {
          await recalcCreator(prisma, c.userId, cfg)
          success++
        } catch (e) {
          failed++
          log.warn(`[bull-scheduler] 创作者 ${c.userId} 计算失败：${e.message}`)
        }
      }

      log.info(`[bull-scheduler] 完成：${success} 成功，${failed} 失败，共 ${creators.length} 人`)
    } catch (e) {
      log.error('[bull-scheduler] 批处理异常：' + e.message)
    }
  }

  // 每天凌晨3点运行（错开结算系统的凌晨2点）
  function scheduleDailyRun() {
    const now  = new Date()
    const next = new Date()
    next.setHours(3, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    const delay = next - now
    setTimeout(() => {
      runDailyBull()
      setInterval(runDailyBull, 24 * 60 * 60 * 1000)
    }, delay)
  }

  scheduleDailyRun()
  log.info('[bull-scheduler] 牛量定时任务已启动（每天 03:00）')
}
