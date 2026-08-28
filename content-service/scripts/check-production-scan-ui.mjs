import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'

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
    ['production-scan.html', '扫码作业总览', 'overview'],
    ['production-scan-frame.html', '帧包完成', 'frame'],
    ['production-scan-material.html', '材料领用', 'material'],
    ['production-scan-pairing.html', '单件配对', 'pairing'],
    ['production-scan-packing.html', '装箱发货', 'packing']
  ]
  for (const [file, heading, station] of pages) {
    await page.goto(`${webBase}/${file}`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 10000 })
    const scanMenu = page.locator('[data-nested="production:scan"]')
    if (!await scanMenu.count() || !await scanMenu.locator('.nav-third').isVisible()) throw new Error(`${heading} 未展开扫码作业三级菜单`)
    if (await scanMenu.locator('.nav-third-item').count() !== 5) throw new Error(`${heading} 的扫码作业三级入口不完整`)
    if (await page.evaluate(() => document.body.dataset.station) !== station) throw new Error(`${heading} 没有应用正确岗位颜色`)
    if (station !== 'overview' && await page.locator('.station-tabs .station-tab').count() !== 5) throw new Error(`${heading} 缺少顶部岗位切换入口`)
  }
  console.log('PASS five production scan pages show the expanded, color-coded station menu')

  await page.goto(`${webBase}/production-scan-frame.html`, { waitUntil: 'networkidle' })
  await page.locator('body').click({ position: { x: 1000, y: 400 } })
  await page.keyboard.type('FP-NOT-EXIST', { delay: 2 })
  await page.keyboard.press('Enter')
  await page.locator('#toast.error').waitFor({ timeout: 10000 })
  if (!await page.locator('#manualCode').evaluate(element => element.value === '')) {
    throw new Error('全局扫码测试错误地依赖了手工输入框')
  }
  console.log('PASS barcode input is captured without focusing a field')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${webBase}/production-scan-pairing.html`, { waitUntil: 'networkidle' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (overflow) throw new Error('单件配对页面在手机宽度出现横向溢出')
  console.log('PASS production scan station fits a mobile viewport')

  if (errors.length) throw new Error(`浏览器脚本错误：${errors.join(' | ')}`)
  console.log('Production scan browser UI checks passed')
} finally {
  await cleanup()
}
