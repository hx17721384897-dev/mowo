import { expect, test } from '@playwright/test'

test('public V1a pages have one working navigation shell', async ({ page }) => {
  await page.goto('/app/')
  await expect(page.getByRole('heading', { name: /转动手柄/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '开始制作' })).toHaveAttribute(
    'href',
    '/app/customize'
  )
  await expect(page.getByRole('link', { name: '查看商品' })).toHaveAttribute(
    'href',
    '/app/showcase'
  )

  await page.getByRole('link', { name: '产品介绍' }).last().click()
  await expect(page).toHaveURL(/\/app\/products$/)
  await expect(page.getByRole('heading', { name: /哞屋.*动画机/ })).toBeVisible()

  await page.goto('/app/about')
  await expect(page.getByRole('heading', { name: /让每一帧热爱/ })).toBeVisible()

  await page.goto('/app/faq')
  await expect(page.getByRole('heading', { name: '常见问题' })).toBeVisible()
})

test('shared public navigation stays geometrically stable across routes', async ({
  page
}, testInfo) => {
  await page.goto('/app/')
  const isMobile = testInfo.project.name === 'mobile-chromium'
  const nav = page.getByRole('navigation', { name: '主导航' })
  const stableControl = isMobile
    ? page.getByRole('button', { name: '打开或关闭导航' })
    : nav.getByRole('link', { name: '关于我们' })
  const homeBox = await nav.boundingBox()
  const homeControlBox = await stableControl.boundingBox()

  await page.evaluate(() => window.scrollTo(0, 900))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  if (isMobile) {
    await stableControl.click()
    await page.locator('#mowo-mobile-menu').getByRole('link', { name: '关于我们' }).click()
  } else {
    await stableControl.click()
  }
  await expect(page).toHaveURL(/\/app\/about$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  expect(await nav.boundingBox()).toEqual(homeBox)
  expect(await stableControl.boundingBox()).toEqual(homeControlBox)
  if (!isMobile) await expect(stableControl).toHaveCSS('font-weight', '700')
})

test('FAQ search reports current payment boundaries', async ({ page }) => {
  await page.goto('/app/faq')
  await page.getByRole('searchbox', { name: '搜索问题' }).fill('支付')
  await expect(page.getByText('找到 1 个问题')).toBeVisible()
  await page.getByText('网页现在可以直接付款吗？').click()
  await expect(page.getByText(/在线支付保持关闭/)).toBeVisible()
  await expect(page.getByText(/7 天无理由/)).toHaveCount(0)
})

test('legal drafts remain visibly non-production', async ({ page }) => {
  await page.goto('/app/legal/privacy')
  await expect(page.getByRole('heading', { name: '哞屋隐私政策' })).toBeVisible()
  await expect(page.getByText('测试草案，不是正式上线法律文本')).toBeVisible()

  await page.goto('/app/legal/terms')
  await expect(page.getByRole('heading', { name: '哞屋用户协议' })).toBeVisible()
  await expect(page.getByText(/当前网页不提供真实在线付款/)).toBeVisible()
})

test('public authentication dialog mounts once and keeps legal links isolated', async ({
  page
}) => {
  await page.goto('/app/')
  await page.getByRole('button', { name: '登录 / 个人中心' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(1)
  await page.getByRole('tab', { name: '注册', exact: true }).click()
  await expect(dialog.getByRole('link', { name: '用户协议' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  )
  await expect(dialog.getByRole('link', { name: '隐私政策' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  )
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('successful login restores the legacy avatar and account dropdown', async ({ page }) => {
  await page.route('**/api/v1/auth/sms/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          accessToken: 'signed-in-token',
          user: {
            id: 'signed-in-user',
            role: 0,
            staffRole: null,
            profile: { nickname: '小哞', avatarUrl: null }
          }
        }
      })
    })
  })

  await page.goto('/app/')
  const mobileMenu = page.getByRole('button', { name: '打开或关闭导航' })
  if (await mobileMenu.isVisible()) {
    await mobileMenu.click()
    await page.locator('#mobileLoginBtn').click()
  } else {
    await page.getByRole('button', { name: '登录 / 个人中心' }).click()
  }
  await page.getByRole('textbox', { name: '手机号' }).fill('13800138003')
  await page.getByRole('textbox', { name: '验证码' }).fill('123456')
  await page.locator('.auth-submit-btn').click()

  if (await mobileMenu.isVisible()) {
    await mobileMenu.click()
    await expect(page.locator('.mowo-mobile-avatar-name')).toHaveText('小哞')
  } else {
    const avatarButton = page.getByRole('button', { name: '打开个人中心菜单' })
    await expect(avatarButton).toBeVisible()
    await avatarButton.click()
    const dropdown = page.locator('#mowo-user-dropdown')
    await expect(dropdown).toHaveClass(/open/)
    await expect(dropdown.getByText('小哞')).toBeVisible()
    await expect(dropdown.getByRole('link', { name: /账号设置/ })).toHaveAttribute(
      'href',
      '/app/account/settings'
    )
  }
})

test('mobile public navigation is usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/')
  await page.getByRole('button', { name: '打开或关闭导航' }).click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await page.getByRole('link', { name: '动盒系列' }).first().click()
  await expect(page).toHaveURL(/\/app\/products$/)
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows).toBe(false)
})

test('protected account and admin areas request login while production shell still renders', async ({
  page
}) => {
  await page.goto('/app/account')
  await expect(page).toHaveURL(/\/app\/?\?.*auth=1/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('哞屋 MOWO')).toBeVisible()
  await expect(page.getByPlaceholder('请输入手机号')).toBeVisible()
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await page.goto('/app/admin')
  await expect(page).toHaveURL(/\/app\/\?.*auth=1/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goto('/app/production')
  await expect(page.getByText('生产区域占位')).toBeVisible()
  await page.goto('/app/does-not-exist')
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  const menuButton = page.getByRole('button', { name: '打开或关闭导航' })
  if (await menuButton.isVisible()) await menuButton.click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
})

test('trusted account calibration permits the protected route', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('mowo_token', 'test-access-token')
    localStorage.setItem('mowo_user', JSON.stringify({ id: 'stale-user', nickname: '旧缓存' }))
  })
  await page.route('**/api/v1/account/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'trusted-user',
          maskedPhone: '138****0000',
          role: 0,
          staffRole: null,
          status: 'ACTIVE',
          createdAt: '2026-09-17T00:00:00.000Z',
          profile: { nickname: '可信资料', avatarUrl: null }
        }
      })
    })
  })
  await page.route('**/api/v1/account/password-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { hasPassword: false, passwordLoginEnabled: false }
      })
    })
  })
  await page.route('**/api/addresses', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] })
    })
  })

  await page.goto('/app/account')
  await expect(page).toHaveURL(/\/app\/account\/settings$/)
  await expect(page.getByRole('heading', { name: '账号设置' })).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: /基本信息/ }).click()
  }
  await expect(page.getByRole('heading', { name: '基本信息' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mowo_user') || '{}').id))
    .toBe('trusted-user')
})
