import { expect, test, type Page, type Route } from '@playwright/test'

const inventory = {
  skuId: 'sku-1',
  skuName: '5×5cm · 椴木板 · 12帧 · 原色',
  skuCode: 'SKU-TEST-01',
  skuBarcode: 'MOWO-TEST-01',
  modelName: '<img src=x onerror=alert(1)>测试款',
  size: '5×5cm',
  material: '椴木板',
  frameCount: 12,
  colorName: '原色',
  colorHex: '#D4B896',
  currentStock: 20,
  reservedStock: 3,
  wipFrameQty: 2,
  wipKitQty: 0,
  availableQty: 15,
  availableStock: 15,
  safetyStock: 5,
  maxOrderLimit: 10,
  safetyFactor: 1,
  dailySales: 0.5,
  alertLevel: 'OK'
}

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    json: { success: status < 400, data, message: status < 400 ? '成功' : '模拟失败' }
  })
}

async function mockPage(page: Page, role = 'PRODUCTION', failAdjustmentOnce = false) {
  const adjustments: Record<string, unknown>[] = []
  const writes: string[] = []
  let failed = false
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'inventory-test-token'))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/account/me')
      return fulfill(route, {
        id: 'staff-1',
        role: role === 'PRODUCTION' ? 1 : 0,
        staffRole: role,
        status: 'ACTIVE',
        profile: { nickname: '库存测试' }
      })
    if (path === '/api/config/features') return fulfill(route, {})
    if (path === '/api/inventory' && request.method() === 'GET') return fulfill(route, [inventory])
    if (path === '/api/inventory/channel-quotas')
      return fulfill(route, [
        {
          skuId: 'sku-1',
          available: 15,
          bufferPool: 5,
          allocatable: 10,
          taobaoQty: 3,
          douyinQty: 3,
          xhsQty: 2
        }
      ])
    if (path === '/api/inventory/sku-1' && request.method() === 'GET')
      return fulfill(route, {
        ...inventory,
        logs: [
          {
            id: 'log-1',
            type: 'manual_adjustment',
            quantity: 5,
            beforeQty: 10,
            afterQty: 15,
            reason: '<b>测试入库</b>',
            note: null,
            createdAt: '2026-10-08T00:00:00Z'
          }
        ]
      })
    if (path.endsWith('/restock')) {
      const body = request.postDataJSON() as Record<string, unknown>
      adjustments.push(body)
      writes.push(path)
      if (failAdjustmentOnce && !failed) {
        failed = true
        return route.abort('connectionreset')
      }
      return fulfill(route, { ...inventory, currentStock: 25, availableQty: 20, reused: false })
    }
    if (path.endsWith('/settings')) {
      writes.push(path)
      return fulfill(route, inventory)
    }
    return fulfill(route, null, 404)
  })
  return { adjustments, writes }
}

test('candidate renders SKU stock safely and keeps the seven-domain geometry', async ({ page }) => {
  await mockPage(page)
  await page.goto('/app/admin/inventory')
  await expect(page.getByRole('heading', { name: '库存管理' })).toBeVisible()
  await expect(page.locator('.main-tab')).toHaveCount(7)
  await expect(page.locator('.stat-card')).toHaveCount(6)
  await expect(page.getByText('<img src=x onerror=alert(1)>测试款')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await page.getByPlaceholder('搜索款式或规格…').fill('SKU-TEST-01')
  await expect(page.locator('.inv-row')).toHaveCount(1)
})

test('candidate reuses one adjustment key after a lost response and saves settings', async ({
  page
}) => {
  const state = await mockPage(page, 'PRODUCTION', true)
  await page.goto('/app/admin/inventory')
  await page.locator('.inv-row').click()
  await expect(page.getByRole('complementary', { name: '库存详情' })).toBeVisible()
  await page.getByPlaceholder('如 50 或 -5').fill('5')
  await page.getByPlaceholder('备注（调减时建议填写原因）').fill('测试入库')
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('网络连接失败')).toBeVisible()
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('库存调整已保存')).toBeVisible()
  expect(state.adjustments).toHaveLength(2)
  expect(state.adjustments[0].clientRequestId).toBe(state.adjustments[1].clientRequestId)
  await page.getByRole('button', { name: '保存策略' }).click()
  await expect(page.getByText('设置已保存')).toBeVisible()
  expect(state.writes.some((path) => path.endsWith('/settings'))).toBe(true)
})

test('candidate enforces production roles and fits mobile', async ({ page }, info) => {
  const role = info.project.name === 'chromium' ? 'CUSTOMER_SERVICE' : 'PRODUCTION'
  await mockPage(page, role)
  await page.goto('/app/admin/inventory')
  if (role === 'CUSTOMER_SERVICE') {
    await expect(page).toHaveURL(/\/app\/forbidden$/)
    return
  }
  await expect(page.getByRole('heading', { name: '库存管理' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
  await page.getByRole('button', { name: '☰' }).click()
  await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
})
