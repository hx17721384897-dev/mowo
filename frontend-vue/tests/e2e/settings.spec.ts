import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'settings-token'))
  await page.route('**/api/v1/account/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'user-settings',
          maskedPhone: '138****0000',
          role: 0,
          staffRole: null,
          status: 'ACTIVE',
          deletionRequest: null,
          createdAt: '2026-09-17T00:00:00.000Z',
          profile: {
            nickname: '测试用户',
            avatarUrl: null,
            bio: '保留旧版资料展示',
            gender: 0,
            birthday: '2000-01-01T00:00:00.000Z',
            nicknameUpdatedAt: null,
            notifyOrder: true,
            notifySystem: true
          }
        }
      })
    })
  })
  await page.route('**/api/v1/account/password-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { hasPassword: false, passwordLoginEnabled: false }
      })
    })
  })
  await page.route('**/api/addresses', async (route) => {
    await route.fulfill({
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
  })
})

test('settings keeps the legacy sections and shared address editor', async ({ page }) => {
  await page.goto('/app/account/settings#addresses')
  await expect(page.getByRole('heading', { name: '账号设置' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '收货地址' })).toBeVisible()
  await expect(page.getByText('138****8000')).toBeVisible()

  await page.getByRole('button', { name: '＋ 新增地址' }).click()
  const dialog = page.getByRole('dialog', { name: '新增地址' })
  await expect(dialog).toBeVisible()
  await dialog
    .getByPlaceholder('粘贴如：张三 13800138000 广东省深圳市南山区科技园南路88号B座501')
    .fill('李四 13900139000 广东省深圳市福田区深南大道100号')
  await dialog.getByRole('button', { name: '一键识别' }).click()
  await expect(dialog.getByPlaceholder('姓名')).toHaveValue('李四')
  await expect(dialog.getByPlaceholder('11位手机号')).toHaveValue('13900139000')
  await expect(dialog.getByText('识别完成，请核对信息')).toBeVisible()
})
