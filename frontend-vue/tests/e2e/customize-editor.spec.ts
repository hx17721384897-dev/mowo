import { expect, test, type Page } from '@playwright/test'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

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

async function mockAuthenticatedUser(page: Page): Promise<void> {
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
  await page.route('**/api/files/editor-frame-*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG })
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
    buffer: ONE_PIXEL_PNG
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
    buffer: ONE_PIXEL_PNG
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

test('image sequence enters the full editor and saves the self-screened draft', async ({
  page
}) => {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'self-token'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'user-self', role: 0, status: 'ACTIVE', profile: { nickname: '筛帧用户' } }
      })
    })
  )
  let uploadNumber = 0
  await page.route('**/api/upload/presign', (route) => {
    uploadNumber += 1
    const purpose = (route.request().postDataJSON() as { purpose: string }).purpose
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          fileId: `file-${uploadNumber}`,
          uploadUrl: `https://objects.example.invalid/upload-${uploadNumber}`,
          objectKey: `private/${purpose.toLowerCase()}/file-${uploadNumber}`,
          completeUrl: `/api/upload/files/file-${uploadNumber}/complete`,
          purpose,
          maxBytes: 5 * 1024 * 1024
        }
      })
    })
  })
  await page.route('https://objects.example.invalid/upload-*', (route) =>
    route.fulfill({ status: 200 })
  )
  await page.route('**/api/upload/files/*/complete', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { status: 'READY' } })
    })
  )
  await page.route('**/api/custom-products', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'product-1',
          animationFrames: JSON.stringify(['private/customization_frame/file-1'])
        }
      })
    })
  )
  await page.route('**/api/customization-requests/draft', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'draft-1' } })
    })
  )

  await page.goto('/app/customize/editor?modelId=model-1')
  await page
    .getByLabel('选择自己筛选的素材')
    .setInputFiles('../frontend/assets/images/faq-hero.png')
  await page.getByRole('button', { name: '开始筛选 →' }).click()
  await expect(page.getByText('动画预览')).toBeVisible()
  await expect(page.locator('.thumb-item')).toHaveCount(1)
  await page.getByRole('button', { name: '克隆此帧' }).click()
  await expect(page.locator('.thumb-item')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.thumb-item')).toHaveCount(1)
  await page.getByRole('button', { name: '下一步 →' }).click()
  await expect(page).toHaveURL(
    /\/mowo\/frontend\/pages\/customize-confirm\.html\?.*requestId=draft-1/
  )
})

test('browser-supported WebM enters the 0.5 to 8 second trim step', async ({ page }) => {
  await page.goto('/app/customize/editor?modelId=model-1')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')!
    const stream = canvas.captureStream(12)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    recorder.start(100)
    for (let index = 0; index < 15; index += 1) {
      context.fillStyle = index % 2 ? '#f0c040' : '#111110'
      context.fillRect(0, 0, 64, 64)
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    await stopped
    stream.getTracks().forEach((track) => track.stop())
    const file = new File(chunks, 'browser.webm', { type: 'video/webm' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="选择自己筛选的素材"]'
    )!
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByRole('button', { name: '开始筛选 →' }).click()
  await expect(page.getByText('裁剪视频片段')).toBeVisible()
  await expect(page.getByRole('button', { name: '提取帧 →' })).toBeEnabled()
  await expect(page.getByLabel('片段开始时间')).toHaveAttribute('max', /\d/)
  await page.getByRole('button', { name: '提取帧 →' }).click()
  await expect(page.getByText('动画预览')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.thumb-item').first()).toBeVisible()
})

test('GIF source is decoded into editable frames instead of being treated as video', async ({
  page
}) => {
  await page.goto('/app/customize/editor?modelId=model-1')
  await page.getByLabel('选择自己筛选的素材').setInputFiles({
    name: 'single-frame.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
  })
  await page.getByRole('button', { name: '开始筛选 →' }).click()
  await expect(page.getByText('动画预览')).toBeVisible()
  await expect(page.locator('.thumb-item')).toHaveCount(1)
})

test('draft idempotency key survives reload for the same source and resets for new material', async ({
  page
}) => {
  const source = '../frontend/assets/images/faq-hero.png'
  await page.goto('/app/customize/editor?modelId=model-1')
  await page.getByLabel('选择自己筛选的素材').setInputFiles(source)
  await expect(page.getByRole('button', { name: '开始筛选 →' })).toBeEnabled()
  await page.evaluate(() => sessionStorage.setItem('mowo_custom_product_draft_key', 'retry-key'))

  await page.reload()
  await page.getByLabel('选择自己筛选的素材').setInputFiles(source)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('mowo_custom_product_draft_key')))
    .toBe('retry-key')

  await page.evaluate(() => sessionStorage.setItem('mowo_custom_product_draft_key', 'stale-key'))
  await page.reload()
  await page.getByLabel('选择自己筛选的素材').setInputFiles({
    name: 'different.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG
  })
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('mowo_custom_product_draft_key')))
    .toBeNull()
})

test('private animation edit appends an immutable version in the Vue editor', async ({
  page
}, testInfo) => {
  await mockAuthenticatedUser(page)
  await page.route('**/api/animation-assets/asset-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'asset-1',
          assetNo: 'AN-001',
          title: '测试动画',
          assetType: 'PRIVATE',
          currentVersionNo: 1,
          versions: [
            {
              id: 'version-1',
              versionNo: 1,
              frames: [
                {
                  key: 'private/frame-1.png',
                  url: 'http://127.0.0.1:4173/api/files/editor-frame-1'
                },
                {
                  key: 'private/frame-2.png',
                  url: 'http://127.0.0.1:4173/api/files/editor-frame-2'
                }
              ]
            }
          ]
        }
      })
    })
  )
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/animation-assets/asset-1/versions', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { version: { versionNo: 2 } } })
    })
  })

  await page.goto('/app/customize/editor?assetId=asset-1')
  await expect(page.getByText(/正在修改 测试动画/)).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: /勾选/ }).click()
  }
  await page.getByRole('button', { name: '取消第 2 帧' }).click()
  await page.getByRole('button', { name: '保存为 V2' }).click()
  await expect(page).toHaveURL(/\/app\/account\/animations\?.*version=2/)
  expect(submitted?.frameKeys).toEqual(['private/frame-1.png'])
})

test('customer review is read-only and accepts the staff frame selection', async ({ page }) => {
  await mockAuthenticatedUser(page)
  await page.route('**/api/customization-requests/mine/request-1/frame-selection', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          request: {
            id: 'request-1',
            requestNo: 'CR-001',
            status: 'OPTIONS_READY',
            customProductId: 'draft-1'
          },
          selection: {
            version: 2,
            staffMessage: '请确认',
            frames: [
              { key: 'private/frame-1.png', url: 'http://127.0.0.1:4173/api/files/editor-frame-1' }
            ]
          },
          model: { id: 'model-1', name: '标准款', modelType: 'single', frameOptions: '[1,12]' }
        }
      })
    })
  )
  await page.route('**/api/customization-requests/mine/request-1/frame-selection/accept', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'request-1' } })
    })
  )
  await page.route('**/mowo/frontend/pages/customize-confirm.html*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>确认</title>' })
  )

  await page.goto('/app/customize/editor?reviewRequestId=request-1')
  await expect(page.getByText(/确认筛帧 · CR-001 · 第 2 版/)).toBeVisible()
  await expect(page.getByRole('button', { name: /克隆此帧/ })).toHaveCount(0)
  await expect(page.locator('.thumb-check')).toHaveCount(0)
  await page.getByRole('button', { name: '满意，选择款式 →' }).click()
  await expect(page).toHaveURL(/customize-confirm\.html\?.*humanRequestId=request-1/)
})

test('draft edit updates the original draft instead of creating a duplicate', async ({
  page
}, testInfo) => {
  await mockAuthenticatedUser(page)
  await page.route('**/api/custom-products/draft-1/editor', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { frameKeys: string[] }
      expect(body.frameKeys).toEqual(['private/frame-1.png'])
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { id: 'draft-1', requestId: 'request-draft-1', frameCount: 1 }
        })
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'draft-1',
          status: 'draft',
          frameCount: 2,
          request: { id: 'request-draft-1', status: 'DRAFT', machineModelId: 'model-1' },
          frames: [
            { key: 'private/frame-1.png', url: 'http://127.0.0.1:4173/api/files/editor-frame-1' },
            { key: 'private/frame-2.png', url: 'http://127.0.0.1:4173/api/files/editor-frame-2' }
          ]
        }
      })
    })
  })
  await page.route('**/mowo/frontend/pages/customize-confirm.html*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>确认</title>' })
  )

  await page.goto('/app/customize/editor?editId=draft-1')
  await expect(page.getByText(/更新原草稿/)).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium')
    await page.getByRole('button', { name: /勾选/ }).click()
  await page.getByRole('button', { name: '取消第 2 帧' }).click()
  await page.getByRole('button', { name: '下一步 →' }).click()
  await expect(page).toHaveURL(/customize-confirm\.html\?.*requestId=request-draft-1/)
})

test('unsupported staff shared-editor modes fail closed in the Vue route', async ({ page }) => {
  await page.goto('/app/customize/editor?adminRequestId=request-1&modelId=model-1')
  await expect(page.getByText('该编辑模式尚未迁移')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交人工处理' })).toHaveCount(0)
})
