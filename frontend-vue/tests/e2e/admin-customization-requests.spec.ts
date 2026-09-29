import { expect, test, type Page } from '@playwright/test'

function fixture() {
  const item = {
    id: 'request-1',
    requestNo: 'CUS-20260929-001',
    mode: 'HUMAN',
    status: 'SUBMITTED',
    version: 2,
    submittedAt: '2026-09-29T08:00:00.000Z',
    modelName: '翻页动画机',
    assignedStaffName: null,
    canEdit: true,
    user: { nickname: '<img src=x onerror=alert(1)>用户', phoneTail: '8899' }
  }
  return {
    item,
    detail: {
      ...item,
      userNote: '请保留人物动作 <script>alert(1)</script>',
      creatorDeclared: true,
      screeningData: { sourceCount: 1, totalBytes: 2048, ratioOk: false },
      sourceFiles: [
        {
          key: 'source-1',
          filename: '原始素材.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          url: 'javascript:alert(1)',
          expiresIn: 300
        }
      ],
      selectedFrames: [],
      events: [
        {
          id: 'event-1',
          eventType: 'SUBMITTED',
          toStatus: 'SUBMITTED',
          publicMessage: '申请已提交',
          createdAt: '2026-09-29T08:00:00.000Z'
        }
      ],
      model: { id: 'model-1', name: '翻页动画机' }
    }
  }
}

async function mockWorkbench(page: Page, staffRole = 'PRODUCTION') {
  const data = fixture()
  const queries: URL[] = []
  const mutations: Array<{ path: string; method: string }> = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'customization-admin-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 'staff-1',
          staffRole,
          role: staffRole === 'OWNER' ? 3 : 2,
          status: 'ACTIVE',
          profile: { nickname: '处理人员' }
        }
      }
    })
  )
  await page.route('**/api/admin/customization-requests**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    if (path === '/api/admin/customization-requests/stats') {
      return route.fulfill({
        json: {
          success: true,
          data: {
            SUBMITTED: 1,
            REVIEWING: 2,
            NEEDS_SUPPLEMENT: 1,
            OPTIONS_READY: 1,
            FRAME_ACCEPTED: 1,
            STYLE_SELECTED: 1,
            UNAVAILABLE: 1,
            CONFIRMED: 2,
            CLOSED: 1
          }
        }
      })
    }
    if (path === '/api/admin/customization-requests' && method === 'GET') {
      queries.push(url)
      return route.fulfill({
        json: { success: true, data: { items: [data.item], total: 1, page: 1, hasMore: false } }
      })
    }
    if (path === '/api/admin/customization-requests/request-1' && method === 'GET') {
      return route.fulfill({ json: { success: true, data: data.detail } })
    }
    if (path === '/api/admin/customization-requests/request-1/claim' && method === 'POST') {
      mutations.push({ path, method })
      return route.fulfill({ json: { success: true, data: data.item } })
    }
    if (path === '/api/admin/customization-requests/claim-next' && method === 'POST') {
      mutations.push({ path, method })
      return route.fulfill({ json: { success: true, data: { id: 'request-1' } } })
    }
    throw new Error(`Unexpected customization request: ${method} ${path}`)
  })
  return { ...data, queries, mutations }
}

test('customization workbench preserves filters, safe detail and responsive shell', async ({
  page
}, info) => {
  const data = await mockWorkbench(page)
  await page.goto('/app/admin/customization-requests')
  await expect(page.getByText('CUS-20260929-001')).toBeVisible()
  await expect(page.getByText('<img src=x onerror=alert(1)>用户')).toBeVisible()
  await expect(page.locator('.metrics')).toContainText('4等待用户')
  await page.getByLabel('按状态筛选').selectOption('SUBMITTED')
  await expect.poll(() => data.queries.at(-1)?.searchParams.get('status')).toBe('SUBMITTED')
  await page.getByLabel('按处理方式筛选').selectOption('HUMAN')
  await expect.poll(() => data.queries.at(-1)?.searchParams.get('mode')).toBe('HUMAN')
  await page.getByLabel('搜索定制申请').fill('CUS-2026')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect.poll(() => data.queries.at(-1)?.searchParams.get('keyword')).toBe('CUS-2026')

  await page.getByRole('button', { name: '查看', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '定制申请详情' })
  await expect(dialog.getByText('请保留人物动作 <script>alert(1)</script>')).toBeVisible()
  await expect(dialog.locator('script')).toHaveCount(0)
  await expect(dialog.locator('img')).toHaveCount(0)
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(dialog.getByText('素材地址不可用')).toBeVisible()
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '关闭详情' }).click()
    await page.getByRole('button', { name: '打开后台菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
})

test('customer service can inspect but cannot claim frame tasks', async ({ page }) => {
  const data = await mockWorkbench(page, 'CUSTOMER_SERVICE')
  data.item.canEdit = false
  data.detail.canEdit = false
  await page.goto('/app/admin/customization-requests')
  await expect(page.getByRole('button', { name: '查看', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始筛帧' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '领取下一条人工筛帧' })).toHaveCount(0)
  expect(data.mutations).toHaveLength(0)
})

test('production claims once and hands the task to the retained editor without drafts', async ({
  page
}) => {
  const data = await mockWorkbench(page)
  await page.goto('/app/admin/customization-requests')
  await page.getByRole('button', { name: '开始筛帧' }).dblclick()
  await page.waitForURL(/customize-editor\.html\?adminRequestId=request-1&claimed=1/)
  expect(data.mutations).toEqual([
    { path: '/api/admin/customization-requests/request-1/claim', method: 'POST' }
  ])
})

test('collaboration staff cannot render the customization workbench', async ({ page }) => {
  const data = await mockWorkbench(page, 'COLLAB_OPS')
  await page.goto('/app/admin/customization-requests')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(data.queries).toHaveLength(0)
  expect(data.mutations).toHaveLength(0)
})

test('retired legacy workbench URL hands off to the single Vue implementation', async ({
  page
}) => {
  await mockWorkbench(page)
  const oldUrl = 'http://127.0.0.1:5500/mowo/frontend/pages/admin-customization-requests.html'
  await page.goto(oldUrl)
  await expect(page).toHaveURL(/\/app\/admin\/customization-requests$/)
  await expect(page.locator('.request-row')).toBeVisible()
})
