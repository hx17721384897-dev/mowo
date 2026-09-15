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

async function mockList(page: Page): Promise<void> {
  await page.route('**/api/collab/works?**', (route) =>
    route.fulfill({ json: { success: true, data: listData } })
  )
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
}

function startLegacyServer(): Promise<{ server: Server; origin: string }> {
  const pageHtml = legacyFile('frontend/pages/showcase.html')
  const navCss = legacyFile('frontend/css/nav.css')
  const navJs = legacyFile('frontend/js/nav.js')
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/pages/showcase.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pageHtml)
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
