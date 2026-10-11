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
    profile: { create: { nickname: `browser-${label}-${runId}` } }
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

async function openAs(staff, path, contextOptions = {}) {
  const context = await browser.newContext(contextOptions)
  await context.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token: staff.token, apiBase })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(15000)
  page.on('dialog', dialog => dialog.accept())
  await page.goto(`${webBase}/${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}

async function expectVueForbidden(staff, path, label) {
  const { context, page } = await openAs(staff, path)
  await page.waitForURL(url => url.pathname.endsWith('/app/forbidden'), { timeout: 8000 })
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
    await page.waitForURL(url => url.pathname.endsWith('/app/admin/users'))
    await page.locator('.sidebar-user-name').waitFor()
    assert(await page.getByRole('link', { name: '联络留言' }).count() === 1, '客服菜单显示 Vue 联络处理入口')
    assert(await page.getByRole('link', { name: '订单总览' }).count() === 0, '客服菜单不显示无权访问的生产订单')
    assert(await page.getByRole('link', { name: '外部订单导入' }).count() === 0, '客服菜单不显示外部订单导入入口')
    assert(await page.getByRole('link', { name: '审计日志' }).count() === 0, '客服菜单不显示负责人审计日志')
    await context.close()
  }
  {
    const { context, page } = await openAs(collab, 'admin-collab-works.html')
    await page.waitForURL(url => url.pathname.endsWith('/app/admin/collab-works'))
    await page.getByText('联名作品', { exact: true }).first().waitFor()
    assert(await page.getByText('联名作品', { exact: true }).count() >= 1, '合作运营菜单显示 Vue 联名作品入口')
    assert(await page.getByText('联名审核', { exact: true }).count() === 0, '合作运营菜单不显示已退役联名审核')
    assert(await page.getByText('商务合同', { exact: true }).count() === 0, '合作运营菜单不显示已退役商务合同')
    assert(await page.getByText('违约政策', { exact: true }).count() === 0, '合作运营菜单不显示已退役违约政策')
    await context.close()
  }
  {
    const { context, page } = await openAs(production, 'admin-orders.html')
    await page.waitForURL(url => url.pathname.endsWith('/app/admin/orders'))
    await page.getByRole('heading', { name: '订单总览' }).waitFor()
    assert(await page.locator('.admin-sidebar').getByText('生产批次', { exact: true }).count() === 1, '生产岗位菜单显示生产批次')
    assert(await page.locator('.admin-sidebar').getByText('外部订单导入', { exact: true }).count() === 1, '生产岗位菜单显示外部订单导入保留入口')
    assert(await page.getByRole('link', { name: '用户管理' }).count() === 0, '生产岗位菜单不显示用户管理')
    await context.close()
  }
  {
    const { context, page } = await openAs(owner, 'admin-logs.html')
    await page.waitForURL(url => url.pathname.endsWith('/app/admin/logs'))
    await page.locator('.sidebar-user-name').waitFor()
    assert(await page.getByRole('link', { name: '审计日志' }).count() === 1, '负责人可以进入审计日志并看到完整菜单入口')
    await context.close()
  }
  {
    const { context, page } = await openAs(owner, 'admin-users.html', { viewport: { width: 700, height: 420 } })
    await page.waitForURL(url => url.pathname.endsWith('/app/admin/users'))
    await page.locator('.sidebar-user-name').waitFor()
    await page.locator('.menu-btn').click()
    await page.locator('.admin-sidebar.open').waitFor()
    const layers = await page.evaluate(() => {
      const sidebar = document.querySelector('.admin-sidebar')
      const backdrop = document.querySelector('.admin-sidebar-backdrop')
      const topElement = document.elementFromPoint(Math.min(100, sidebar.getBoundingClientRect().width / 2), 100)
      return {
        sidebar: Number(getComputedStyle(sidebar).zIndex),
        backdrop: Number(getComputedStyle(backdrop).zIndex),
        sidebarReceivesPointer: sidebar.contains(topElement)
      }
    })
    assert(layers.sidebar > layers.backdrop && layers.sidebarReceivesPointer, '窄屏侧栏位于遮罩上方并可点击')
    const nav = page.locator('.admin-sidebar .sidebar-nav')
    const dimensions = await nav.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
    assert(dimensions.scrollHeight > dimensions.clientHeight, '窄屏侧栏菜单形成独立可滚动区域')
    await nav.hover()
    await page.mouse.wheel(0, 500)
    await page.waitForFunction(() => document.querySelector('.admin-sidebar .sidebar-nav')?.scrollTop > 0)
    assert(true, '窄屏侧栏支持滚轮滚动')
    await page.getByRole('button', { name: /系统/ }).click()
    await page.getByRole('link', { name: '审计日志' }).click()
    await page.waitForURL(url => url.pathname.endsWith('/app/admin/logs'))
    assert(true, '窄屏侧栏可以切换后台页面')
    await context.close()
  }

  await expectVueForbidden(support, 'admin-orders.html', '客服通过旧地址访问生产订单会被 Vue 岗位门禁拒绝')
  await expectVueForbidden(production, 'admin-users.html', '生产岗位通过旧地址访问用户管理会被 Vue 岗位门禁拒绝')
  await expectVueForbidden(collab, 'admin-contact.html', '合作运营通过旧地址访问联络留言会被 Vue 岗位门禁拒绝')
  await expectVueForbidden(support, 'admin-logs.html', '客服通过旧地址访问审计日志会被 Vue 岗位门禁拒绝')
  console.log('Admin role browser checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
