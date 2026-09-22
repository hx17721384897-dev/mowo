import { expect, test, type Page } from '@playwright/test'

async function mockLogs(page: Page, staffRole = 'OWNER') {
  const reads: URL[] = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'test-logs'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'owner-1', staffRole, role: staffRole === 'OWNER' ? 3 : 2, status: 'ACTIVE' }
      }
    })
  )
  await page.route('**/api/admin/logs**', (route) => {
    reads.push(new URL(route.request().url()))
    return route.fulfill({
      json: {
        success: true,
        data: {
          logs: [
            {
              id: 'log-1',
              userId: 'owner-1',
              userRole: 3,
              method: 'PUT',
              path: '/api/admin/users/user-1/role',
              action: '<img src=x onerror=alert(1)>',
              outcome: 'SUCCESS',
              statusCode: 200,
              targetId: 'user-1',
              before: '{"role":"USER"}',
              after: '<script>alert(1)</script>',
              ip: '127.0.0.1',
              createdAt: '2026-09-20T00:00:00.000Z',
              actor: { name: '负责人', maskedPhone: '177****4897', staffRole: 'OWNER' }
            }
          ],
          pagination: { page: 1, limit: 50, total: 1 }
        }
      }
    })
  })
  return reads
}

test('owner log list retains filters, local search and safe expandable detail', async ({
  page
}, info) => {
  const reads = await mockLogs(page)
  await page.goto('/app/admin/logs')
  await expect(page.locator('.topbar-title')).toHaveText('审计日志')
  await expect(page.locator('.log-item')).toHaveCount(1)
  await expect(page.locator('.log-item img, .log-item script')).toHaveCount(0)
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  await page.getByRole('combobox', { name: '操作类型' }).selectOption('PUT')
  await expect.poll(() => reads.at(-1)?.searchParams.get('method')).toBe('PUT')
  await page.getByRole('combobox', { name: '操作结果' }).selectOption('SUCCESS')
  await expect.poll(() => reads.at(-1)?.searchParams.get('outcome')).toBe('SUCCESS')
  await page.getByRole('searchbox', { name: '搜索操作内容' }).fill('not-present')
  await expect(page.getByText('暂无日志记录')).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索操作内容' }).clear()
  await page.getByRole('button', { name: '展开详情' }).click()
  await expect(page.getByText('修改后：<script>alert(1)</script>')).toBeVisible()
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '打开后台菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
})

test('service staff cannot render security logs or call its API', async ({ page }) => {
  const reads = await mockLogs(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/logs')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(reads).toHaveLength(0)
})
