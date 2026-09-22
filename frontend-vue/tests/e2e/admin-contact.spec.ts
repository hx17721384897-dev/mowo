import { expect, test, type Page } from '@playwright/test'

function item() {
  return {
    id: 'contact-1',
    type: 'artist',
    name: '<img src=x onerror=alert(1)>测试画师',
    contact: 'artist@example.com',
    message: '合作详情 <script>alert(1)</script>',
    status: 'pending',
    isStarred: false,
    createdAt: '2026-09-20T10:00:00.000Z',
    note: '',
    extra: { platform: '微博', fanbase: '1 万', portfolioUrl: 'javascript:alert(1)' },
    attachments: [],
    attachmentUrls: [{ url: 'https://example.com/portfolio.pdf', filename: '作品集.pdf' }],
    submitterUserId: null,
    ip: '127.0.0.1',
    isBlocked: false,
    handledAt: null
  }
}

async function mockContact(page: Page, staffRole = 'CUSTOMER_SERVICE') {
  const record = item()
  const queries: URL[] = []
  const mutations: string[] = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'admin-contact-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-1', staffRole, role: 2, status: 'ACTIVE', profile: { nickname: '客服' } }
      }
    })
  )
  await page.route('**/api/admin/contact**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    if (path === '/api/admin/contact/stats')
      return route.fulfill({
        json: {
          success: true,
          data: {
            pendingTotal: 1,
            starredTotal: record.isStarred ? 1 : 0,
            byStatus: {
              pending: record.status === 'pending' ? 1 : 0,
              processing: record.status === 'processing' ? 1 : 0,
              done: 0,
              spam: 0
            },
            byType: { artist: 1, channel: 0, media: 0, join: 0, feedback: 0, factory: 0 }
          }
        }
      })
    if (path === '/api/admin/contact' && method === 'GET') {
      queries.push(url)
      return route.fulfill({
        json: {
          success: true,
          data: { items: [record], pagination: { page: 1, limit: 20, total: 1 } }
        }
      })
    }
    if (path === '/api/admin/contact/contact-1' && method === 'GET') {
      return route.fulfill({ json: { success: true, data: record } })
    }
    if (method === 'PUT') {
      mutations.push(path)
      const body = route.request().postDataJSON()
      if (path.endsWith('/status')) record.status = body.status
      if (path.endsWith('/star')) record.isStarred = body.isStarred
      if (path.endsWith('/note')) record.note = body.note
      return route.fulfill({ json: { success: true, data: record } })
    }
    throw new Error(`Unexpected contact request: ${method} ${path}`)
  })
  return { record, queries, mutations }
}

test('contact candidate keeps filters, list, private detail and safe links', async ({
  page
}, info) => {
  const fixture = await mockContact(page)
  await page.goto('/app/admin/contact')
  await expect(page.getByText('💌 联络留言')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('artist@example.com')
  await expect(page.locator('tbody img')).toHaveCount(0)
  await page.getByRole('button', { name: /画师联名/ }).click()
  await expect.poll(() => fixture.queries.at(-1)?.searchParams.get('type')).toBe('artist')
  await page.getByRole('searchbox', { name: '搜索留言' }).fill('合作')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect.poll(() => fixture.queries.at(-1)?.searchParams.get('keyword')).toBe('合作')
  await page.getByRole('button', { name: '查看' }).click()
  const dialog = page.getByRole('dialog', { name: '联络留言详情' })
  await expect(dialog.getByText('artist@example.com')).toBeVisible()
  await expect(dialog.getByText('合作详情 <script>alert(1)</script>')).toBeVisible()
  await expect(dialog.locator('script')).toHaveCount(0)
  await expect(dialog.getByText('javascript:alert(1)')).toBeVisible()
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: '作品集.pdf' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  )
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '关闭详情' }).click()
    await page.getByRole('button', { name: '打开后台菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
})

test('contact status, star and note are refreshed from server before UI confirms', async ({
  page
}) => {
  const fixture = await mockContact(page)
  await page.goto('/app/admin/contact')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.locator('tbody select').selectOption('processing')
  await expect.poll(() => fixture.record.status).toBe('processing')
  await expect(page.locator('tbody select')).toHaveValue('processing')
  await page.getByRole('button', { name: '加星标' }).click()
  await expect.poll(() => fixture.record.isStarred).toBe(true)
  await page.getByRole('button', { name: '查看' }).click()
  const dialog = page.getByRole('dialog', { name: '联络留言详情' })
  await dialog.getByPlaceholder('添加处理备注…').fill('已联系')
  await dialog.getByRole('button', { name: '保存备注' }).click()
  await expect.poll(() => fixture.record.note).toBe('已联系')
  await expect(dialog.getByPlaceholder('添加处理备注…')).toHaveValue('已联系')
  expect(fixture.mutations).toEqual([
    '/api/admin/contact/contact-1/status',
    '/api/admin/contact/contact-1/star',
    '/api/admin/contact/contact-1/note'
  ])
})

test('filter chips and reset preserve the original contact query behavior', async ({ page }) => {
  const fixture = await mockContact(page)
  await page.goto('/app/admin/contact')
  await page
    .getByRole('button', { name: /待处理/ })
    .first()
    .click()
  await expect.poll(() => fixture.queries.at(-1)?.searchParams.get('status')).toBe('pending')
  await page.getByRole('button', { name: /星标/ }).first().click()
  await expect.poll(() => fixture.queries.at(-1)?.searchParams.get('starred')).toBe('1')
  await page.getByRole('button', { name: '清除待处理' }).click()
  await expect.poll(() => fixture.queries.at(-1)?.searchParams.get('status')).toBe('')
  await page.getByRole('button', { name: '重置' }).click()
  await expect.poll(() => fixture.queries.at(-1)?.searchParams.has('starred')).toBe(false)
  await expect(page.getByRole('button', { name: '清除⭐ 星标' })).toHaveCount(0)
})

test('failed status change returns to server state and shows feedback', async ({ page }) => {
  await mockContact(page)
  await page.route('**/api/admin/contact/contact-1/status', (route) =>
    route.fulfill({
      status: 403,
      json: { success: false, message: '权限不足' }
    })
  )
  await page.goto('/app/admin/contact')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.locator('tbody select').selectOption('processing')
  await expect(page.getByRole('status')).toContainText('权限不足')
  await expect(page.locator('tbody select')).toHaveValue('pending')
})

test('production staff cannot render contact page or call its API', async ({ page }) => {
  const fixture = await mockContact(page, 'PRODUCTION')
  await page.goto('/app/admin/contact')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(fixture.queries).toHaveLength(0)
})
