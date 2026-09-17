import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.MOWO_CAPTURE_FIDELITY !== '1', '仅在生成视觉验收基线时运行')

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const legacyRevision = 'a007340^'

function legacyFile(path: string): string {
  return execFileSync('git', ['show', `${legacyRevision}:${path}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

function legacyBinary(path: string): Buffer {
  return execFileSync('git', ['show', `${legacyRevision}:${path}`], {
    cwd: repoRoot,
    maxBuffer: 5 * 1024 * 1024
  })
}

function svgData(label: string, start: string, end: string): string {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="720" height="720" fill="url(#g)"/><circle cx="360" cy="310" r="150" fill="rgba(255,255,255,.38)"/><text x="360" y="560" text-anchor="middle" font-family="sans-serif" font-size="48" font-weight="700" fill="#2c1f14">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
}

const colors = [
  ['#f6c76e', '#f58f7c'],
  ['#a5d8cc', '#f2e7a2'],
  ['#adc8ef', '#e6b4dd'],
  ['#f2ae92', '#f8de8c'],
  ['#c8b5e8', '#91c8df'],
  ['#bcd99b', '#f5c9a6'],
  ['#eeb0b0', '#bdd5ef'],
  ['#f4dd91', '#b9d6bc'],
  ['#d3b4ee', '#f3b891'],
  ['#98cfd0', '#f0c0ca']
]

const works = colors.map(([start, end], index) => ({
  id: `work-${index + 1}`,
  creatorId: `creator-${(index % 4) + 1}`,
  title: [
    '十二格春日',
    '月亮缓缓升起',
    '小狗摇尾巴',
    '海浪与灯塔',
    '森林里的风',
    '云朵旅行记',
    '花园下午茶',
    '猫咪伸懒腰',
    '纸飞机远行',
    '雨后彩虹'
  ][index],
  description: index % 3 === 0 ? '一段可以捧在手里的逐帧小故事。' : '',
  coverUrl: svgData(`MOWO ${index + 1}`, start!, end!),
  hoverGifUrl: null,
  approvedAt: '2026-09-01T00:00:00.000Z',
  creator: {
    userId: `creator-${(index % 4) + 1}`,
    nickname: ['小满', '阿禾', '木子', '南星'][index % 4],
    avatarUrl: null
  },
  minPrice: 99 + index * 10,
  availableSkuCount: (index % 3) + 1,
  availableSizes: index % 2 ? ['小号', '大号'] : ['标准款'],
  minLeadTimeDays: 3 + (index % 5),
  previewFrames: []
}))

const listData = {
  works,
  total: works.length,
  page: 1,
  limit: 12,
  hasMore: false,
  sort: 'recommended',
  creators: ['小满', '阿禾', '木子', '南星'].map((name, index) => ({
    id: `creator-${index + 1}`,
    name
  }))
}

const detailData = {
  id: 'work-1',
  creatorId: 'creator-1',
  title: '十二格春日',
  description: '一朵花从种子慢慢开放。\n每一格都保留手绘纸张的细微质感。',
  storefrontSummary: '把一整个春天，轻轻转到眼前。',
  storefrontMedia: [{ url: svgData('DETAIL', '#b9dbcb', '#f5dfa2'), kind: 'image' }],
  storefrontTags: ['手绘', '春日', '逐帧动画'],
  storefrontSeries: '春日系列',
  animationFrames: [
    svgData('FRAME 1', '#f7df88', '#efaa86'),
    svgData('FRAME 2', '#b6dac8', '#f0d88b'),
    svgData('FRAME 3', '#adc9ea', '#dfb8df')
  ],
  hoverGifUrl: null,
  coverUrl: works[0]!.coverUrl,
  approvedAt: '2026-09-01T00:00:00.000Z',
  creator: { userId: 'creator-1', nickname: '小满', avatarUrl: null },
  supportedSkus: [
    {
      id: 'sku-1',
      modelId: 'model-1',
      modelName: '手摇动画机',
      size: '小号',
      material: '纸艺',
      frameCount: 12,
      colorName: '原木',
      colorHex: '#d7b98e',
      previewImage: works[1]!.coverUrl,
      finalPrice: 129,
      fulfillmentMode: 'STOCK_FIRST',
      leadTimeDays: 5,
      exampleMedia: []
    },
    {
      id: 'sku-2',
      modelId: 'model-1',
      modelName: '手摇动画机',
      size: '大号',
      material: '纸艺',
      frameCount: 12,
      colorName: '深木',
      colorHex: '#5d4634',
      previewImage: works[2]!.coverUrl,
      finalPrice: 169,
      fulfillmentMode: 'STOCK_ONLY',
      leadTimeDays: 2,
      exampleMedia: []
    }
  ]
}

async function mockList(page: Page): Promise<void> {
  await page.route('**/api/collab/works?**', (route) =>
    route.fulfill({ json: { success: true, data: listData } })
  )
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
}

async function mockDetail(page: Page): Promise<void> {
  await mockList(page)
  await page.route('**/api/config/features', (route) =>
    route.fulfill({ json: { success: true, data: { onlineCheckout: false } } })
  )
  await page.route('**/api/collab/works/work-1', (route) =>
    route.fulfill({ json: { success: true, data: detailData } })
  )
  await page.route('**/api/collab/works/work-1/view', (route) =>
    route.fulfill({ json: { success: true, data: { counted: true } } })
  )
}

function startLegacyServer(): Promise<{ server: Server; origin: string }> {
  const homeHtml = legacyFile('frontend/pages/index.html')
  const aboutHtml = legacyFile('frontend/pages/about.html')
  const productsHtml = legacyFile('frontend/pages/products.html')
  const faqHtml = legacyFile('frontend/pages/faq.html')
  const contactHtml = legacyFile('frontend/pages/contact.html')
  const termsHtml = legacyFile('frontend/pages/user-agreement.html')
  const privacyHtml = legacyFile('frontend/pages/privacy-policy.html')
  const pageHtml = legacyFile('frontend/pages/showcase.html')
  const detailHtml = legacyFile('frontend/pages/showcase-detail.html')
  const navCss = legacyFile('frontend/css/nav.css')
  const navJs = legacyFile('frontend/js/nav.js')
  const detailJs = legacyFile('frontend/js/showcase-detail.js')
  const heroImage = legacyBinary('frontend/assets/hero-main.png')
  const boxDiagram = legacyBinary('frontend/assets/box-diagram.png')
  const faqHero = legacyBinary('frontend/assets/images/faq-hero.png')
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/pages/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(homeHtml)
      return
    }
    if (path === '/pages/about.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(aboutHtml)
      return
    }
    if (path === '/pages/products.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(productsHtml)
      return
    }
    if (path === '/pages/faq.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(faqHtml)
      return
    }
    if (path === '/pages/contact.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(contactHtml)
      return
    }
    if (path === '/pages/user-agreement.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(termsHtml)
      return
    }
    if (path === '/pages/privacy-policy.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(privacyHtml)
      return
    }
    if (path === '/pages/showcase.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pageHtml)
      return
    }
    if (path === '/pages/showcase-detail.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(detailHtml)
      return
    }
    if (path === '/css/nav.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end(navCss)
      return
    }
    if (path === '/js/nav.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(navJs)
      return
    }
    if (path === '/js/showcase-detail.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(detailJs)
      return
    }
    if (path === '/assets/hero-main.png' || path === '/assets/box-diagram.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(path.endsWith('hero-main.png') ? heroImage : boxDiagram)
      return
    }
    if (path === '/assets/images/faq-hero.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(faqHero)
      return
    }
    if (path === '/js/feature-flags.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end('window.getMowoFeatureFlags = async () => ({ onlineCheckout: false })')
      return
    }
    if (path === '/js/runtime-config.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end('window.MOWO_API_BASE = ""')
      return
    }
    if (path === '/js/auth.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end('')
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('无法启动旧版视觉基线服务')
      resolve({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

test('公共 404 双视口稳定性截图', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name
  await page.setViewportSize(
    suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
  )
  await page.goto('/app/this-route-does-not-exist')
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/app/')
  await expect(page.getByText(/尚未迁移|旧功能|退役/)).toHaveCount(0)
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows).toBe(false)
  await page.screenshot({
    path: `test-results/visual-fidelity/vue-not-found-${suffix}.png`,
    fullPage: true
  })
})

for (const legalPage of [
  { name: '用户协议', legacy: 'user-agreement.html', vue: 'terms' },
  { name: '隐私政策', legacy: 'privacy-policy.html', vue: 'privacy' }
]) {
  test(`${legalPage.name}旧版与 Vue 版视觉验收截图`, async ({ page }, testInfo) => {
    const { server, origin } = await startLegacyServer()
    const suffix = testInfo.project.name
    try {
      await page.setViewportSize(
        suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
      )
      await page.goto(`${origin}/pages/${legalPage.legacy}`)
      const oldHeader = await page.locator('header').boundingBox()
      const oldArticle = await page.locator('article').boundingBox()
      await page.screenshot({
        path: `test-results/visual-fidelity/old-legal-${legalPage.vue}-${suffix}.png`,
        fullPage: true
      })

      await page.goto(`/app/legal/${legalPage.vue}`)
      const vueHeader = await page.locator('.legal-header').boundingBox()
      const vueArticle = await page.locator('article').boundingBox()
      expect(vueHeader).toEqual(oldHeader)
      expect(vueArticle?.x).toBe(oldArticle?.x)
      expect(vueArticle?.width).toBe(oldArticle?.width)
      await expect(page.getByText('测试草案，不是正式上线法律文本。')).toBeVisible()
      await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
      await page.screenshot({
        path: `test-results/visual-fidelity/vue-legal-${legalPage.vue}-${suffix}.png`,
        fullPage: true
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
}

test('常见问题旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
    await page.route('https://cdn.jsdelivr.net/**', (route) =>
      route.fulfill({
        contentType: 'text/javascript; charset=utf-8',
        body: 'window.Fuse=class{constructor(items){this.items=items}search(query){return this.items.filter((item)=>JSON.stringify(item).includes(query)).map((item)=>({item}))}}'
      })
    )
    await page.goto(`${origin}/pages/faq.html`)
    await expect(page.locator('.faq-item')).toHaveCount(20)
    const oldHero = await page.locator('.faq-hero').boundingBox()
    await page.screenshot({
      path: `test-results/visual-fidelity/old-faq-${suffix}.png`,
      fullPage: true
    })

    await page.goto('/app/faq')
    await expect(page.locator('.faq-item')).toHaveCount(9)
    const vueHero = await page.locator('.faq-hero').boundingBox()
    expect(vueHero).toEqual(oldHero)
    await expect(page.locator('.trust-section')).toHaveCount(0)
    await expect(page.getByText(/社区|分红|提现|牛量|创作者自助/)).toHaveCount(0)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-faq-${suffix}.png`,
      fullPage: true
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('联络页旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort())

    await page.goto(`${origin}/pages/contact.html`)
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('on')))
    await page.waitForTimeout(900)
    await expect(page.locator('.contact-card')).toHaveCount(6)
    const oldHero = await page.locator('.page-hero').boundingBox()
    const oldGrid = await page.locator('.cards-grid').boundingBox()
    await page.screenshot({
      path: `test-results/visual-fidelity/old-contact-${suffix}.png`,
      fullPage: true
    })
    await page.locator('.contact-card').first().click()
    await expect(page.locator('#modal-artist')).toHaveClass(/open/)
    await page.waitForTimeout(500)
    const oldModal = await page.locator('#modal-artist .modal').boundingBox()
    await page.screenshot({
      path: `test-results/visual-fidelity/old-contact-modal-${suffix}.png`
    })

    await page.goto('/app/contact')
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('on')))
    await page.waitForTimeout(900)
    await expect(page.locator('.contact-card')).toHaveCount(6)
    const vueHero = await page.locator('.page-hero').boundingBox()
    const vueGrid = await page.locator('.cards-grid').boundingBox()
    expect(vueHero).toEqual(oldHero)
    expect(vueGrid?.x).toBe(oldGrid?.x)
    expect(vueGrid?.width).toBe(oldGrid?.width)
    await expect(page.getByText(/100%|3 个工作日/)).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
    ).toBe(false)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-contact-${suffix}.png`,
      fullPage: true
    })
    await page.locator('.contact-card').first().click()
    await expect(page.locator('.contact-modal-backdrop')).toHaveClass(/open/)
    await page.waitForTimeout(500)
    const vueModal = await page.locator('.contact-modal').boundingBox()
    expect(vueModal?.x).toBe(oldModal?.x)
    expect(vueModal?.width).toBe(oldModal?.width)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-contact-modal-${suffix}.png`
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('产品介绍旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
    await page.goto(`${origin}/pages/products.html`)
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('on')))
    await page.waitForTimeout(1000)
    const oldHero = await page.locator('#hero').boundingBox()
    await page.screenshot({
      path: `test-results/visual-fidelity/old-products-${suffix}.png`,
      fullPage: true
    })

    await page.goto('/app/products')
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('on')))
    await page.waitForTimeout(1000)
    const vueHero = await page.locator('#hero').boundingBox()
    expect(vueHero).toEqual(oldHero)
    await expect(page.locator('.scene-row')).toHaveCount(6)
    await expect(page.locator('.prod-card')).toHaveCount(0)
    await expect(page.getByText('AI 生成动画帧')).toHaveCount(0)
    await expect(page.getByText('铝合金')).toHaveCount(0)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-products-${suffix}.png`,
      fullPage: true
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('关于页旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
    await page.goto(`${origin}/pages/about.html`)
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('on')))
    await page.waitForTimeout(1000)
    const oldHero = await page.locator('#hero').boundingBox()
    await page.screenshot({
      path: `test-results/visual-fidelity/old-about-${suffix}.png`,
      fullPage: true
    })

    await page.goto('/app/about')
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('on')))
    await page.waitForTimeout(1000)
    const vueHero = await page.locator('#hero').boundingBox()
    expect(vueHero).toEqual(oldHero)
    await expect(page.getByText('创作者平台')).toHaveCount(0)
    await expect(page.getByText('百万播放')).toHaveCount(0)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-about-${suffix}.png`,
      fullPage: true
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('首页旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await mockList(page)
    await page.goto(`${origin}/pages/index.html`)
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('in')))
    const oldHero = await page.locator('.hero').boundingBox()
    await page.screenshot({
      path: `test-results/visual-fidelity/old-home-${suffix}.png`,
      fullPage: true
    })

    await page.goto('/app/')
    await expect(page.locator('.creative-card')).toHaveCount(4)
    await page
      .locator('.reveal')
      .evaluateAll((elements) => elements.forEach((element) => element.classList.add('in')))
    await expect(page.getByText('真实用户反馈')).toHaveCount(0)
    await expect(page.getByText('全球配送')).toHaveCount(0)
    await expect(page.getByText('7 天无理由退换')).toHaveCount(0)
    const vueHero = await page.locator('.hero').boundingBox()
    expect(vueHero).toEqual(oldHero)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-home-${suffix}.png`,
      fullPage: true
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('联名列表旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await mockList(page)
    await page.goto(`${origin}/pages/showcase.html`)
    await expect(page.locator('.work-card')).toHaveCount(works.length)
    await page.waitForTimeout(700)
    const oldScreenshot = await page.screenshot({
      path: `test-results/visual-fidelity/old-${suffix}.png`,
      fullPage: true
    })

    await page.goto('/app/showcase')
    await expect(page.locator('.work-card')).toHaveCount(works.length)
    await page.waitForTimeout(700)
    const vueScreenshot = await page.screenshot({
      path: `test-results/visual-fidelity/vue-${suffix}.png`,
      fullPage: true
    })
    if (suffix === 'chromium') expect(vueScreenshot.equals(oldScreenshot)).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('联名详情旧版与 Vue 版视觉验收截图', async ({ page }, testInfo) => {
  const { server, origin } = await startLegacyServer()
  const suffix = testInfo.project.name
  try {
    await page.setViewportSize(
      suffix === 'mobile-chromium' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    )
    await mockDetail(page)
    await page.goto(`${origin}/pages/showcase-detail.html?workId=work-1`)
    await expect(page.locator('.sku-card')).toHaveCount(2)
    await expect(page.locator('.more-card')).toHaveCount(4)
    await page.waitForTimeout(700)
    const oldHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.screenshot({
      path: `test-results/visual-fidelity/old-detail-${suffix}.png`,
      fullPage: true
    })

    await page.goto('/app/showcase/work-1')
    await expect(page.locator('.sku-card')).toHaveCount(2)
    await expect(page.locator('.more-card')).toHaveCount(4)
    await page.waitForTimeout(700)
    const vueHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(vueHeight).toBe(oldHeight)
    await page.screenshot({
      path: `test-results/visual-fidelity/vue-detail-${suffix}.png`,
      fullPage: true
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
