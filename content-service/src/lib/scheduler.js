// src/lib/scheduler.js
// 定时任务管理器
// 在 index.js 启动后调用 startScheduler(fastify) 即可
//
// 任务一（每小时）：冷却期到期 → collab_orders.revenueStatus: cooling → available
// 任务二（每天凌晨2点）：储备金90天到期 → 释放回创作者余额

import { cleanupAbandonedAvatars } from './private-file-cleanup.js'
import { processDueAccountDeletions } from './account-deletion.js'

export function startScheduler(fastify) {
  const log = fastify.log

  // ─────────────────────────────────────────
  // 任务一：冷却期到期处理
  // 每小时运行一次，将 coolingEndAt < now 的订单转为 available
  //
  // 同时：
  //   - 将 payoutAmount 记入 balance.pendingAmount（供前端展示"待确认"）
  //   - 注意：真正的 availableAmount 在管理员 /settle 时才写入
  // ─────────────────────────────────────────
  async function processCoolingExpired() {
    const now = new Date()
    try {
      // 找出所有冷却期已过的订单
      const expired = await fastify.prisma.collabOrder.findMany({
        where: {
          revenueStatus: 'cooling',
          coolingEndAt: { lte: now }
        },
        select: { id: true, creatorId: true, payoutAmount: true }
      })

      if (expired.length === 0) return

      // 按 creatorId 分组，准备批量更新 balance
      const grouped = {}
      for (const o of expired) {
        grouped[o.creatorId] = (grouped[o.creatorId] || 0) + o.payoutAmount
      }

      await fastify.prisma.$transaction(async (tx) => {
        // 1. 批量将订单状态改为 available
        await tx.collabOrder.updateMany({
          where: { id: { in: expired.map(o => o.id) } },
          data:  { revenueStatus: 'available' }
        })

        // 2. 更新每个创作者的 balance.pendingAmount（展示用，不是真实可提现）
        //    这里 pendingAmount 代表"等待管理员结算打款"的金额
        for (const [creatorId, amount] of Object.entries(grouped)) {
          await tx.balance.upsert({
            where:  { creatorId },
            create: {
              creatorId,
              pendingAmount:   +amount.toFixed(4),
              availableAmount: 0,
              withdrawnAmount: 0
            },
            update: {
              pendingAmount: { increment: +amount.toFixed(4) }
            }
          })
        }
      })

      log.info(`[scheduler] 冷却期到期处理完成：${expired.length} 笔订单转为 available`)
    } catch (err) {
      log.error('[scheduler] 冷却期处理失败：' + err.message)
    }
  }

  // ─────────────────────────────────────────
  // 任务二：储备金90天解冻
  // 每天凌晨2点运行，将 releaseAt <= now 的 reserve_logs 对应金额
  // 释放回创作者 balance.availableAmount
  // ─────────────────────────────────────────
  async function processReserveRelease() {
    const now = new Date()
    try {
      // 找出所有到期的储备金流水（只处理 deduct 类型且未被释放的）
      const dueLogs = await fastify.prisma.reserveLog.findMany({
        where: {
          actionType: 'deduct',
          releaseAt:  { lte: now },
          // 通过检查是否存在对应的 release 记录来判断是否已处理
          // 用 collabOrderId 做关联标识
        },
        select: {
          id:           true,
          creatorId:    true,
          reserveId:    true,
          amount:       true,
          collabOrderId: true
        }
      })

      if (dueLogs.length === 0) return

      // 过滤掉已经有 release 记录的（防重复释放）
      const alreadyReleased = await fastify.prisma.reserveLog.findMany({
        where: {
          actionType:    'release',
          collabOrderId: { in: dueLogs.map(l => l.collabOrderId).filter(Boolean) }
        },
        select: { collabOrderId: true }
      })
      const releasedOrderIds = new Set(alreadyReleased.map(l => l.collabOrderId))
      const toRelease = dueLogs.filter(l => !releasedOrderIds.has(l.collabOrderId))

      if (toRelease.length === 0) return

      // 按 creatorId 分组
      const grouped = {}
      for (const l of toRelease) {
        if (!grouped[l.creatorId]) grouped[l.creatorId] = { amount: 0, reserveId: l.reserveId, logs: [] }
        grouped[l.creatorId].amount += l.amount
        grouped[l.creatorId].logs.push(l)
      }

      await fastify.prisma.$transaction(async (tx) => {
        for (const [creatorId, data] of Object.entries(grouped)) {
          const releaseAmount = +data.amount.toFixed(4)

          // 查当前储备金余额
          const reserve = await tx.creatorReserve.findUnique({
            where: { creatorId }
          })
          if (!reserve) continue

          const newReleasable = Math.max(0, reserve.releasableAmount - releaseAmount)
          const newReleased   = reserve.releasedAmount + releaseAmount

          // 1. 更新储备金账户
          await tx.creatorReserve.update({
            where: { creatorId },
            data: {
              releasableAmount: +newReleasable.toFixed(4),
              releasedAmount:   +newReleased.toFixed(4)
            }
          })

          // 2. 写 release 流水记录
          for (const l of data.logs) {
            await tx.reserveLog.create({
              data: {
                creatorId,
                reserveId:     data.reserveId,
                collabOrderId: l.collabOrderId,
                actionType:    'release',
                amount:        +l.amount.toFixed(4),
                balanceAfter:  +newReleasable.toFixed(4),
                note:          '90天安全期满自动释放'
              }
            })
          }

          // 3. 释放金额打回 balance.availableAmount
          await tx.balance.upsert({
            where:  { creatorId },
            create: {
              creatorId,
              pendingAmount:   0,
              availableAmount: releaseAmount,
              withdrawnAmount: 0
            },
            update: {
              availableAmount: { increment: releaseAmount }
            }
          })
        }
      })

      log.info(`[scheduler] 储备金解冻完成：${toRelease.length} 笔流水，涉及 ${Object.keys(grouped).length} 位创作者`)
    } catch (err) {
      log.error('[scheduler] 储备金解冻失败：' + err.message)
    }
  }

  // ─────────────────────────────────────────
  // 注册定时器
  // ─────────────────────────────────────────

  // 任务一：每小时整点运行
  const HOUR_MS = 60 * 60 * 1000
  if (fastify.config.features.creatorFinance) {
    setInterval(processCoolingExpired, HOUR_MS)
    // 启动时立即跑一次，处理服务重启期间积压的
    processCoolingExpired()
  }

  // 任务二：每天凌晨2点运行
  function scheduleReserveRelease() {
    const now   = new Date()
    const next  = new Date()
    next.setHours(2, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    const delay = next - now
    setTimeout(() => {
      processReserveRelease()
      setInterval(processReserveRelease, 24 * HOUR_MS)
    }, delay)
  }
  if (fastify.config.features.creatorFinance) scheduleReserveRelease()

  // ─────────────────────────────────────────
  // 任务三：每日00:00 — 库存全量快照
  // 对所有 sku_inventory 记录生成 inventory_snapshots 一条
  // 用于财务审计基准，精准定位「哪天开始出错」
  // ─────────────────────────────────────────
  async function takeInventorySnapshot() {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const inventories = await fastify.prisma.skuInventory.findMany()
      if (!inventories.length) return

      for (const inv of inventories) {
        const available = inv.currentStock - inv.reservedStock - inv.wipFrameQty - inv.wipKitQty
        await fastify.prisma.inventorySnapshot.upsert({
          where: { skuId_snapshotDate: { skuId: inv.skuId, snapshotDate: today } },
          create: {
            skuId:        inv.skuId,
            totalQty:     inv.currentStock,
            availableQty: Math.max(0, available),
            lockedQty:    inv.reservedStock,
            wipFrameQty:  inv.wipFrameQty,
            wipKitQty:    inv.wipKitQty,
            snapshotDate: today
          },
          update: {
            totalQty:     inv.currentStock,
            availableQty: Math.max(0, available),
            lockedQty:    inv.reservedStock,
            wipFrameQty:  inv.wipFrameQty,
            wipKitQty:    inv.wipKitQty,
          }
        })
      }
      log.info(`[scheduler] 库存快照完成：共 ${inventories.length} 条 SKU`)
    } catch (err) {
      log.error('[scheduler] 库存快照失败：' + err.message)
    }
  }

  // ─────────────────────────────────────────
  // 任务四：每天08:00 — CBR SKU 授权到期检查
  // 到期前30天标记 Expiring，当天标记 Expired
  // ─────────────────────────────────────────
  async function checkLicenseExpiry() {
    try {
      const now     = new Date()
      const in30    = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      const todayEnd = new Date(now)
      todayEnd.setHours(23, 59, 59, 999)

      // 今天到期 → Expired
      const expiredToday = await fastify.prisma.machineModelSku.findMany({
        where: {
          skuType:          'CBR_TEMPLATE',
          licenseExpireDate: { lte: todayEnd },
          licenseStatus:    { not: 'Expired' }
        }
      })
      if (expiredToday.length) {
        await fastify.prisma.machineModelSku.updateMany({
          where: { id: { in: expiredToday.map(s => s.id) } },
          data:  { licenseStatus: 'Expired' }
        })
        log.warn(`[scheduler] CBR授权到期：${expiredToday.length} 个 SKU 已标记 Expired`)
      }

      // 30天内到期 → Expiring（未过期的）
      const expiringSoon = await fastify.prisma.machineModelSku.findMany({
        where: {
          skuType:          'CBR_TEMPLATE',
          licenseExpireDate: { gt: todayEnd, lte: in30 },
          licenseStatus:    'Active'
        }
      })
      if (expiringSoon.length) {
        await fastify.prisma.machineModelSku.updateMany({
          where: { id: { in: expiringSoon.map(s => s.id) } },
          data:  { licenseStatus: 'Expiring' }
        })
        log.warn(`[scheduler] CBR授权即将到期：${expiringSoon.length} 个 SKU 已标记 Expiring`)
      }
    } catch (err) {
      log.error('[scheduler] 授权到期检查失败：' + err.message)
    }
  }

  // 任务三：每天00:00快照
  function scheduleInventorySnapshot() {
    const now  = new Date()
    const next = new Date()
    next.setHours(0, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    setTimeout(() => {
      takeInventorySnapshot()
      setInterval(takeInventorySnapshot, 24 * HOUR_MS)
    }, next - now)
  }
  scheduleInventorySnapshot()

  // 任务四：每天08:00授权检查
  function scheduleLicenseCheck() {
    const now  = new Date()
    const next = new Date()
    next.setHours(8, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    setTimeout(() => {
      checkLicenseExpiry()
      setInterval(checkLicenseExpiry, 24 * HOUR_MS)
    }, next - now)
  }
  scheduleLicenseCheck()
  // 启动时立即跑一次，修正重启期间可能遗漏的到期 SKU
  checkLicenseExpiry()

  // ─────────────────────────────────────────
  // 任务五：每2分钟 — PreOrder 超时自动释放库存
  // 超过 expiresAt 且仍为 pending_payment 的预订单自动 expire
  // ─────────────────────────────────────────
  async function expirePreOrders() {
    try {
      const expired = await fastify.prisma.preOrder.findMany({
        where: { status: 'pending_payment', expiresAt: { lt: new Date() } }
      })
      if (!expired.length) return

      for (const po of expired) {
        // 释放 reservedStock
        let cartItemIds = []
        try { cartItemIds = JSON.parse(po.cartItemIds) } catch {}

        if (cartItemIds.length) {
          const items = await fastify.prisma.cartItem.findMany({
            where: { id: { in: cartItemIds } }
          })
          for (const item of items) {
            if (item.itemType === 'MARKET') {
              await fastify.prisma.skuInventory.updateMany({
                where: { skuId: item.hardwareSkuId },
                data: { reservedStock: { decrement: item.quantity } }
              }).catch(() => {})
            }
          }
        }

        await fastify.prisma.preOrder.update({
          where: { id: po.id },
          data: { status: 'expired' }
        }).catch(() => {})
      }

      if (expired.length > 0) {
        log.info(`[scheduler] 预订单超时释放：${expired.length} 笔`)
      }
    } catch (err) {
      log.error('[scheduler] 预订单超时处理失败：' + err.message)
    }
  }

  // ─────────────────────────────────────────
  // 任务六：每天03:00 — 清理过期 CustomProduct 草稿
  // 排除：有 active CartItem 关联的草稿（生命周期保护）
  // ─────────────────────────────────────────
  async function cleanupExpiredDrafts() {
    try {
      const now = new Date()
      // 查找过期的 draft 状态草稿，且没有 CartItem 关联
      const expired = await fastify.prisma.customProduct.findMany({
        where: {
          status: 'draft',
          draftExpiresAt: { lt: now }
        }
      })
      if (!expired.length) return

      // 过滤掉仍有 CartItem 关联的
      const expiredIds = []
      for (const cp of expired) {
        const hasCartItem = await fastify.prisma.cartItem.count({
          where: { customProductId: cp.id }
        })
        if (!hasCartItem) expiredIds.push(cp.id)
      }

      if (expiredIds.length) {
        await fastify.prisma.customProduct.updateMany({
          where: { id: { in: expiredIds } },
          data: { status: 'removed' }
        })
        log.info(`[scheduler] CustomProduct 草稿清理：${expiredIds.length} 条已标记 removed`)
      }
    } catch (err) {
      log.error('[scheduler] 草稿清理失败：' + err.message)
    }
  }

  // 任务五：每2分钟检查 PreOrder 超时
  setInterval(expirePreOrders, 2 * 60 * 1000)
  expirePreOrders() // 启动时立即跑一次

  // 任务六：每天03:00清理草稿
  function scheduleDraftCleanup() {
    const now  = new Date()
    const next = new Date()
    next.setHours(3, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    setTimeout(() => {
      cleanupExpiredDrafts()
      setInterval(cleanupExpiredDrafts, 24 * HOUR_MS)
    }, next - now)
  }
  scheduleDraftCleanup()

  // ─────────────────────────────────────────
  // 任务七：14天自动确认收货
  // 每小时运行，shipped 且 shippedAt 超过14天 → 自动转 received
  // 同时触发联名作品冷却期（与手动确认收货逻辑一致）
  // ─────────────────────────────────────────
  async function autoConfirmReceipt() {
    const threshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    try {
      const orders = await fastify.prisma.customizeOrder.findMany({
        where: { status: 'shipped', shippedAt: { lte: threshold } }
      })
      if (!orders.length) return

      for (const order of orders) {
        await fastify.prisma.$transaction(async tx => {
          await tx.customizeOrder.update({
            where: { id: order.id },
            data:  { status: 'received' }
          })

          if (fastify.config.features.creatorFinance && order.sourceType === 'collab') {
            const coolingEndAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
            await tx.collabOrder.updateMany({
              where: {
                orderId:       order.id,
                revenueStatus: { in: ['estimated', 'cooling'] }
              },
              data: { revenueStatus: 'cooling', coolingEndAt }
            })
          }
        }).catch(err => {
          log.warn(`[scheduler] 自动确认收货单条失败 ${order.id}：${err.message}`)
        })
      }

      log.info(`[scheduler] 14天自动确认收货：${orders.length} 笔订单已转为 received`)
    } catch (err) {
      log.error('[scheduler] 自动确认收货失败：' + err.message)
    }
  }

  // 与冷却期检查共用每小时频率
  setInterval(autoConfirmReceipt, HOUR_MS)
  autoConfirmReceipt() // 启动时立即跑一次

  // 任务八：清理超过保留期仍未采用或已经被替换的头像。
  async function cleanupAvatarFiles() {
    try {
      const result = await cleanupAbandonedAvatars(fastify)
      if (result.selected > 0) {
        log.info(`[scheduler] 废弃头像清理：删除 ${result.deleted}，失败 ${result.failed}，跳过 ${result.skipped}`)
      }
    } catch (err) {
      log.error('[scheduler] 废弃头像清理失败：' + err.message)
    }
  }

  const avatarCleanupInterval = fastify.config.privateFileCleanup.intervalMinutes * 60 * 1000
  setInterval(cleanupAvatarFiles, avatarCleanupInterval)
  cleanupAvatarFiles()

  // 任务九：执行已到期或等待重试的账号注销处理单。
  async function processAccountDeletions() {
    try {
      const results = await processDueAccountDeletions(fastify)
      if (results.length) {
        const completed = results.filter(item => item.status === 'COMPLETED').length
        const blocked = results.filter(item => item.status === 'BLOCKED').length
        const failed = results.filter(item => item.status === 'FAILED').length
        log.info(`[scheduler] 账号注销处理：完成 ${completed}，阻止 ${blocked}，失败 ${failed}`)
      }
    } catch (err) {
      log.error('[scheduler] 账号注销任务失败：' + err.message)
    }
  }

  const deletionInterval = fastify.config.accountDeletion.intervalMinutes * 60 * 1000
  setInterval(processAccountDeletions, deletionInterval)
  processAccountDeletions()

  // 频率限制只需保留尚可能影响当前请求的时间窗，过期记录每天清理。
  async function cleanupExpiredRateLimits() {
    try {
      const result = await fastify.prisma.rateLimitBucket.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 24 * HOUR_MS) } }
      })
      if (result.count) log.info(`[scheduler] 过期限流记录清理：${result.count} 条`)
    } catch (err) {
      log.error('[scheduler] 过期限流记录清理失败：' + err.message)
    }
  }
  setInterval(cleanupExpiredRateLimits, 24 * HOUR_MS)
  cleanupExpiredRateLimits()

  log.info(`[scheduler] 定时任务已启动：库存、授权、订单、文件清理、账号注销${fastify.config.features.creatorFinance ? '、创作者财务' : ''}`)
}
