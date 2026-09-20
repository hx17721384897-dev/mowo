import { expect, test, type Page } from '@playwright/test'

async function mockUser(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'confirm-token'))
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
          profile: { nickname: '确认用户' }
        }
      })
    })
  )
}

async function mockConfirmation(page: Page): Promise<void> {
  await mockUser(page)
  await page.route('**/api/customization-requests/mine/request-1/confirmation', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          request: {
            id: 'request-1',
            mode: 'SELF',
            status: 'DRAFT',
            customProductId: 'product-1',
            desiredSkuId: null
          },
          model: { id: 'model-1', name: '<img src=x onerror=alert(1)>标准款', modelType: 'single' },
          baseFrameCount: 6,
          validTargets: [12, 24]
        }
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
            price: 129
          },
          {
            id: 'sku-24',
            size: '7×7cm',
            material: '亚克力',
            frameCount: 24,
            colorName: '黑色',
            colorHex: '#111111',
            price: 199
          }
        ]
      })
    })
  )
}

async function chooseOnlyVariant(page: Page): Promise<void> {
  await page.getByRole('button', { name: /12 帧/ }).click()
  await page.getByRole('button', { name: '5×5cm' }).click()
  await page.getByRole('button', { name: '椴木板' }).click()
  await page.getByRole('button', { name: '原木色' }).click()
}

test('self confirmation preserves legacy selection and idempotent checkout handoff', async ({
  page
}) => {
  await mockConfirmation(page)
  let submitBody: Record<string, unknown> | null = null
  const cartBodies: Record<string, unknown>[] = []
  await page.route('**/api/customization-requests/request-1/submit', async (route) => {
    submitBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'request-1', status: 'CONFIRMED' } })
    })
  })
  await page.route('**/api/cart/add', async (route) => {
    cartBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'cart-1' } })
    })
  })
  await page.route('**/mowo/frontend/pages/checkout.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>checkout</title>' })
  )

  await page.goto('/app/customize/confirm?requestId=request-1')
  await expect(page.locator('.price-card-machine')).toHaveText('<img src=x onerror=alert(1)>标准款')
  await expect(page.locator('.price-card-machine img')).toHaveCount(0)
  await chooseOnlyVariant(page)
  await page.getByRole('button', { name: '+ 加入已选' }).click()
  await expect(page.locator('.added-item')).toHaveCount(1)
  await page.getByPlaceholder('订单备注（选填）').fill('请仔细包装')
  await page.getByRole('button', { name: '提交订单 →' }).click()
  await page.waitForURL(/checkout\.html/)

  expect(submitBody).toMatchObject({ desiredSkuId: 'sku-12', userNote: '请仔细包装' })
  expect(cartBodies).toHaveLength(1)
  expect(cartBodies[0]).toMatchObject({
    itemType: 'CUSTOM',
    contentId: 'product-1',
    hardwareSkuId: 'sku-12',
    quantity: 1
  })
  expect(String(cartBodies[0]?.idempotencyKey)).toMatch(/^confirm-cart-/)
})

test('human confirmation uses accepted request instead of route metadata', async ({ page }) => {
  await mockConfirmation(page)
  await page.route('**/api/customization-requests/mine/human-1/confirmation', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          request: {
            id: 'human-1',
            mode: 'HUMAN',
            status: 'FRAME_ACCEPTED',
            customProductId: 'human-product'
          },
          model: { id: 'model-1', name: '服务端标准款', modelType: 'single' },
          baseFrameCount: 6,
          validTargets: [12]
        }
      })
    })
  )
  let chooseBody: Record<string, unknown> | null = null
  await page.route('**/api/customization-requests/mine/human-1/choose-sku', async (route) => {
    chooseBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'human-1' } })
    })
  })
  await page.route('**/api/cart/add', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'human-cart' } })
    })
  )
  await page.route('**/mowo/frontend/pages/checkout.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: 'checkout' })
  )
  await page.goto('/app/customize/confirm?humanRequestId=human-1&modelName=伪造款式&frames=999')
  await expect(page.locator('.price-card-machine')).toHaveText('服务端标准款')
  await chooseOnlyVariant(page)
  await page.getByRole('button', { name: '提交订单 →' }).click()
  await page.waitForURL(/checkout\.html/)
  expect(chooseBody).toMatchObject({ desiredSkuId: 'sku-12' })
})

test('animation reuse pins the current private version and stable request key', async ({
  page
}) => {
  await mockUser(page)
  await page.route('**/api/animation-assets/asset-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'asset-1',
          assetType: 'PRIVATE',
          currentVersionNo: 2,
          versions: [{ id: 'version-2', versionNo: 2, baseFrameCount: 6 }]
        }
      })
    })
  )
  await page.route('**/api/machine-models/model-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'model-1', name: '复购标准款', modelType: 'single' }
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
            price: 129
          }
        ]
      })
    })
  )
  let reuseBody: Record<string, unknown> | null = null
  await page.route('**/api/animation-assets/asset-1/reuse', async (route) => {
    reuseBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { customProductId: 'asset-product' } })
    })
  })
  await page.route('**/api/cart/add', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'asset-cart' } })
    })
  )
  await page.route('**/mowo/frontend/pages/checkout.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: 'checkout' })
  )
  await page.goto('/app/customize/confirm?assetId=asset-1&modelId=model-1&frames=999')
  await chooseOnlyVariant(page)
  await page.getByRole('button', { name: '提交订单 →' }).click()
  await page.waitForURL(/checkout\.html/)
  expect(reuseBody).toMatchObject({ machineModelId: 'model-1', desiredSkuId: 'sku-12' })
  expect(String(reuseBody?.clientRequestKey)).toMatch(/^confirm-/)
})

test('confirmation fails closed for mixed modes and has no horizontal overflow', async ({
  page
}) => {
  await mockConfirmation(page)
  await page.goto('/app/customize/confirm?requestId=request-1&assetId=asset-1&modelId=model-1')
  await expect(page.getByText('确认页入口参数无效，请从定制流程重新进入')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true)
})
