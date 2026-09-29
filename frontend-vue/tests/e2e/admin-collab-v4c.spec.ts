import { expect, test, type Page } from '@playwright/test'

async function staff(page: Page, role = 'OWNER'): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'v4c-test-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-1', staffRole: role, status: 'ACTIVE', profile: { nickname: '员工' } }
      }
    })
  )
}

test('collab works candidate preserves status, search, detail, inventory and safe text', async ({
  page
}) => {
  await staff(page)
  const mutations: Array<{ path: string; body: unknown }> = []
  const work = {
    id: 'work-1',
    title: '<img src=x onerror=alert(1)>',
    status: 'approved',
    shelfStatus: 'on_sale',
    createdAt: '2026-09-01T00:00:00Z',
    approvedAt: '2026-09-02T00:00:00Z',
    coverUrl: 'javascript:alert(1)',
    creator: { nickname: '作者' },
    sizes: ['S'],
    saleConfigCount: 1,
    saleReadiness: { ready: true, blockers: [] },
    saleSkus: [{ id: 'sale-1' }],
    animationFrames: ['javascript:alert(2)']
  }
  await page.route('**/api/admin/collab/works?*', (route) =>
    route.fulfill({
      json: { success: true, data: { works: [work], total: 1, page: 1, limit: 200 } }
    })
  )
  await page.route('**/api/admin/collab/works/work-1', (route) =>
    route.fulfill({ json: { success: true, data: work } })
  )
  await page.route('**/api/admin/collab/work-1/frame-packs', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [{ size: 'S', stockType: 'stocked', currentStock: 4, reservedStock: 1 }]
      }
    })
  )
  await page.route('**/api/admin/collab/work-1/frame-packs/S/update', (route) => {
    mutations.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON()
    })
    return route.fulfill({
      json: {
        success: true,
        data: { stockType: 'on_demand', quantity: 2, currentStock: 6, replayed: false }
      }
    })
  })
  await page.route('**/api/admin/collab/work-1/suspend', (route) => {
    mutations.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON()
    })
    work.shelfStatus = 'suspended'
    return route.fulfill({ json: { success: true, data: {} } })
  })
  await page.goto('/app/admin/collab-works')
  await expect(page.locator('.works-card')).toHaveCount(1)
  await expect(page.locator('.works-cover img')).toHaveCount(0)
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  await page.locator('.works-card').getByRole('button', { name: '详情', exact: true }).click()
  await expect(page.locator('.works-pack-table')).toContainText('S')
  await expect(page.locator('.review-frame img')).toHaveCount(0)
  await page.locator('.works-pack-table').getByRole('button', { name: '调整' }).click()
  await page
    .locator('.works-modal')
    .getByText('库存类型')
    .locator('select')
    .selectOption('on_demand')
  await page.locator('.works-modal').getByText('调整数量').locator('input').fill('2')
  await page.locator('.works-modal').getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => mutations.length).toBe(1)
  expect(mutations[0]?.path).toBe('/api/admin/collab/work-1/frame-packs/S/update')
  expect(mutations[0]?.body).toMatchObject({
    stockType: 'on_demand',
    quantity: 2,
    clientRequestId: expect.any(String)
  })
  page.on('dialog', (dialog) => dialog.accept())
  await page.locator('.works-drawer').getByRole('button', { name: '暂停销售' }).click()
  await expect.poll(() => mutations.length).toBe(2)
  await expect(page.locator('.works-card')).toHaveCount(0)
  await page.locator('.works-stat').filter({ hasText: '暂停中' }).click()
  await expect(page.locator('.works-card')).toHaveCount(1)
  await page.getByRole('searchbox', { name: '搜索作品标题或创作者名称' }).fill('不存在')
  await expect(page.locator('.works-card')).toHaveCount(0)
})

test('collab works rejects unauthorized staff', async ({ page }) => {
  await staff(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/collab-works')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
})

test('retired review, contract and policy pages have no Vue or legacy entry', async ({
  page,
  request
}) => {
  await staff(page)
  await page.goto('/app/admin/collab-works')
  await expect(page.getByText('联名审核', { exact: true })).toHaveCount(0)
  await expect(page.getByText('商务合同', { exact: true })).toHaveCount(0)
  await expect(page.getByText('违约政策', { exact: true })).toHaveCount(0)

  for (const path of ['/app/admin/collab-review', '/app/admin/contracts']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  }

  for (const file of ['admin-collab.html', 'admin-contract.html', 'admin-collab-policy.html']) {
    const response = await request.get(`http://127.0.0.1:5500/mowo/frontend/pages/${file}`)
    expect(response.status()).toBe(404)
  }
})

test('product candidate validates, edits SKU and saves without drafts', async ({ page }) => {
  await staff(page)
  const workspace = {
    productNo: null,
    reviewStatus: 'approved',
    shelfStatus: 'off_shelf',
    isOnShelf: false,
    sourceTitle: '原作品',
    storefrontTitle: '商品标题',
    storefrontSummary: '卖点简介',
    storefrontDescription: '商品详情',
    storefrontMedia: [{ key: 'media-1', url: 'https://example.com/image.jpg', kind: 'image' }],
    storefrontTags: [],
    storefrontSeries: '',
    storefrontKeywords: '',
    storefrontSortOrder: 0,
    coverUrl: 'https://example.com/image.jpg',
    coverKey: 'media-1',
    asset: { assetNo: 'ASSET-1', versionNo: 1 },
    baseFrameCount: 8,
    readinessGroups: { content: [], asset: [], sale: [] },
    selected: [],
    candidates: [
      {
        id: 'sku-1',
        skuCode: 'SKU-1',
        modelName: '款式',
        size: 'S',
        material: '木质',
        frameCount: 16,
        colorName: '原木',
        basePrice: 99,
        previewImage: null,
        compatible: true,
        isActive: true,
        inventory: { status: 'ENOUGH', available: 4, current: 5, reserved: 1 }
      }
    ]
  }
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = []
  await page.route('**/api/admin/collab/work-1/product-workspace', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { success: true, data: workspace } })
      : (mutations.push({
          path: new URL(route.request().url()).pathname,
          body: route.request().postDataJSON()
        }),
        route.fulfill({ json: { success: true, data: { ready: true, blockers: [] } } }))
  )
  await page.route('**/api/admin/collab/work-1/product-history', (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  )
  await page.goto('/app/admin/collab-product/work-1')
  await expect(page.locator('.product-sku-row')).toHaveCount(1)
  await page.locator('.product-sku-row input[type=checkbox]').check()
  await page.getByRole('button', { name: '保存', exact: true }).dblclick()
  await expect.poll(() => mutations.length).toBe(1)
  expect(mutations[0]?.body.skus).toMatchObject([
    { skuId: 'sku-1', finalPrice: 99, isEnabled: true }
  ])
  expect(mutations[0]?.path).toBe('/api/admin/collab/work-1/product-workspace')
})
