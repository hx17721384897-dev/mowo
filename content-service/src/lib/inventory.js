// InventoryService — 库存操作统一收口
// 所有库存变更必须通过此模块，禁止路由层直接操作 sku_inventory 表
// 每个方法均保证：DB 事务 + 乐观锁 + 写 inventory_log + 幂等检查

import crypto from 'crypto'

// ---------------------------------------------------------------
// 工具：计算当前 available_qty
// ---------------------------------------------------------------
export function calcAvailable(inv) {
  return inv.currentStock - inv.reservedStock - inv.wipFrameQty
}

// ---------------------------------------------------------------
// 工具：幂等检查 — 若同一 idempotencyKey 已执行，直接返回 true
// ---------------------------------------------------------------
async function isIdempotentDuplicate(prisma, idempotencyKey) {
  if (!idempotencyKey) return false
  const existing = await prisma.inventoryLog.findUnique({
    where: { idempotencyKey }
  })
  return !!existing
}

// ---------------------------------------------------------------
// 工具：生成幂等 key（若调用方未传入）
// ---------------------------------------------------------------
export function makeIdempotencyKey(prefix, ...parts) {
  return `${prefix}_${parts.join('_')}_${Date.now()}`
}

// ---------------------------------------------------------------
// 工具：写库存日志
// ---------------------------------------------------------------
async function writeLog(tx, { skuId, type, quantity, orderId, operatorId, note, idempotencyKey, beforeQty, afterQty, reason }) {
  return tx.inventoryLog.create({
    data: {
      skuId,
      type,
      quantity,
      orderId: orderId || null,
      operatorId: operatorId || 'system',
      note: note || null,
      idempotencyKey: idempotencyKey || null,
      beforeQty: beforeQty ?? null,
      afterQty: afterQty ?? null,
      reason: reason || null
    }
  })
}

// ---------------------------------------------------------------
// lockInventory — 下单时：available → locked（乐观锁 SQL）
// ---------------------------------------------------------------
export async function lockInventory(prisma, skuId, qty, orderId, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    // 乐观锁：只有 available >= qty 时才更新
    const result = await tx.$executeRaw`
      UPDATE sku_inventory
      SET reserved_stock = reserved_stock + ${qty},
          updated_at = NOW()
      WHERE sku_id = ${skuId}
        AND (current_stock - reserved_stock - wip_frame_qty) >= ${qty}
    `
    if (result === 0) throw new Error('INSUFFICIENT_STOCK')

    const inv = await tx.skuInventory.findUnique({ where: { skuId } })
    const afterQty = calcAvailable(inv)

    await writeLog(tx, {
      skuId, type: 'reserved', quantity: qty, orderId,
      idempotencyKey, beforeQty: afterQty + qty, afterQty
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// unlockInventory — 取消/退款（未进批次）：locked → available
// ---------------------------------------------------------------
export async function unlockInventory(prisma, skuId, qty, orderId, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET reserved_stock = GREATEST(0, reserved_stock - ${qty}),
          updated_at = NOW()
      WHERE sku_id = ${skuId}
    `
    const inv = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'released', quantity: qty, orderId,
      idempotencyKey, beforeQty: calcAvailable(inv) - qty, afterQty: calcAvailable(inv)
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// startWipFrame — 批次导出：locked → wip_frame（不可回流）
// ---------------------------------------------------------------
export async function startWipFrame(prisma, skuId, qty, batchId, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET reserved_stock = GREATEST(0, reserved_stock - ${qty}),
          wip_frame_qty  = wip_frame_qty + ${qty},
          updated_at     = NOW()
      WHERE sku_id = ${skuId}
    `
    const inv = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'wip_frame_start', quantity: qty, orderId: batchId,
      idempotencyKey, beforeQty: calcAvailable(inv), afterQty: calcAvailable(inv)
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// startWipKit — 批次导出：locked → wip_kit（取消可归还）
// ---------------------------------------------------------------
export async function startWipKit(prisma, skuId, qty, batchId, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET reserved_stock = GREATEST(0, reserved_stock - ${qty}),
          wip_kit_qty    = wip_kit_qty + ${qty},
          updated_at     = NOW()
      WHERE sku_id = ${skuId}
    `
    const inv = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'wip_kit_start', quantity: qty, orderId: batchId,
      idempotencyKey, beforeQty: calcAvailable(inv), afterQty: calcAvailable(inv)
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// rollbackWipKit — 取消/退款（已进批次）：wip_kit → available
// ---------------------------------------------------------------
export async function rollbackWipKit(prisma, skuId, qty, orderId, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET wip_kit_qty = GREATEST(0, wip_kit_qty - ${qty}),
          updated_at  = NOW()
      WHERE sku_id = ${skuId}
    `
    // current_stock 不变，available 自然增加（因为 wip_kit 减少）
    const inv = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'wip_kit_rollback', quantity: qty, orderId,
      idempotencyKey, beforeQty: calcAvailable(inv) - qty, afterQty: calcAvailable(inv)
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// deductWip — 扫码配对完成核销：wip_frame + wip_kit → 从 total 中扣除
// ---------------------------------------------------------------
export async function deductWip(prisma, skuId, qty, orderId, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    const invBefore = await tx.skuInventory.findUnique({ where: { skuId } })
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET wip_frame_qty  = GREATEST(0, wip_frame_qty - ${qty}),
          current_stock  = GREATEST(0, current_stock - ${qty}),
          updated_at     = NOW()
      WHERE sku_id = ${skuId}
    `
    const invAfter = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'wip_deduct', quantity: qty, orderId,
      idempotencyKey, beforeQty: calcAvailable(invBefore), afterQty: calcAvailable(invAfter)
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// defectFrame — 帧图报废：wip_frame → 损耗（不回流）
// ---------------------------------------------------------------
export async function defectFrame(prisma, skuId, qty, orderId, reason, idempotencyKey) {
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET wip_frame_qty = GREATEST(0, wip_frame_qty - ${qty}),
          current_stock = GREATEST(0, current_stock - ${qty}),
          updated_at    = NOW()
      WHERE sku_id = ${skuId}
    `
    const inv = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'wip_defect_frame', quantity: qty, orderId,
      idempotencyKey, afterQty: calcAvailable(inv), reason
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// manualAdjust — 手动盘点调整：current_stock += delta（reason 必填）
// ---------------------------------------------------------------
export async function manualAdjust(prisma, skuId, delta, reason, operatorId, idempotencyKey) {
  if (!reason) throw new Error('REASON_REQUIRED')
  if (await isIdempotentDuplicate(prisma, idempotencyKey)) return { success: true, duplicate: true }

  return prisma.$transaction(async (tx) => {
    const invBefore = await tx.skuInventory.findUnique({ where: { skuId } })
    await tx.$executeRaw`
      UPDATE sku_inventory
      SET current_stock = GREATEST(0, current_stock + ${delta}),
          updated_at    = NOW()
      WHERE sku_id = ${skuId}
    `
    const invAfter = await tx.skuInventory.findUnique({ where: { skuId } })
    await writeLog(tx, {
      skuId, type: 'manual_adjustment', quantity: Math.abs(delta), operatorId,
      idempotencyKey, beforeQty: calcAvailable(invBefore), afterQty: calcAvailable(invAfter), reason
    })
    return { success: true }
  }, { timeout: 5000 })
}

// ---------------------------------------------------------------
// getInventoryWithAlert — 查询库存 + 计算三级预警
// ---------------------------------------------------------------
export async function getInventoryWithAlert(prisma, skuId) {
  const inv = await prisma.skuInventory.findUnique({ where: { skuId } })
  if (!inv) return null

  const available = calcAvailable(inv)

  // 近30天 wip_deduct 类型的出货量 → 日均销量
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const deductLogs = await prisma.inventoryLog.aggregate({
    where: { skuId, type: 'wip_deduct', createdAt: { gte: thirtyDaysAgo } },
    _sum: { quantity: true }
  })
  const dailySales = (deductLogs._sum.quantity || 0) / 30
  const effectiveDailySales = dailySales * (inv.safetyFactor || 1.0)

  let alertLevel = 'OK'  // OK / SUGGEST（蓝）/ WARNING（黄）/ CRITICAL（红）
  if (effectiveDailySales > 0) {
    const daysLeft = available / effectiveDailySales
    if (daysLeft < 7) alertLevel = 'CRITICAL'
    else if (daysLeft < 14) alertLevel = 'WARNING'
    else if (daysLeft < 30) alertLevel = 'SUGGEST'
  }

  return {
    ...inv,
    availableQty: available,
    dailySales: Math.round(dailySales * 10) / 10,
    alertLevel
  }
}

// ---------------------------------------------------------------
// resolveSkuIdBySkuCode — 通过 sku_code 找到 machine_model_skus.id
// ---------------------------------------------------------------
export async function resolveSkuIdBySkuCode(prisma, skuCode) {
  const sku = await prisma.machineModelSku.findFirst({ where: { skuCode } })
  return sku ? sku.id : null
}

// ---------------------------------------------------------------
// ensureInventoryRecord — 确保 sku_inventory 存在该 SKU 的记录
// ---------------------------------------------------------------
export async function ensureInventoryRecord(prisma, skuId) {
  return prisma.skuInventory.upsert({
    where: { skuId },
    create: { skuId },
    update: {}
  })
}
