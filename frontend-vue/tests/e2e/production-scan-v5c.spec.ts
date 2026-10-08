import { expect, test, type Page, type Route } from '@playwright/test'

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    json: { success: status < 400, data, message: status < 400 ? '成功' : '模拟失败' }
  })
}

async function mockPage(page: Page, role = 'PRODUCTION', failFrameOnce = false) {
  const writes: Array<{ path: string; method: string; body: unknown }> = []
  let packed = false
  let frameAttempts = 0
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'scan-test-token'))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (path === '/api/v1/account/me')
      return fulfill(route, {
        id: 'staff-1',
        role: role === 'PRODUCTION' ? 1 : 0,
        staffRole: role,
        status: 'ACTIVE',
        profile: { nickname: '生产测试' }
      })
    if (path === '/api/config/features') return fulfill(route, {})
    if (method !== 'GET') writes.push({ path, method, body: request.postDataJSON?.() || null })
    if (path.endsWith('/scan-overview'))
      return fulfill(route, {
        batches: [
          {
            id: 'PB-TEST',
            status: 'IN_PROGRESS',
            createdAt: '2026-10-08T00:00:00Z',
            total: 2,
            frameCompleted: 1,
            materialPicked: 1,
            paired: 1,
            packaged: 0,
            exceptions: 0
          }
        ],
        waitingSessions: 0,
        recent: [
          {
            action: '<img src=x onerror=alert(1)>测试生产操作',
            targetId: 'PU-1',
            createdAt: '2026-10-08T00:00:00Z',
            userId: 'staff-1'
          }
        ]
      })
    if (path.endsWith('/frame-print-queue'))
      return fulfill(route, {
        queue: [
          {
            sequence: 1,
            productionUnitId: 'PU-1',
            productionNo: 'PU-TEST-01',
            salesOrderNo: 'SO-1',
            framePackCode: 'FP-TEST-01',
            groupCode: 'G1',
            groupName: '测试打印组',
            specification: '测试款 · 5×5cm · 12帧',
            pageCount: 1,
            printCopies: 1,
            frameStatus: 'WAITING',
            fileName: null,
            downloadUrl: null
          }
        ]
      })
    if (path.endsWith('/pairing/lookup/FP-TEST-01'))
      return fulfill(route, {
        type: 'FRAME_PACK',
        productionNo: 'PU-TEST-01',
        specification: '测试款 · 5×5cm · 12帧'
      })
    if (path.endsWith('/pairing/lookup/KB-TEST'))
      return fulfill(route, {
        type: 'KIT_BATCH',
        skuCode: 'SKU-TEST',
        specification: '测试款 · 5×5cm',
        freeQty: 2
      })
    if (path.endsWith('/frame-packs/FP-TEST-01/complete')) {
      frameAttempts++
      if (failFrameOnce && frameAttempts === 1) return fulfill(route, null, 503)
      return fulfill(route, {
        reused: true,
        advanced: false,
        changed: false,
        frame: { status: 'COMPLETED' }
      })
    }
    if (path.endsWith('/material-picks') && method === 'GET')
      return fulfill(route, [
        {
          id: 'PICK-1',
          sourceCode: 'KB-TEST',
          quantity: 2,
          remainingQty: 1,
          consumedQty: 1,
          returnedQty: 0,
          status: 'ACTIVE'
        }
      ])
    if (path.endsWith('/material-picks') && method === 'POST')
      return fulfill(route, { id: 'PICK-2' }, 201)
    if (path.includes('/pairing/material-source/'))
      return fulfill(route, {
        code: 'KB-TEST',
        skuCode: 'SKU-TEST',
        specification: '测试款 · 5×5cm',
        pickedQty: 2,
        remainingQty: 1,
        consumedQty: 1
      })
    if (path.endsWith('/pairing') && method === 'POST')
      return fulfill(route, { reused: true, sourceCode: 'KB-TEST' })
    if (path.endsWith('/packing-sessions'))
      return fulfill(route, [
        {
          id: 'PACK-1',
          trackingNo: 'TRACK-TEST',
          status: 'OPEN',
          orderNo: 'SO-1',
          receiverName: '测试收件人',
          scanned: 0,
          total: 1,
          updatedAt: '2026-10-08T00:00:00Z'
        }
      ])
    if (path.endsWith('/packing/TRACK-TEST') && method === 'GET')
      return fulfill(route, {
        order: {
          id: 'SO-1',
          orderNo: 'SO-1',
          receiverName: '测试收件人',
          fulfillmentStatus: packed ? 'READY_TO_SHIP' : 'PRODUCING',
          batchId: 'PB-TEST'
        },
        units: [
          {
            productionUnitId: 'PU-1',
            productionNo: 'PU-TEST-01',
            specification: '测试款 · 5×5cm',
            paired: true,
            scanned: packed
          }
        ],
        complete: packed
      })
    if (path.endsWith('/packing/TRACK-TEST/scan')) {
      packed = true
      return fulfill(route, { complete: true, orderNo: 'SO-1' })
    }
    if (path.endsWith('/packing/TRACK-TEST/ship'))
      return fulfill(route, { orderNo: 'SO-1', batchId: 'PB-TEST' })
    throw new Error(`Unexpected request: ${method} ${path}`)
  })
  return writes
}

async function chooseBatch(page: Page) {
  await page.getByLabel('生产批次').selectOption('PB-TEST')
  await expect(page.locator('#batchSelectionState')).toHaveText('2 件')
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? { x: rect.x, y: rect.y, width: rect.width } : null
    }
    return {
      topbar: box('.topbar'),
      content: box('.content'),
      toolbar: box('.batch-toolbar'),
      tabs: box('.work-tabs')
    }
  })
}

test('formal page preserves overview geometry, legacy redirect and safe server text', async ({
  page
}, info) => {
  await mockPage(page)
  await page.goto(
    'http://127.0.0.1:5500/mowo/frontend/pages/production-scan.html?source=cutover#overview'
  )
  await expect(page).toHaveURL(/\/app\/admin\/production-scan\?source=cutover#overview$/)
  await expect(page.getByText('<img src=x onerror=alert(1)>测试生产操作')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  const formal = await geometry(page)
  if (info.project.name === 'chromium') {
    for (const key of ['topbar', 'content', 'toolbar', 'tabs'] as const) {
      expect(formal[key]).not.toBeNull()
      expect(formal[key]!.width).toBeGreaterThan(0)
    }
  } else {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    ).toBe(true)
  }
})

test('formal page keeps five stations, selected batch, scanner capture and mobile layout', async ({
  page
}, info) => {
  await mockPage(page)
  await page.goto('/app/admin/production-scan#overview')
  await expect(page.getByRole('heading', { name: '扫码作业总览' })).toBeVisible()
  await expect(page.locator('.work-tabs button')).toHaveCount(5)
  await chooseBatch(page)
  await page.locator('.work-tabs button[data-station="frame"]').click()
  await expect(page.getByRole('heading', { name: '打印队列' })).toBeVisible()
  await page.getByRole('heading', { name: '打印队列' }).click()
  await page.keyboard.type('FP-TEST-01', { delay: 2 })
  await page.keyboard.press('Enter')
  await expect(page.getByText('此前已经完成，本次未重复登记')).toBeVisible()
  await expect(page.locator('#frameManual')).toHaveValue('')
  await page.locator('.work-tabs button[data-station="material"]').click()
  await expect(page.getByLabel('生产批次')).toHaveValue('PB-TEST')
  if (info.project.name === 'mobile-chromium') {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    ).toBe(true)
    await page.getByRole('button', { name: '打开菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  }
  await page.goto('/app/admin/production-scan?station=pairing')
  await expect(page.locator('#stationTitle')).toHaveText('单件配对')
})

test('failed frame write does not advance locally and can retry in place', async ({ page }) => {
  const writes = await mockPage(page, 'PRODUCTION', true)
  await page.goto('/app/admin/production-scan#frame')
  await chooseBatch(page)
  await page.getByLabel('手工输入').fill('FP-TEST-01')
  await page.getByRole('button', { name: '登记完成' }).click()
  await expect(page.getByText('模拟失败')).toBeVisible()
  await expect(page.locator('#frameResult')).toHaveText('等待扫描帧素材包')
  await page.getByLabel('手工输入').fill('FP-TEST-01')
  await page.getByRole('button', { name: '登记完成' }).click()
  await expect(page.getByText('此前已经完成，本次未重复登记')).toBeVisible()
  expect(
    writes.filter((row) => row.path.endsWith('/frame-packs/FP-TEST-01/complete'))
  ).toHaveLength(2)
})

test('material and pairing preserve server-confirmed endpoints and duplicate semantics', async ({
  page
}) => {
  const writes = await mockPage(page)
  await page.goto('/app/admin/production-scan#material')
  await chooseBatch(page)
  await page.getByLabel('手工输入').fill('KB-TEST')
  await page.getByRole('button', { name: '读取' }).click()
  await expect(page.getByText('当前可领 2 套')).toBeVisible()
  await page.getByRole('button', { name: '确认领用' }).click()
  await page.locator('.work-tabs button[data-station="pairing"]').click()
  await page.getByLabel('手工输入').fill('KB-TEST')
  await page.getByRole('button', { name: '处理' }).click()
  await page.getByLabel('手工输入').fill('FP-TEST-01')
  await page.getByRole('button', { name: '处理' }).click()
  await expect(page.getByText('此前已经与 KB-TEST 配对，本次未扣库存')).toBeVisible()
  expect(writes.map((row) => `${row.method} ${row.path}`)).toEqual(
    expect.arrayContaining([
      'POST /api/admin/production-workflow/material-picks',
      'POST /api/admin/production-workflow/pairing'
    ])
  )
})

test('packing requires server completion and explicit ship confirmation', async ({ page }) => {
  const writes = await mockPage(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/app/admin/production-scan#packing')
  await chooseBatch(page)
  await page.getByLabel('手工输入').fill('TRACK-TEST')
  await page.getByRole('button', { name: '处理' }).click()
  await expect(page.getByRole('strong').filter({ hasText: 'SO-1 · 测试收件人' })).toBeVisible()
  await page.getByLabel('手工输入').fill('FP-TEST-01')
  await page.getByRole('button', { name: '处理' }).click()
  await page.getByRole('button', { name: '确认交付快递并发货' }).click()
  expect(writes.map((row) => `${row.method} ${row.path}`)).toContain(
    'POST /api/admin/production-workflow/packing/TRACK-TEST/scan'
  )
  expect(writes.map((row) => `${row.method} ${row.path}`)).toContain(
    'POST /api/admin/production-workflow/packing/TRACK-TEST/ship'
  )
})

test('non-production staff cannot render or query production scan workbench', async ({ page }) => {
  const writes = await mockPage(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/production-scan#frame')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(writes).toHaveLength(0)
})
