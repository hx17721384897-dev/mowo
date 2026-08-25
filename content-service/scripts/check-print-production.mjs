import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { hasPermission, PERMISSION, requiredPermissionForRequest } from '../src/lib/permissions.js'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
const sizeA = `${runId.slice(-4)}x5cm`
const sizeB = `${runId.slice(-4)}x8cm`
let adminId, customerId, preOrderId, salesOrderId, batchId, browser
const modelIds = [], skuIds = [], groupIds = []

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

async function cleanup() {
  if (batchId) {
    await prisma.productionBatchUnit.deleteMany({ where: { batchId } })
    await prisma.productionBatchOrder.deleteMany({ where: { batchId } })
    await prisma.batchItem.deleteMany({ where: { batchId } })
    await prisma.productionBatch.deleteMany({ where: { id: batchId } })
  }
  if (customerId) await prisma.customizeOrder.deleteMany({ where: { userId: customerId } })
  if (salesOrderId) await prisma.salesOrderItem.deleteMany({ where: { salesOrderId } })
  if (salesOrderId) await prisma.salesOrder.deleteMany({ where: { id: salesOrderId } })
  if (preOrderId) await prisma.preOrder.deleteMany({ where: { id: preOrderId } })
  if (skuIds.length) await prisma.machineModelSku.deleteMany({ where: { id: { in: skuIds } } })
  if (modelIds.length) await prisma.machineModel.deleteMany({ where: { id: { in: modelIds } } })
  if (groupIds.length) {
    await prisma.printCutRule.deleteMany({ where: { groupId: { in: groupIds } } })
    await prisma.printCutGroup.deleteMany({ where: { id: { in: groupIds } } })
  }
  for (const userId of [customerId, adminId].filter(Boolean)) {
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
}

try {
  assert(PERMISSION.PRODUCTION_CONFIG === 'PRODUCTION_CONFIG' && requiredPermissionForRequest('PUT', '/api/admin/print-production/groups/example') === PERMISSION.PRODUCTION_CONFIG, '打印排产设置使用独立高权限')
  assert(!hasPermission({ staffRole: 'PRODUCTION' }, PERMISSION.PRODUCTION_CONFIG), '普通生产员工不能修改全局排产规则')
  const adminPhone = `195${runId}`
  const admin = await prisma.user.create({ data: {
    phone: adminPhone, role: 3, staffRole: 'OWNER', privacyAgreedAt: new Date(), privacyPolicyVersion: 'print-test',
    profile: { create: { nickname: `print-admin-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  adminId = admin.id
  await prisma.smsCode.create({ data: { userId: adminId, phone: adminPhone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const login = await request('/api/v1/auth/sms/verify', null, { method: 'POST', body: JSON.stringify({ phone: adminPhone, code: '123456', mode: 'LOGIN' }) })
  assert(login.status === 200, '打印排产测试管理员可以登录')
  const token = (await login.json()).data.accessToken

  async function createGroup(name, size, framesPerSheet) {
    const response = await request('/api/admin/print-production/groups', token, {
      method: 'POST', body: JSON.stringify({ name, size, framesPerSheet, paperSize: 'A4', cuttingTool: `${size}-${framesPerSheet}格模具` })
    })
    const json = await response.json()
    assert(response.status === 201, `可以新增打印裁切组：${name}`)
    groupIds.push(json.data.id)
    return json.data
  }
  const group12 = await createGroup(`${sizeA}每页12帧`, sizeA, 12)
  const group16 = await createGroup(`${sizeA}每页16帧`, sizeA, 16)
  const group8 = await createGroup(`${sizeB}每页12帧`, sizeB, 12)
  for (const [groupId, frameCount] of [[group12.id, 12], [group12.id, 24], [group16.id, 16], [group8.id, 12]]) {
    const response = await request('/api/admin/print-production/rules', token, { method: 'POST', body: JSON.stringify({ groupId, frameCount }) })
    assert(response.status === 201, `可以配置 ${frameCount} 帧适用规则`)
  }
  const changed = await request(`/api/admin/print-production/groups/${group12.id}`, token, {
    method: 'PUT', body: JSON.stringify({ name: group12.name, size: sizeA, framesPerSheet: 10, paperSize: 'A4', cuttingTool: group12.cuttingTool })
  })
  assert(changed.status === 200 && (await prisma.printCutRule.findUnique({ where: { size_frameCount: { size: sizeA, frameCount: 24 } } })).pagesPerUnit === 3, '修改每页帧数会自动重算组内预计页数')
  await request(`/api/admin/print-production/groups/${group12.id}`, token, {
    method: 'PUT', body: JSON.stringify({ name: group12.name, size: sizeA, framesPerSheet: 12, paperSize: 'A4', cuttingTool: group12.cuttingTool })
  })

  const base = await prisma.machineModel.create({ data: { name: `基础款-${runId}`, ratios: '["1:1"]', frameOptions: '[12,16,24]', sizes: JSON.stringify([sizeA, sizeB]), sortOrder: 0 } })
  const box = await prisma.machineModel.create({ data: { name: `宝盒款-${runId}`, ratios: '["1:1"]', frameOptions: '[12]', sizes: JSON.stringify([sizeA]), sortOrder: 1 } })
  modelIds.push(base.id, box.id)
  const specs = [
    [base, sizeA, 12, '基础12'], [box, sizeA, 12, '宝盒12'], [base, sizeA, 24, '基础24'],
    [base, sizeA, 16, '基础16'], [base, sizeB, 12, '基础8x8']
  ]
  const skus = []
  for (const [model, size, frameCount, label] of specs) {
    const sku = await prisma.machineModelSku.create({ data: {
      modelId: model.id, size, frameCount, material: '椴木板', colorName: `${label}-${runId}`, colorHex: '#DDCC99', skuCode: `PRINT-${label}-${runId}`
    } })
    skus.push(sku); skuIds.push(sku.id)
  }

  const customerPhone = `196${runId}`
  const customer = await prisma.user.create({ data: {
    phone: customerPhone, privacyAgreedAt: new Date(), privacyPolicyVersion: 'print-test',
    profile: { create: { nickname: `print-customer-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  customerId = customer.id
  const preOrder = await prisma.preOrder.create({ data: {
    userId: customerId, cartItemIds: '[]', checkoutIdempotencyKey: `print-plan-${runId}`, status: 'paid', totalAmount: '50',
    receiverName: '排产测试', receiverPhone: customerPhone, receiverAddress: '排产测试路25号', receiverCity: '测试市', expiresAt: new Date(Date.now() + 600000)
  } })
  preOrderId = preOrder.id
  const paidAt = new Date()
  const order = await prisma.salesOrder.create({ data: {
    orderNo: `SO-PRINT-${runId}`, userId: customerId, preOrderId, status: 'paid', totalAmount: '50', paidAt,
    receiverName: '排产测试', receiverPhone: customerPhone, receiverAddress: '排产测试路25号', receiverCity: '测试市'
  } })
  salesOrderId = order.id
  const taskIds = []
  for (let index = 0; index < skus.length; index++) {
    const sku = skus[index], [model, size, frameCount, label] = specs[index]
    const item = await prisma.salesOrderItem.create({ data: {
      itemNo: `${order.orderNo}-${String(index + 1).padStart(2, '0')}`, salesOrderId, itemType: 'CUSTOM', contentId: `PRINT-${index}-${runId}`,
      skuId: sku.id, skuCode: sku.skuCode, snapshotTitle: label, unitPrice: '10', quantity: 1, lineTotal: '10'
    } })
    const task = await prisma.customizeOrder.create({ data: {
      orderNo: `PU-PRINT-${runId}-${index + 1}`, userId: customerId, skuId: sku.id, modelId: model.id, modelName: model.name,
      frameCount, size, material: '椴木板', color: '#DDCC99', colorName: label, ossPath: '', frameUrls: JSON.stringify([`private/print/${runId}/${index}.png`]),
      status: 'paid', receiverName: order.receiverName, receiverPhone: order.receiverPhone, receiverAddress: order.receiverAddress,
      receiverCity: order.receiverCity, salesOrderItemId: item.id, unitIndex: 1
    } })
    taskIds.push(task.id)
  }

  const filterResponse = await request(`/api/admin/production-batches/candidates?skuId=${encodeURIComponent(skus[0].id)}`, token)
  const filtered = (await filterResponse.json()).data.find(row => row.id === salesOrderId)
  assert(filtered?.matchedUnitCount === 1 && filtered.extraUnitCount === 4 && filtered.includesUnmatchedItems, '按 SKU 筛选时明确提示混合订单仍会整单加入')
  const date = paidAt.toISOString().slice(0, 10)
  const dateResponse = await request(`/api/admin/production-batches/candidates?paidFrom=${date}&paidTo=${date}`, token)
  assert((await dateResponse.json()).data.some(row => row.id === salesOrderId), '候选订单按支付成功日期筛选')

  const createResponse = await request('/api/admin/production-batches', token, { method: 'POST', body: JSON.stringify({ salesOrderIds: [salesOrderId], acknowledgeWarnings: true }) })
  const created = await createResponse.json()
  assert(createResponse.status === 201, '完整混合订单可以创建生产批次')
  batchId = created.data.batchId
  const units = await prisma.productionBatchUnit.findMany({ where: { batchId }, orderBy: { printSequence: 'asc' } })
  const expectedTaskIds = [taskIds[0], taskIds[1], taskIds[2], taskIds[3], taskIds[4]]
  assert(units.map(unit => unit.productionUnitId).join(',') === expectedTaskIds.join(','), '顺序为12帧基础款、12帧宝盒款、24帧基础款、16帧基础款、8×8基础款')
  assert(units.map(unit => unit.printPageCount).join(',') === '1,1,2,1,1', '24帧使用12帧版式时冻结为两页')

  await request('/api/admin/print-production/groups/reorder', token, { method: 'PUT', body: JSON.stringify({ groupIds: [group16.id, group12.id, group8.id] }) })
  const frozen = await prisma.productionBatchUnit.findMany({ where: { batchId }, orderBy: { printSequence: 'asc' } })
  assert(frozen.map(unit => unit.productionUnitId).join(',') === expectedTaskIds.join(','), '修改规则顺序不会改变已有批次快照')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), token)
  await page.goto(`${webBase}/admin-print-production.html`, { waitUntil: 'networkidle' })
  await page.getByText(group12.name).waitFor()
  assert(await page.getByText('打印与裁切设置').count() >= 1, '独立打印与裁切设置页面可以打开')
  await page.goto(`${webBase}/admin-production-batches.html`, { waitUntil: 'networkidle' })
  await page.getByText(batchId).first().click()
  await page.getByText('帧素材打印顺序').waitFor()
  assert(await page.getByText('帧素材打印顺序').count() === 1, '生产批次详情展示冻结的打印顺序')
  await context.close()
  console.log('Print production checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
