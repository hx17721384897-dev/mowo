import { expect, test, type Page } from '@playwright/test'

async function mockReview(page: Page, staffRole = 'OWNER') {
  const works = [
    {
      id: 'work-1',
      title: '<img src=x onerror=alert(1)>',
      status: 'pending',
      createdAt: '2026-09-01T00:00:00Z',
      orderNo: 'A001',
      coverUrl: 'javascript:alert(1)',
      creator: { nickname: '创作者' }
    },
    {
      id: 'work-2',
      title: '已通过作品',
      status: 'approved',
      createdAt: '2026-09-02T00:00:00Z',
      isOnShelf: true,
      hoverGifUrl: null,
      creator: { nickname: '合作方' }
    },
    {
      id: 'work-3',
      title: '已拒绝作品',
      status: 'rejected',
      createdAt: '2026-09-03T00:00:00Z',
      rejectReason: '不符合要求',
      creator: { nickname: '合作方' }
    }
  ]
  const mutations: Array<{ path: string; body: unknown }> = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'test-admin-collab'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-1', staffRole, status: 'ACTIVE', profile: { nickname: '员工' } }
      }
    })
  )
  await page.route('**/api/admin/collab/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/admin/collab/works') {
      const status = url.searchParams.get('status')
      const filtered = status ? works.filter((work) => work.status === status) : works
      return route.fulfill({
        json: {
          success: true,
          data: {
            works: filtered,
            total: filtered.length,
            page: Number(url.searchParams.get('page') ?? 1),
            limit: Number(url.searchParams.get('limit') ?? 15)
          }
        }
      })
    }
    if (path.startsWith('/api/admin/collab/works/')) {
      const work = works.find((item) => item.id === path.split('/').pop())
      return route.fulfill({
        json: {
          success: true,
          data: {
            ...work,
            animationFrames: ['javascript:alert(2)', 'data:image/png;base64,aGVsbG8=']
          }
        }
      })
    }
    mutations.push({ path, body: route.request().postDataJSON() })
    if (path.endsWith('/approve')) {
      const work = works.find((item) => item.id === path.split('/')[4])!
      const body = route.request().postDataJSON()
      work.status = body.action === 'approve' ? 'approved' : 'rejected'
    }
    return route.fulfill({ json: { success: true, data: {} } })
  })
  return { works, mutations }
}

test('review candidate filters, renders detail safely, and submits approval only once', async ({
  page
}) => {
  const fixture = await mockReview(page)
  await page.goto('/app/admin/collab-review')
  await expect(page.locator('.review-work-row')).toHaveCount(1)
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  await expect(page.locator('.review-cover img')).toHaveCount(0)
  await page.locator('.review-work-row').click()
  await expect(page.locator('.review-drawer')).toContainText('帧图预览（共 2 帧）')
  await expect(page.locator('.review-frame img')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭详情' }).click()
  await page.locator('.review-work-row').getByRole('button', { name: '通过' }).click()
  await expect(page.locator('.review-modal')).toBeVisible()
  await page.getByRole('button', { name: '确认通过' }).dblclick()
  await expect.poll(() => fixture.mutations.length).toBe(1)
  expect(fixture.mutations[0]).toEqual({
    path: '/api/admin/collab/work-1/approve',
    body: { action: 'approve' }
  })
  await expect(page.locator('.review-work-row')).toHaveCount(0)
  await page.getByRole('button', { name: '全部', exact: true }).last().click()
  await expect(page.locator('.review-work-row')).toHaveCount(3)
  await expect(page.locator('.review-work-row img[onerror]')).toHaveCount(0)
})

test('reject requires reason; approved work retains GIF and shelf actions', async ({ page }) => {
  const fixture = await mockReview(page)
  await page.goto('/app/admin/collab-review')
  await page.locator('.review-work-row').getByRole('button', { name: '拒绝' }).click()
  await expect(page.locator('.review-textarea')).toBeVisible()
  await page.getByRole('button', { name: '确认拒绝并提交' }).click()
  await expect(page.getByRole('status')).toContainText('请填写拒绝原因')
  expect(fixture.mutations).toHaveLength(0)
  await page.locator('.review-textarea').fill('画面不符合要求')
  await page.getByRole('button', { name: '确认拒绝并提交' }).click()
  await expect.poll(() => fixture.mutations.length).toBe(1)
  expect(fixture.mutations[0]?.body).toEqual({ action: 'reject', rejectReason: '画面不符合要求' })
  await page.locator('.review-tab').filter({ hasText: '已通过' }).click()
  await page.locator('.review-work-row').click()
  await expect(page.getByRole('button', { name: '重新生成GIF' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下架' })).toBeVisible()
})

test('other staff cannot enter review candidate or call its API', async ({ page }) => {
  const fixture = await mockReview(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/collab-review')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(fixture.mutations).toHaveLength(0)
})

test('failed approval keeps modal open and reports server error', async ({ page }) => {
  await mockReview(page)
  await page.route('**/api/admin/collab/work-1/approve', (route) =>
    route.fulfill({ status: 403, json: { success: false, message: '权限不足' } })
  )
  await page.goto('/app/admin/collab-review')
  await page.locator('.review-work-row').getByRole('button', { name: '通过' }).click()
  await page.getByRole('button', { name: '确认通过' }).click()
  await expect(page.getByRole('status')).toContainText('权限不足')
  await expect(page.locator('.review-modal')).toBeVisible()
})

test('legacy review page does not execute injected cover, frame or creator markup', async ({
  page
}) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'test-legacy-collab'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: { success: true, data: { id: 'staff-1', staffRole: 'OWNER', status: 'ACTIVE' } }
    })
  )
  await page.route('**/api/admin/collab/works?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          works: [
            {
              id: 'work-1',
              title: '作品',
              status: 'pending',
              createdAt: '2026-09-01T00:00:00Z',
              coverUrl: 'x" onerror="window.__legacyXss=1',
              creator: { nickname: '<img src=x onerror=window.__legacyXss=1>' }
            }
          ],
          total: 1,
          page: 1,
          limit: 15
        }
      }
    })
  )
  await page.route('**/api/admin/collab/works/work-1', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 'work-1',
          title: '作品',
          status: 'pending',
          createdAt: '2026-09-01T00:00:00Z',
          animationFrames: ['x" onerror="window.__legacyXss=1'],
          creator: { nickname: '合作方' }
        }
      }
    })
  )
  await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-collab.html')
  await expect(page.locator('.work-row')).toHaveCount(1)
  await expect(page.locator('.creator-avatar')).toContainText('<')
  await expect(page.locator('.work-cover img')).toHaveCount(0)
  await page.locator('.work-row').click()
  await expect(page.locator('.frame-thumb')).toHaveCount(1)
  await expect(page.locator('.frame-thumb img')).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as Window & { __legacyXss?: number }).__legacyXss)
  ).toBeUndefined()
})

test('review candidate keeps legacy content geometry', async ({ page }) => {
  await mockReview(page)
  await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-collab.html')
  await expect(page.locator('.work-row')).toHaveCount(1)
  const legacy = await Promise.all(
    ['.topbar', '.stats-grid', '.filter-tabs', '.table-wrap'].map((selector) =>
      page.locator(selector).boundingBox()
    )
  )
  await page.goto('/app/admin/collab-review')
  await expect(page.locator('.review-work-row')).toHaveCount(1)
  const candidate = await Promise.all(
    ['.review-topbar', '.review-stats', '.review-tabs', '.review-table'].map((selector) =>
      page.locator(selector).boundingBox()
    )
  )
  for (let index = 0; index < legacy.length; index++) {
    expect(legacy[index], `missing legacy geometry ${index}`).not.toBeNull()
    expect(candidate[index], `missing candidate geometry ${index}`).not.toBeNull()
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(legacy[index]![key] - candidate[index]![key]),
        `section ${index} ${key}`
      ).toBeLessThanOrEqual(4)
    }
  }
})
