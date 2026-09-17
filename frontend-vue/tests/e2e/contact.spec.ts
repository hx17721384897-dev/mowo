import { expect, test, type Page, type Request } from '@playwright/test'

const cards = [
  '画师 / IP 联名',
  '媒体 / 博主合作',
  '反馈 & 创意共建',
  '线下渠道合作',
  '厂家合作',
  '加入哞屋'
]

async function openCard(page: Page, title: string): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

async function fillFeedback(page: Page): Promise<void> {
  await openCard(page, '反馈 & 创意共建')
  await page.getByLabel('类型*').selectOption({ label: '我有一个改进建议' })
  await page.getByLabel('你的想法*').fill('希望错误提示能够更清楚，并保留重试入口。')
}

test('contact page keeps six distinct forms and restores focus after close', async ({ page }) => {
  await page.goto('/app/contact')
  await expect(page.getByRole('heading', { name: /我们很想.*认识你/ })).toBeVisible()
  await expect(page.locator('.contact-card')).toHaveCount(6)
  await expect(page.getByText('100%')).toHaveCount(0)
  await expect(page.getByText(/3 个工作日内/)).toHaveCount(0)

  for (const title of cards) {
    const card = page.getByRole('button', {
      name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    })
    await card.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(card).toBeFocused()
  }
})

test('anonymous feedback is single-submit and sends no claimed user id', async ({ page }) => {
  let requestCount = 0
  let submitted: Record<string, unknown> | null = null
  let uploadSession = ''
  let releaseResponse!: () => void
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  await page.route('**/api/contact', async (route) => {
    requestCount += 1
    const request = route.request()
    submitted = request.postDataJSON() as Record<string, unknown>
    uploadSession = request.headers()['x-upload-session'] ?? ''
    await responseGate
    await route.fulfill({ json: { success: true } })
  })

  await page.goto('/app/contact')
  await fillFeedback(page)
  const submit = page.locator('.form-submit')
  await submit.evaluate((element: HTMLButtonElement) => element.click())
  await expect(submit).toBeDisabled()
  releaseResponse()
  await expect(page.getByRole('heading', { name: '谢谢你告诉我们！' })).toBeVisible()

  expect(requestCount).toBe(1)
  expect(uploadSession).toMatch(/^[a-zA-Z0-9_-]{20,200}$/)
  expect(submitted).toMatchObject({
    type: 'feedback',
    name: '匿名用户',
    contact: '未留联系方式',
    message: '希望错误提示能够更清楚，并保留重试入口。'
  })
  expect(submitted).not.toHaveProperty('submitterUserId')
})

test('portfolio upload omits credentials and binds the returned object key', async ({ page }) => {
  const requests: Request[] = []
  let contactBody: Record<string, unknown> | null = null
  await page.route('**/api/upload/presign', async (route) => {
    requests.push(route.request())
    await route.fulfill({
      json: {
        success: true,
        data: {
          fileId: 'file-1',
          uploadUrl: 'http://127.0.0.1:4173/api/upload/local/file-1?token=test-token',
          objectKey: 'private/contact_portfolio/guest/file-1.png',
          completeUrl: 'http://127.0.0.1:4173/api/upload/files/file-1/complete',
          purpose: 'CONTACT_PORTFOLIO',
          maxBytes: 20 * 1024 * 1024
        }
      }
    })
  })
  await page.route('**/api/upload/local/file-1?token=test-token', async (route) => {
    requests.push(route.request())
    await route.fulfill({ status: 204 })
  })
  await page.route('**/api/upload/files/file-1/complete', async (route) => {
    requests.push(route.request())
    await route.fulfill({
      json: { success: true, data: { objectKey: 'private/contact_portfolio/guest/file-1.png' } }
    })
  })
  await page.route('**/api/contact', async (route) => {
    contactBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: { success: true } })
  })

  await page.goto('/app/contact')
  await openCard(page, '画师 / IP 联名')
  await page.getByLabel('你的名字 / 工作室名*').fill('测试工作室')
  await page.getByLabel('联系邮箱*').fill('artist@example.invalid')
  await page.getByLabel('IP / 作品介绍*').fill('用于验证匿名附件绑定的合成作品说明。')
  await page.locator('input[type=file]').setInputFiles({
    name: 'portfolio.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
  await page.getByRole('button', { name: '提交合作申请 →' }).click()
  await expect(page.getByRole('heading', { name: '收到了！' })).toBeVisible()

  const binaryUpload = requests.find((request) => request.method() === 'PUT')!
  expect(binaryUpload.headers()).not.toHaveProperty('authorization')
  expect(binaryUpload.headers()).not.toHaveProperty('cookie')
  expect(contactBody).toMatchObject({
    type: 'artist',
    attachments: ['private/contact_portfolio/guest/file-1.png']
  })
})

test('forbidden resume type is rejected before any upload request', async ({ page }) => {
  let uploadRequests = 0
  await page.route('**/api/upload/**', async (route) => {
    uploadRequests += 1
    await route.abort()
  })

  await page.goto('/app/contact')
  await openCard(page, '加入哞屋')
  await page.locator('input[type=file]').setInputFiles({
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('not-a-real-resume')
  })
  await expect(page.getByRole('alert')).toContainText('文件类型不符合要求')
  expect(uploadRequests).toBe(0)
})

test('non-json server failures stay inside the form and allow retry', async ({ page }) => {
  await page.route('**/api/contact', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'internal details must stay hidden'
    })
  )

  await page.goto('/app/contact')
  await fillFeedback(page)
  const submit = page.getByRole('button', { name: '提交 →' })
  await submit.click()
  await expect(page.getByRole('alert')).toHaveText('服务器返回了无法解析的数据')
  await expect(page.getByText('internal details must stay hidden')).toHaveCount(0)
  await expect(submit).toBeEnabled()
})

test('contact page and modal have no mobile horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/contact')
  await openCard(page, '厂家合作')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
})
