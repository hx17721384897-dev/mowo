import { expect, test, type Page } from '@playwright/test'

async function mockAccount(page: Page, staffRole: string | null, role: number): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'staff-test-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-test', role, staffRole, status: 'ACTIVE', profile: { nickname: '员工' } }
      }
    })
  )
}

for (const staffRole of ['OWNER', 'CUSTOMER_SERVICE', 'PRODUCTION', 'COLLAB_OPS']) {
  test(`${staffRole} can enter the V4 shell`, async ({ page }) => {
    await mockAccount(page, staffRole, 2)
    await page.goto('/app/admin')
    await expect(page.getByText('管理区域占位')).toBeVisible()
  })
}

test('ordinary user cannot render the admin shell', async ({ page }) => {
  await mockAccount(page, null, 0)
  await page.goto('/app/admin')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  await expect(page.getByText('管理区域占位')).toHaveCount(0)
})

test('legacy numeric role alone does not grant Vue admin access', async ({ page }) => {
  await mockAccount(page, null, 3)
  await page.goto('/app/admin')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  await expect(page.getByText('管理区域占位')).toHaveCount(0)
})
