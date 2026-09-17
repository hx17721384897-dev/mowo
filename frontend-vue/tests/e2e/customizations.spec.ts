import { expect, test } from '@playwright/test'

const baseRequest = {
  mode: 'HUMAN',
  version: 2,
  model: { id: 'model-1', name: '标准款', previewImage: null },
  desiredSku: { id: 'sku-1', size: '5x5cm', material: '椴木板', frameCount: 12 }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'customization-token'))
  await page.route('**/api/v1/account/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'customization-user',
          role: 0,
          staffRole: null,
          status: 'ACTIVE',
          profile: { nickname: '定制用户', avatarUrl: null }
        }
      })
    })
  })
  await page.route('**/api/customization-requests/mine?limit=50', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [
            {
              ...baseRequest,
              id: 'request-action',
              requestNo: 'CR20260917001',
              status: 'OPTIONS_READY',
              updatedAt: '2026-09-17T06:00:00.000Z'
            },
            {
              ...baseRequest,
              id: 'request-draft',
              requestNo: null,
              mode: 'SELF',
              status: 'DRAFT',
              desiredSku: null,
              updatedAt: '2026-09-16T06:00:00.000Z'
            }
          ],
          total: 2,
          page: 1,
          hasMore: false
        }
      })
    })
  })
  await page.route('**/api/customization-requests/mine/request-action', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          ...baseRequest,
          id: 'request-action',
          requestNo: 'CR20260917001',
          status: 'OPTIONS_READY',
          updatedAt: '2026-09-17T06:00:00.000Z',
          events: [
            {
              id: 'event-1',
              eventType: 'FRAME_SELECTION_SUBMITTED',
              toStatus: 'OPTIONS_READY',
              publicMessage: '<img src=x onerror=alert(1)>工作人员已提交筛帧结果',
              createdAt: '2026-09-17T06:00:00.000Z'
            }
          ]
        }
      })
    })
  })
})

test('my customizations preserves filters, timeline and editor handoff', async ({ page }) => {
  await page.goto('/app/account/customizations?submitted=CR20260917001')

  await expect(page.getByRole('heading', { name: '我的定制' })).toBeVisible()
  await expect(page.getByText('定制需求 CR20260917001 已提交')).toBeVisible()
  await expect(page.getByText('CR20260917001', { exact: true })).toBeVisible()
  await expect(page.getByText('未提交草稿')).toBeVisible()

  await page.getByRole('tab', { name: '待我确认' }).click()
  await expect(page.getByText('CR20260917001', { exact: true })).toBeVisible()
  await expect(page.getByText('未提交草稿')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '确认筛帧' })).toHaveAttribute(
    'href',
    '/mowo/frontend/pages/customize-editor.html?reviewRequestId=request-action'
  )

  await page.getByRole('button', { name: '查看' }).click()
  const dialog = page.getByRole('dialog', { name: 'CR20260917001' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.locator('.detail-grid .value').filter({ hasText: '待确认筛帧' })
  ).toBeVisible()
  await expect(dialog.getByText(/工作人员已提交筛帧结果/)).toBeVisible()
  await expect(dialog.locator('img')).toHaveCount(0)
  await dialog.getByRole('button', { name: '关闭定制详情' }).click()
  await expect(dialog).not.toBeVisible()

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows).toBe(false)
})
