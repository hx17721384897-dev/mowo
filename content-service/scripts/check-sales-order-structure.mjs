import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
let userId
let outsiderId
let assetId
let versionId
let cartId
let preOrderId
let modelId
let skuId
let collabWorkId
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

async function createConfirmedSelection(customProductId) {
  await prisma.customizationRequest.create({ data: {
    userId,
    mode: 'SELF',
    status: 'CONFIRMED',
    customProductId,
    machineModelId: modelId,
    desiredSkuId: skuId,
    sourceKeys: [],
    editorData: { requestedOptions: [{ skuId }] },
  } })
}

async function cleanup() {
  if (!userId) return
  await prisma.aftersaleRequest.deleteMany({ where: { userId } })
  await prisma.customizeOrder.deleteMany({ where: { userId } })
  await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { userId } } })
  await prisma.salesOrder.deleteMany({ where: { userId } })
  await prisma.preOrder.deleteMany({ where: { userId } })
  await prisma.customizationRequestEvent.deleteMany({ where: { request: { userId } } })
  await prisma.customizationRequest.deleteMany({ where: { userId } })
  const userCarts = await prisma.cart.findMany({ where: { userId }, select: { id: true } })
  if (userCarts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: userCarts.map(cart => cart.id) } } })
  await prisma.cart.deleteMany({ where: { userId } })
  await prisma.customProduct.deleteMany({ where: { userId } })
  if (collabWorkId) await prisma.collabWork.deleteMany({ where: { id: collabWorkId } })
  await prisma.animationAssetVersion.deleteMany({ where: { asset: { ownerUserId: userId } } })
  await prisma.animationAsset.deleteMany({ where: { ownerUserId: userId } })
  await prisma.smsCode.deleteMany({ where: { userId } })
  await prisma.refreshToken.deleteMany({ where: { userId } })
  await prisma.operationLog.deleteMany({ where: { userId } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.userProfile.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
  if (outsiderId) {
    await prisma.smsCode.deleteMany({ where: { userId: outsiderId } })
    await prisma.refreshToken.deleteMany({ where: { userId: outsiderId } })
    await prisma.operationLog.deleteMany({ where: { userId: outsiderId } })
    await prisma.auditLog.deleteMany({ where: { userId: outsiderId } })
    await prisma.userProfile.deleteMany({ where: { userId: outsiderId } })
    await prisma.user.deleteMany({ where: { id: outsiderId } })
  }
  if (skuId) await prisma.inventoryLog.deleteMany({ where: { skuId } })
  if (skuId) await prisma.skuInventory.deleteMany({ where: { skuId } })
  if (skuId) await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
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
  const model = await prisma.machineModel.create({ data: {
    name: `订单结构测试款-${runId}`, ratios: '["1:1"]', frameOptions: '[12]', sizes: '["5x5cm"]'
  } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId, size: '5x5cm', material: '椴木板', frameCount: 12,
    colorName: '原色', colorHex: '#E8D6B0', price: 100, skuCode: `TEST-ORDER-${runId}`
  } })
  skuId = sku.id
  await prisma.skuInventory.create({ data: { skuId, currentStock: 20, safetyStock: 0 } })
  assert(Boolean(sku), '测试库存在可用 SKU 和材料包库存')

  const phone = `196${runId}`
  const user = await prisma.user.create({ data: {
    phone,
    privacyAgreedAt: new Date(), privacyPolicyVersion: 'sales-order-test',
    profile: { create: { nickname: `sales-order-test-${runId}` } },
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
  const outsiderPhone = `195${runId}`
  const outsider = await prisma.user.create({ data: {
    phone: outsiderPhone,
    privacyAgreedAt: new Date(), privacyPolicyVersion: 'sales-order-test',
    profile: { create: { nickname: `sales-order-test-outsider-${runId}` } },
  } })
  outsiderId = outsider.id
  await prisma.smsCode.create({ data: {
    userId: outsiderId, phone: outsiderPhone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000)
  } })
  const outsiderLogin = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone: outsiderPhone, code: '123456', mode: 'LOGIN' })
  })
  assert(outsiderLogin.ok, '第二测试账号可以登录以验证订单所有权')
  const outsiderToken = (await outsiderLogin.json()).data.accessToken

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

  const collabWork = await prisma.collabWork.create({ data: {
    creatorId: userId,
    title: `联名原资料-${runId}`,
    storefrontTitle: `混合订单联名商品-${runId}`,
    storefrontSummary: '混合订单验收',
    storefrontDescription: '混合订单验收详情',
    storefrontCoverUrl: `private/test/${runId}-cover.png`,
    animationFrames: '[]', supportedSkus: JSON.stringify([sku.id]),
    animationAssetId: assetId, animationVersionId: versionId,
    status: 'approved', agreementSignedAt: new Date(), approvedAt: new Date(),
    isOnShelf: true, shelfStatus: 'on_sale', productNo: `COLLAB-${runId}`,
  } })
  collabWorkId = collabWork.id
  await prisma.collabSaleSku.create({ data: {
    collabWorkId, skuId: sku.id, finalPrice: 120,
    fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 7,
    createdBy: userId, updatedBy: userId,
  } })

  for (let index = 0; index < 2; index += 1) {
    const product = await prisma.customProduct.create({ data: {
      userId,
      animationFrames: JSON.stringify(['private/test/frame.png']),
      configJson: JSON.stringify({ modelId: sku.modelId, modelName: model.name, frameCount: 1 }),
      hardwareSkuId: null,
      frameCount: 1,
      animationAssetId: assetId,
      animationVersionId: versionId,
      status: 'in_cart'
    } })
    productIds.push(product.id)
    await createConfirmedSelection(product.id)
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
    configSnapshotJson: JSON.stringify({ modelName: model.name, skuFrameCount: sku.frameCount }),
    snapshotPrice: '100.00',
    quantity: index === 0 ? 1 : 2
  } })))
  cartItems.push(await prisma.cartItem.create({ data: {
    cartId,
    itemType: 'MARKET',
    contentId: collabWorkId,
    hardwareSkuId: sku.id,
    hardwareSkuCode: sku.skuCode,
    snapshotTitle: collabWork.storefrontTitle,
    coverUrl: collabWork.storefrontCoverUrl,
    snapshotPrice: '120.00',
    quantity: 1,
    creatorId: userId,
  } }))

  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  })
  const checkoutContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const checkoutPage = await checkoutContext.newPage()
  await checkoutPage.addInitScript(({ token, apiBase, cartItemIds }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
    sessionStorage.setItem('mowo_checkout_items', JSON.stringify(cartItemIds))
  }, { token, apiBase, cartItemIds: cartItems.map(item => item.id) })
  await checkoutPage.goto(`${webBase}/checkout.html`, { waitUntil: 'networkidle' })
  await checkoutPage.locator('#btnPay').waitFor({ timeout: 10000 })
  assert(await checkoutPage.locator('#btnMockPay').isVisible(), '隔离测试模式由服务端配置显示模拟支付入口')
  await checkoutContext.close()
  browser = null

  const checkoutResponse = await request('/api/cart/checkout', token, {
    method: 'POST', body: JSON.stringify({
      cartItemIds: [cartItems[0].id, cartItems[1].id, cartItems[2].id, cartItems[1].id],
      receiverName: '订单测试', receiverPhone: phone,
      receiverAddress: '测试地址 1 号', receiverCity: '测试市',
      idempotencyKey: `sales-order-test-${runId}`
    })
  })
  assert(checkoutResponse.status === 200, '结算接口接受数量合并后重复出现的购物车 ID')
  const preOrder = (await checkoutResponse.json()).data
  preOrderId = preOrder.id
  const savedPreOrder = await prisma.preOrder.findUnique({ where: { id: preOrder.id } })
  assert(JSON.parse(savedPreOrder.cartItemIds).length === 3, '预订单只保存去重后的购物车条目，商品数量保留在条目中')
  assert(savedPreOrder.checkoutSnapshot?.items?.length === 3, '预订单冻结联名和私人定制商品快照')
  assert(new Set(savedPreOrder.checkoutSnapshot.items.map(item => item.itemType)).size === 2, '一张付款前订单同时包含 MARKET 和 CUSTOM')
  const reserved = await prisma.skuInventory.findUnique({ where: { skuId } })
  assert(reserved.reservedStock === 4, '联名和私人定制共同预锁 4 份材料包库存')

  const duplicateCheckout = await request('/api/cart/checkout', token, {
    method: 'POST', body: JSON.stringify({
      cartItemIds: [cartItems[0].id, cartItems[1].id, cartItems[2].id],
      receiverName: '订单测试', receiverPhone: phone,
      receiverAddress: '测试地址 1 号', receiverCity: '测试市',
      idempotencyKey: `sales-order-test-${runId}`,
    }),
  })
  const duplicateBody = await duplicateCheckout.json()
  assert(duplicateCheckout.ok && duplicateBody.data.id === preOrder.id, '同一提交编号重试返回原付款前订单')
  assert((await prisma.skuInventory.findUnique({ where: { skuId } })).reservedStock === 4, '网络重试不会重复锁定库存')

  await prisma.cartItem.update({
    where: { id: cartItems[2].id }, data: { snapshotTitle: '被篡改的购物车标题', snapshotPrice: '1.00' },
  })

  const payResponses = await Promise.all([1, 2].map(() => request('/api/payment/callback', null, {
    method: 'POST', body: JSON.stringify({ preOrderId: preOrder.id, success: true })
  })))
  assert(payResponses.every(response => response.status === 200), '并发重复支付通知均安全成功')
  const order = await prisma.salesOrder.findUnique({
    where: { preOrderId: preOrder.id },
    include: { items: { include: { productionTasks: true } } }
  })
  assert(Boolean(order) && /^SO-\d{8}-[A-Z2-9]{8}$/.test(order.orderNo), '一次支付只生成一个 SO 用户订单')
  assert(order.items.length === 3, '三个购物车条目生成三条订单商品')
  assert(order.items.reduce((sum, item) => sum + item.quantity, 0) === 4, '订单商品完整保存购买数量')
  const tasks = order.items.flatMap(item => item.productionTasks)
  assert(tasks.length === 4 && tasks.every(task => /^PU-\d{8}-[A-Z2-9]{8}$/.test(task.orderNo)), '四件实物生成四个独立 PU 生产任务')
  assert(order.items.every(item => item.animationAssetId === assetId && item.animationVersionId === versionId), '每条订单商品锁定成交动画及版本')
  const marketItem = order.items.find(item => item.itemType === 'MARKET')
  assert(marketItem.snapshotTitle === collabWork.storefrontTitle && Number(marketItem.unitPrice) === 120, '付款只读取冻结快照，不受后续购物车变化影响')
  assert(Number(marketItem.baseUnitPrice) === 100 && Number(marketItem.priceAdjustment) === 20, '联名订单保存基础价、价格调整和最终成交价')
  assert(tasks.filter(task => task.sourceType === 'collab').every(task => JSON.parse(task.frameUrls).length === 1), '联名 PU 获得冻结动画版本的帧文件')

  const retry = await request(`/api/payment/mock-pay/${preOrder.id}`, token, { method: 'POST' })
  assert(retry.status === 200, '重复支付通知安全返回')
  assert(await prisma.salesOrder.count({ where: { preOrderId: preOrder.id } }) === 1, '重复支付不会创建第二个用户订单')
  assert(await prisma.customizeOrder.count({ where: { salesOrderItem: { salesOrderId: order.id } } }) === 4, '重复支付不会创建额外生产任务')

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
  assert(Boolean(listed) && listed.items.length === 3 && listed.totalQuantity === 4, '订单列表以一张卡片返回混合商品和四件数量')
  const detailResponse = await request(`/api/orders/${order.id}`, token)
  const detail = (await detailResponse.json()).data
  assert(detail.items.length === 3 && detail.items.flatMap(item => item.productionTasks).length === 4, '订单详情返回完整混合商品和单件任务关系')
  assert(detail.actions?.canCancel === true && detail.actions?.canRequestRefund === true && detail.actions?.canRequestQuality === false, '订单接口按服务端状态返回可取消和售后能力')
  assert(detail.receivedAt === null, '未收货订单明确返回空收货时间')
  assert((await request(`/api/orders/${order.id}`, outsiderToken)).status === 404, '其他用户不能读取订单详情')
  assert((await request(`/api/orders/${order.id}/cancel`, outsiderToken, { method: 'POST' })).status === 404, '其他用户不能取消订单')

  const cancellableProduct = await prisma.customProduct.create({ data: {
    userId, animationFrames: JSON.stringify(['private/test/frame.png']),
    configJson: JSON.stringify({ modelId, modelName: model.name, frameCount: 1 }),
    hardwareSkuId: null, frameCount: 1, animationAssetId: assetId,
    animationVersionId: versionId, status: 'in_cart',
  } })
  productIds.push(cancellableProduct.id)
  await createConfirmedSelection(cancellableProduct.id)
  const cancellableItem = await prisma.cartItem.create({ data: {
    cartId, itemType: 'CUSTOM', contentId: cancellableProduct.id,
    customProductId: cancellableProduct.id, hardwareSkuId: sku.id,
    hardwareSkuCode: sku.skuCode, snapshotTitle: '待取消快照测试',
    snapshotPrice: '100.00', quantity: 2,
  } })
  const cancellableCheckout = await request('/api/cart/checkout', token, {
    method: 'POST', body: JSON.stringify({
      cartItemIds: [cancellableItem.id], receiverName: '订单测试', receiverPhone: phone,
      receiverAddress: '测试地址 1 号', receiverCity: '测试市',
      idempotencyKey: `sales-order-cancel-${runId}`,
    }),
  })
  const cancellablePreOrder = (await cancellableCheckout.json()).data
  assert(cancellableCheckout.ok && (await prisma.skuInventory.findUnique({ where: { skuId } })).reservedStock === 6, '新待付款订单继续准确预锁库存')
  const cancellablePay = await request(`/api/payment/mock-pay/${cancellablePreOrder.id}`, token, { method: 'POST' })
  assert(cancellablePay.ok, '待取消订单可从付款前订单进入正式订单')
  const cancellableSalesOrder = await prisma.salesOrder.findUnique({ where: { preOrderId: cancellablePreOrder.id } })
  const cancelResponse = await request(`/api/orders/${cancellableSalesOrder.id}/cancel`, token, { method: 'POST' })
  assert(cancelResponse.ok, '用户可以取消尚未进入生产的正式订单')
  assert((await prisma.salesOrder.findUnique({ where: { id: cancellableSalesOrder.id } })).status === 'cancelled', '取消后聚合订单状态已更新')
  assert((await prisma.skuInventory.findUnique({ where: { skuId } })).reservedStock === 4, '正式订单取消与库存释放在同一事务内完成')
  assert((await request(`/api/orders/${cancellableSalesOrder.id}/cancel`, token, { method: 'POST' })).status === 400, '重复取消不会重复释放库存')
  await prisma.skuInventory.update({ where: { skuId }, data: { currentStock: 5 } })
  const insufficientProduct = await prisma.customProduct.create({ data: {
    userId, animationFrames: JSON.stringify(['private/test/frame.png']),
    configJson: JSON.stringify({ modelId, modelName: model.name, frameCount: 1 }),
    hardwareSkuId: null, frameCount: 1, animationAssetId: assetId,
    animationVersionId: versionId, status: 'in_cart',
  } })
  productIds.push(insufficientProduct.id)
  await createConfirmedSelection(insufficientProduct.id)
  const insufficientItem = await prisma.cartItem.create({ data: {
    cartId, itemType: 'CUSTOM', contentId: insufficientProduct.id,
    customProductId: insufficientProduct.id, hardwareSkuId: sku.id,
    hardwareSkuCode: sku.skuCode, snapshotTitle: '库存不足测试',
    snapshotPrice: '100.00', quantity: 2,
  } })
  const insufficientCheckout = await request('/api/cart/checkout', token, {
    method: 'POST', body: JSON.stringify({
      cartItemIds: [insufficientItem.id], receiverName: '订单测试', receiverPhone: phone,
      receiverAddress: '测试地址 1 号', receiverCity: '测试市',
      idempotencyKey: `sales-order-insufficient-${runId}`,
    }),
  })
  assert(insufficientCheckout.status === 400, '材料包库存不足时整笔结算被拦截')
  assert((await prisma.skuInventory.findUnique({ where: { skuId } })).reservedStock === 4, '库存不足时不留下部分锁定')
  assert(await prisma.preOrder.count({ where: { checkoutIdempotencyKey: `sales-order-insufficient-${runId}` } }) === 0, '库存锁定失败时不留下空的付款前订单')

  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token, apiBase })
  await page.goto(`${webBase}/orders.html`, { waitUntil: 'networkidle' })
  const card = page.locator('.order-card').filter({ hasText: order.orderNo })
  await card.waitFor({ timeout: 10000 })
  assert(await page.locator('.order-card').count() === 1, '订单页只显示一张用户订单卡片')
  assert(await card.getByText('测试商品 1').count() === 1 && await card.getByText('混合订单联名商品', { exact: false }).count() === 1, '一张订单卡片同时展示私人定制和联名商品')
  await page.goto(`${webBase}/order-detail.html?id=${encodeURIComponent(order.id)}`, { waitUntil: 'networkidle' })
  await page.locator('.order-item').first().waitFor({ timeout: 10000 })
  assert(await page.locator('.order-item').count() === 3, '订单详情页展示三条订单商品')
  assert(await page.getByText(/已生成 2 个生产任务/).count() === 1, '数量二正确展示为两个生产任务')
  await context.close()

  await prisma.customizeOrder.updateMany({ where: { id: { in: tasks.map(task => task.id) } }, data: { status: 'shipped' } })
  const shippedDetail = (await (await request(`/api/orders/${order.id}`, token)).json()).data
  assert(shippedDetail.actions?.canConfirmReceipt === true, '全部发货后订单接口开放确认收货能力')
  const confirmReceipt = await request(`/api/orders/${order.id}/confirm-receipt`, token, { method: 'POST' })
  assert(confirmReceipt.ok, '全部发货的聚合订单可以由本人确认收货')
  const receivedOrder = await prisma.salesOrder.findUnique({
    where: { id: order.id }, include: { items: { include: { productionTasks: true } } }
  })
  assert(receivedOrder.status === 'received' && receivedOrder.items.flatMap(item => item.productionTasks).every(task => task.status === 'received'), '确认收货会一致更新订单头、商品项和全部生产任务')
  const receivedDetail = (await (await request(`/api/orders/${order.id}`, token)).json()).data
  assert(Boolean(receivedDetail.receivedAt) && receivedDetail.actions?.canRequestQuality === true, '确认收货后返回收货时间并开放质量售后能力')
  assert((await request(`/api/orders/${order.id}/aftersale`, token, {
    method: 'POST', body: JSON.stringify({ type: 'quality', reason: { invalid: true } })
  })).status === 400, '售后原因类型错误被服务端拒绝而非抛出异常')
  assert((await request(`/api/orders/${order.id}/aftersale`, token, {
    method: 'POST', body: JSON.stringify({ type: 'quality', reason: '测试', imageUrls: ['a', 'b', 'c', 'd'] })
  })).status === 400, '售后凭证数量超限被服务端拒绝')
  const aftersaleResponse = await request(`/api/orders/${order.id}/aftersale`, token, {
    method: 'POST', body: JSON.stringify({ type: 'quality', reason: '自动化状态机验收' })
  })
  assert(aftersaleResponse.ok, '已收货的订单可提交质量问题售后')
  assert((await request(`/api/orders/${order.id}/aftersale`, token)).ok, '用户可读取自己订单的最新售后申请')
  assert((await request(`/api/orders/${order.id}/aftersale`, token, {
    method: 'POST', body: JSON.stringify({ type: 'quality', reason: '重复申请' })
  })).status === 400, '存在待处理售后时不能重复提交申请')

  console.log('Sales order structure checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
