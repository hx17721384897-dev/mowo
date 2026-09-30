import { expect, test, type Page, type Route } from '@playwright/test'

const progress = {
  total: 2,
  frameCompleted: 1,
  materialPicked: 1,
  paired: 0,
  packaged: 0,
  exceptions: 1
}
const summary = {
  id: 'PB-20260930-ABC234',
  status: 'IN_PROGRESS',
  createdAt: '2026-09-30T02:00:00.000Z',
  updatedAt: '2026-09-30T03:00:00.000Z',
  salesOrderCount: 1,
  productionUnitCount: 2,
  skuCount: 1,
  warningCount: 1,
  progress,
  legacy: false
}
const detail = {
  batch: {
    id: summary.id,
    status: summary.status,
    createdAt: summary.createdAt,
    salesOrderCount: 1,
    productionUnitCount: 2,
    skuCount: 1,
    warnings: [{ code: 'KIT_SHORTAGE', message: '<script>材料不足</script>' }]
  },
  progress,
  ledgerCheck: { currentMarker: `${summary.id} / 返工1次`, reprintCount: 1 },
  reprintTimeline: [
    {
      id: 'rp-1',
      revisionNo: 1,
      productionNo: 'PU-001',
      specification: '标准款 · 12帧',
      oldFramePackCode: 'FP-OLD',
      newFramePackCode: 'FP-NEW',
      requestedPages: [2],
      reason: '<img src=x onerror=alert(1)>裁切损坏',
      requestedByName: '生产人员',
      createdAt: summary.createdAt,
      newFramePackStatus: 'IN_PROGRESS',
      pairingStatus: 'WAITING',
      packageStatus: 'WAITING',
      productionPrintFileId: 'file-2'
    }
  ],
  materialDemand: [{ skuId: 'sku-1', skuCode: 'SKU-001', required: 2, available: 1, picked: 1 }],
  productionFiles: [
    {
      id: 'file-1',
      displayName: '首次生产.docx',
      targetFrameCount: 12,
      sourceType: 'ORDER',
      createdAt: summary.createdAt,
      downloadUrl: 'javascript:alert(1)'
    },
    {
      id: 'file-2',
      displayName: '返工.docx',
      targetFrameCount: 12,
      sourceType: 'REPRINT',
      createdAt: summary.createdAt,
      downloadUrl: 'https://objects.example.invalid/reprint.docx'
    }
  ],
  printQueue: [
    {
      productionUnitId: 'unit-1',
      productionNo: 'PU-001',
      sequence: 1,
      groupName: 'A4 单页 12 帧',
      pageCount: 1,
      rule: { size: '5×5cm', frameCount: 12 }
    }
  ],
  orders: [
    {
      id: 'so-1',
      orderNo: 'SO-001',
      receiverName: '<b>收件人</b>',
      receiverPhone: '13800138000',
      receiverCity: '上海',
      receiverAddress: '<script>地址</script>',
      fulfillmentStatus: 'PRODUCING',
      trackingNo: 'SF001',
      trackingCompany: '顺丰',
      items: [
        {
          id: 'item-1',
          title: '定制商品',
          quantity: 2,
          productionUnits: [
            {
              id: 'unit-1',
              productionNo: 'PU-001',
              specification: '标准款 · 12帧 · 5×5cm',
              workflow: {
                frameStatus: 'COMPLETED',
                materialStatus: 'PICKED',
                pairingStatus: 'WAITING',
                packageStatus: 'WAITING'
              },
              framePack: { code: 'FP-NEW' }
            },
            {
              id: 'unit-2',
              productionNo: 'PU-002',
              specification: '标准款 · 12帧 · 5×5cm',
              workflow: {
                frameStatus: 'IN_PROGRESS',
                materialStatus: 'IN_PROGRESS',
                pairingStatus: 'WAITING',
                packageStatus: 'WAITING'
              },
              framePack: null
            }
          ]
        }
      ]
    }
  ],
  legacy: false
}
const candidate = {
  id: 'so-ready',
  orderNo: 'SO-READY',
  receiverName: '测试收件人',
  itemCount: 1,
  productionUnitCount: 2,
  estimatedPrintPages: 2,
  unconfiguredPrintUnitCount: 1,
  ready: true,
  hardBlocks: [],
  warnings: [{ code: 'KIT_SHORTAGE', message: '材料包不足' }],
  matchedUnitCount: 1,
  extraUnitCount: 1,
  includesUnmatchedItems: true
}
const meta = {
  totalOrders: 1,
  totalUnits: 2,
  models: [{ id: 'model-1', name: '标准款' }],
  skus: [
    {
      id: 'sku-1',
      code: 'SKU-001',
      modelId: 'model-1',
      modelName: '标准款',
      size: '5×5cm',
      frameCount: 12
    }
  ],
  sizes: ['5×5cm'],
  frameCounts: [12],
  printGroups: [{ id: 'group-1', name: 'A4 单页 12 帧', size: '5×5cm' }]
}

async function fulfill(route: Route, data: unknown, extra: Record<string, unknown> = {}) {
  await route.fulfill({ json: { success: true, data, ...extra } })
}

async function mockPage(page: Page, role = 'PRODUCTION') {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  const draftWrites: string[] = []
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'test-token'))
  await page.route('**/api/v1/account/me', (route) =>
    fulfill(route, {
      id: 'staff-1',
      staffRole: role,
      role: role === 'OWNER' ? 3 : 2,
      status: 'ACTIVE',
      profile: { nickname: '生产人员' }
    })
  )
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    if (path === '/api/v1/account/me')
      return fulfill(route, {
        id: 'staff-1',
        staffRole: role,
        role: role === 'OWNER' ? 3 : 2,
        status: 'ACTIVE',
        profile: { nickname: '生产人员' }
      })
    if (path === '/api/config/features') return fulfill(route, {})
    if (/draft|customization-requests/.test(path) && request.method() !== 'GET')
      draftWrites.push(path)
    if (path === '/api/admin/production-batches' && request.method() === 'GET')
      return fulfill(route, [summary])
    if (path === `/api/admin/production-batches/${summary.id}` && request.method() === 'GET')
      return fulfill(route, detail)
    if (path === '/api/admin/production-batches/candidates' && request.method() === 'GET')
      return fulfill(route, [candidate], { meta })
    if (path === '/api/admin/production-batches' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      writes.push({ path, body })
      if (body.acknowledgeWarnings !== true)
        return route.fulfill({
          status: 409,
          json: {
            success: false,
            code: 'BATCH_WARNINGS_REQUIRE_ACK',
            message: '存在生产风险，请确认后继续',
            data: [{ code: 'KIT_SHORTAGE', message: '材料包不足' }]
          }
        })
      return fulfill(route, {
        batchId: summary.id,
        warnings: [],
        artifactErrors: [],
        reused: false
      })
    }
    throw new Error(`Unexpected request: ${request.method()} ${path}`)
  })
  return { writes, draftWrites }
}

test('production batch page preserves summary, detail, files, materials and safe text', async ({
  page
}, info) => {
  const tracked = await mockPage(page)
  await page.goto(`/app/admin/production-batches?batchId=${summary.id}`)
  await expect(page.getByRole('heading', { name: '生产批次' })).toBeVisible()
  await expect(page.getByText(`${summary.id} / 返工1次`)).toBeVisible()
  await expect(page.getByText('A4 单页 12 帧')).toBeVisible()
  await expect(page.getByText('SKU-001')).toBeVisible()
  await expect(page.getByText('PU-001', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('<script>材料不足</script>')).toBeVisible()
  await expect(page.getByText('<img src=x onerror=alert(1)>裁切损坏')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(page.locator('script').filter({ hasText: '材料不足' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '进入当前订单环节' })).toHaveAttribute(
    'href',
    /admin\/orders\?view=producing/
  )
  expect(tracked.draftWrites).toHaveLength(0)
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '菜单' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  } else {
    await page.goto(
      `http://127.0.0.1:5500/mowo/frontend/pages/admin-production-batches.html?batchId=${summary.id}`
    )
    await expect(page).toHaveURL(
      `/app/admin/production-batches?batchId=${encodeURIComponent(summary.id)}`
    )
    await expect(page.getByText(`${summary.id} / 返工1次`)).toBeVisible()
  }
})

test('create dialog keeps all filters and reuses one idempotency key through warning confirmation', async ({
  page
}) => {
  const tracked = await mockPage(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/app/admin/production-batches')
  await page.getByRole('button', { name: '创建生产批次' }).click()
  const dialog = page.getByRole('dialog', { name: '创建生产批次' })
  await expect(dialog.getByLabel('款式')).toContainText('标准款')
  await expect(dialog.getByLabel('SKU')).toContainText('SKU-001')
  await expect(dialog.getByLabel('尺寸')).toContainText('5×5cm')
  await expect(dialog.getByLabel('帧数')).toContainText('12帧')
  await expect(dialog.getByLabel('打印裁切组')).toContainText('A4 单页 12 帧')
  await expect(dialog.getByText('另有 1 件会随整张订单一并加入')).toBeVisible()
  await dialog.getByText('SO-READY').click()
  await dialog.getByRole('button', { name: '确认创建' }).click()
  await expect.poll(() => tracked.writes.length).toBe(2)
  await expect(dialog).toHaveCount(0)
  expect(tracked.writes[0]!.body.clientRequestId).toBe(tracked.writes[1]!.body.clientRequestId)
  expect(tracked.writes[0]!.body.acknowledgeWarnings).toBe(false)
  expect(tracked.writes[1]!.body.acknowledgeWarnings).toBe(true)
  expect(tracked.draftWrites).toHaveLength(0)
})

test('non-production staff cannot query production batches', async ({ page }) => {
  const tracked = await mockPage(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/production-batches')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(tracked.writes).toHaveLength(0)
  expect(tracked.draftWrites).toHaveLength(0)
})
