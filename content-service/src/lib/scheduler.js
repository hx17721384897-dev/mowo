// src/lib/scheduler.js
// 定时任务管理器
// 在 index.js 启动后调用 startScheduler(fastify) 即可

import {
  cleanupAbandonedAvatars,
  cleanupAbandonedCustomizationFiles,
  cleanupExpiredCustomizationDrafts
} from './private-file-cleanup.js'
import { processDueAccountDeletions } from './account-deletion.js'
import { closePreOrderAndRelease } from './checkout-snapshot.js'

export function startScheduler(fastify) {
  const log = fastify.log
  const HOUR_MS = 60 * 60 * 1000

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
        await closePreOrderAndRelease(fastify.prisma, po, 'expired')
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

  // 定制素材沿用相同检查频率：中断上传保留 24 小时，云端草稿保留 7 天。
  async function cleanupCustomizationFiles() {
    try {
      const [abandoned, drafts] = await Promise.all([
        cleanupAbandonedCustomizationFiles(fastify),
        cleanupExpiredCustomizationDrafts(fastify)
      ])
      if (abandoned.selected > 0 || drafts.selected > 0) {
        log.info(
          `[scheduler] 定制素材清理：中断上传删除 ${abandoned.deleted}，` +
          `过期草稿 ${drafts.expired}，草稿文件删除 ${drafts.filesDeleted}，失败 ${abandoned.failed + drafts.failed}`
        )
      }
    } catch (err) {
      log.error('[scheduler] 定制素材清理失败：' + err.message)
    }
  }

  setInterval(cleanupCustomizationFiles, avatarCleanupInterval)
  cleanupCustomizationFiles()

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

  log.info('[scheduler] 定时任务已启动：库存、授权、订单、文件清理、账号注销')
}
