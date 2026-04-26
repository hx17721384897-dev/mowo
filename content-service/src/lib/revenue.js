// src/lib/revenue.js — 联名分红率计算模块
//
// 规则（2026-04 修订）：
//   新手期   = 前 N 款作品，每款审核通过后 D 天内，固定 NEWBIE_RATE，独家不叠加
//   活动期   = 管理员指定活动分红率，固定值，独家不叠加
//   正常期   = 5% × 牛量系数 + 独家加成（独家只在此分支叠加）
//   最终分红 = max(新手期, 活动期, 正常期含独家)，上限 MAX_RATE

/**
 * 计算联名作品分红率
 *
 * @param {object} params
 * @param {number}       params.bullEnergy        牛量等级 1-5
 * @param {boolean}      params.isExclusive       是否签独家
 * @param {boolean}      params.isNewbieWork      是否属于新手期作品
 * @param {Date|null}    params.newbieExpiredAt   新手期截止时间
 * @param {number|null}  params.activityRate      当前活动分红率（如 0.20），无活动传 null
 * @param {object}       [params.config]          分红参数配置（从 platform_configs 读取后传入）
 *   config.revenue_max_rate        上限，默认 0.25
 *   config.revenue_exclusive_bonus 独家加成，默认 0.08
 *   config.revenue_newbie_rate     新手期固定分红率，默认 0.15
 *   config.revenue_bull_coeff_1~5  各级系数，默认 1.0/1.1/1.2/1.4/1.6
 *
 * @returns {{ rate: number, breakdown: object }}
 */
export function calcRevenueRate({
  bullEnergy,
  isExclusive,
  isNewbieWork,
  newbieExpiredAt,
  activityRate,
  config = {},
}) {
  // ── 读取配置，未设置时回落默认值 ──
  const MAX_RATE       = Number(config.revenue_max_rate        ?? 0.25)
  const EXCLUSIVE_BONUS = Number(config.revenue_exclusive_bonus ?? 0.08)
  const NEWBIE_RATE    = Number(config.revenue_newbie_rate     ?? 0.15)

  const BULL_COEFFICIENTS = {
    1: Number(config.revenue_bull_coeff_1 ?? 1.0),
    2: Number(config.revenue_bull_coeff_2 ?? 1.1),
    3: Number(config.revenue_bull_coeff_3 ?? 1.2),
    4: Number(config.revenue_bull_coeff_4 ?? 1.4),
    5: Number(config.revenue_bull_coeff_5 ?? 1.6),
  }
  const coeff = BULL_COEFFICIENTS[bullEnergy] ?? 1.0

  const now = new Date()
  const inNewbiePeriod   = isNewbieWork && newbieExpiredAt && new Date(newbieExpiredAt) > now
  const inActivityPeriod = activityRate !== null && activityRate !== undefined

  // ── 第一步：计算三条分支各自的值 ──
  const newbieValue   = inNewbiePeriod   ? NEWBIE_RATE  : null   // 新手期：固定值，不含独家
  const activityValue = inActivityPeriod ? activityRate : null   // 活动期：指定值，不含独家
  const normalValue   = 0.05 * coeff + (isExclusive ? EXCLUSIVE_BONUS : 0) // 正常期：含独家

  // ── 第二步：取最高值 ──
  const candidates = [normalValue]
  if (newbieValue   !== null) candidates.push(newbieValue)
  if (activityValue !== null) candidates.push(activityValue)
  const rawRate = Math.max(...candidates)

  // ── 第三步：封顶 ──
  const finalRate = Math.min(rawRate, MAX_RATE)

  // 确定实际生效来源（用于 breakdown 说明）
  let activeReason
  if (rawRate === newbieValue && newbieValue >= (activityValue ?? 0) && newbieValue >= normalValue) {
    activeReason = `新手期固定 ${(NEWBIE_RATE * 100).toFixed(1)}%`
  } else if (rawRate === activityValue && activityValue > normalValue) {
    activeReason = `活动期 ${(activityRate * 100).toFixed(1)}%`
  } else {
    activeReason = isExclusive
      ? `正常期：5% × 牛量系数${coeff}（${bullEnergy}级）+ 独家 ${(EXCLUSIVE_BONUS * 100).toFixed(1)}%`
      : `正常期：5% × 牛量系数${coeff}（${bullEnergy}级）`
  }

  return {
    rate: finalRate,
    breakdown: {
      newbieValue,
      activityValue,
      normalValue,
      rawRate,
      finalRate,
      cappedByMax: rawRate > MAX_RATE,
      inNewbiePeriod:   !!inNewbiePeriod,
      inActivityPeriod: !!inActivityPeriod,
      exclusiveBonus:   isExclusive ? EXCLUSIVE_BONUS : 0,
      activeReason,
    },
  }
}

/**
 * 计算单笔订单分红金额（购买时用快照 revenueRate）
 */
export function calcRevenueAmount(salePrice, revenueRate) {
  return Math.round(salePrice * revenueRate * 100) / 100
}

/**
 * 从 platform_configs 记录数组中提取 revenue 分组配置，返回 key→value 映射
 * @param {Array} rows  prisma.platformConfig.findMany() 结果
 * @returns {object}
 */
export function buildRevenueConfig(rows) {
  const map = {}
  for (const row of rows) {
    map[row.configKey] = row.valueType === 'number' ? Number(row.configValue) : row.configValue
  }
  return map
}
