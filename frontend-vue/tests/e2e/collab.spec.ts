import { expect, test, type Page } from '@playwright/test'

const listData = {
  works: [
    {
      id: 'work-1',
      creatorId: 'creator-1',
      title: '十二格春日',
      description: '手绘花朵逐帧开放。',
      coverUrl: '/broken-cover.jpg',
      hoverGifUrl: null,
      approvedAt: '2026-09-01T00:00:00.000Z',
      creator: { userId: 'creator-1', nickname: '小满', avatarUrl: null },
      minPrice: 129,
      availableSkuCount: 2,
      availableSizes: ['小号', '大号'],
      minLeadTimeDays: 5,
      previewFrames: [],
      internalCost: 1
    }
  ],
  total: 1,
  page: 1,
  limit: 12,
  hasMore: false,
  sort: 'recommended',
  creators: [{ id: 'creator-1', name: '小满' }]
}

const detailData = {
  id: 'work-1',
  creatorId: 'creator-1',
  title: '十二格春日',
  description: '一朵花从种子慢慢开放。',
  storefrontSummary: '把春天转到眼前。',
  storefrontMedia: [{ url: '/broken-media.jpg', kind: 'image' }],
  storefrontTags: ['手绘'],
  storefrontSeries: '春日系列',
  animationFrames: [
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%23f5e642"/%3E%3C/svg%3E',
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%23ff6b35"/%3E%3C/svg%3E'
  ],
  hoverGifUrl: null,
  coverUrl: null,
  approvedAt: '2026-09-01T00:00:00.000Z',
  creator: { userId: 'creator-1', nickname: '小满', avatarUrl: null },
  secretContract: 'must-not-render',
  supportedSkus: [
    {
      id: 'sku-1',
      modelId: 'model-1',
      modelName: '手摇动画机',
      size: '小号',
      material: '纸艺',
      frameCount: 12,
      colorName: '原木',
      colorHex: '#ddd',
      previewImage: null,
      finalPrice: 129,
      fulfillmentMode: 'STOCK_FIRST',
      leadTimeDays: 5,
      exampleMedia: []
    },
    {
      id: 'sku-2',
      modelId: 'model-1',
      modelName: '手摇动画机',
      size: '大号',
      material: '纸艺',
      frameCount: 12,
      colorName: '深木',
      colorHex: '#333',
      previewImage: null,
      finalPrice: 169,
      fulfillmentMode: 'STOCK_ONLY',
      leadTimeDays: 2,
      exampleMedia: []
    }
  ]
}

async function mockCollab(page: Page): Promise<void> {
  await page.route('**/api/collab/works?**', (route) =>
    route.fulfill({ json: { success: true, data: listData } })
  )
  await page.route('**/api/collab/works/work-1', (route) =>
    route.fulfill({ json: { success: true, data: detailData } })
  )
  await page.route('**/api/collab/works/work-1/view', (route) =>
    route.fulfill({ json: { success: true, data: { counted: true } } })
  )
}

test('collab list, detail deep link and broken media degrade safely', async ({
  page
}, testInfo) => {
  await mockCollab(page)
  await page.goto('/app/showcase?q=春日')
  await expect(page.getByText('十二格春日', { exact: true })).toBeVisible()
  await expect(page.getByText('secretContract')).toHaveCount(0)
  await expect(page.getByText('媒体暂时无法显示')).toHaveCount(0)
  if (process.env.MOWO_CAPTURE_V1B === '1') {
    await page.screenshot({
      path: `test-results/manual-v1b-${testInfo.project.name}-list.png`,
      fullPage: true
    })
  }
  await page.locator('.work-card').click()
  await expect(page).toHaveURL(/\/app\/showcase\/work-1\?sku=sku-1$/)
  await expect(page.getByText('该素材暂时不可用')).toBeVisible()
  await page.getByRole('button', { name: '动画预览' }).click()
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.getByText('2 个核心帧 · 10 fps')).toBeHidden()
  } else {
    await expect(page.getByText('2 个核心帧 · 10 fps')).toBeVisible()
  }
  await page.getByRole('button', { name: '播放动画' }).click()
  await expect(page.getByRole('button', { name: '播放动画' })).toHaveText('暂停')
  await page.getByRole('button', { name: '加快播放' }).click()
  await expect(page.getByText('2 个核心帧 · 12 fps')).toHaveCount(1)
  await page.getByRole('button', { name: /大号/ }).click()
  await expect(page).toHaveURL(/sku=sku-2/)
  await page.reload()
  await expect(page.getByRole('button', { name: /大号/ })).toHaveClass(/selected/)
  if (process.env.MOWO_CAPTURE_V1B === '1') {
    await page.screenshot({
      path: `test-results/manual-v1b-${testInfo.project.name}-detail.png`,
      fullPage: true
    })
  }
})

test('legacy detail URL preserves work and sku', async ({ page }) => {
  await mockCollab(page)
  await page.goto('/app/showcase-detail?workId=work-1&sku=sku-2')
  await expect(page).toHaveURL(/\/app\/showcase\/work-1\?sku=sku-2$/)
  await expect(page.getByRole('button', { name: /大号/ })).toHaveClass(/selected/)
})

test('closed checkout keeps the original contact path without transaction calls', async ({
  page
}, testInfo) => {
  await mockCollab(page)
  let cartCalls = 0
  await page.route('**/api/cart/**', (route) => {
    cartCalls += 1
    return route.abort()
  })
  await page.goto('/app/showcase/work-1?sku=sku-2')
  await page.getByRole('button', { name: '增加数量' }).click()
  await expect(page.getByRole('button', { name: /大号/ })).toHaveClass(/selected/)
  await expect(page.getByLabel('购买数量')).toHaveValue('2')
  const contactAction = page.locator('.actions .cta')
  if (testInfo.project.name === 'mobile-chromium') await expect(contactAction).toBeHidden()
  else await expect(contactAction).toBeVisible()
  await expect(page.getByRole('button', { name: '立即购买' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '加入购物车' })).toHaveCount(0)
  expect(cartCalls).toBe(0)
})

test('non-json API responses show a retryable error', async ({ page }) => {
  await page.route('**/api/collab/works?**', (route) =>
    route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>bad gateway</h1>' })
  )
  await page.goto('/app/showcase')
  await expect(page.getByText('加载失败，请刷新重试')).toBeVisible()
})
