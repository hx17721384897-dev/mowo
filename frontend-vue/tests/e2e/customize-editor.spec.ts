import { expect, test, type Page } from '@playwright/test'

async function mockEditorModel(page: Page): Promise<void> {
  await page.route('**/api/machine-models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 'model-1',
            name: '标准款',
            description: '测试款式',
            modelType: 'single',
            previewUrl: null,
            videoUrl: null
          }
        ]
      })
    })
  )
  await page.route('**/api/machine-models/model-1/skus', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 'sku-12',
            size: '5×5cm',
            material: '椴木板',
            frameCount: 12,
            colorName: '原木色',
            colorHex: '#d4a373',
            price: 129,
            previewUrl: null
          }
        ]
      })
    })
  )
}

test.beforeEach(async ({ page }) => {
  await mockEditorModel(page)
})

test('new editor upload step preserves the legacy two-path structure', async ({ page }) => {
  await page.goto('/app/customize/editor?modelId=model-1')

  await expect(page.getByRole('heading', { name: /选择素材.*处理方式/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: '我自己筛选' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '请工作人员帮我筛选' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始筛选 →' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '提交人工处理' })).toHaveCount(0)

  await page.getByLabel('选择自己筛选的素材').setInputFiles({
    name: 'frame.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71])
  })
  await expect(page.getByRole('button', { name: '开始筛选 →' })).toBeEnabled()

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows).toBe(false)
})

test('human path uploads privately and submits an idempotent request', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'editor-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'user-1', role: 0, status: 'ACTIVE', profile: { nickname: '测试用户' } }
      })
    })
  )
  await page.route('**/api/upload/presign', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          fileId: 'file-1',
          uploadUrl: 'https://objects.example.invalid/source-1',
          objectKey: 'private/customization/source-1.png',
          completeUrl: '/api/upload/files/file-1/complete',
          purpose: 'CUSTOMIZATION_SOURCE',
          maxBytes: 1024
        }
      })
    })
  )
  await page.route('https://objects.example.invalid/source-1', async (route) => {
    expect(route.request().headers().authorization).toBeUndefined()
    expect(route.request().headers().cookie).toBeUndefined()
    await route.fulfill({ status: 200 })
  })
  await page.route('**/api/upload/files/file-1/complete', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { status: 'READY' } })
    })
  )
  let submittedBody: Record<string, unknown> | null = null
  await page.route('**/api/customization-requests', async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'request-1', requestNo: 'DZ202609180001' }
      })
    })
  })
  await page.route('**/api/customization-requests/mine**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { items: [], total: 0, page: 1, hasMore: false }
      })
    })
  )

  await page.goto('/app/customize/editor?modelId=model-1')
  await page.getByLabel('选择提交给工作人员的素材').setInputFiles({
    name: 'source.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71])
  })
  await page.getByPlaceholder(/希望保留的片段/).fill('保留中间动作')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '提交人工处理' }).click()

  await expect(page).toHaveURL(/\/app\/account\/customizations\?submitted=DZ202609180001/)
  expect(submittedBody).toMatchObject({
    mode: 'HUMAN',
    machineModelId: 'model-1',
    sourceKeys: ['private/customization/source-1.png'],
    userNote: '保留中间动作'
  })
  expect(typeof submittedBody?.clientRequestKey).toBe('string')
})

test('unsupported shared-editor modes fail closed in the Vue route', async ({ page }) => {
  await page.goto('/app/customize/editor?assetId=asset-1&modelId=model-1')
  await expect(page.getByText('该编辑模式尚未迁移')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交人工处理' })).toHaveCount(0)
})
