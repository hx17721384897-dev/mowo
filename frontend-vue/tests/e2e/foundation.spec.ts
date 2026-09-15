import { expect, test } from '@playwright/test'

test('public V1a pages have one working navigation shell', async ({ page }) => {
  await page.goto('/app/')
  await expect(page.getByRole('heading', { name: /转动手柄/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '开始制作' })).toHaveAttribute(
    'href',
    '/mowo/frontend/pages/customize-start.html'
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

test('shared public navigation stays geometrically stable across routes', async ({ page }) => {
  await page.goto('/app/')
  const nav = page.getByRole('navigation', { name: '主导航' })
  const aboutLink = nav.getByRole('link', { name: '关于我们' })
  const homeBox = await nav.boundingBox()
  const homeLinkBox = await aboutLink.boundingBox()

  await page.evaluate(() => window.scrollTo(0, 900))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await aboutLink.click()
  await expect(page).toHaveURL(/\/app\/about$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  expect(await nav.boundingBox()).toEqual(homeBox)
  expect(await aboutLink.boundingBox()).toEqual(homeLinkBox)
  await expect(aboutLink).toHaveCSS('font-weight', '700')
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
  await page.getByRole('button', { name: '注册', exact: true }).click()
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

test('four application areas and controlled 404 still render', async ({ page }) => {
  await page.goto('/app/account')
  await expect(page.getByText('账户区域占位')).toBeVisible()
  await page.goto('/app/admin')
  await expect(page.getByText('管理区域占位')).toBeVisible()
  await page.goto('/app/production')
  await expect(page.getByText('生产区域占位')).toBeVisible()
  await page.goto('/app/does-not-exist')
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  const menuButton = page.getByRole('button', { name: '打开或关闭导航' })
  if (await menuButton.isVisible()) await menuButton.click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
})
