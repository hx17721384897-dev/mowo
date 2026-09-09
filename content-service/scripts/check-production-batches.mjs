import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
const testSize = `${runId.slice(-4)}x5cm`
let adminId, customerId, modelId, skuId, salesOrderId, preOrderId, batchId, printGroupId, browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function request(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
}

async function deleteUser(userId) {
  if (!userId) return
  await prisma.smsCode.deleteMany({ where: { userId } })
  await prisma.refreshToken.deleteMany({ where: { userId } })
  await prisma.operationLog.deleteMany({ where: { userId } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.userProfile.deleteMany({ where: { userId } })
  await prisma.creditScore.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
}

async function cleanup() {
  const orderIds = salesOrderId ? [salesOrderId] : []
  if (customerId && !orderIds.length) {
    const rows = await prisma.salesOrder.findMany({ where: { userId: customerId }, select: { id: true } })
    orderIds.push(...rows.map(row => row.id))
  }
  const memberships = orderIds.length ? await prisma.productionBatchOrder.findMany({
    where: { salesOrderId: { in: orderIds } }, select: { batchId: true }
  }) : []
  const batchIds = [...new Set([batchId, ...memberships.map(row => row.batchId)].filter(Boolean))]
  if (batchIds.length) {
    await prisma.productionBatchUnit.deleteMany({ where: { batchId: { in: batchIds } } })
    await prisma.productionBatchOrder.deleteMany({ where: { batchId: { in: batchIds } } })
    await prisma.batchItem.deleteMany({ where: { batchId: { in: batchIds } } })
    await prisma.productionBatch.deleteMany({ where: { id: { in: batchIds } } })
  }
  if (customerId) await prisma.customizeOrder.deleteMany({ where: { userId: customerId } })
  if (orderIds.length) await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } })
  if (orderIds.length) await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } })
  if (preOrderId) await prisma.preOrder.deleteMany({ where: { id: preOrderId } })
  if (skuId) await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  if (printGroupId) {
    await prisma.printCutRule.deleteMany({ where: { groupId: printGroupId } })
    await prisma.printCutGroup.deleteMany({ where: { id: printGroupId } })
  }
  await deleteUser(customerId)
  await deleteUser(adminId)
}

async function cleanupHistorical() {
  const profiles = await prisma.userProfile.findMany({
    where: { nickname: { startsWith: 'production-batch-test-' } }, select: { userId: true }
  })
  for (const profile of profiles) {
    customerId = profile.userId
    const order = await prisma.salesOrder.findFirst({ where: { userId: customerId } })
    salesOrderId = order?.id
    preOrderId = order?.preOrderId
    await cleanup().catch(() => {})
    customerId = salesOrderId = preOrderId = null
  }
}

try {
  await cleanupHistorical()
  const adminPhone = `197${runId.slice(-8)}`
  const admin = await prisma.user.create({ data: {
    phone: adminPhone, role: 3, staffRole: 'OWNER', privacyAgreedAt: new Date(), privacyPolicyVersion: 'pb-test',
    profile: { create: { nickname: `production-batch-admin-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  adminId = admin.id
  await prisma.smsCode.create({ data: { userId: adminId, phone: adminPhone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const login = await request('/api/v1/auth/sms/verify', null, { method: 'POST', body: JSON.stringify({ phone: adminPhone, code: '123456', mode: 'LOGIN' }) })
  assert(login.status === 200, '生产批次测试管理员可以登录')
  const token = (await login.json()).data.accessToken

  const printGroup = await prisma.printCutGroup.create({ data: {
    code: `PCG-TEST-${runId}`, name: `批次测试版式-${runId}`, size: testSize,
    framesPerSheet: 12, sortOrder: 9999, createdBy: adminId
  } })
  printGroupId = printGroup.id
  const model = await prisma.machineModel.create({ data: {
    name: `生产批次测试款-${runId}`, ratios: '["1:1"]', frameOptions: '[12]', sizes: JSON.stringify([testSize])
  } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId, size: testSize, material: '椴木板', frameCount: 12, colorName: `测试原色-${runId}`, colorHex: '#DDCC99', skuCode: `PBTEST-${runId}`
  } })
  skuId = sku.id
  await prisma.printCutRule.create({ data: { groupId: printGroupId, skuId, pagesPerUnit: 1 } })

  const customerPhone = `198${runId.slice(-8)}`
  const customer = await prisma.user.create({ data: {
    phone: customerPhone, privacyAgreedAt: new Date(), privacyPolicyVersion: 'pb-test',
    profile: { create: { nickname: `production-batch-test-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  customerId = customer.id
  const preOrder = await prisma.preOrder.create({ data: {
    userId: customerId, cartItemIds: '[]', checkoutIdempotencyKey: `production-batch-test-${runId}`,
    status: 'paid', totalAmount: '20.00', receiverName: '批次测试收件人', receiverPhone: customerPhone,
    receiverAddress: '测试路 23 号', receiverCity: '测试市', expiresAt: new Date(Date.now() + 600000)
  } })
  preOrderId = preOrder.id
  const order = await prisma.salesOrder.create({ data: {
    orderNo: `SO-20990101-${runId}`, userId: customerId, preOrderId, status: 'paid', totalAmount: '20.00',
    receiverName: '批次测试收件人', receiverPhone: customerPhone, receiverAddress: '测试路 23 号', receiverCity: '测试市', paidAt: new Date()
  } })
  salesOrderId = order.id
  const item = await prisma.salesOrderItem.create({ data: {
    itemNo: `${order.orderNo}-01`, salesOrderId, itemType: 'CUSTOM', contentId: `PBTEST-${runId}`,
    skuId, skuCode: sku.skuCode, snapshotTitle: '生产批次测试商品', unitPrice: '10.00', quantity: 2, lineTotal: '20.00'
  } })
  const tasks = await Promise.all([1, 2].map(unitIndex => prisma.customizeOrder.create({ data: {
    orderNo: `PU-20990101-${runId.slice(-6)}${unitIndex}`, userId: customerId, skuId, modelId, modelName: model.name,
    frameCount: 12, size: testSize, material: '椴木板', color: '#DDCC99', colorName: '原色', ossPath: '',
    frameUrls: JSON.stringify([`private/test/${runId}/${unitIndex}.png`]), status: 'paid', sourceType: 'custom',
    receiverName: order.receiverName, receiverPhone: order.receiverPhone, receiverAddress: order.receiverAddress,
    receiverCity: order.receiverCity, salesOrderItemId: item.id, unitIndex
  } })))

  const candidatesResponse = await request('/api/admin/production-batches/candidates', token)
  assert(candidatesResponse.status === 200, '可以读取生产批次候选总订单')
  const candidate = (await candidatesResponse.json()).data.find(row => row.id === salesOrderId)
  assert(candidate?.ready === true && candidate.productionUnitCount === 2, '完整总订单和两个 PU 一起进入候选列表')
  assert(candidate.warnings.some(row => row.code === 'KIT_SHORTAGE'), '材料包不足只形成明确提醒')

  const warningResponse = await request('/api/admin/production-batches', token, {
    method: 'POST', body: JSON.stringify({ salesOrderIds: [salesOrderId] })
  })
  assert(warningResponse.status === 409 && (await warningResponse.json()).code === 'BATCH_WARNINGS_REQUIRE_ACK', '未确认材料缺口时不会直接创建批次')

  const createResponse = await request('/api/admin/production-batches', token, {
    method: 'POST', body: JSON.stringify({ salesOrderIds: [salesOrderId], acknowledgeWarnings: true })
  })
  const created = await createResponse.json()
  assert(createResponse.status === 201 && /^PB-\d{8}-[A-Z2-9]{6}$/.test(created.data.batchId), '确认提醒后创建正式 PB 批次')
  batchId = created.data.batchId
  const membership = await prisma.productionBatchOrder.findFirst({ where: { batchId, salesOrderId } })
  assert(Boolean(membership), '批次保存完整总订单冻结关系')
  assert(await prisma.productionBatchUnit.count({ where: { batchId } }) === 2, '批次保存两个单件生产任务及并行进度')
  const printUnits = await prisma.productionBatchUnit.findMany({ where: { batchId }, orderBy: { printSequence: 'asc' } })
  assert(printUnits.every((unit, index) => unit.printGroupId === printGroupId && unit.printSequence === index + 1 && unit.printPageCount === 1), '批次冻结打印裁切组、页数和生产顺序')
  const claimed = await prisma.customizeOrder.findMany({ where: { id: { in: tasks.map(task => task.id) } } })
  assert(claimed.every(task => task.batchId === batchId && task.lockStatus === 'LOCKED'), '所有 PU 原子写入同一批次并锁定')

  const duplicate = await request('/api/admin/production-batches', token, {
    method: 'POST', body: JSON.stringify({ salesOrderIds: [salesOrderId], acknowledgeWarnings: true })
  })
  assert(duplicate.status === 409, '同一总订单不能重复进入活动批次')
  const detailResponse = await request(`/api/admin/production-batches/${batchId}`, token)
  const detail = (await detailResponse.json()).data
  assert(detail.orders.length === 1 && detail.orders[0].items[0].productionUnits.length === 2, '批次详情返回总订单、商品和全部 PU')
  assert(detail.materialDemand[0].required === 2 && detail.progress.total === 2, '批次详情正确汇总领料需求和并行进度')
  assert(detail.printQueue.length === 2 && detail.printQueue[0].groupName === printGroup.name, '批次详情返回冻结的帧素材打印队列')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), token)
  await page.goto(`${webBase}/admin-production-batches.html`, { waitUntil: 'networkidle' })
  const productionItems = page.locator('.nav-group[data-key="production"] > .nav-sub > *')
  assert(await productionItems.first().locator('.nav-sub-parent').getByText('全部订单', { exact: true }).count() === 1, '生产菜单把全部订单放在第一位')
  await productionItems.first().locator('.nav-sub-parent').click()
  const orderStageLinks = productionItems.first().locator('.nav-third-item')
  assert(await orderStageLinks.count() === 8, '全部订单下集中展示八个订单阶段入口')
  await page.getByText(batchId).first().click()
  await page.getByText(tasks[0].orderNo, { exact: true }).first().waitFor({ timeout: 10000 })
  assert(await page.getByText(order.orderNo).count() >= 1, '生产批次页面展示用户总订单')
  assert(await page.getByText(tasks[0].orderNo).count() >= 2 && await page.getByText(tasks[1].orderNo).count() >= 2, '生产批次页面同时在打印队列和订单进度中展示每个 PU')
  await page.goto(`${webBase}/admin-orders.html?view=producing`, { waitUntil: 'networkidle' })
  const activeOrderStage = page.locator('.nav-third-item.active')
  assert(await activeOrderStage.getByText('生产中', { exact: true }).count() === 1, '订单阶段页面自动高亮对应三级菜单')
  assert(await page.locator('.nav-nested[data-nested="production:orders"] .nav-third.open').count() === 1, '当前订单阶段会自动展开全部订单菜单')
  await context.close()

  console.log('Production batch checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
