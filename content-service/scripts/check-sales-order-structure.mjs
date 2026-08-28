import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
let userId
let assetId
let versionId
let cartId
let preOrderId
const productIds = []
let browser

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
  if (!userId) return
  await prisma.aftersaleRequest.deleteMany({ where: { userId } })
  await prisma.customizeOrder.deleteMany({ where: { userId } })
  await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { userId } } })
  await prisma.salesOrder.deleteMany({ where: { userId } })
  await prisma.preOrder.deleteMany({ where: { userId } })
  const userCarts = await prisma.cart.findMany({ where: { userId }, select: { id: true } })
  if (userCarts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: userCarts.map(cart => cart.id) } } })
  await prisma.cart.deleteMany({ where: { userId } })
  await prisma.customProduct.deleteMany({ where: { userId } })
  await prisma.animationAssetVersion.deleteMany({ where: { asset: { ownerUserId: userId } } })
  await prisma.animationAsset.deleteMany({ where: { ownerUserId: userId } })
  await prisma.smsCode.deleteMany({ where: { userId } })
  await prisma.refreshToken.deleteMany({ where: { userId } })
  await prisma.operationLog.deleteMany({ where: { userId } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.userProfile.deleteMany({ where: { userId } })
  await prisma.creditScore.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
}

async function cleanupHistoricalUsers() {
  const profiles = await prisma.userProfile.findMany({
    where: { nickname: { startsWith: 'sales-order-test-' } }, select: { userId: true }
  })
  for (const profile of profiles) {
    userId = profile.userId
    assetId = null
    cartId = null
    productIds.length = 0
    await cleanup()
  }
  userId = null
}

try {
  await cleanupHistoricalUsers()
  const sku = await prisma.machineModelSku.findFirst({
    where: { isActive: true, model: { isActive: true } }, include: { model: true }
  })
  assert(Boolean(sku), '测试库存在可用 SKU')

  const phone = `196${runId}`
  const user = await prisma.user.create({ data: {
    phone,
    privacyAgreedAt: new Date(), privacyPolicyVersion: 'sales-order-test',
    profile: { create: { nickname: `sales-order-test-${runId}` } },
    creditScore: { create: { score: 100 } }
  } })
  userId = user.id
  await prisma.smsCode.create({ data: {
    userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000)
  } })
  const loginResponse = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assert(loginResponse.status === 200, '订单测试账号可以登录')
  const token = (await loginResponse.json()).data.accessToken

  const asset = await prisma.animationAsset.create({ data: {
    assetNo: `ANM-20990101-${runId.slice(-6)}`,
    ownerUserId: userId,
    title: '订单结构测试动画',
    sourceType: 'SELF_SCREENED',
    currentVersionNo: 1
  } })
  assetId = asset.id
  const version = await prisma.animationAssetVersion.create({ data: {
    assetId,
    versionNo: 1,
    sourceKey: `SALES_ORDER_TEST:${runId}`,
    sourceType: 'SELF_SCREENED',
    frameKeys: ['private/test/frame.png'],
    baseFrameCount: 1,
    manifestHash: 'a'.repeat(64)
  } })
  versionId = version.id

  for (let index = 0; index < 2; index += 1) {
    const product = await prisma.customProduct.create({ data: {
      userId,
      animationFrames: JSON.stringify(['private/test/frame.png']),
      configJson: JSON.stringify({ modelId: sku.modelId, modelName: sku.model.name, frameCount: 1 }),
      hardwareSkuId: sku.id,
      frameCount: 1,
      animationAssetId: assetId,
      animationVersionId: versionId,
      status: 'in_cart'
    } })
    productIds.push(product.id)
  }

  const cart = await prisma.cart.create({ data: { userId } })
  cartId = cart.id
  const cartItems = await Promise.all(productIds.map((productId, index) => prisma.cartItem.create({ data: {
    cartId,
    itemType: 'CUSTOM',
    contentId: productId,
    customProductId: productId,
    hardwareSkuId: sku.id,
    hardwareSkuCode: sku.skuCode,
    snapshotTitle: `测试商品 ${index + 1}`,
    configSnapshotJson: JSON.stringify({ modelName: sku.model.name, skuFrameCount: sku.frameCount }),
    snapshotPrice: index === 0 ? '10.00' : '20.00',
    quantity: index === 0 ? 1 : 2
  } })))
  const checkoutResponse = await request('/api/cart/checkout', token, {
    method: 'POST', body: JSON.stringify({
      cartItemIds: [cartItems[0].id, cartItems[1].id, cartItems[1].id],
      receiverName: '订单测试', receiverPhone: phone,
      receiverAddress: '测试地址 1 号', receiverCity: '测试市',
      idempotencyKey: `sales-order-test-${runId}`
    })
  })
  assert(checkoutResponse.status === 200, '结算接口接受数量合并后重复出现的购物车 ID')
  const preOrder = (await checkoutResponse.json()).data
  preOrderId = preOrder.id
  const savedPreOrder = await prisma.preOrder.findUnique({ where: { id: preOrder.id } })
  assert(JSON.parse(savedPreOrder.cartItemIds).length === 2, '预订单只保存去重后的购物车条目，商品数量保留在条目中')

  const payResponses = await Promise.all([1, 2].map(() => request('/api/payment/callback', null, {
    method: 'POST', body: JSON.stringify({ preOrderId: preOrder.id, success: true })
  })))
  assert(payResponses.every(response => response.status === 200), '并发重复支付通知均安全成功')
  const order = await prisma.salesOrder.findUnique({
    where: { preOrderId: preOrder.id },
    include: { items: { include: { productionTasks: true } } }
  })
  assert(Boolean(order) && /^SO-\d{8}-[A-Z2-9]{8}$/.test(order.orderNo), '一次支付只生成一个 SO 用户订单')
  assert(order.items.length === 2, '两个购物车条目生成两条订单商品')
  assert(order.items.reduce((sum, item) => sum + item.quantity, 0) === 3, '订单商品完整保存购买数量')
  const tasks = order.items.flatMap(item => item.productionTasks)
  assert(tasks.length === 3 && tasks.every(task => /^PU-\d{8}-[A-Z2-9]{8}$/.test(task.orderNo)), '三件实物生成三个独立 PU 生产任务')
  assert(order.items.every(item => item.animationAssetId === assetId && item.animationVersionId === versionId), '每条订单商品锁定成交动画及版本')

  const retry = await request(`/api/payment/mock-pay/${preOrder.id}`, token, { method: 'POST' })
  assert(retry.status === 200, '重复支付通知安全返回')
  assert(await prisma.salesOrder.count({ where: { preOrderId: preOrder.id } }) === 1, '重复支付不会创建第二个用户订单')
  assert(await prisma.customizeOrder.count({ where: { salesOrderItem: { salesOrderId: order.id } } }) === 3, '重复支付不会创建额外生产任务')

  const brokenPreOrder = await prisma.preOrder.create({ data: {
    userId, cartItemIds: JSON.stringify(['missing-cart-item']),
    checkoutIdempotencyKey: `sales-order-broken-${runId}`, totalAmount: '1.00',
    expiresAt: new Date(Date.now() + 600000)
  } })
  const brokenMock = await request(`/api/payment/mock-pay/${brokenPreOrder.id}`, token, { method: 'POST' })
  assert(brokenMock.status >= 400, '模拟支付在正式订单创建失败时向前端返回失败')
  assert(await prisma.salesOrder.count({ where: { preOrderId: brokenPreOrder.id } }) === 0, '失败的模拟支付不会留下不完整正式订单')

  const listResponse = await request('/api/orders/mine?tab=all', token)
  const list = (await listResponse.json()).data.orders
  const listed = list.find(item => item.id === order.id)
  assert(Boolean(listed) && listed.items.length === 2 && listed.totalQuantity === 3, '订单列表以一张卡片返回两种商品和三件数量')
  const detailResponse = await request(`/api/orders/${order.id}`, token)
  const detail = (await detailResponse.json()).data
  assert(detail.items.length === 2 && detail.items.flatMap(item => item.productionTasks).length === 3, '订单详情返回完整商品和单件任务关系')

  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), token)
  await page.goto(`${webBase}/orders.html`, { waitUntil: 'networkidle' })
  const card = page.locator('.order-card').filter({ hasText: order.orderNo })
  await card.waitFor({ timeout: 10000 })
  assert(await page.locator('.order-card').count() === 1, '订单页只显示一张用户订单卡片')
  assert(await card.getByText('测试商品 1').count() === 1 && await card.getByText('测试商品 2').count() === 1, '一张订单卡片同时展示两种商品')
  await page.goto(`${webBase}/order-detail.html?id=${encodeURIComponent(order.id)}`, { waitUntil: 'networkidle' })
  await page.locator('.order-item').first().waitFor({ timeout: 10000 })
  assert(await page.locator('.order-item').count() === 2, '订单详情页展示两条订单商品')
  assert(await page.getByText(/已生成 2 个生产任务/).count() === 1, '数量二正确展示为两个生产任务')
  await context.close()

  console.log('Sales order structure checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
