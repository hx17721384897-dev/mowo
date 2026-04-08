// src/lib/revenue.js — 联名分红率计算模块

/**
 * 计算联名作品分红率
 *
 * @param {object} params
 * @param {number}       params.bullEnergy        牛能等级 1-5
 * @param {boolean}      params.isExclusive       是否签独家
 * @param {boolean}      params.isNewbieWork      是否属于前3款新手作品
 * @param {Date|null}    params.newbieExpiredAt   新手期截止时间
 * @param {number|null}  params.activityRate      当前活动分红率（如 0.20），无活动传 null
 * @returns {{ rate: number, breakdown: object }}
 */
export function calcRevenueRate({ bullEnergy, isExclusive, isNewbieWork, newbieExpiredAt, activityRate }) {
  const MAX_RATE = 0.25
  const EXCLUSIVE_BONUS = 0.08
  const NEWBIE_RATE = 0.15

  const BULL_COEFFICIENTS = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.4, 5: 1.6 }
  const coeff = BULL_COEFFICIENTS[bullEnergy] ?? 1.0

  const now = new Date()
  const inNewbiePeriod = isNewbieWork && newbieExpiredAt && new Date(newbieExpiredAt) > now
  const inActivityPeriod = activityRate !== null && activityRate !== undefined

  // 第一步：确定 BASE_RATE
  let baseRate, baseRateReason

  if (inNewbiePeriod && inActivityPeriod) {
    baseRate = Math.max(NEWBIE_RATE, activityRate)
    baseRateReason = `新手期(15%) vs 活动期(${(activityRate * 100).toFixed(1)}%)，取较高者`
  } else if (inNewbiePeriod) {
    baseRate = NEWBIE_RATE
    baseRateReason = '新手期固定 15%'
  } else if (inActivityPeriod) {
    baseRate = activityRate
    baseRateReason = `活动期 ${(activityRate * 100).toFixed(1)}%`
  } else {
    baseRate = 0.05 * coeff
    baseRateReason = `正常期：5% × 牛能系数${coeff}（${bullEnergy}牛能）`
  }

  // 第二步：叠加独家
  const exclusiveBonus = isExclusive ? EXCLUSIVE_BONUS : 0

  // 第三步：封顶25%
  const rawRate = baseRate + exclusiveBonus
  const finalRate = Math.min(rawRate, MAX_RATE)

  return {
    rate: finalRate,
    breakdown: {
      baseRate,
      baseRateReason,
      exclusiveBonus,
      rawRate,
      finalRate,
      cappedByMax: rawRate > MAX_RATE,
      inNewbiePeriod,
      inActivityPeriod,
    },
  }
}

/**
 * 计算单笔订单分红金额（购买时用快照 revenueRate）
 */
export function calcRevenueAmount(salePrice, revenueRate) {
  return Math.round(salePrice * revenueRate * 100) / 100
}
