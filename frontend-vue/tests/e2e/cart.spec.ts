import { expect, test, type Page } from '@playwright/test'

const cartData = {
  cartId: 'cart-1',
  items: [
    {
      id: 'custom-item',
      cartId: 'cart-1',
      itemType: 'CUSTOM',
      contentId: 'custom-1',
      hardwareSkuId: 'sku-1',
      hardwareSkuCode: 'SKU-1',
      snapshotTitle: '定制款',
      snapshotPreviewUrl: null,
      coverUrl: null,
      configSnapshotJson:
        '{"modelName":"标准款","size":"5×5cm","skuFrameCount":12,"material":"椴木板","colorName":"原木色"}',
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
      id: 'market-item',
      cartId: 'cart-1',
      itemType: 'MARKET',
      contentId: 'work-1',
      hardwareSkuId: 'sku-2',
      hardwareSkuCode: 'SKU-2',
      snapshotTitle: '<img src=x onerror=alert(1)>联名作品',
      snapshotPreviewUrl: null,
      coverUrl: null,
      configSnapshotJson: null,
      snapshotPrice: '99.00',
      currentPrice: 109,
      quantity: 2,
      selected: true,
      creatorId: 'creator-1',
      status: 'price_changed',
      customProductId: null,
      sessionGroupId: null
    }
  ],
  creatorProfiles: {
    'creator-1': { userId: 'creator-1', nickname: '联名创作者', avatarUrl: null }
  },
  totalSelected: 3,
  totalPrice: '347.00'
}

async function mockCart(page: Page): Promise<{ draftWrites: () => number }> {
  let draftWriteCount = 0
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'cart-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'user-1', role: 0, status: 'ACTIVE', profile: { nickname: '购物车用户' } }
      })
    })
  )
  await page.route('**/api/cart', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: cartData })
    })
  )
  await page.route('**/api/cart/item/*/update', async (route) => {
    const id = route.request().url().split('/').at(-2)
    const body = route.request().postDataJSON() as { quantity?: number; selected?: boolean }
    const item = cartData.items.find((row) => row.id === id)
    if (item) {
      if (body.quantity != null) item.quantity = body.quantity
      if (body.selected != null) item.selected = body.selected
      cartData.totalSelected = cartData.items
        .filter((row) => row.selected && row.status !== 'stock_out' && row.status !== 'invalid')
        .reduce((sum, row) => sum + row.quantity, 0)
      cartData.totalPrice = cartData.items
        .filter((row) => row.selected && row.status !== 'stock_out' && row.status !== 'invalid')
        .reduce((sum, row) => sum + Number(row.currentPrice) * row.quantity, 0)
        .toFixed(2)
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
  })
  await page.route('**/api/cart/price-changes/confirm-all', async (route) => {
    cartData.items[1]!.status = 'normal'
    cartData.items[1]!.snapshotPrice = String(cartData.items[1]!.currentPrice)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
  })
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      (/customization-requests/.test(request.url()) || /custom-products/.test(request.url()))
    ) {
      draftWriteCount += 1
    }
  })
  return { draftWrites: () => draftWriteCount }
}

test('mixed cart keeps the legacy structure and uses the typed transaction boundary', async ({
  page
}) => {
  const audit = await mockCart(page)
  await page.goto('/app/cart')

  await expect(page.getByRole('heading', { name: '购物车 🛒' })).toBeVisible()
  await expect(page.locator('.cart-group')).toHaveCount(2)
  await expect(page.getByText('我的定制 · 标准款')).toBeVisible()
  await expect(page.getByText('联名创作者')).toBeVisible()
  await expect(
    page.locator('.child-title').getByText('<img src=x onerror=alert(1)>联名作品', { exact: true })
  ).toBeVisible()
  await expect(page.locator('.child-title img')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '去结算' })).toBeDisabled()

  await page.getByRole('button', { name: '确认最新价格' }).click()
  await expect(page.getByRole('button', { name: '去结算' })).toBeEnabled()
  await page.locator('.child-item').first().getByRole('button', { name: '+' }).click()
  await expect(page.locator('.child-item').first().locator('.qty-n')).toHaveText('2')

  await page.getByRole('button', { name: '去结算' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('确认前往结算')).toBeVisible()
  expect(audit.draftWrites()).toBe(0)
})

test('cart candidate has no horizontal overflow on mobile', async ({ page }) => {
  await mockCart(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/cart')
  await expect(page.locator('.cart-group')).toHaveCount(2)
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowing: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(
        (element) =>
          !element.closest('.mowo-mobile-menu') &&
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1
      )
      .slice(0, 8)
      .map((element) => ({
        className: element.className,
        right: element.getBoundingClientRect().right
      }))
  }))
  expect(layout).toEqual({ scrollWidth: 390, clientWidth: 390, overflowing: [] })
})
