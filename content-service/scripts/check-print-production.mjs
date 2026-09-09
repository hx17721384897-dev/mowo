import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { hasPermission, PERMISSION, requiredPermissionForRequest } from '../src/lib/permissions.js'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
const sizeA = `${runId.slice(-4)}x5cm`, sizeB = `${runId.slice(-4)}x8cm`
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

  const base = await prisma.machineModel.create({ data: { name: `基础款-${runId}`, ratios: '["1:1"]', frameOptions: '[12,16,24]', sizes: JSON.stringify([sizeA, sizeB]), sortOrder: 0 } })
  const box = await prisma.machineModel.create({ data: { name: `宝盒款-${runId}`, ratios: '["1:1"]', frameOptions: '[12]', sizes: JSON.stringify([sizeA]), sortOrder: 1 } })
  modelIds.push(base.id, box.id)
  const specs = [
    [base, sizeA, 12, '基础12'], [box, sizeA, 12, '宝盒12'], [base, sizeA, 24, '基础24'],
    [base, sizeA, 16, '基础16'], [base, sizeB, 12, '基础8x8'], [box, sizeA, 24, '未配置24'],
    [base, sizeA, 12, '拖拽12']
  ]
  const skus = []
  for (const [model, size, frameCount, label] of specs) {
    const sku = await prisma.machineModelSku.create({ data: {
      modelId: model.id, size, frameCount, material: label.includes('拖拽') ? '亚克力' : '椴木板',
      colorName: `${label}-${runId}`, colorHex: label.includes('宝盒') ? '#CC3355' : '#DDCC99',
      skuCode: `PRINT-${label}-${runId}`, previewImage: 'https://example.com/sku-preview.png'
    } })
    skus.push(sku); skuIds.push(sku.id)
  }

  async function createGroup(name, size, framesPerSheet) {
    const response = await request('/api/admin/print-production/groups', token, {
      method: 'POST', body: JSON.stringify({ name, size, framesPerSheet, paperSize: 'A4', cuttingTool: `${size}-${framesPerSheet}格模具` })
    })
    const json = await response.json()
    assert(response.status === 201, `可以新增打印裁切组：${name}`)
    groupIds.push(json.data.id)
    return json.data
  }
  const group12 = await createGroup(`A4纸${sizeA}单页12帧`, sizeA, 12)
  const group16 = await createGroup(`A4纸${sizeA}单页16帧`, sizeA, 16)
  const group8 = await createGroup(`A4纸${sizeB}单页12帧`, sizeB, 12)

  async function assign(groupId, selectedSkus) {
    const response = await request('/api/admin/print-production/rules', token, {
      method: 'POST', body: JSON.stringify({ groupId, skuIds: selectedSkus.map(sku => sku.id) })
    })
    assert(response.status === 201, `可以向打印组加入 ${selectedSkus.length} 个真实 SKU`)
  }
  await assign(group12.id, [skus[0], skus[1], skus[2]])
  await assign(group16.id, [skus[3]])
  await assign(group8.id, [skus[4]])

  const group12Rules = await prisma.printCutRule.findMany({ where: { groupId: group12.id }, orderBy: { sortOrder: 'asc' } })
  const reorderResponse = await request('/api/admin/print-production/rules/reorder', token, {
    method: 'PUT', body: JSON.stringify({ ruleIds: [group12Rules[1].id, group12Rules[0].id, group12Rules[2].id] })
  })
  assert(reorderResponse.status === 200, '组内具体 SKU 可以单独调整顺序')
  await request('/api/admin/print-production/rules/reorder', token, {
    method: 'PUT', body: JSON.stringify({ ruleIds: [group12Rules[0].id, group12Rules[1].id, group12Rules[2].id] })
  })

  const configResponse = await request('/api/admin/print-production/', token)
  const config = (await configResponse.json()).data
  const configuredRule = config.groups.flatMap(group => group.rules).find(rule => rule.skuId === skus[1].id)
  const unconfiguredRow = config.skus.find(sku => sku.id === skus[5].id)
  assert(configuredRule?.sku?.material === '椴木板' && configuredRule.sku.model.name === box.name, '配置按真实 SKU 保存并返回款式、材质和颜色')
  assert(unconfiguredRow?.previewUrl && !unconfiguredRow.assignment, '尚未配置区返回单个 SKU 和对应图片')

  const changed = await request(`/api/admin/print-production/groups/${group12.id}`, token, {
    method: 'PUT', body: JSON.stringify({ name: group12.name, size: sizeA, framesPerSheet: 10, paperSize: 'A4', cuttingTool: group12.cuttingTool })
  })
  const changedRule = await prisma.printCutRule.findUnique({ where: { skuId: skus[2].id } })
  assert(changed.status === 200 && changedRule.pagesPerUnit === 3, '修改每页帧数会按各 SKU 帧数重算预计页数')
  await request(`/api/admin/print-production/groups/${group12.id}`, token, {
    method: 'PUT', body: JSON.stringify({ name: group12.name, size: sizeA, framesPerSheet: 12, paperSize: 'A4', cuttingTool: group12.cuttingTool })
  })

  const customerPhone = `196${runId}`
  const customer = await prisma.user.create({ data: {
    phone: customerPhone, privacyAgreedAt: new Date(), privacyPolicyVersion: 'print-test',
    profile: { create: { nickname: `print-customer-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  customerId = customer.id
  const preOrder = await prisma.preOrder.create({ data: {
    userId: customerId, cartItemIds: '[]', checkoutIdempotencyKey: `print-plan-${runId}`, status: 'paid', totalAmount: '60',
    receiverName: '排产测试', receiverPhone: customerPhone, receiverAddress: '排产测试路25号', receiverCity: '测试市', expiresAt: new Date(Date.now() + 600000)
  } })
  preOrderId = preOrder.id
  const paidAt = new Date()
  const order = await prisma.salesOrder.create({ data: {
    orderNo: `SO-PRINT-${runId}`, userId: customerId, preOrderId, status: 'paid', totalAmount: '60', paidAt,
    receiverName: '排产测试', receiverPhone: customerPhone, receiverAddress: '排产测试路25号', receiverCity: '测试市'
  } })
  salesOrderId = order.id
  const productionSkus = skus.slice(0, 6), taskIds = []
  for (let index = 0; index < productionSkus.length; index++) {
    const sku = productionSkus[index], [model, size, frameCount, label] = specs[index]
    const item = await prisma.salesOrderItem.create({ data: {
      itemNo: `${order.orderNo}-${String(index + 1).padStart(2, '0')}`, salesOrderId, itemType: 'CUSTOM', contentId: `PRINT-${index}-${runId}`,
      skuId: sku.id, skuCode: sku.skuCode, snapshotTitle: label, unitPrice: '10', quantity: 1, lineTotal: '10'
    } })
    const task = await prisma.customizeOrder.create({ data: {
      orderNo: `PU-PRINT-${runId}-${index + 1}`, userId: customerId, skuId: sku.id, modelId: model.id, modelName: model.name,
      frameCount, size, material: sku.material, color: sku.colorHex, colorName: sku.colorName, ossPath: '',
      frameUrls: JSON.stringify([`private/print/${runId}/${index}.png`]), status: 'paid',
      receiverName: order.receiverName, receiverPhone: order.receiverPhone, receiverAddress: order.receiverAddress,
      receiverCity: order.receiverCity, salesOrderItemId: item.id, unitIndex: 1
    } })
    taskIds.push(task.id)
  }

  const filterResponse = await request(`/api/admin/production-batches/candidates?skuId=${encodeURIComponent(skus[0].id)}`, token)
  const filtered = (await filterResponse.json()).data.find(row => row.id === salesOrderId)
  assert(filtered?.matchedUnitCount === 1 && filtered.extraUnitCount === 5 && filtered.includesUnmatchedItems, '按 SKU 筛选时明确提示混合订单仍会整单加入')
  assert(filtered?.unconfiguredPrintUnitCount === 1 && filtered.warnings.some(row => row.code === 'PRINT_SKU_UNCONFIRMED'), '候选订单明确预警尚未配置的 SKU')
  const date = paidAt.toISOString().slice(0, 10)
  const dateResponse = await request(`/api/admin/production-batches/candidates?paidFrom=${date}&paidTo=${date}`, token)
  assert((await dateResponse.json()).data.some(row => row.id === salesOrderId), '候选订单按支付成功日期筛选')

  const warningResponse = await request('/api/admin/production-batches', token, { method: 'POST', body: JSON.stringify({ salesOrderIds: [salesOrderId] }) })
  const warningJson = await warningResponse.json()
  assert(warningResponse.status === 409 && warningJson.code === 'BATCH_WARNINGS_REQUIRE_ACK' && warningJson.data.some(row => row.code === 'PRINT_SKU_UNCONFIRMED'), '未配置 SKU 入批前必须人工确认预警')
  const createResponse = await request('/api/admin/production-batches', token, { method: 'POST', body: JSON.stringify({ salesOrderIds: [salesOrderId], acknowledgeWarnings: true }) })
  const created = await createResponse.json()
  assert(createResponse.status === 201, '确认风险后完整总订单可以创建生产批次')
  batchId = created.data.batchId
  const units = await prisma.productionBatchUnit.findMany({ where: { batchId }, orderBy: { printSequence: 'asc' } })
  assert(units.map(unit => unit.productionUnitId).join(',') === taskIds.join(','), '顺序按打印组和组内具体 SKU 冻结，未配置 SKU 排在最后')
  assert(units.map(unit => unit.printPageCount ?? 0).join(',') === '1,1,2,1,1,0', '逐 SKU 规则正确计算页数，未配置项保留待确认')
  assert(units.at(-1).printRuleId === null && units.at(-1).printRuleSnapshot?.unconfigured === true, '未配置 SKU 在批次快照中有明显标记')

  await request('/api/admin/print-production/groups/reorder', token, { method: 'PUT', body: JSON.stringify({ groupIds: [group16.id, group12.id, group8.id] }) })
  const frozen = await prisma.productionBatchUnit.findMany({ where: { batchId }, orderBy: { printSequence: 'asc' } })
  assert(frozen.map(unit => unit.productionUnitId).join(',') === taskIds.join(','), '修改打印组顺序不会改变已有批次快照')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), token)
  await page.goto(`${webBase}/admin-print-production.html`, { waitUntil: 'networkidle' })
  await page.getByText(group12.name).waitFor()
  assert(await page.locator(`[data-sku-id="${skus[0].id}"] img`).count() === 1, '页面逐个展示 SKU 图片和基础信息')
  await page.locator(`[data-group-id="${group12.id}"]`).getByRole('button', { name: '添加 SKU' }).click()
  assert((await page.locator('#skuModalHint').textContent())?.includes(`尺寸为 ${sizeA}`), '添加 SKU 时自动检索相同尺寸的现有 SKU')
  await page.getByRole('button', { name: '关闭' }).last().click()
  await page.evaluate(({ skuId, groupId }) => {
    const source = document.querySelector(`[data-sku-id="${skuId}"]`)
    const target = document.querySelector(`[data-group-id="${groupId}"] .sku-list`)
    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  }, { skuId: skus[6].id, groupId: group12.id })
  await page.waitForFunction(id => document.querySelector(`[data-group-id="${id}"]`)?.textContent.includes('拖拽12'), group12.id)
  assert(!!(await prisma.printCutRule.findUnique({ where: { skuId: skus[6].id } })), '尚未配置 SKU 可以拖入匹配尺寸的打印组')
  await page.goto(`${webBase}/admin-production-batches.html`, { waitUntil: 'networkidle' })
  await page.getByText(batchId).first().click()
  await page.getByText('帧素材打印顺序').waitFor()
  assert(await page.getByText('未配置 SKU，待现场确认').count() >= 1, '批次详情展示未配置 SKU 的现场确认标记')
  await context.close()
  console.log('Print production checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
