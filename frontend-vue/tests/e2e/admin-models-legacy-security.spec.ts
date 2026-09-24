import { expect, test } from '@playwright/test'

test('legacy catalog does not execute model or SKU text as code', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'catalog-legacy-test'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: { success: true, data: { id: 'staff-1', staffRole: 'OWNER', status: 'ACTIVE' } }
    })
  )
  await page.route('**/api/machine-models/admin/all', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            id: 'model-1',
            name: `');window.__catalogXss=1;//`,
            description: '测试款式',
            previewImage: 'x" onerror="window.__catalogXss=1',
            isActive: true,
            modelType: 'single',
            sortOrder: 0
          }
        ]
      }
    })
  )
  await page.route('**/api/machine-models/admin/model-1/skus', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            id: 'sku-1',
            modelId: 'model-1',
            size: `');window.__catalogXss=1;//`,
            material: '木质',
            frameCount: 12,
            colorName: '原色',
            colorHex: '#D4B896',
            price: 199,
            previewImage: null,
            isActive: true,
            sortOrder: 0
          }
        ]
      }
    })
  )
  await page.route('**/api/inventory', (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  )
  await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-models.html')
  await expect(page.locator('.model-card')).toHaveCount(1)
  await expect(page.locator('.model-preview img')).toHaveCount(0)
  await page.locator('.model-card-header').click()
  await page
    .locator('.model-card-header')
    .getByRole('button', { name: '删除' })
    .evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.locator('#deleteModelModal')).toHaveClass(/show/)
  await page
    .locator('#deleteModelModal')
    .getByRole('button', { name: '取消' })
    .evaluate((button: HTMLButtonElement) => button.click())
  await page
    .locator('.sku-row')
    .getByRole('button', { name: '删除' })
    .evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.locator('#deleteSkuModal')).toHaveClass(/show/)
  expect(
    await page.evaluate(() => (window as Window & { __catalogXss?: number }).__catalogXss)
  ).toBeUndefined()
})
