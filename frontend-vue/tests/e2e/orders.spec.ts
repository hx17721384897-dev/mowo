import { expect, test, type Page } from '@playwright/test'

function orderFixture(status: 'shipped' | 'received' | 'paid' = 'shipped') {
  return {
    id: 'order-1',
    orderNo: 'MOWO-001',
    status,
    displayStatus: status === 'shipped' ? '运输中' : status === 'received' ? '已完成' : '已付款',
    statusGroup: status === 'shipped' ? 'shipped' : status === 'received' ? 'done' : 'paid',
    statusStep: status === 'shipped' ? 3 : status === 'received' ? 4 : 1,
    sourceType: 'custom',
    platform: 'mowo',
    productTitle: '混合订单',
    coverUrl: null,
    modelName: null,
    size: null,
    material: null,
    frameCount: null,
    colorName: null,
    totalAmount: 327,
    itemCount: 2,
    totalQuantity: 3,
    items: [
      {
        id: 'item-1',
        itemNo: 'ITEM-1',
        itemType: 'CUSTOM',
        productTitle: '<img src=x onerror=alert(1)>私人定制',
        coverUrl: null,
        modelName: '标准款',
        size: '5×5cm',
        material: '椴木板',
        frameCount: 12,
        colorName: '原木色',
        quantity: 1,
        unitPrice: 129,
        lineTotal: 129,
        animationAssetId: null,
        animationVersionId: null,
        skuId: 'sku-1'
      },
      {
        id: 'item-2',
        itemNo: 'ITEM-2',
        itemType: 'MARKET',
        productTitle: '联名商品',
        coverUrl: null,
        modelName: '标准款',
        size: '5×5cm',
        material: '椴木板',
        frameCount: 12,
        colorName: '原木色',
        quantity: 2,
        unitPrice: 99,
        lineTotal: 198,
        animationAssetId: null,
        animationVersionId: null,
        skuId: 'sku-2'
      }
    ],
    actions: {
      canCancel: status === 'paid',
      canConfirmReceipt: status === 'shipped',
      canRequestRefund: true,
      canRequestQuality: status === 'received'
    },
    trackingNo: 'YT123456',
    trackingCompany: '圆通',
    shippedAt: '2026-09-20T10:00:00.000Z',
    receivedAt: status === 'received' ? '2026-09-21T10:00:00.000Z' : null,
    paidAt: '2026-09-20T10:00:00.000Z',
    earliestProductionAt: '2026-09-20T11:00:00.000Z',
    receiverName: '张三',
    receiverPhone: '13800138000',
    receiverAddress: '科技园南路88号',
    receiverCity: '深圳市',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    legacy: false
  }
}

async function setup(page: Page, initialStatus: 'shipped' | 'received' | 'paid' = 'shipped') {
  let draftWrites = 0
  let status: 'shipped' | 'received' | 'paid' = initialStatus
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'orders-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'user-1', role: 0, status: 'ACTIVE', profile: { nickname: '订单用户' } }
      }
    })
  )
  await page.route('**/api/orders/mine?**', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          orders: [orderFixture(status)],
          activeCount: status === 'received' ? 0 : 1,
          totalCount: 1,
          page: 1,
          limit: 30,
          hasMore: false
        }
      }
    })
  )
  await page.route('**/api/orders/order-1', (route) =>
    route.fulfill({ json: { success: true, data: orderFixture(status) } })
  )
  await page.route('**/api/orders/order-1/confirm-receipt', (route) => {
    status = 'received'
    return route.fulfill({ json: { success: true, data: { status } } })
  })
  await page.route('**/api/orders/order-1/aftersale', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? {
              success: true,
              data: {
                id: 'after-1',
                type: 'quality',
                reason: '与描述不符',
                description: '问题描述',
                status: 'pending',
                adminNote: null,
                processedAt: null,
                createdAt: '2026-09-21T10:00:00.000Z',
                updatedAt: '2026-09-21T10:00:00.000Z'
              }
            }
          : { success: true, data: { status: 'aftersale' } }
    })
  )
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /customization-requests|custom-products/.test(request.url()))
      draftWrites++
  })
  return { draftWrites: () => draftWrites }
}

test('已付款订单展示最早可开始制作时间', async ({ page }) => {
  await setup(page, 'paid')
  await page.goto('/app/orders/order-1')
  await expect(page.getByRole('heading', { name: '已付款' })).toBeVisible()
  await expect(page.getByText(/最早可开始制作：/)).toBeVisible()
})

test('列表保留混合商品、文本安全和确认收货，且不写草稿', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/app/orders')
  await expect(page.getByRole('heading', { name: /我的订单/ })).toBeVisible()
  await expect(page.getByText('<img src=x onerror=alert(1)>私人定制')).toBeVisible()
  await expect(page.locator('.order-card .items-row')).toHaveCount(2)
  await expect(page.locator('.order-card img')).toHaveCount(0)
  await page.getByRole('button', { name: '确认收货' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: '确认收货' }).click()
  await expect(page.getByText('已完成').first()).toBeVisible()
  expect(state.draftWrites()).toBe(0)
})

test('详情展示地址、商品数量和售后能力，移动端无横向溢出', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/app/orders/order-1')
  await expect(page.getByText('张三')).toBeVisible()
  await expect(page.getByText(/138.*8000/)).toBeVisible()
  await expect(page.getByText('数量：2')).toBeVisible()
  await expect(page.getByText(/生产任务|生产批次|PU-|PB-/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '申请售后' })).toBeVisible()
  await page.getByRole('button', { name: '申请售后' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '质量售后' })).toBeDisabled()
  await page.getByRole('dialog').getByRole('button', { name: '退款申请' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '拍错了' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '提交申请' })).toBeEnabled()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true)
  expect(state.draftWrites()).toBe(0)
})

test('无权访问或不存在订单时不显示订单信息', async ({ page }) => {
  await setup(page)
  await page.route('**/api/orders/other-order', (route) =>
    route.fulfill({ status: 404, json: { success: false, message: '订单不存在' } })
  )
  await page.goto('/app/orders/other-order')
  await expect(page.getByText('加载失败')).toBeVisible()
  await expect(page.locator('.order-section')).toHaveCount(0)
})

test('售后提交只发送一次，仍不产生定制草稿', async ({ page }) => {
  const state = await setup(page)
  let aftersaleWrites = 0
  await page.route('**/api/orders/order-1/aftersale', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    aftersaleWrites++
    await new Promise((resolve) => setTimeout(resolve, 150))
    return route.fulfill({ json: { success: true, data: { status: 'aftersale' } } })
  })
  await page.goto('/app/orders/order-1')
  await page.getByRole('button', { name: '申请售后' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '退款申请' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '拍错了' }).click()
  const submit = page.getByRole('dialog').getByRole('button', { name: '提交申请' })
  await submit.dblclick()
  await expect(page.getByText('✓ 售后申请已提交')).toBeVisible()
  expect(aftersaleWrites).toBe(1)
  expect(state.draftWrites()).toBe(0)
})

test('未登录访问订单返回登录弹窗并保留安全回跳', async ({ page }) => {
  await page.goto('/app/orders')
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/app/' &&
      url.searchParams.get('auth') === '1' &&
      url.searchParams.get('redirect') === '/orders'
  )
  await expect(page.getByRole('dialog')).toBeVisible()
})
