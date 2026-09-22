import { expect, test, type Page } from '@playwright/test'

async function mockDeletion(page: Page, staffRole = 'OWNER') {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    user: { nickname: '<img src=x onerror=alert(1)>', phone: '138****0001' },
    status: 'FAILED',
    requestedAt: '2026-09-20T00:00:00.000Z',
    elapsedHours: 12,
    attemptCount: 2,
    lastError: '<script>alert(1)</script>',
    blockers: [],
    pauseReason: null,
    pauseUserMessage: null,
    protectionMinutesLeft: 0,
    canUserCancel: false,
    alertLevel: 'ATTENTION'
  }
  const actions: Array<{ path: string; body: unknown }> = []
  const reads: URL[] = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'test-deletions'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-1', staffRole, role: staffRole === 'OWNER' ? 3 : 2, status: 'ACTIVE' }
      }
    })
  )
  await page.route('**/api/admin/account-deletions**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET') {
      reads.push(url)
      return route.fulfill({
        json: {
          success: true,
          data: {
            items: [task],
            summary: { FAILED: 1, PROTECTION: 0 },
            canManage: staffRole === 'OWNER',
            pagination: { page: 1, limit: 20, total: 1 }
          }
        }
      })
    }
    actions.push({
      path: url.pathname,
      body: route.request().postData() ? route.request().postDataJSON() : null
    })
    if (url.pathname.endsWith('/pause')) task.status = 'PAUSED'
    return route.fulfill({ json: { success: true, message: '操作成功' } })
  })
  return { task, actions, reads }
}

test('owner can filter and pause a deletion task once with validated reasons', async ({
  page
}, info) => {
  const fixture = await mockDeletion(page)
  await page.goto('/app/admin/account-deletions')
  await expect(page.getByText('注销任务管理')).toBeVisible()
  await expect(page.locator('.row:not(.head)')).toHaveCount(1)
  await expect(page.locator('.row img, .row script')).toHaveCount(0)
  await expect(page.getByText('<script>alert(1)</script>')).toBeVisible()
  await page.getByRole('combobox', { name: '任务状态' }).selectOption('FAILED')
  await expect.poll(() => fixture.reads.at(-1)?.searchParams.get('status')).toBe('FAILED')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '暂停注销任务' })
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect(page.getByRole('status')).toContainText('至少5个字')
  await dialog.getByLabel('内部处理原因').fill('核对售后争议材料')
  await dialog.getByLabel('给用户看的说明').fill('正在处理售后争议，请稍候')
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect.poll(() => fixture.actions.length).toBe(1)
  expect(fixture.actions[0]).toEqual({
    path: '/api/admin/account-deletions/task-1/pause',
    body: { reason: '核对售后争议材料', userMessage: '正在处理售后争议，请稍候' }
  })
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '打开后台菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
})

test('service can read masked tasks but cannot operate', async ({ page }) => {
  const fixture = await mockDeletion(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/account-deletions')
  await expect(page.getByText('138****0001')).toBeVisible()
  await expect(page.getByText('只读')).toBeVisible()
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0)
  expect(fixture.actions).toHaveLength(0)
})

test('production staff cannot render deletion tasks or call the API', async ({ page }) => {
  const fixture = await mockDeletion(page, 'PRODUCTION')
  await page.goto('/app/admin/account-deletions')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(fixture.reads).toHaveLength(0)
})

test('failed pause leaves the task and confirmation intact for a safe retry', async ({ page }) => {
  await mockDeletion(page)
  await page.route('**/api/admin/account-deletions/task-1/pause', (route) =>
    route.fulfill({ status: 409, json: { success: false, message: '任务状态刚刚发生变化' } })
  )
  await page.goto('/app/admin/account-deletions')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '暂停注销任务' })
  await dialog.getByLabel('内部处理原因').fill('核对售后争议材料')
  await dialog.getByLabel('给用户看的说明').fill('正在处理售后争议，请稍候')
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect(page.getByRole('status')).toContainText('任务状态刚刚发生变化')
  await expect(dialog).toBeVisible()
  await expect(page.locator('.badge')).toContainText('自动重试')
})
