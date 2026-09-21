import { expect, test, type Page } from '@playwright/test'

function cartFixture() {
  return {
    cartId: 'cart-1',
    items: [
      {
        id: 'item-1',
        itemType: 'CUSTOM',
        contentId: 'custom-1',
        hardwareSkuId: 'sku-1',
        hardwareSkuCode: 'SKU-1',
        snapshotTitle: '标准款私人定制',
        snapshotPreviewUrl: null,
        coverUrl: null,
        configSnapshotJson: '{}',
        snapshotPrice: '129.00',
        currentPrice: 129,
        quantity: 1,
        selected: true,
        creatorId: null,
        status: 'normal',
        customProductId: 'custom-1',
        sessionGroupId: 'group-1'
      },
      {
        id: 'item-2',
        itemType: 'MARKET',
        contentId: 'work-1',
        hardwareSkuId: 'sku-2',
        hardwareSkuCode: 'SKU-2',
        snapshotTitle: '<img src=x onerror=alert(1)>联名作品',
        snapshotPreviewUrl: null,
        coverUrl: null,
        configSnapshotJson: null,
        snapshotPrice: '99.00',
        currentPrice: 99,
        quantity: 2,
        selected: true,
        creatorId: 'creator-1',
        status: 'normal',
        customProductId: null,
        sessionGroupId: null
      }
    ],
    creatorProfiles: {
      'creator-1': { userId: 'creator-1', nickname: '创作者', avatarUrl: null }
    },
    totalSelected: 3,
    totalPrice: '327.00'
  }
}

async function mockBase(page: Page, features = { onlineCheckout: true, mockPayment: true }) {
  let draftWrites = 0
  await page.addInitScript(() => {
    localStorage.setItem('mowo_token', 'checkout-token')
    sessionStorage.setItem('mowo_checkout_items', '["item-1","item-2"]')
    sessionStorage.setItem('unrelated-draft', 'keep')
  })
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'user-1', role: 0, status: 'ACTIVE', profile: { nickname: '结算用户' } }
      })
    })
  )
  await page.route('**/api/config/features', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { ...features, passwordLogin: false } })
    })
  )
  await page.route('**/api/cart', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: cartFixture() })
    })
  )
  await page.route('**/api/addresses', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 'address-1',
            label: '家',
            name: '张三',
            phone: '13800138000',
            province: '广东省',
            city: '深圳市',
            district: '南山区',
            detail: '科技园南路88号',
            isDefault: true
          }
        ]
      })
    })
  )
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      (/customization-requests/.test(request.url()) || /custom-products/.test(request.url()))
    ) {
      draftWrites += 1
    }
  })
  return { draftWrites: () => draftWrites }
}

test('checkout keeps one idempotency key across retry and completes isolated mock payment', async ({
  page
}) => {
  const audit = await mockBase(page)
  const checkoutBodies: Record<string, unknown>[] = []
  let checkoutCalls = 0
  await page.route('**/api/cart/checkout', async (route) => {
    checkoutCalls += 1
    checkoutBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (checkoutCalls === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'TEMPORARY', message: '暂时不可用' })
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'pre-1',
          status: 'pending_payment',
          totalAmount: '327.00',
          expiresAt: '2099-09-21T09:10:00.000Z',
          createdAt: '2099-09-21T09:00:00.000Z'
        }
      })
    })
  })
  await page.route('**/api/payment/status/pre-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'pre-1',
          status: 'pending_payment',
          totalAmount: '327.00',
          expiresAt: '2099-09-21T09:10:00.000Z',
          expired: false
        }
      })
    })
  )
  await page.route('**/api/payment/mock-pay/pre-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'order-1', orderNo: 'SO-1' } })
    })
  )

  await page.goto('/app/checkout')
  await expect(page.getByRole('heading', { name: '确认订单' })).toBeVisible()
  await expect(page.locator('.product-row')).toHaveCount(2)
  await expect(
    page.locator('.product-name').getByText('<img src=x onerror=alert(1)>联名作品')
  ).toBeVisible()
  await expect(page.locator('.product-name img')).toHaveCount(0)
  const submit = page.locator('.btn-pay')
  await expect(submit).toBeEnabled()

  await submit.click()
  await expect(page.getByText('暂时不可用')).toBeVisible()
  await submit.click()
  await expect(page.getByText('订单已生成')).toBeVisible()
  expect(checkoutBodies).toHaveLength(2)
  expect(checkoutBodies[0]?.idempotencyKey).toBe(checkoutBodies[1]?.idempotencyKey)
  expect(checkoutBodies[1]).toMatchObject({
    cartItemIds: ['item-1', 'item-2'],
    receiverName: '张三',
    receiverPhone: '13800138000',
    receiverCity: '深圳市',
    receiverAddress: '广东省 深圳市 南山区 科技园南路88号'
  })

  await page.reload()
  await expect(page.getByText('订单已生成')).toBeVisible()
  expect(checkoutCalls).toBe(2)
  await page.getByRole('button', { name: '🧪 开发模式：模拟支付成功' }).click()
  await expect(page.getByText('支付成功！')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('mowo_checkout_items'))).toBeNull()
  expect(await page.evaluate(() => sessionStorage.getItem('mowo_checkout_attempt_v1'))).toBeNull()
  expect(await page.evaluate(() => sessionStorage.getItem('unrelated-draft'))).toBe('keep')
  expect(audit.draftWrites()).toBe(0)
})

test('checkout fails closed when online checkout is disabled', async ({ page }) => {
  await mockBase(page, { onlineCheckout: false, mockPayment: false })
  await page.goto('/app/checkout')
  await expect(page.getByText('当前暂未开放在线结算，请稍后从正式支付入口完成购买。')).toBeVisible()
  await expect(page.locator('.btn-pay')).toBeDisabled()
  await expect(page.getByText('开发模式：模拟支付成功')).toHaveCount(0)
})

test('checkout reuses the address book and has no mobile overflow', async ({ page }) => {
  await mockBase(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/checkout')
  await expect(page.getByText('138****8000')).toBeVisible()
  await page.getByRole('button', { name: '＋ 新增地址' }).click()
  await expect(page.getByRole('dialog', { name: '新增地址' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
})
