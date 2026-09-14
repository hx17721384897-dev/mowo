import { expect, test } from '@playwright/test'

test('four application areas and status components render', async ({ page }) => {
  await page.goto('/app/')
  await expect(page.getByRole('heading', { name: '公开应用壳' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(3)

  await page.goto('/app/account')
  await expect(page.getByText('账户区域占位')).toBeVisible()

  await page.goto('/app/admin')
  await expect(page.getByText('管理区域占位')).toBeVisible()

  await page.goto('/app/production')
  await expect(page.getByText('生产区域占位')).toBeVisible()
})

test('unknown Vue path shows the controlled 404 page', async ({ page }) => {
  await page.goto('/app/does-not-exist')
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
})
