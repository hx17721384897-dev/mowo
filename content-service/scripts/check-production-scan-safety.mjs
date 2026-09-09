import AdmZip from 'adm-zip'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
const phone = `194${runId}`
let userId = null
const fixtureIds = {}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function cleanup() {
  if (fixtureIds.taskId) await prisma.productionUnitPairing.deleteMany({ where: { productionUnitId: fixtureIds.taskId } }).catch(() => {})
  if (fixtureIds.batchId) await prisma.productionMaterialPick.deleteMany({ where: { batchId: fixtureIds.batchId } }).catch(() => {})
  if (fixtureIds.taskId) await prisma.productionFramePack.deleteMany({ where: { productionUnitId: fixtureIds.taskId } }).catch(() => {})
  if (fixtureIds.batchId) await prisma.productionBatchUnit.deleteMany({ where: { batchId: fixtureIds.batchId } }).catch(() => {})
  if (fixtureIds.batchId) await prisma.batchItem.deleteMany({ where: { batchId: fixtureIds.batchId } }).catch(() => {})
  if (fixtureIds.batchId) await prisma.productionBatchOrder.deleteMany({ where: { batchId: fixtureIds.batchId } }).catch(() => {})
  if (fixtureIds.batchId) await prisma.productionBatch.deleteMany({ where: { id: fixtureIds.batchId } }).catch(() => {})
  if (fixtureIds.otherBatchId) await prisma.productionBatch.deleteMany({ where: { id: fixtureIds.otherBatchId } }).catch(() => {})
  if (fixtureIds.taskId) await prisma.customizeOrder.deleteMany({ where: { id: fixtureIds.taskId } }).catch(() => {})
  if (fixtureIds.itemId) await prisma.salesOrderItem.deleteMany({ where: { id: fixtureIds.itemId } }).catch(() => {})
  if (fixtureIds.orderId) await prisma.salesOrder.deleteMany({ where: { id: fixtureIds.orderId } }).catch(() => {})
  if (fixtureIds.preOrderId) await prisma.preOrder.deleteMany({ where: { id: fixtureIds.preOrderId } }).catch(() => {})
  if (fixtureIds.kitBatchId) await prisma.kitAssemblyBatch.deleteMany({ where: { id: fixtureIds.kitBatchId } }).catch(() => {})
  if (fixtureIds.containerId) await prisma.kitContainer.deleteMany({ where: { id: fixtureIds.containerId } }).catch(() => {})
  if (fixtureIds.skuId) await prisma.machineModelSku.deleteMany({ where: { id: fixtureIds.skuId } }).catch(() => {})
  if (fixtureIds.modelId) await prisma.machineModel.deleteMany({ where: { id: fixtureIds.modelId } }).catch(() => {})
  if (userId) {
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { OR: [{ userId }, { phone }] } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({ data: {
    phone, role: 3, staffRole: 'OWNER', privacyAgreedAt: new Date(), privacyPolicyVersion: 'scan-safety-test',
    profile: { create: { nickname: `scan-safety-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  userId = user.id

  const model = await prisma.machineModel.create({ data: {
    name: `扫码测试款-${runId}`, ratios: '["1:1"]', frameOptions: '[12]', sizes: '["5×5cm"]'
  } })
  fixtureIds.modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId: model.id, size: '5×5cm', material: '扫码测试材料', frameCount: 12,
    colorName: '测试白', colorHex: '#FFFFFF', skuCode: `MOWO-SKU-SCAN-${runId}`
  } })
  fixtureIds.skuId = sku.id
  const preOrder = await prisma.preOrder.create({ data: {
    userId, cartItemIds: '[]', checkoutIdempotencyKey: `scan-${runId}`, status: 'paid',
    totalAmount: '10.00', receiverName: '扫码测试', receiverPhone: phone,
    receiverAddress: '隔离测试地址', receiverCity: '测试市', expiresAt: new Date(Date.now() + 600000)
  } })
  fixtureIds.preOrderId = preOrder.id
  const order = await prisma.salesOrder.create({ data: {
    orderNo: `SO-SCAN-${runId}`, userId, preOrderId: preOrder.id, status: 'paid',
    fulfillmentStatus: 'PRODUCING', totalAmount: '10.00', receiverName: '扫码测试',
    receiverPhone: phone, receiverAddress: '隔离测试地址', receiverCity: '测试市', paidAt: new Date()
  } })
  fixtureIds.orderId = order.id
  const item = await prisma.salesOrderItem.create({ data: {
    itemNo: `SO-SCAN-${runId}-01`, salesOrderId: order.id, itemType: 'CUSTOM',
    contentId: `scan-fixture-${runId}`, skuId: sku.id, skuCode: sku.skuCode,
    snapshotTitle: '扫码测试商品', unitPrice: '10.00', quantity: 1, lineTotal: '10.00'
  } })
  fixtureIds.itemId = item.id
  const task = await prisma.customizeOrder.create({ data: {
    orderNo: `PU-SCAN-${runId}`, userId, modelId: model.id, modelName: model.name,
    frameCount: 12, size: sku.size, material: sku.material, color: sku.colorHex,
    colorName: sku.colorName, skuId: sku.id, ossPath: '', frameUrls: '[]', status: 'producing',
    sourceType: 'custom', salesOrderItemId: item.id, unitIndex: 1
  } })
  fixtureIds.taskId = task.id
  const batchId = `PB-SCAN-${runId}`
  const otherBatchId = `PB-SCAN-OTHER-${runId}`
  fixtureIds.batchId = batchId
  fixtureIds.otherBatchId = otherBatchId
  await prisma.productionBatch.createMany({ data: [
    { id: batchId, operatorId: userId, status: 'IN_PROGRESS', salesOrderCount: 1, productionUnitCount: 1, skuCount: 1 },
    { id: otherBatchId, operatorId: userId, status: 'READY' }
  ] })
  await prisma.productionBatchOrder.create({ data: {
    batchId, salesOrderId: order.id, orderNoSnapshot: order.orderNo, status: 'PRODUCING'
  } })
  await prisma.productionBatchUnit.create({ data: {
    batchId, productionUnitId: task.id, salesOrderId: order.id, skuId: sku.id,
    productionNoSnapshot: task.orderNo, printSequence: 1, printPageCount: 1,
    frameStatus: 'COMPLETED', materialStatus: 'PICKED', pairingStatus: 'COMPLETED'
  } })
  await prisma.batchItem.create({ data: { batchId, skuId: sku.id, skuCode: sku.skuCode, plannedQty: 1, actualQty: 1 } })
  const container = await prisma.kitContainer.create({ data: {
    code: `KC-SCAN-${runId}`, skuId: sku.id, currentQty: 1, reservedQty: 1, location: '隔离测试区'
  } })
  fixtureIds.containerId = container.id
  const kitBatch = await prisma.kitAssemblyBatch.create({ data: {
    batchNo: `KB-SCAN-${runId}`, skuId: sku.id, quantity: 2, availableQty: 1, reservedQty: 1,
    bomVersion: 1, bomSnapshot: '{}', containerId: container.id, operatorId: userId
  } })
  fixtureIds.kitBatchId = kitBatch.id
  const pick = await prisma.productionMaterialPick.create({ data: {
    batchId, skuId: sku.id, kitAssemblyBatchId: kitBatch.id, kitContainerId: container.id,
    quantity: 2, remainingQty: 1, consumedQty: 1, pickedBy: userId
  }, include: { kitAssemblyBatch: true, kitContainer: true } })
  const fixture = await prisma.productionFramePack.create({ data: {
    code: `FP-SCAN-${runId}-01`, productionUnitId: task.id, salesOrderId: order.id,
    batchId, skuId: sku.id, targetFrameCount: 12, size: sku.size,
    status: 'PAIRED', isActive: true, createdBy: userId
  } })
  await prisma.productionUnitPairing.create({ data: {
    productionUnitId: task.id, salesOrderId: order.id, batchId, framePackId: fixture.id,
    skuId: sku.id, kitAssemblyBatchId: kitBatch.id, kitContainerId: container.id,
    pairedBy: userId
  } })

  const fixtureBatchIsActive = true
  const otherBatch = { id: otherBatchId }
  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const loginResponse = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const login = await loginResponse.json()
  if (!loginResponse.ok || !login.success) throw new Error(login.message || '测试负责人登录失败')
  const headers = { Authorization: `Bearer ${login.data.accessToken}`, 'Content-Type': 'application/json' }

  if (fixtureBatchIsActive) {
    const beforeLogs = await prisma.operationLog.count({ where: { targetId: fixture.id, action: { contains: '完成裁切装袋' } } })
    const duplicateResponse = await fetch(`${apiBase}/api/admin/production-workflow/frame-packs/${encodeURIComponent(fixture.code)}/complete`, {
      method: 'POST', headers, body: JSON.stringify({ batchId: fixture.batchId })
    })
    const duplicate = await duplicateResponse.json()
    assert(duplicateResponse.ok && duplicate.data?.reused === true && duplicate.data?.changed === false, '重复扫描已完成或已进入后续环节的 FP 返回提醒且不重复推进')
    const afterLogs = await prisma.operationLog.count({ where: { targetId: fixture.id, action: { contains: '完成裁切装袋' } } })
    assert(afterLogs === beforeLogs, '重复扫描不会新增“完成裁切装袋”成功日志')
  } else {
    console.log('SKIP 当前只有已结束批次，不对真实已发货帧包执行重复扫码')
  }

  if (fixtureBatchIsActive && otherBatch) {
    const wrongResponse = await fetch(`${apiBase}/api/admin/production-workflow/frame-packs/${encodeURIComponent(fixture.code)}/complete`, {
      method: 'POST', headers, body: JSON.stringify({ batchId: otherBatch.id })
    })
    assert(wrongResponse.status === 409, '跨生产批次扫描 FP 会被服务器拒绝')
  }

  if (fixtureBatchIsActive && pick) {
    const sourceCode = pick.kitContainer?.code || pick.kitAssemblyBatch.batchNo
    const sourceResponse = await fetch(`${apiBase}/api/admin/production-workflow/pairing/material-source/${encodeURIComponent(sourceCode)}?batchId=${encodeURIComponent(fixture.batchId)}`, { headers })
    const source = await sourceResponse.json()
    assert(sourceResponse.ok && source.data?.remainingQty > 0, '配对前能核对当前批次已领材料来源和剩余数量')
  }

  const pairing = await prisma.productionUnitPairing.findUnique({ where: { productionUnitId: fixture.productionUnitId } })
  if (fixtureBatchIsActive && pairing && pairing.status !== 'VOID') {
    const [kitBatch, container] = await Promise.all([
      prisma.kitAssemblyBatch.findUnique({ where: { id: pairing.kitAssemblyBatchId } }),
      pairing.kitContainerId ? prisma.kitContainer.findUnique({ where: { id: pairing.kitContainerId } }) : null
    ])
    const sourceCode = container?.code || kitBatch?.batchNo
    const beforeStock = { availableQty: kitBatch.availableQty, reservedQty: kitBatch.reservedQty }
    const beforePairLogs = await prisma.operationLog.count({ where: { targetId: pairing.id, action: { contains: '配对' } } })
    const pairingResponse = await fetch(`${apiBase}/api/admin/production-workflow/pairing`, {
      method: 'POST', headers, body: JSON.stringify({ batchId: fixture.batchId, framePackCode: fixture.code, kitCode: sourceCode })
    })
    const pairingResult = await pairingResponse.json()
    const afterBatch = await prisma.kitAssemblyBatch.findUnique({ where: { id: pairing.kitAssemblyBatchId } })
    const afterPairLogs = await prisma.operationLog.count({ where: { targetId: pairing.id, action: { contains: '配对' } } })
    assert(pairingResponse.ok && pairingResult.data?.reused === true, '重复扫描已配对 FP 返回原配对结果')
    assert(afterBatch.availableQty === beforeStock.availableQty && afterBatch.reservedQty === beforeStock.reservedQty, '重复配对不会再次扣减材料库存或预留')
    assert(afterPairLogs === beforePairLogs, '重复配对不会新增成功配对日志')
  }

  const ledgerResponse = await fetch(`${apiBase}/api/admin/production-workflow/batches/${encodeURIComponent(fixture.batchId)}/production-ledger`, { headers })
  const ledger = Buffer.from(await ledgerResponse.arrayBuffer())
  const zip = new AdmZip(ledger)
  const workbook = zip.readAsText('xl/workbook.xml')
  const detail = zip.readAsText('xl/worksheets/sheet1.xml')
  const reprintCount = await prisma.productionFrameReprint.count({ where: { batchId: fixture.batchId } })
  assert(ledgerResponse.ok && workbook.includes('单件生产明细') && workbook.includes('材料需求汇总'), '生产总表包含单件明细和材料需求两个工作表')
  assert(detail.includes('MOWO-SKU-') && !detail.includes('SKU编码缺失'), '生产总表展示正式 SKU 编码而不是数据库内部 ID')
  assert(detail.includes('清单核对标记') && detail.includes(`${fixture.batchId} / 返工${reprintCount}次`), '生产总表打印后可用批次和返工次数与系统核对新旧')
  console.log('Production scan safety checks passed')
} finally {
  await cleanup()
}
