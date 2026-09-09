import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import path from 'node:path'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
const phone = `195${runId}`
let userId = null
let browser = null

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  const users = await prisma.user.findMany({
    where: { privacyPolicyVersion: 'scan-ui-test' }, select: { id: true, phone: true }
  })
  const userIds = users.map(user => user.id)
  const phones = users.map(user => user.phone).filter(Boolean)
  if (userIds.length) {
    await prisma.operationLog.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.smsCode.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { phone: { in: phones } }] } })
    await prisma.creditScore.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({ data: {
    phone, role: 1, staffRole: 'PRODUCTION', privacyAgreedAt: new Date(),
    privacyPolicyVersion: 'scan-ui-test',
    profile: { create: { nickname: `scan-ui-${runId}` } }, creditScore: { create: { score: 100 } }
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
  if (!loginResponse.ok || !login.success) throw new Error(login.message || '临时生产员工登录失败')

  browser = await chromium.launch({
    headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(token => localStorage.setItem('mowo_token', token), login.data.accessToken)

  const pages = [
    ['production-scan.html?v=20260904-1#overview', '扫码作业总览', 'overview'],
    ['production-scan.html?v=20260904-1#frame', '帧包完成', 'frame'],
    ['production-scan.html?v=20260904-1#material', '材料领用', 'material'],
    ['production-scan.html?v=20260904-1#pairing', '单件配对', 'pairing'],
    ['production-scan.html?v=20260904-1#packing', '装箱发货', 'packing']
  ]
  for (const [file, heading, station] of pages) {
    await page.goto(`${webBase}/${file}`, { waitUntil: 'networkidle' })
    await page.locator('#stationTitle').filter({ hasText: heading }).waitFor({ timeout: 10000 })
    const scanMenu = page.locator('[data-nested="production:scan"]')
    if (!await scanMenu.count() || !await scanMenu.locator('.nav-third').isVisible()) throw new Error(`${heading} 未展开扫码作业三级菜单`)
    if (await scanMenu.locator('.nav-third-item').count() !== 5) throw new Error(`${heading} 的扫码作业三级入口不完整`)
    if (await page.evaluate(() => document.body.dataset.station) !== station) throw new Error(`${heading} 没有应用正确岗位颜色`)
    if (await page.locator('.work-tabs button').count() !== 5) throw new Error(`${heading} 缺少统一工作台环节切换入口`)
  }
  console.log('PASS unified production workbench shows five color-coded station entries')

  const visibleCopy = await page.locator('body').innerText()
  if (visibleCopy.includes('本次浏览器作业期间') || visibleCopy.includes('这里是正式记录') || visibleCopy.includes('服务器仍会')) {
    throw new Error('扫码页面仍展示面向开发讨论的实现说明')
  }
  console.log('PASS production workbench only shows staff-facing operational copy')

  await page.goto(`${webBase}/production-scan.html?v=20260904-1#frame`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '打印队列', exact: true }).waitFor()
  if (!await page.locator('#globalBatch').count() || !await page.locator('#queueCurrent').count()) {
    throw new Error('帧包完成页缺少批次选择或当前打印任务')
  }
  console.log('PASS frame station shows the shared ordered print queue')
  const batchOptions = await page.locator('#globalBatch option').count()
  if (batchOptions > 1) {
    await page.locator('#globalBatch').selectOption({ index: 1 })
    await page.waitForFunction(() => document.querySelector('#batchSelectionState')?.textContent?.includes('件'))
    const selectedBatch = await page.locator('#globalBatch').inputValue()
    await page.evaluate(() => { window.__scanWorkbenchMarker = 'preserved' })
    await page.locator('.work-tabs button[data-station="material"]').click()
    await page.getByRole('heading', { name: '领取材料包', exact: true }).waitFor()
    await page.locator('.work-tabs button[data-station="pairing"]').click()
    await page.locator('[data-view="pairing"] h2').filter({ hasText: '单件配对' }).waitFor()
    if (await page.locator('#globalBatch').inputValue() !== selectedBatch || await page.evaluate(() => window.__scanWorkbenchMarker) !== 'preserved') {
      throw new Error('切换扫码环节时页面刷新或丢失了当前生产批次')
    }
    await page.locator('.work-tabs button[data-station="frame"]').click()
    if (process.env.SCREENSHOT_DIR) {
      for (const station of ['overview', 'frame', 'material', 'pairing', 'packing']) {
        await page.locator(`.work-tabs button[data-station="${station}"]`).click()
        await page.waitForTimeout(180)
        const activeSidebarStations = page.locator('[data-nested="production:scan"] .nav-third-item.active')
        if (await activeSidebarStations.count() !== 1 || !await activeSidebarStations.first().getAttribute('href').then(href => href?.endsWith(`#${station}`))) {
          throw new Error(`${station} 切换后左侧菜单高亮不唯一`)
        }
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `production-scan-${station}.png`), fullPage: true })
      }
      await page.locator('.work-tabs button[data-station="frame"]').click()
    }
    console.log('PASS station switching preserves the page and selected production batch')
  }
  if (await page.evaluate(() => MowoScan.classify('LEGACY-KIT-TEST')) !== 'KIT_BATCH') {
    throw new Error('旧材料批次码没有按材料来源识别')
  }
  await page.locator('body').click({ position: { x: 1000, y: 400 } })
  await page.keyboard.type('FP-NOT-EXIST', { delay: 2 })
  await page.keyboard.press('Enter')
  await page.locator('#toast.error').waitFor({ timeout: 10000 })
  if (!await page.locator('#frameManual').evaluate(element => element.value === '')) {
    throw new Error('全局扫码测试错误地依赖了手工输入框')
  }
  console.log('PASS barcode input is captured without focusing a field')

  const legacyPages = [
    ['production-scan-frame.html?v=20260904-1', 'frame'],
    ['production-scan-material.html?v=20260904-1', 'material'],
    ['production-scan-pairing.html?v=20260904-1', 'pairing'],
    ['production-scan-packing.html?v=20260904-1', 'packing']
  ]
  for (const [legacyFile, station] of legacyPages) {
    await page.goto(`${webBase}/${legacyFile}`, { waitUntil: 'networkidle' })
    const locationState = await page.evaluate(() => ({ path: location.pathname, search: location.search, hash: location.hash }))
    if (!locationState.path.endsWith('/production-scan.html') || locationState.search !== '?v=20260904-1' || locationState.hash !== `#${station}`) {
      throw new Error(`${legacyFile} 没有收口到统一扫码工作台`)
    }
  }
  await page.goto(`${webBase}/production-scan.html?station=pairing`, { waitUntil: 'networkidle' })
  if (await page.evaluate(() => location.search !== '?v=20260904-1' || location.hash !== '#pairing')) {
    throw new Error('旧 station 参数没有自动收口到统一网址')
  }
  console.log('PASS legacy scan URLs redirect to one versioned workbench')

  const signedOutContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const signedOutPage = await signedOutContext.newPage()
  await signedOutPage.goto(`${webBase}/production-scan.html?v=20260904-1#packing`, { waitUntil: 'domcontentloaded' })
  await signedOutPage.waitForURL(url => url.pathname.endsWith('/index.html') && url.searchParams.get('auth') === '1')
  const loginRedirect = new URL(signedOutPage.url()).searchParams.get('redirect')
  if (!loginRedirect?.endsWith('/production-scan.html?v=20260904-1#packing')) {
    throw new Error('未登录员工进入扫码页时没有保留原工位返回地址')
  }
  await signedOutContext.close()
  console.log('PASS signed-out staff use the real login modal and return to the original station')

  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${webBase}/production-scan.html?v=20260904-1#pairing`, { waitUntil: 'networkidle' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (overflow) throw new Error('单件配对页面在手机宽度出现横向溢出')
  console.log('PASS production scan station fits a mobile viewport')

  if (errors.length) throw new Error(`浏览器脚本错误：${errors.join(' | ')}`)
  console.log('Production scan browser UI checks passed')
} finally {
  await cleanup()
}
