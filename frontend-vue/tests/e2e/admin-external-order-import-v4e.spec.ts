import { expect, test, type Page } from '@playwright/test'

async function mockAccount(page: Page, staffRole: string): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'staff-test-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 'staff-test',
          role: 2,
          staffRole,
          status: 'ACTIVE',
          profile: { nickname: '员工' }
        }
      }
    })
  )
}

test('retained import entry makes the deferred boundary explicit without order writes', async ({
  page
}) => {
  await mockAccount(page, 'PRODUCTION')
  const importRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/admin\/(?:import|sku-mapping)/.test(request.url())) {
      importRequests.push(`${request.method()} ${request.url()}`)
    }
  })

  await page.goto('/app/admin/import')
  await expect(page.getByRole('heading', { name: '等待真实平台样表后再接入' })).toBeVisible()
  await expect(page.getByText('入口保留 · 写入关闭')).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /导入|上传|提交/ })).toHaveCount(0)
  expect(importRequests).toEqual([])
})

test('external import entry remains limited to owner and production staff', async ({ page }) => {
  await mockAccount(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/import')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  await expect(page.getByRole('heading', { name: '等待真实平台样表后再接入' })).toHaveCount(0)
})

test('retired legacy import URL hands off to the retained Vue entry', async ({ page }) => {
  await mockAccount(page, 'OWNER')
  await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-import.html?source=legacy')
  await expect(page).toHaveURL(/\/app\/admin\/import\?source=legacy$/)
  await expect(page.getByRole('heading', { name: '等待真实平台样表后再接入' })).toBeVisible()
})
