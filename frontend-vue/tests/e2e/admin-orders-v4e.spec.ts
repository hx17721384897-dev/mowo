import { expect, test, type Page, type Route } from '@playwright/test'

const counts = {
  PAID: 1,
  PENDING_ADDRESS_EXPORT: 2,
  WAITING_TRACKING: 3,
  READY_FOR_PRODUCTION: 4,
  PRODUCING: 5,
  READY_TO_SHIP: 6,
  SHIPPED: 7
}

type StageStatus = keyof typeof counts

function orderFixture(status: StageStatus) {
  const batched = status !== 'PAID'
  return {
    id: 'order-1',
    orderNo: 'SO-20260929-001',
    fulfillmentStatus: status,
    paidAt: '2026-09-29T08:00:00.000Z',
    createdAt: '2026-09-29T07:00:00.000Z',
    receiverName: '<img src=x onerror=alert(1)>收件人',
    receiverPhone: '13800138000',
    receiverCity: '上海市',
    receiverAddress: '测试路 1 号 <script>alert(1)</script>',
    trackingNo: status === 'WAITING_TRACKING' ? null : 'SF123456',
    trackingCompany: status === 'WAITING_TRACKING' ? null : '顺丰',
    batchId: batched ? 'PB-20260929-001' : null,
    batchStatus: batched ? 'IN_PROGRESS' : null,
    itemCount: 2,
    units: [
      {
        id: 'unit-1',
        productionNo: 'PU-20260929-001',
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        title: '定制翻页动画机',
        specification: '标准款 · S · 12帧 · 环保纸 · 原木色',
        printPageCount: 3,
        workflow: batched
          ? {
              frameStatus: 'IN_PROGRESS',
              materialStatus: 'IN_PROGRESS',
              pairingStatus: 'WAITING',
              packageStatus: 'WAITING',
              exceptionStatus: 'NORMAL'
            }
          : null,
        framePacks:
          status === 'PRODUCING'
            ? [
                {
                  code: 'FP-CURRENT',
                  status: 'IN_PROGRESS',
                  isActive: true,
                  voidReason: null
                },
                {
                  code: 'FP-VOID',
                  status: 'VOID',
                  isActive: false,
                  voidReason: '打印损坏'
                }
              ]
            : [],
        reprints: status === 'PRODUCING' ? [{ id: 'reprint-old' }] : []
      }
    ]
  }
}

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({ json: { success: true, data } })
}

async function mockOrders(page: Page, staffRole = 'PRODUCTION') {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const listQueries: URL[] = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'production-token'))
  await page.route('**/api/v1/account/me', (route) =>
    fulfillJson(route, {
      id: 'staff-1',
      staffRole,
      role: staffRole === 'OWNER' ? 3 : 2,
      status: 'ACTIVE',
      profile: { nickname: '生产人员' }
    })
  )
  await page.route('**/api/admin/production-workflow/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (path === '/api/admin/production-workflow/orders' && method === 'GET') {
      listQueries.push(url)
      const status = (url.searchParams.get('status') || 'PAID') as StageStatus
      return fulfillJson(route, { orders: [orderFixture(status)], counts })
    }
    calls.push({ method, path, body: request.postDataJSON() ?? null })
    if (path.endsWith('/export-addresses')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        body: '\ufeff收件人,电话\n测试,13800138000'
      })
    }
    if (path.endsWith('/tracking')) return fulfillJson(route, null)
    if (path.endsWith('/export-production')) {
      return route.fulfill({ status: 200, contentType: 'application/zip', body: 'test-zip' })
    }
    if (path.endsWith('/reprint')) {
      return fulfillJson(route, {
        framePackCode: 'FP-NEW',
        oldFramePackCode: 'FP-CURRENT',
        pages: [2],
        fileName: 'PU-20260929-001_返工.docx',
        downloadUrl: 'https://objects.example.invalid/reprint.docx',
        reprintId: 'reprint-1',
        message: '已生成 FP-NEW，旧码 FP-CURRENT 已失效'
      })
    }
    throw new Error(`Unexpected production workflow request: ${method} ${path}`)
  })
  await page.route('https://objects.example.invalid/reprint.docx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: 'test-docx'
    })
  )
  return { calls, listQueries }
}

test('production orders keep overview, search, safe rendering and all eight stages', async ({
  page
}, info) => {
  const data = await mockOrders(page)
  await page.goto('/app/admin/orders')
  await expect(page.getByRole('heading', { name: '订单总览' })).toBeVisible()
  await expect(page.getByText('<img src=x onerror=alert(1)>收件人')).toBeVisible()
  await expect(page.getByText(/测试路 1 号 <script>alert\(1\)<\/script>/)).toBeVisible()
  await expect(page.locator('script').filter({ hasText: 'alert(1)' })).toHaveCount(0)
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '订单总览 28' })).toBeVisible()

  await page.getByLabel('搜索正式订单').fill('SO-2026')
  await page.getByLabel('搜索正式订单').press('Enter')
  await expect.poll(() => data.listQueries.at(-1)?.searchParams.get('q')).toBe('SO-2026')

  const stages = [
    ['已付款', 'PAID'],
    ['待处理', 'PENDING_ADDRESS_EXPORT'],
    ['处理中', 'WAITING_TRACKING'],
    ['待生产', 'READY_FOR_PRODUCTION'],
    ['生产中', 'PRODUCING'],
    ['待发货', 'READY_TO_SHIP'],
    ['已发货', 'SHIPPED']
  ] as const
  for (const [label, status] of stages) {
    await page.getByRole('button', { name: new RegExp(`^${label}\\s`) }).click()
    await expect.poll(() => data.listQueries.at(-1)?.searchParams.get('status')).toBe(status)
    await expect(page.getByRole('heading', { name: label })).toBeVisible()
  }

  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
})

test('batch actions preserve address export, tracking and production export payloads', async ({
  page
}) => {
  const data = await mockOrders(page)
  page.on('dialog', (dialog) => dialog.accept())

  await page.goto('/app/admin/orders?view=pending')
  const addressDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出本批次地址' }).click()
  await addressDownload
  await expect
    .poll(() => data.calls.filter((call) => call.path.endsWith('/export-addresses')).length)
    .toBe(1)

  await page.getByRole('button', { name: /^处理中\s/ }).click()
  await page.getByRole('button', { name: '确认本批次面单' }).click()
  await expect(page.getByRole('status')).toContainText('请至少填写一张面单')
  await page.getByLabel('SO-20260929-001 快递单号').fill('YT987654')
  await page.getByRole('button', { name: '确认本批次面单' }).click()
  await expect(page.getByRole('status')).toContainText('必须同时填写')
  await page.getByLabel('SO-20260929-001 快递公司').fill('圆通')
  await page.getByRole('button', { name: '确认本批次面单' }).click()
  await expect
    .poll(() => data.calls.find((call) => call.path.endsWith('/tracking'))?.body)
    .toEqual({
      entries: [{ orderNo: 'SO-20260929-001', trackingNo: 'YT987654', trackingCompany: '圆通' }]
    })

  await page.getByRole('button', { name: /^待生产\s/ }).click()
  const productionDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出生产资料并开工' }).click()
  await productionDownload
  await expect
    .poll(() => data.calls.filter((call) => call.path.endsWith('/export-production')).length)
    .toBe(1)
})

test('reprint keeps page selection, reason, signed download and closes after success', async ({
  page
}) => {
  const data = await mockOrders(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/app/admin/orders?view=producing')
  await expect(page.getByText('当前 FP-CURRENT')).toBeVisible()
  await expect(page.getByText('FP-VOID')).toBeVisible()
  await expect(page.getByText('返工 1 次')).toBeVisible()
  await page.getByRole('button', { name: '重印', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重印帧素材包' })
  await dialog.getByRole('button', { name: '生成新帧包码并下载' }).click()
  await expect(page.getByRole('status')).toContainText('请选择需要重印的页')
  await dialog.getByLabel('第 2 页').check()
  await dialog.getByLabel('返工原因').fill('第 2 页裁切偏移')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '生成新帧包码并下载' }).click()
  await download
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(() => data.calls.find((call) => call.path.endsWith('/reprint'))?.body)
    .toMatchObject({ pages: [2], reason: '第 2 页裁切偏移' })
  const reprintBody = data.calls.find((call) => call.path.endsWith('/reprint'))?.body as Record<
    string,
    unknown
  >
  expect(reprintBody.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(data.calls.filter((call) => call.path.endsWith('/reprint'))).toHaveLength(1)
})

test('non-production staff cannot render or query production orders', async ({ page }) => {
  const data = await mockOrders(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/orders')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(data.listQueries).toHaveLength(0)
  expect(data.calls).toHaveLength(0)
})

test('retired legacy order URL preserves the selected stage in the Vue workbench', async ({
  page
}) => {
  const data = await mockOrders(page)
  await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-orders.html?view=producing')
  await expect(page).toHaveURL(/\/app\/admin\/orders\?view=producing$/)
  await expect(page.getByRole('heading', { name: '生产中' })).toBeVisible()
  await expect.poll(() => data.listQueries.at(-1)?.searchParams.get('status')).toBe('PRODUCING')
})
