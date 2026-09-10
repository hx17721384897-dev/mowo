import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3002'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-7)
const users = []
let browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function createStaff(label, staffRole, role, index) {
  const phone = `193${runId}${index}`
  const user = await prisma.user.create({ data: {
    phone, role, staffRole, privacyAgreedAt: new Date(), privacyPolicyVersion: 'admin-browser-test',
    profile: { create: { nickname: `browser-${label}-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  users.push({ ...user, phone })
  await prisma.smsCode.create({ data: { userId: user.id, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const response = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const payload = await response.json()
  if (!response.ok || !payload.data?.accessToken) throw new Error(`${label} 登录失败`)
  return { ...user, token: payload.data.accessToken }
}

async function openAs(staff, path) {
  const context = await browser.newContext()
  await context.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token: staff.token, apiBase })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(8000)
  page.on('dialog', dialog => dialog.accept())
  await page.goto(`${webBase}/${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}

async function expectRedirect(staff, path, label) {
  const { context, page } = await openAs(staff, path)
  await page.waitForURL(url => url.pathname.endsWith('/index.html'), { timeout: 8000 })
  assert(true, label)
  await context.close()
}

async function cleanup() {
  const ids = users.map(user => user.id)
  const phones = users.map(user => user.phone)
  if (ids.length) {
    await prisma.operationLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.smsCode.deleteMany({ where: { phone: { in: phones } } })
    await prisma.creditScore.deleteMany({ where: { userId: { in: ids } } })
    await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
}

try {
  const owner = await createStaff('owner', 'OWNER', 3, 1)
  const support = await createStaff('support', 'CUSTOMER_SERVICE', 2, 2)
  const production = await createStaff('production', 'PRODUCTION', 2, 3)
  const collab = await createStaff('collab', 'COLLAB_OPS', 2, 4)
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })

  {
    const { context, page } = await openAs(support, 'admin-users.html')
    await page.waitForFunction(() => {
      const node = document.querySelector('#sidebarName')
      return node && node.textContent !== '加载中…'
    })
    assert(await page.locator('a[href="admin-contact.html"]').count() === 1, '客服菜单显示联络处理')
    assert(await page.locator('a[href^="admin-orders.html"]').count() === 0, '客服菜单不显示无权访问的生产订单')
    assert(await page.locator('a[href="admin-logs.html"]').count() === 0, '客服菜单不显示负责人审计日志')
    await context.close()
  }
  console.log('CHECK collab read-only page')
  {
    const { context, page } = await openAs(collab, 'admin-collab-policy.html')
    await page.locator('#permBanner .banner-lock').waitFor()
    assert(await page.locator('a[href="admin-collab-policy.html"]').count() === 1, '合作运营菜单显示只读联名政策')
    assert(await page.locator('#saveBtn').isHidden(), '合作运营不能看到联名政策保存按钮')
    await context.close()
  }
  console.log('CHECK production page')
  {
    const { context, page } = await openAs(production, 'admin-orders.html')
    await page.locator('#pageTitle').waitFor()
    await page.locator('#sidebar a[href="admin-production-batches.html"]').waitFor()
    assert(await page.locator('#sidebar a[href="admin-production-batches.html"]').count() === 1, '生产岗位菜单显示生产批次')
    assert(await page.locator('a[href="admin-users.html"]').count() === 0, '生产岗位菜单不显示用户管理')
    await context.close()
  }
  console.log('CHECK owner page')
  {
    const { context, page } = await openAs(owner, 'admin-logs.html')
    await page.waitForFunction(() => {
      const node = document.querySelector('#sidebarName')
      return node && node.textContent !== '加载中…'
    })
    assert(await page.locator('a[href="admin-logs.html"]').count() === 1, '负责人可以进入审计日志并看到完整菜单入口')
    await context.close()
  }

  console.log('CHECK denied page redirects')
  await expectRedirect(support, 'admin-orders.html', '客服直接访问生产订单会返回前台')
  await expectRedirect(production, 'admin-users.html', '生产岗位直接访问用户管理会返回前台')
  await expectRedirect(collab, 'admin-contact.html', '合作运营直接访问联络留言会返回前台')
  await expectRedirect(support, 'admin-logs.html', '客服直接访问审计日志会返回前台')
  console.log('Admin role browser checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
