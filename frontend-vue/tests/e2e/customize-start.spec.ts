import { expect, test, type Page } from '@playwright/test'

const models = [
  {
    id: 'model-1',
    name: '<img src=x onerror=alert(1)>标准款',
    description: '手摇播放，适合桌面摆放',
    modelType: 'single',
    previewUrl: 'javascript:alert(1)',
    videoUrl: null
  },
  {
    id: 'model-2',
    name: '八帧款',
    description: '紧凑款式',
    modelType: 'single',
    previewUrl: null,
    videoUrl: null
  }
]

const skus = {
  'model-1': [
    {
      id: 'sku-12',
      size: '5×5cm',
      material: '椴木板',
      frameCount: 12,
      colorName: '原木色',
      colorHex: '#d4a373',
      price: 129,
      previewUrl: null
    },
    {
      id: 'sku-24',
      size: '7×7cm',
      material: '亚克力',
      frameCount: 24,
      colorName: '黑色',
      colorHex: 'url(javascript:alert(1))',
      price: 199,
      previewUrl: null
    }
  ],
  'model-2': [
    {
      id: 'sku-8',
      size: '5×5cm',
      material: '椴木板',
      frameCount: 8,
      colorName: '原木色',
      colorHex: '#d4a373',
      price: 99,
      previewUrl: null
    }
  ]
}

async function mockCatalog(page: Page): Promise<void> {
  await page.route('**/api/machine-models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: models })
    })
  )
  for (const [modelId, modelSkus] of Object.entries(skus)) {
    await page.route(`**/api/machine-models/${modelId}/skus`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: modelSkus })
      })
    )
  }
  await page.route('**/api/machine-models/model-1/sku-sales', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { 'sku-24': 9, 'sku-12': 2 } })
    })
  )
}

test.beforeEach(async ({ page }) => {
  await mockCatalog(page)
})

test('customize entry preserves selection, dialogs and browser safety', async ({ page }) => {
  await page.goto('/app/customize')

  await expect(page.getByRole('heading', { name: '选择你的动盒款式' })).toBeVisible()
  const unsafeModel = page.locator('.model-card').filter({ hasText: '标准款' })
  await expect(unsafeModel).toBeVisible()
  await expect(unsafeModel.locator('img')).toHaveCount(0)
  await expect(unsafeModel.locator('.model-card-name')).toHaveText(
    '<img src=x onerror=alert(1)>标准款'
  )

  await unsafeModel.getByRole('button', { name: '选择此款' }).click()
  await expect(page.locator('#bottomBar')).toHaveClass(/visible/)
  const saved = await page.evaluate(() => localStorage.getItem('mowo_customize_meta'))
  expect(JSON.parse(saved || '{}')).toMatchObject({
    modelId: 'model-1',
    name: '<img src=x onerror=alert(1)>标准款',
    frames: [12, 24],
    modelType: 'single'
  })

  await unsafeModel.getByRole('button', { name: '查看玩法' }).click()
  const gameplay = page.getByRole('dialog', { name: /标准款玩法/ })
  await expect(gameplay).toBeVisible()
  await gameplay.getByRole('button', { name: /查看规格价格/ }).click()
  const details = page.getByRole('dialog', { name: /标准款规格与价格/ })
  await expect(details).toBeVisible()
  await expect(details.locator('.sku-card')).toHaveCount(2)
  await details.getByRole('button', { name: '24帧' }).click()
  await expect(details.locator('.sku-card')).toHaveCount(1)
  await expect(details.locator('.sku-color-dot')).toHaveAttribute(
    'style',
    /#c4c3bf|rgb\(196, 195, 191\)/
  )

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows).toBe(false)
})

test('new customization uses the Vue editor as its only formal handoff', async ({ page }) => {
  await page.goto('/app/customize')
  await page.getByRole('button', { name: '选择此款' }).first().click()
  await page.locator('#nextBtn').click()
  await expect(page).toHaveURL(/\/app\/customize\/editor\?modelId=model-1$/)
  await expect(page.getByRole('heading', { name: /选择素材.*处理方式/ })).toBeVisible()
})

test('reuse deep link requires a session and only shows frame-compatible models', async ({
  page
}) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'reuse-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'user-1',
          role: 0,
          status: 'ACTIVE',
          profile: { nickname: '复用用户', avatarUrl: null }
        }
      })
    })
  )
  await page.route('**/api/animation-assets/asset-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'asset-1',
          assetNo: 'ANM-20260917-000001',
          title: '六帧动画',
          currentVersionNo: 2,
          versions: [{ versionNo: 2, baseFrameCount: 6 }]
        }
      })
    })
  )

  await page.goto('/app/customize?assetId=asset-1')
  await expect(page.locator('#reuseBanner.show')).toContainText('六帧动画')
  await expect(page.locator('.model-card')).toHaveCount(1)
  await expect(page.getByText('八帧款')).toHaveCount(0)
  await page.getByRole('button', { name: '选择此款' }).click()
  await page.locator('#nextBtn').click()
  await expect(page).toHaveURL(
    /\/mowo\/frontend\/pages\/customize-confirm\.html\?.*assetId=asset-1.*modelId=model-1.*frames=6.*targets=12%2C24/
  )
})

test('draft quota blocks editor handoff without losing the selected model', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'quota-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'user-2', role: 0, status: 'ACTIVE', profile: { nickname: '配额用户' } }
      })
    })
  )
  await page.route('**/api/custom-products/quota', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { count: 10, limit: 10, canCreate: false } })
    })
  )

  await page.goto('/app/customize')
  await page.getByRole('button', { name: '选择此款' }).first().click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#nextBtn').click()
  await expect(page).toHaveURL(/\/app\/customize$/)
  await expect(page.locator('#bottomBar')).toHaveClass(/visible/)
})
