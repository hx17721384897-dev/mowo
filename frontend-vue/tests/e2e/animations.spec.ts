import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'animation-token'))
  await page.route('**/api/v1/account/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'animation-user',
          role: 0,
          staffRole: null,
          status: 'ACTIVE',
          profile: { nickname: '动画用户', avatarUrl: null }
        }
      })
    })
  })
  await page.route('**/api/animation-assets?page=1&limit=50', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: 'asset-1',
              assetNo: 'ANM-20260917-000001',
              title: '<img src=x onerror=alert(1)>正式动画',
              sourceType: 'SELF_SCREENED',
              assetType: 'PRIVATE',
              status: 'ACTIVE',
              collabStatus: 'NONE',
              currentVersionNo: 2,
              currentVersion: {
                id: 'version-2',
                versionNo: 2,
                baseFrameCount: 12,
                manifestHash: 'must-not-render',
                previewFrameUrl: 'javascript:alert(1)',
                editorData: { private: true },
                createdAt: '2026-09-17T05:00:00.000Z'
              },
              createdAt: '2026-09-16T05:00:00.000Z',
              updatedAt: '2026-09-17T05:00:00.000Z'
            }
          ],
          total: 1,
          page: 1,
          hasMore: false
        }
      })
    })
  })
  await page.route('**/api/custom-products?page=1&limit=50', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: 'draft-1',
              animationAssetId: null,
              animationFrames: '["private/secret-frame.png"]',
              draftData: '{"private":true}',
              configJson: JSON.stringify({
                animName: '临时草稿',
                modelName: '标准款',
                size: '5x5cm',
                material: '椴木板',
                colorName: '原木色',
                frameCount: 8
              }),
              frameCount: 8,
              status: 'draft',
              draftExpiresAt: '2099-09-24T05:00:00.000Z',
              previewFrameUrl: null,
              createdAt: '2026-09-15T05:00:00.000Z',
              updatedAt: '2026-09-16T05:00:00.000Z'
            },
            {
              id: 'linked-product',
              animationAssetId: 'asset-1',
              configJson: '{}',
              status: 'draft',
              createdAt: '2026-09-14T05:00:00.000Z',
              updatedAt: '2026-09-14T05:00:00.000Z'
            }
          ],
          total: 2,
          page: 1,
          hasMore: false
        }
      })
    })
  })
})

test('my animations preserves assets, drafts and safe mutations', async ({ page }) => {
  const mutations: Array<{ method: string; url: string; body: unknown }> = []
  await page.route('**/api/animation-assets/asset-1', async (route) => {
    mutations.push({
      method: route.request().method(),
      url: route.request().url(),
      body: route.request().postDataJSON()
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'asset-1' } })
    })
  })
  await page.route('**/api/custom-products/draft-1/title', async (route) => {
    mutations.push({
      method: route.request().method(),
      url: route.request().url(),
      body: route.request().postDataJSON()
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'draft-1', title: '草稿新名称' } })
    })
  })

  await page.goto('/app/account/animations')
  await expect(page.getByRole('heading', { name: '我的动画' })).toBeVisible()
  await expect(page.getByText('共 2 件')).toBeVisible()
  await expect(page.getByText(/正式动画/)).toBeVisible()
  await expect(page.getByText('临时草稿')).toBeVisible()
  await expect(page.getByText('linked-product')).toHaveCount(0)
  await expect(page.locator('.anim-card img')).toHaveCount(0)

  const assetCard = page.locator('.anim-card').filter({ hasText: 'ANM-20260917-000001' })
  await expect(assetCard.getByText('V2')).toBeVisible()
  await expect(assetCard.getByRole('link', { name: '修改动画' })).toHaveAttribute(
    'href',
    '/mowo/frontend/pages/customize-editor.html?assetId=asset-1'
  )
  await expect(assetCard.getByRole('link', { name: /选择新款式/ })).toHaveAttribute(
    'href',
    '/app/customize?assetId=asset-1'
  )

  await page.getByRole('tab', { name: '草稿' }).click()
  await expect(assetCard).toHaveCount(0)
  const draftCard = page.locator('.anim-card').filter({ hasText: '临时草稿' })
  await expect(draftCard.getByText('标准款 5x5cm 8帧 椴木板 原木色')).toHaveCount(0)
  await expect(draftCard.getByRole('link', { name: /重新编辑/ })).toHaveAttribute(
    'href',
    '/mowo/frontend/pages/customize-editor.html?editId=draft-1'
  )

  await draftCard.getByRole('button', { name: /重命名/ }).click()
  const renameDialog = page.getByRole('dialog', { name: '重命名动画' })
  await renameDialog.getByRole('textbox').fill('草稿新名称')
  await renameDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.anim-card').filter({ hasText: '草稿新名称' })).toBeVisible()
  await expect.poll(() => mutations.length).toBe(1)
  expect(mutations[0]).toMatchObject({ method: 'PATCH', body: { title: '草稿新名称' } })
  expect(mutations[0]?.body).not.toHaveProperty('configJson')

  await page.getByRole('tab', { name: '全部' }).click()
  const renamedAssetCard = page.locator('.anim-card').filter({ hasText: 'ANM-20260917-000001' })
  await renamedAssetCard.getByRole('button', { name: '删除' }).click()
  const deleteDialog = page.getByRole('dialog', { name: '删除动画' })
  await expect(deleteDialog.getByText(/将从您的动画列表移除/)).toBeVisible()
  await deleteDialog.getByRole('button', { name: '确认删除' }).click()
  await expect(renamedAssetCard).toHaveCount(0)
  await expect.poll(() => mutations.length).toBe(2)
  expect(mutations[1]).toMatchObject({ method: 'DELETE' })

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows).toBe(false)
})
