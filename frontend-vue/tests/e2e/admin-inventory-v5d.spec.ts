import { expect, test, type Page, type Route } from '@playwright/test'

const inventory = {
  skuId: 'sku-1',
  skuName: '5×5cm · 椴木板 · 12帧 · 原色',
  skuCode: 'SKU-TEST-01',
  skuBarcode: 'MOWO-TEST-01',
  modelName: '<img src=x onerror=alert(1)>测试款',
  size: '5×5cm',
  material: '椴木板',
  frameCount: 12,
  colorName: '原色',
  colorHex: '#D4B896',
  currentStock: 20,
  reservedStock: 3,
  wipFrameQty: 2,
  wipKitQty: 0,
  availableQty: 15,
  availableStock: 15,
  safetyStock: 5,
  maxOrderLimit: 10,
  safetyFactor: 1,
  dailySales: 0.5,
  alertLevel: 'OK'
}
const materials = [
  {
    id: 'mat-raw',
    name: '<img src=x onerror=alert(2)>散装铁丝',
    itemCode: 'MAT-RAW-01',
    itemType: 'RAW',
    specification: '长度5.5cm',
    unit: '根',
    currentStock: 120,
    safetyStock: 20,
    leadTime: 7,
    note: null,
    sourceMaterialId: null,
    sourceQtyPerUnit: null,
    sourceMaterialName: null,
    consumed30d: 24,
    dailyConsumption: 0.8,
    availableDays: 150,
    alertLevel: 'OK',
    boundSkuCount: 1
  },
  {
    id: 'mat-packed',
    name: '12根铁丝包',
    itemCode: 'MAT-PACK-01',
    itemType: 'PACKED',
    specification: null,
    unit: '包',
    currentStock: 8,
    safetyStock: 10,
    leadTime: 7,
    note: null,
    sourceMaterialId: 'mat-raw',
    sourceQtyPerUnit: 12,
    sourceMaterialName: '<img src=x onerror=alert(2)>散装铁丝',
    consumed30d: 12,
    dailyConsumption: 0.4,
    availableDays: 20,
    alertLevel: 'WARNING',
    boundSkuCount: 1
  }
]
const returnReceipt = {
  id: 'return-1',
  returnNo: '<img src=x onerror=alert(3)>RT-TEST-001',
  aftersaleRequestId: 'aftersale-1',
  orderId: 'order-1',
  trackingNo: 'SF123456',
  trackingCompany: '顺丰',
  status: 'QUARANTINED',
  receivedAt: '2026-10-09T08:00:00Z',
  inspectedAt: null,
  note: null,
  items: [],
  aftersale: { order: { orderNo: 'PU-TEST-001' }, user: { nickname: '测试用户' } }
}
const framePackWorks = [
  {
    id: 'frame-work-1',
    collabWorkId: 'collab-1',
    name: '<img src=x onerror=alert(6)>联名动画',
    thumbnailUrl: null,
    worstAlert: 'WARNING',
    variants: [
      {
        id: 'frame-variant-1',
        workId: 'frame-work-1',
        size: '5x5cm',
        frameCount: 12,
        skuCode: 'FP-TEST-01',
        currentStock: 4,
        safetyStock: 5,
        leadTime: 7,
        note: null,
        consumed30d: 0,
        dailyConsumption: 0,
        availableDays: null,
        alertLevel: 'WARNING'
      }
    ]
  }
]

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    json: { success: status < 400, data, message: status < 400 ? '成功' : '模拟失败' }
  })
}

async function mockPage(
  page: Page,
  role = 'PRODUCTION',
  failAdjustmentOnce = false,
  failReturnInspectionOnce = false
) {
  const adjustments: Record<string, unknown>[] = []
  const materialWrites: Array<{ path: string; body: Record<string, unknown> }> = []
  const returnWrites: Array<{ path: string; body: Record<string, unknown> }> = []
  const quotaWrites: Array<Record<string, unknown>> = []
  const framePackWrites: Array<{ path: string; body: Record<string, unknown> }> = []
  const logQueries: string[] = []
  const writes: string[] = []
  let failed = false
  let returnInspectionFailed = false
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'inventory-test-token'))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/account/me')
      return fulfill(route, {
        id: 'staff-1',
        role: role === 'PRODUCTION' ? 1 : 0,
        staffRole: role,
        status: 'ACTIVE',
        profile: { nickname: '库存测试' }
      })
    if (path === '/api/config/features') return fulfill(route, {})
    if (path === '/api/frame-packs' && request.method() === 'GET')
      return fulfill(route, framePackWorks)
    if (path === '/api/frame-packs/search-collab')
      return fulfill(route, [
        { id: 'collab-2', title: '候选联名动画', thumbnailKey: null, alreadyAdded: false }
      ])
    if (path === '/api/frame-packs' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      framePackWrites.push({ path, body })
      return fulfill(route, { ...framePackWorks[0], id: 'frame-work-2', reused: false })
    }
    if (path.startsWith('/api/frame-packs/') && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      framePackWrites.push({ path, body })
      return fulfill(route, { currentStock: 6, reused: false })
    }
    if (path === '/api/inventory/logs') {
      logQueries.push(new URL(request.url()).search)
      return fulfill(route, {
        logs: [
          {
            id: 'global-log-1',
            skuId: 'sku-1',
            type: 'manual_adjustment',
            quantity: -2,
            operatorId: 'operator-12345678',
            note: '<img src=x onerror=alert(4)>盘点差异',
            reason: null,
            beforeQty: 22,
            afterQty: 20,
            createdAt: '2026-10-09T09:00:00Z',
            modelName: '测试款',
            skuSpec: '5×5cm · 椴木板 · 12帧 · 原色'
          }
        ],
        total: 31,
        page: Number(new URL(request.url()).searchParams.get('page') || 1),
        limit: 30
      })
    }
    if (path === '/api/inventory/returns' && request.method() === 'GET')
      return fulfill(route, [returnReceipt])
    if (path === '/api/inventory/returns/receive') {
      const body = request.postDataJSON() as Record<string, unknown>
      returnWrites.push({ path, body })
      return fulfill(route, { ...returnReceipt, id: 'return-new', ...body, reused: false })
    }
    if (path === '/api/inventory/returns/return-1/inspect') {
      const body = request.postDataJSON() as Record<string, unknown>
      returnWrites.push({ path, body })
      if (failReturnInspectionOnce && !returnInspectionFailed) {
        returnInspectionFailed = true
        return route.abort('connectionreset')
      }
      return fulfill(route, { reused: false })
    }
    if (path === '/api/inventory/returns/return-1/replacement') {
      const body = request.postDataJSON() as Record<string, unknown>
      returnWrites.push({ path, body })
      return fulfill(route, { id: 'replacement-1', orderNo: 'PU-R-001', reused: false })
    }
    if (path === '/api/materials/form-options' && request.method() === 'GET')
      return fulfill(route, {
        names: [{ id: 'name-1', category: 'NAME', scope: 'RAW', value: '测试零件' }],
        units: [{ id: 'unit-1', category: 'UNIT', scope: 'ALL', value: '个' }]
      })
    if (path === '/api/materials/form-options' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { id: 'option-new', ...body })
    }
    if (path.startsWith('/api/materials/form-options/') && request.method() === 'DELETE') {
      materialWrites.push({ path, body: {} })
      return fulfill(route, null)
    }
    if (path === '/api/materials' && request.method() === 'GET') return fulfill(route, materials)
    if (path === '/api/materials' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { ...materials[0], id: 'mat-new', ...body, reused: false })
    }
    if (path === '/api/materials/mat-raw' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { ...materials[0], ...body })
    }
    if (path === '/api/materials/mat-raw/defect') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { currentStock: 119, reused: false })
    }
    if (path === '/api/materials/mat-raw/adjust') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { currentStock: 122, reused: false })
    }
    if (path === '/api/materials/mat-packed/logs')
      return fulfill(route, { logs: [], total: 0, page: 1 })
    if (path === '/api/materials/mat-packed/bindings') return fulfill(route, [])
    if (path === '/api/materials/mat-raw/logs')
      return fulfill(route, { logs: [], total: 0, page: 1 })
    if (path === '/api/materials/mat-raw/bindings') return fulfill(route, [])
    if (path === '/api/materials/mat-packed/prepare-preview')
      return fulfill(route, {
        materialId: 'mat-raw',
        materialName: '<img src=x onerror=alert(2)>散装铁丝',
        itemType: 'RAW',
        unit: '根',
        requiredQty: 24,
        outputQty: 2,
        lossQty: 0,
        allocations: [
          {
            sourceBatchId: 'receipt-1',
            sourceType: 'RECEIPT',
            batchNo: 'RCV-001',
            quantity: 24,
            availableQty: 120,
            location: 'A-01'
          }
        ]
      })
    if (path === '/api/materials/mat-packed/prepare') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { batchNo: 'PREP-001', outputQty: 2, reused: false })
    }
    if (path === '/api/materials/mat-raw/restock') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { currentStock: 130, receiptNo: 'RCV-002', reused: false })
    }
    if (path === '/api/inventory/kits/assemble-preview')
      return fulfill(route, {
        skuId: 'sku-1',
        quantity: 1,
        plan: [
          {
            materialId: 'mat-packed',
            materialName: '12根铁丝包',
            itemType: 'PACKED',
            unit: '包',
            requiredQty: 1,
            allocations: [
              {
                sourceBatchId: 'prep-1',
                sourceType: 'PREPARATION',
                batchNo: 'PREP-OLD-001',
                quantity: 1,
                availableQty: 8,
                location: 'B-01'
              }
            ]
          }
        ]
      })
    if (path === '/api/inventory/kits/assemble') {
      const body = request.postDataJSON() as Record<string, unknown>
      materialWrites.push({ path, body })
      return fulfill(route, { batchNo: 'KB-001', quantity: 1, reused: false })
    }
    if (path === '/api/inventory' && request.method() === 'GET') return fulfill(route, [inventory])
    if (path === '/api/inventory/channel-quotas/sku-1' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>
      quotaWrites.push(body)
      return fulfill(route, {
        ...body,
        skuId: 'sku-1',
        assigned: 8,
        oversold: body.forceOversell === true
      })
    }
    if (path === '/api/inventory/channel-quotas' && request.method() === 'GET')
      return fulfill(route, [
        {
          skuId: 'sku-1',
          skuCode: 'SKU-TEST-01',
          modelName: '<img src=x onerror=alert(5)>测试款',
          skuSpec: '5×5cm · 椴木板 · 12帧 · 原色',
          available: 15,
          bufferPool: 5,
          allocatable: 10,
          suggestTaobao: 3,
          suggestDouyin: 3,
          suggestXhs: 3,
          taobaoQty: 3,
          douyinQty: 3,
          xhsQty: 2,
          livestreamMode: false
        }
      ])
    if (path === '/api/inventory/sku-1' && request.method() === 'GET')
      return fulfill(route, {
        ...inventory,
        logs: [
          {
            id: 'log-1',
            type: 'manual_adjustment',
            quantity: 5,
            beforeQty: 10,
            afterQty: 15,
            reason: '<b>测试入库</b>',
            note: null,
            createdAt: '2026-10-08T00:00:00Z'
          }
        ]
      })
    if (path.endsWith('/restock')) {
      const body = request.postDataJSON() as Record<string, unknown>
      adjustments.push(body)
      writes.push(path)
      if (failAdjustmentOnce && !failed) {
        failed = true
        return route.abort('connectionreset')
      }
      return fulfill(route, { ...inventory, currentStock: 25, availableQty: 20, reused: false })
    }
    if (path.endsWith('/settings')) {
      writes.push(path)
      return fulfill(route, inventory)
    }
    return fulfill(route, null, 404)
  })
  return {
    adjustments,
    logQueries,
    materialWrites,
    returnWrites,
    quotaWrites,
    framePackWrites,
    writes
  }
}

test('candidate renders SKU stock safely and keeps the seven-domain geometry', async ({ page }) => {
  await mockPage(page)
  await page.goto('/app/admin/inventory')
  await expect(page.getByRole('heading', { name: '库存管理' })).toBeVisible()
  await expect(page.locator('.main-tab')).toHaveCount(7)
  await expect(page.locator('.content > .stats-grid .stat-card')).toHaveCount(6)
  await expect(page.getByText('<img src=x onerror=alert(1)>测试款')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await page.getByPlaceholder('搜索款式或规格…').fill('SKU-TEST-01')
  await expect(page.locator('.inv-row')).toHaveCount(1)
})

test('inventory keeps legacy tablet geometry and isolates inactive material domains', async ({
  page
}) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await mockPage(page)
  await page.goto('/app/admin/inventory')

  await expect(page.getByRole('button', { name: '☰' })).toBeVisible()
  const mainBox = await page.locator('.admin-inventory-page .main').boundingBox()
  expect(mainBox?.x).toBeLessThanOrEqual(1)
  await expect(page.getByRole('button', { name: '＋ 新增分装小包' })).toBeHidden()
  await expect(page.getByRole('button', { name: '＋ 新增基础零件' })).toBeHidden()

  await page
    .locator('.inv-row')
    .first()
    .getByRole('button', { name: '材料包入库', exact: true })
    .click()
  await expect(page.getByLabel('材料包 SKU *')).toHaveValue('sku-1')
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '已分装小包', exact: true }).click()
  await expect(page.getByRole('button', { name: '＋ 新增分装小包' })).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ 新增基础零件' })).toBeHidden()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
})

test('candidate reuses one adjustment key after a lost response and saves settings', async ({
  page
}) => {
  const state = await mockPage(page, 'PRODUCTION', true)
  await page.goto('/app/admin/inventory')
  await page.locator('.inv-row').click()
  await expect(page.getByRole('complementary', { name: '库存详情' })).toBeVisible()
  await page.getByPlaceholder('如 50 或 -5').fill('5')
  await page.getByPlaceholder('备注（调减时建议填写原因）').fill('测试入库')
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('网络连接失败')).toBeVisible()
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('库存调整已保存')).toBeVisible()
  expect(state.adjustments).toHaveLength(2)
  expect(state.adjustments[0].clientRequestId).toBe(state.adjustments[1].clientRequestId)
  await page.getByRole('button', { name: '保存策略' }).click()
  await expect(page.getByText('设置已保存')).toBeVisible()
  expect(state.writes.some((path) => path.endsWith('/settings'))).toBe(true)
})

test('candidate enforces production roles and fits mobile', async ({ page }, info) => {
  const role = info.project.name === 'chromium' ? 'CUSTOMER_SERVICE' : 'PRODUCTION'
  await mockPage(page, role)
  await page.goto('/app/admin/inventory')
  if (role === 'CUSTOMER_SERVICE') {
    await expect(page).toHaveURL(/\/app\/forbidden$/)
    return
  }
  await expect(page.getByRole('heading', { name: '库存管理' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
  await page.getByRole('button', { name: '☰' }).click()
  await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
})

test('material domains keep FIFO preparation and receipt writes inside Vue', async ({ page }) => {
  const state = await mockPage(page)
  await page.goto('/app/admin/inventory')
  await page.getByRole('button', { name: '已分装小包' }).click()
  await expect(page.getByText('12根铁丝包')).toBeVisible()
  await page.getByRole('button', { name: '分装', exact: true }).click()
  await page.getByLabel('分装成品数量 *').fill('2')
  await expect(page.getByText('RCV-001：24根')).toBeVisible()
  await page.getByRole('button', { name: '确认分装' }).click()
  await expect(page.getByText(/分装完成，批次 PREP-001/)).toBeVisible()

  await page.getByRole('button', { name: '材料包入库' }).click()
  await page.getByLabel('材料包 SKU *').selectOption('sku-1')
  await page.getByLabel('入库套数 *').fill('1')
  await expect(page.getByText('PREP-OLD-001：1包')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '确认材料包入库' }).click()
  await expect(page.getByText(/材料包入库完成，批次 KB-001/)).toBeVisible()

  await page.getByRole('button', { name: '基础零件', exact: true }).click()
  await expect(page.getByText('<img src=x onerror=alert(2)>散装铁丝')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await page.getByRole('button', { name: '采购入库' }).click()
  await page.getByLabel('实际合格数量 *').fill('10')
  await page.getByLabel('到货次品数量').fill('1')
  await page.getByRole('button', { name: '确认入库' }).click()
  await expect(page.getByText(/入库完成，批次 RCV-002/)).toBeVisible()

  expect(state.materialWrites).toHaveLength(3)
  expect(state.materialWrites[0].body.clientRequestId).toMatch(/^material-/)
  expect(state.materialWrites[0].body.allocations).toEqual([
    { sourceBatchId: 'receipt-1', quantity: 24 }
  ])
  expect(state.materialWrites[1].body.clientRequestId).toMatch(/^material-/)
  expect(state.materialWrites[1].body.allocations).toEqual([
    {
      materialId: 'mat-packed',
      allocations: [{ sourceBatchId: 'prep-1', quantity: 1 }]
    }
  ])
  expect(state.materialWrites[2].body.clientRequestId).toMatch(/^material-/)
  expect(state.materialWrites[2].body.actualQty).toBe(11)
})

test('material maintenance creates, edits, defects and adjusts through safe writes', async ({
  page
}) => {
  const state = await mockPage(page)
  await page.goto('/app/admin/inventory')
  await page.getByRole('button', { name: '基础零件', exact: true }).click()

  await page.getByRole('button', { name: '＋ 新增基础零件' }).click()
  await page.getByLabel('零件名称', { exact: true }).selectOption('测试零件')
  await page.getByLabel('单位', { exact: true }).selectOption('个')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('零件已创建')).toBeVisible()

  const card = page.locator('.material-card').filter({ hasText: '散装铁丝' })
  await card.getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('heading', { name: '编辑零件' })).toBeVisible()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('零件资料已保存')).toBeVisible()

  await card.getByRole('button', { name: '报损' }).click()
  await page.getByLabel('报损数量 *').fill('1')
  await page.getByLabel('报损原因 *').fill('质检报损')
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('报损已登记')).toBeVisible()

  await card.getByRole('button', { name: '盘点' }).click()
  await page.getByLabel('调整量 *').fill('2')
  await page.getByLabel('调整原因 *').fill('盘点差异')
  await page.getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('盘点调整已保存')).toBeVisible()

  const writes = state.materialWrites.slice(-4)
  expect(writes.map((row) => row.path)).toEqual([
    '/api/materials',
    '/api/materials/mat-raw',
    '/api/materials/mat-raw/defect',
    '/api/materials/mat-raw/adjust'
  ])
  expect(writes[0].body.clientRequestId).toMatch(/^material-/)
  expect(writes[2].body.clientRequestId).toMatch(/^material-/)
  expect(writes[3].body.clientRequestId).toMatch(/^material-/)
})

test('return inspection keeps receipt, disposition and replacement writes inside Vue', async ({
  page
}) => {
  const state = await mockPage(page, 'PRODUCTION', false, true)
  await page.goto('/app/admin/inventory?aftersaleId=aftersale-prefilled')
  await page.getByRole('button', { name: '退回检查' }).click()
  await expect(page.getByText('<img src=x onerror=alert(3)>RT-TEST-001')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)

  await page.getByRole('button', { name: '＋ 登记退回收货' }).click()
  await expect(page.getByLabel('售后申请 ID *')).toHaveValue('aftersale-prefilled')
  await page.getByLabel('快递公司').fill('圆通')
  await page.getByRole('button', { name: '确认收货并隔离' }).click()
  await expect(page.getByText('已收货并进入隔离区')).toBeVisible()

  await page.getByRole('button', { name: '开始检查' }).click()
  await page.getByLabel('包装与使用情况 *').selectOption('OPENED')
  await page.getByLabel('可复用基础零件（可选）').selectOption('mat-raw')
  await page.getByLabel('零件数量').fill('2')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '确认检查结论' }).click()
  await expect(page.getByText('网络连接失败')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '确认检查结论' }).click()
  await expect(page.getByText('退回检查已完成')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '创建补发任务' }).click()
  await expect(page.getByText('补发生产任务已创建')).toBeVisible()

  expect(state.returnWrites.map((row) => row.path)).toEqual([
    '/api/inventory/returns/receive',
    '/api/inventory/returns/return-1/inspect',
    '/api/inventory/returns/return-1/inspect',
    '/api/inventory/returns/return-1/replacement'
  ])
  expect(
    state.returnWrites.every((row) => String(row.body.clientRequestId).startsWith('return-'))
  ).toBe(true)
  expect(state.returnWrites[1].body.clientRequestId).toBe(
    state.returnWrites[2].body.clientRequestId
  )
  expect(state.returnWrites[1].body.items).toEqual([
    {
      inventoryLevel: 'BASE',
      materialId: 'mat-raw',
      receivedQty: 2,
      disposition: 'SERVICE_ONLY'
    }
  ])
})

test('global inventory logs preserve filters, pagination and safe text rendering', async ({
  page
}) => {
  const state = await mockPage(page)
  await page.goto('/app/admin/inventory')
  await page.getByRole('button', { name: '变动记录' }).click()
  await expect(page.getByText('<img src=x onerror=alert(4)>盘点差异')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(
    page.locator('.inventory-logs-panel').getByText('5×5cm · 椴木板 · 12帧 · 原色')
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
  await page.getByLabel('变动类型').selectOption('manual_adjustment')
  await expect.poll(() => state.logQueries.at(-1)).toContain('type=manual_adjustment')
  await page.getByRole('button', { name: '2', exact: true }).click()
  await expect.poll(() => state.logQueries.at(-1)).toContain('page=2')
})

test('channel quotas preserve safe rendering, dynamic buffer checks and explicit oversell confirmation', async ({
  page
}) => {
  const state = await mockPage(page)
  await page.goto('/app/admin/inventory')
  await page.getByRole('button', { name: '渠道配额' }).click()

  await expect(page.getByText('<img src=x onerror=alert(5)>测试款')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await page.getByRole('button', { name: '保存配额' }).click()
  await expect(page.getByText('配额已保存')).toBeVisible()
  expect(state.quotaWrites).toHaveLength(1)
  expect(state.quotaWrites[0]).not.toHaveProperty('forceOversell')

  await page.getByLabel('缓冲池', { exact: true }).fill('10')
  await expect(page.getByText(/超过可分配量（5）/)).toBeVisible()
  await page.getByRole('button', { name: '保存配额' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '了解风险，强制保存' }).click()
  await expect(page.getByText('配额已强制保存，请持续关注超卖风险')).toBeVisible()
  expect(state.quotaWrites).toHaveLength(2)
  expect(state.quotaWrites[1].forceOversell).toBe(true)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
})

test('frame pack inventory preserves legacy cards and sends one safe restock write', async ({
  page
}) => {
  const state = await mockPage(page, 'PRODUCTION')
  await page.goto('/app/admin/inventory')
  await page.getByRole('button', { name: '帧包库存' }).click()
  await expect(page.getByText('<img src=x onerror=alert(6)>联名动画')).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(page.getByText('1 种规格 · 合计 4 套在库')).toBeVisible()
  await page.locator('.fp-work-header').click()
  await expect(page.getByText('FP-TEST-01')).toBeVisible()
  await expect(page.getByRole('button', { name: '调整' })).toHaveCount(0)
  await page.getByRole('button', { name: '入库', exact: true }).click()
  await page.getByLabel('入库数量 *').fill('2')
  await page.getByRole('button', { name: '确认入库' }).click()
  await expect(page.getByText('帧包入库成功')).toBeVisible()
  expect(state.framePackWrites).toHaveLength(1)
  expect(state.framePackWrites[0]?.path).toContain('/frame-variant-1/restock')
  expect(state.framePackWrites[0]?.body.clientRequestId).toMatch(/^frame-pack-/)
})

test('frame pack owner can add approved work without duplicate drafts', async ({ page }) => {
  const state = await mockPage(page, 'OWNER')
  await page.goto('/app/admin/inventory')
  await page.getByRole('button', { name: '帧包库存' }).click()
  await page.getByRole('button', { name: '+ 添加作品' }).click()
  await page.getByLabel('搜索联名作品').fill('候选')
  await expect(page.getByRole('button', { name: /候选联名动画/ })).toBeVisible()
  await page.getByRole('button', { name: /候选联名动画/ }).click()
  await page.getByRole('button', { name: '添加到白名单' }).click()
  await expect(page.getByText('已添加到帧包白名单')).toBeVisible()
  expect(state.framePackWrites).toHaveLength(1)
  expect(state.framePackWrites[0]?.body.clientRequestId).toMatch(/^frame-pack-/)
})
