import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3002'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-7)
const phone = `197${runId}1`
let userId
let browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  if (userId) {
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({ data: {
    phone,
    privacyAgreedAt: new Date(),
    privacyPolicyVersion: 'shell-ui-test',
    profile: { create: { nickname: `shell-${runId}` } },
    creditScore: { create: { score: 100 } }
  } })
  userId = user.id
  await prisma.smsCode.create({ data: {
    userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000)
  } })
  const loginResponse = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const login = await loginResponse.json()
  if (!loginResponse.ok || !login.data?.accessToken) throw new Error('用户壳层浏览器测试登录失败')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext()
  await context.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token: login.data.accessToken, apiBase })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)

  await page.goto(`${webBase}/orders.html`, { waitUntil: 'domcontentloaded' })
  await page.locator('#listWrap .empty, #listWrap .order-list').waitFor()
  assert(page.url().includes('/orders.html'), '有效会话可以进入我的订单')

  await page.evaluate(() => window.mowoLogout())
  await page.goto(`${webBase}/orders.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(url => url.pathname.endsWith('/index.html') && url.searchParams.get('auth') === '1')
  assert(true, '退出后直接访问我的订单会返回登录入口')

  const navStyles = []
  for (const file of ['index.html', 'about.html', 'products.html']) {
    await page.goto(`${webBase}/${file}`, { waitUntil: 'domcontentloaded' })
    navStyles.push(await page.locator('.mowo-nav-mid a[href="contact.html"]').evaluate(element => {
      const style = getComputedStyle(element)
      return { file: location.pathname.split('/').pop(), family: style.fontFamily, weight: style.fontWeight }
    }))
  }
  assert(new Set(navStyles.map(style => style.family)).size === 1, '首页、关于和产品页导航使用相同字体族')
  assert(new Set(navStyles.map(style => style.weight)).size === 1, '首页、关于和产品页非当前导航项使用相同字重')
  console.log('User route and public navigation browser checks passed')
} finally {
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
}
