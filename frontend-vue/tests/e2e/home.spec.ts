import { expect, test, type Page } from '@playwright/test'

const works = Array.from({ length: 4 }, (_, index) => ({
  id: `home-work-${index + 1}`,
  creatorId: `creator-${index + 1}`,
  title: `正式联名作品 ${index + 1}`,
  description: '',
  coverUrl: index === 0 ? '/broken-home-cover.png' : null,
  hoverGifUrl: null,
  approvedAt: '2026-09-01T00:00:00.000Z',
  creator: { userId: `creator-${index + 1}`, nickname: `创作者 ${index + 1}`, avatarUrl: null },
  minPrice: null,
  availableSkuCount: 1,
  availableSizes: ['标准款'],
  minLeadTimeDays: null,
  previewFrames: []
}))

async function mockHomeWorks(page: Page, rows: typeof works): Promise<void> {
  await page.route('**/api/collab/works?**', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          works: rows,
          total: rows.length,
          page: 1,
          limit: 4,
          hasMore: false,
          sort: 'recommended',
          creators: []
        }
      }
    })
  )
}

test('home keeps the legacy visual structure with verified storefront data', async ({ page }) => {
  await mockHomeWorks(page, works)
  await page.goto('/app/')

  await expect(page.locator('.style-card')).toHaveCount(4)
  await expect(page.locator('.creative-card')).toHaveCount(4)
  await expect(page.getByText('正式联名作品 1')).toBeVisible()
  await expect(page.locator('.creative-placeholder').first()).toBeVisible()
  await expect(page.getByText('真实用户反馈')).toHaveCount(0)
  await expect(page.getByText('全球配送')).toHaveCount(0)
  await expect(page.getByText('7 天无理由退换')).toHaveCount(0)
})

test('home shows a neutral empty state instead of invented works', async ({ page }) => {
  await mockHomeWorks(page, [])
  await page.goto('/app/')

  await expect(page.locator('.creative-card')).toHaveCount(0)
  await expect(page.getByText('联名作品正在准备中，稍后再来看看。')).toBeVisible()
})
