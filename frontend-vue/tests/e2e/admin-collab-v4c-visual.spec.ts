import { expect, test, type Page } from '@playwright/test'

async function prepare(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'visual-owner'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          id: 'staff-1',
          staffRole: 'OWNER',
          role: 3,
          status: 'ACTIVE',
          profile: { nickname: '负责人' }
        }
      }
    })
  )
  const work = {
    id: 'work-1',
    title: '测试联名作品',
    status: 'approved',
    shelfStatus: 'on_sale',
    createdAt: '2026-09-01T00:00:00Z',
    approvedAt: '2026-09-02T00:00:00Z',
    creator: { nickname: '合作方' },
    sizes: ['S'],
    saleConfigCount: 1,
    saleReadiness: { ready: true, blockers: [] },
    saleSkus: [{ id: 'sale-1' }],
    animationFrames: []
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
    route.fulfill({ json: { success: true, data: [] } })
  )
  const contract = {
    id: 'contract-1',
    creatorName: '测试合作方',
    contractType: 'buyout',
    status: 'active',
    revenueRate: null,
    guaranteeAmount: null,
    buyoutAmount: 100,
    startAt: '2026-09-01T00:00:00Z',
    endAt: null,
    terms: '',
    note: '',
    settlementLogs: [],
    totalPaid: 0,
    createdBy: '负责人'
  }
  await page.route('**/api/admin/contracts?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { contracts: [contract], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }
      }
    })
  )
  await page.route('**/api/admin/contracts/contract-1', (route) =>
    route.fulfill({ json: { success: true, data: contract } })
  )
  const product = {
    productNo: 'P-1',
    reviewStatus: 'approved',
    shelfStatus: 'off_shelf',
    isOnShelf: false,
    sourceTitle: '测试联名作品',
    storefrontTitle: '测试商品',
    storefrontSummary: '卖点简介',
    storefrontDescription: '商品详情',
    storefrontMedia: [],
    storefrontTags: [],
    storefrontSeries: '',
    storefrontKeywords: '',
    storefrontSortOrder: 0,
    coverUrl: null,
    coverKey: '',
    asset: { assetNo: 'ASSET-1', versionNo: 1 },
    baseFrameCount: 8,
    readinessGroups: { content: [], asset: [], sale: [] },
    selected: [],
    candidates: []
  }
  await page.route('**/api/admin/collab/work-1/product-workspace', (route) =>
    route.fulfill({ json: { success: true, data: product } })
  )
  await page.route('**/api/admin/collab/work-1/product-history', (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  )
}

async function compare(
  page: Page,
  oldUrl: string,
  newUrl: string,
  oldSelectors: string[],
  newSelectors: string[]
): Promise<void> {
  await page.goto(oldUrl)
  await expect(page.locator(oldSelectors.at(-1)!).first()).toBeVisible()
  const oldBoxes = await Promise.all(
    oldSelectors.map((selector) => page.locator(selector).first().boundingBox())
  )
  await page.goto(newUrl)
  await expect(page.locator(newSelectors.at(-1)!).first()).toBeVisible()
  const newBoxes = await Promise.all(
    newSelectors.map((selector) => page.locator(selector).first().boundingBox())
  )
  for (let index = 0; index < oldBoxes.length; index++) {
    expect(oldBoxes[index], `old ${oldSelectors[index]}`).not.toBeNull()
    expect(newBoxes[index], `new ${newSelectors[index]}`).not.toBeNull()
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(oldBoxes[index]![key] - newBoxes[index]![key]),
        `${oldSelectors[index]} ${key} old=${oldBoxes[index]![key]} new=${newBoxes[index]![key]}`
      ).toBeLessThanOrEqual(5)
    }
  }
}

test('works candidate keeps legacy content geometry', async ({ page }) => {
  await prepare(page)
  await compare(
    page,
    'http://127.0.0.1:5500/mowo/frontend/pages/admin-collab-works.html',
    '/app/admin/collab-works',
    ['.topbar', '.stats-grid', '.search-bar', '.works-grid', '.work-card'],
    ['.review-topbar', '.works-stats', '.works-search', '.works-grid', '.works-card']
  )
})
test('contracts candidate keeps legacy content geometry', async ({ page }) => {
  await prepare(page)
  await compare(
    page,
    'http://127.0.0.1:5500/mowo/frontend/pages/admin-contract.html',
    '/app/admin/contracts',
    ['.topbar', '.toolbar', '.contract-card'],
    ['.review-topbar', '.contracts-toolbar', '.contracts-card']
  )
})
test('product candidate keeps legacy content geometry', async ({ page }) => {
  await prepare(page)
  await compare(
    page,
    'http://127.0.0.1:5500/mowo/frontend/pages/admin-collab-product-edit.html?id=work-1',
    '/app/admin/collab-product/work-1',
    ['.topbar', '.content', '.layout', '.section', '.side-section'],
    [
      '.product-topbar',
      '.product-content',
      '.product-layout',
      '.product-section',
      '.product-side-section'
    ]
  )
})
