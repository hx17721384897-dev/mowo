import { expect, test, type Page, type Route } from '@playwright/test'

type Mutation = { method: string; path: string; body: unknown }

async function staff(page: Page, role = 'OWNER'): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'v4d-catalog-test'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-1', staffRole: role, status: 'ACTIVE', profile: { nickname: '员工' } }
      }
    })
  )
}

function ok(route: Route, data: unknown = {}): Promise<void> {
  return route.fulfill({ json: { success: true, data } })
}

test('catalog candidate loads without writes and preserves core model, SKU, order and BOM controls', async ({
  page
}) => {
  await staff(page)
  const mutations: Mutation[] = []
  const models = [
    {
      id: 'model-1',
      name: '<img src=x onerror=alert(1)>',
      description: '测试款式',
      previewImage: 'javascript:alert(1)',
      videoUrl: 'https://example.test/model.mp4',
      isActive: true,
      modelType: 'single',
      sortOrder: 0
    },
    {
      id: 'model-2',
      name: '第二款',
      description: '用于排序',
      previewImage: null,
      videoUrl: null,
      isActive: false,
      modelType: 'dual',
      sortOrder: 1
    }
  ]
  const skus = new Map<string, Array<Record<string, unknown>>>([
    [
      'model-1',
      [
        {
          id: 'sku-1',
          modelId: 'model-1',
          size: '5x5cm',
          material: '椴木板',
          frameCount: 12,
          colorName: '原色',
          colorHex: '#D4B896',
          previewImage: null,
          price: 199,
          isActive: true,
          sortOrder: 0,
          exampleMedia: JSON.stringify(['catalog/example-1.png'])
        }
      ]
    ],
    ['model-2', []]
  ])

  await page.route(/\/api\/machine-models(?:\/|$|\?)/, async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    if (method !== 'GET') {
      mutations.push({ method, path, body: request.postDataJSON() })
    }
    if (method === 'GET' && path === '/api/machine-models/admin/all') return ok(route, models)
    const skuList = path.match(/^\/api\/machine-models\/admin\/([^/]+)\/skus$/)
    if (method === 'GET' && skuList) return ok(route, skus.get(skuList[1]!) || [])
    if (method === 'PUT' && path === '/api/machine-models/reorder') return ok(route)
    if (method === 'PUT' && path === '/api/machine-models/model-1/skus/reorder') return ok(route)
    if (method === 'PUT' && path === '/api/machine-models/skus/sku-1/price') return ok(route)
    if (method === 'PUT' && path === '/api/machine-models/skus/sku-1') return ok(route)
    if (method === 'PUT' && path === '/api/machine-models/model-1') return ok(route)
    if (method === 'GET' && path === '/api/machine-models/skus/sku-1/example-media-url') {
      return ok(route, { url: 'javascript:alert(2)' })
    }
    if (method === 'GET' && path === '/api/machine-models/skus/sku-1/bom') {
      return ok(route, {
        skuId: 'sku-1',
        version: 1,
        items: [{ materialId: 'material-1', qtyPerUnit: 2 }]
      })
    }
    if (method === 'PUT' && path === '/api/machine-models/skus/sku-1/bom') return ok(route)
    return route.fulfill({ status: 404, json: { success: false, error: 'unexpected mock route' } })
  })
  await page.route('**/api/inventory', (route) =>
    ok(route, [{ skuId: 'sku-1', currentStock: 10, reservedStock: 3, isOut: false, isLow: false }])
  )
  await page.route('**/api/materials', (route) =>
    ok(route, [
      {
        id: 'material-1',
        name: '木片',
        itemCode: 'WOOD-1',
        specification: '标准',
        itemType: 'component',
        currentStock: 50,
        unit: '片'
      }
    ])
  )

  await page.goto('/app/admin/models')
  await expect(page.locator('.catalog-card')).toHaveCount(2)
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  await expect(page.locator('.catalog-preview img')).toHaveCount(0)
  expect(mutations).toEqual([])

  await page.locator('.catalog-card').first().getByRole('button', { name: '展开规格' }).click()
  await expect(page.locator('.catalog-sku-row')).toContainText('椴木板')
  await expect(page.locator('.catalog-stock')).toHaveText('7')

  await page.locator('.catalog-price-cell').click()
  await page.locator('.catalog-price-edit input').fill('208')
  await page.locator('.catalog-price-edit button').first().click()
  await expect.poll(() => mutations.filter((item) => item.path.endsWith('/price')).length).toBe(1)
  await expect(page.locator('.catalog-price-cell')).toContainText('208')

  await page.getByRole('button', { name: '↕ 调整款式顺序' }).click()
  await page.locator('.catalog-sort-item').nth(1).getByRole('button', { name: '▲' }).click()
  await page.getByRole('button', { name: '保存顺序' }).click()
  await expect.poll(() => mutations.filter((item) => item.path.endsWith('/reorder')).length).toBe(1)
  expect(mutations.find((item) => item.path.endsWith('/reorder'))?.body).toEqual({
    modelIds: ['model-2', 'model-1']
  })

  await page.locator('.catalog-card').first().getByRole('button', { name: '示例图' }).click()
  await expect(page.getByText('预览失效')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()

  await page.locator('.catalog-card').first().getByRole('button', { name: '材料清单' }).click()
  await expect(page.locator('.catalog-material-list')).toContainText('木片')
  await page.getByRole('button', { name: '保存材料清单' }).click()
  await expect.poll(() => mutations.filter((item) => item.path.endsWith('/bom')).length).toBe(1)
  expect(mutations.find((item) => item.path.endsWith('/bom'))?.body).toEqual({
    items: [{ materialId: 'material-1', qtyPerUnit: 2 }]
  })

  expect(
    await page.evaluate(() => (window as Window & { __catalogXss?: number }).__catalogXss)
  ).toBeUndefined()
})

test('catalog candidate rejects staff outside the server-aligned role boundary', async ({
  page
}) => {
  await staff(page, 'PRODUCTION')
  await page.goto('/app/admin/models')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
})

test('legacy and candidate keep the same primary layout geometry', async ({ page }) => {
  await staff(page)
  const model = {
    id: 'model-geometry',
    name: '几何对照款',
    description: '布局对照',
    previewImage: null,
    videoUrl: null,
    isActive: true,
    modelType: 'single',
    sortOrder: 0
  }
  await page.route('**/api/machine-models/admin/all', (route) => ok(route, [model]))
  await page.route('**/api/machine-models/admin/model-geometry/skus', (route) => ok(route, []))
  await page.route('**/api/inventory', (route) => ok(route, []))

  await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-models.html')
  await expect(page.locator('.model-card')).toHaveCount(1)
  const legacy = {
    topbar: await page.locator('.topbar').boundingBox(),
    content: await page.locator('.content').boundingBox(),
    card: await page.locator('.model-card').boundingBox()
  }

  await page.goto('http://127.0.0.1:4173/app/admin/models')
  await expect(page.locator('.catalog-card')).toHaveCount(1)
  const candidate = {
    topbar: await page.locator('.catalog-topbar').boundingBox(),
    content: await page.locator('.catalog-content').boundingBox(),
    card: await page.locator('.catalog-card').boundingBox()
  }
  const isMobile = (page.viewportSize()?.width || 0) <= 680

  if (isMobile) {
    const viewportWidth = page.viewportSize()!.width
    expect(legacy.content!.width).toBeGreaterThan(viewportWidth)
    expect(candidate.topbar!.width).toBeLessThanOrEqual(viewportWidth)
    expect(candidate.content!.width).toBeLessThanOrEqual(viewportWidth)
    expect(candidate.card!.x).toBeGreaterThanOrEqual(0)
    expect(candidate.card!.x + candidate.card!.width).toBeLessThanOrEqual(viewportWidth)
    return
  }

  for (const key of ['topbar', 'content', 'card'] as const) {
    expect(legacy[key]).not.toBeNull()
    expect(candidate[key]).not.toBeNull()
    for (const dimension of ['x', 'y', 'width'] as const) {
      expect(
        Math.abs(legacy[key]![dimension] - candidate[key]![dimension]),
        `${key}.${dimension}: legacy=${legacy[key]![dimension]}, candidate=${candidate[key]![dimension]}`
      ).toBeLessThanOrEqual(6)
    }
  }
})
