import { expect, test, type Page } from '@playwright/test'

async function mockUsers(page: Page, staffRole = 'OWNER') {
  const users = [
    {
      id: 'owner-1',
      phone: '177****4897',
      role: 3,
      staffRole: 'OWNER',
      isBanned: false,
      status: 'ACTIVE',
      createdAt: '2026-09-01T00:00:00.000Z',
      profile: { nickname: '负责人', avatarUrl: null }
    },
    {
      id: 'user-1',
      phone: '138****0001',
      role: 0,
      staffRole: null,
      isBanned: false,
      status: 'ACTIVE',
      createdAt: '2026-09-02T00:00:00.000Z',
      profile: { nickname: '<img src=x onerror=alert(1)>', avatarUrl: 'javascript:alert(1)' }
    }
  ]
  const mutations: Array<{ path: string; body: unknown }> = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'test-admin-users'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 'owner-1',
          staffRole,
          role: staffRole === 'OWNER' ? 3 : 2,
          status: 'ACTIVE',
          profile: { nickname: '员工' }
        }
      }
    })
  )
  await page.route('**/api/admin/users**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          success: true,
          data: {
            users: staffRole === 'OWNER' ? users : users.slice(1),
            pagination: { page: 1, limit: 20, total: staffRole === 'OWNER' ? 2 : 1 }
          }
        }
      })
    mutations.push({ path: url.pathname, body: route.request().postDataJSON() })
    if (url.pathname.endsWith('/ban')) users[1].isBanned = true
    if (url.pathname.endsWith('/role')) users[1].staffRole = 'PRODUCTION'
    return route.fulfill({ json: { success: true, message: '操作成功' } })
  })
  return { users, mutations }
}

test('users candidate preserves list, local search, role and ban confirmations', async ({
  page
}, info) => {
  const fixture = await mockUsers(page)
  await page.goto('/app/admin/users')
  await expect(page.getByText('用户管理', { exact: true })).toBeVisible()
  await expect(page.locator('.user-row')).toHaveCount(2)
  await expect(page.locator('.user-row img')).toHaveCount(0)
  await expect(page.locator('.user-row script')).toHaveCount(0)
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索手机号或昵称' }).fill('138')
  await expect(page.locator('.user-row')).toHaveCount(1)
  await page.getByRole('searchbox', { name: '搜索手机号或昵称' }).clear()
  await page.getByRole('button', { name: '设岗位' }).click()
  await page.getByLabel('岗位模板').selectOption('PRODUCTION')
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect.poll(() => fixture.mutations.length).toBe(1)
  expect(fixture.mutations[0]).toEqual({
    path: '/api/admin/users/user-1/role',
    body: { staffRole: 'PRODUCTION' }
  })
  await page.getByRole('button', { name: '封禁' }).click()
  await expect(page.getByRole('dialog', { name: '确认封禁用户' })).toContainText(
    '封禁后该用户将无法登录'
  )
  await page.getByRole('button', { name: '确认封禁' }).click()
  await expect.poll(() => fixture.mutations.length).toBe(2)
  expect(fixture.mutations[1]).toEqual({
    path: '/api/admin/users/user-1/ban',
    body: { isBanned: true }
  })
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '打开后台菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
})

test('customer service cannot mutate roles and staff accounts', async ({ page }) => {
  const fixture = await mockUsers(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/users')
  await expect(page.locator('.user-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '设岗位' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '封禁' })).toHaveCount(1)
  expect(fixture.mutations).toHaveLength(0)
})

test('production staff cannot render users candidate or call its API', async ({ page }) => {
  const fixture = await mockUsers(page, 'PRODUCTION')
  await page.goto('/app/admin/users')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(fixture.mutations).toHaveLength(0)
})

test('failed ban does not claim success or change the visible user state', async ({ page }) => {
  await mockUsers(page)
  await page.route('**/api/admin/users/user-1/ban', (route) =>
    route.fulfill({ status: 403, json: { success: false, message: '权限不足' } })
  )
  await page.goto('/app/admin/users')
  await page.getByRole('button', { name: '封禁', exact: true }).click()
  await page.getByRole('button', { name: '确认封禁' }).click()
  await expect(page.getByRole('status')).toContainText('权限不足')
  await expect(page.getByRole('dialog', { name: '确认封禁用户' })).toBeVisible()
  await expect(page.locator('.banned-tag')).toHaveCount(0)
})
