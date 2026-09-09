import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-7)
const phone = `198${runId}1`
let userId = null
let browser = null

async function api(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
}

async function waitForToast(page, text) {
  await page.locator('#toast.show', { hasText: text }).waitFor({ timeout: 10000 })
}

async function chooseFirstRegion(page, selector) {
  await page.locator(selector).waitFor({ timeout: 10000 })
  await page.locator(selector).evaluate((element) => {
    const option = [...element.options].find((item) => item.value)
    if (!option) throw new Error(`${element.id} has no selectable option`)
    element.value = option.value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  if (userId) {
    await prisma.userAddress.deleteMany({ where: { userId } })
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
  const user = await prisma.user.create({
    data: {
      phone,
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'settings-ui-test',
      profile: { create: { nickname: `settings-${runId}` } },
      creditScore: { create: { score: 100 } }
    }
  })
  userId = user.id
  await prisma.smsCode.create({
    data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) }
  })
  const loginResponse = await api('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const login = await loginResponse.json()
  if (!loginResponse.ok || !login.success) throw new Error('settings test login preparation failed')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript((token) => localStorage.setItem('mowo_token', token), login.data.accessToken)
  await page.goto(`${webBase}/settings.html`, { waitUntil: 'networkidle' })
  await page.locator('#nicknameInput').waitFor({ timeout: 10000 })

  const nickname = `设置验收${runId}`
  await page.locator('#nicknameInput').fill(nickname)
  await page.locator('#nicknameInput').blur()
  await page.locator('#nicknameIcon').getByText('✅').waitFor({ timeout: 10000 })
  await page.locator('#bioInput').fill('隔离测试账号的设置页浏览器验收资料')
  await page.locator('#saveProfileBtn').click()
  await waitForToast(page, '保存成功')
  const savedProfile = await prisma.userProfile.findUnique({ where: { userId } })
  if (savedProfile?.nickname !== nickname || savedProfile.bio !== '隔离测试账号的设置页浏览器验收资料') {
    throw new Error('profile fields were not persisted')
  }
  console.log('PASS settings browser saves profile data')

  await page.locator('.sidebar-item[data-section="notifications"]').click()
  await page.locator('#section-notifications.active').waitFor()
  // The styled toggle intentionally hides its native checkbox.
  await page.locator('#notifyPromo').evaluate((element) => element.click())
  await waitForToast(page, '通知设置已保存')
  const afterNotifications = await prisma.userProfile.findUnique({ where: { userId } })
  if (afterNotifications?.notifyPromo !== false) throw new Error('notification preference was not persisted')
  console.log('PASS settings browser saves notification preferences')

  await page.locator('.sidebar-item[data-section="privacy"]').click()
  await page.locator('#section-privacy.active').waitFor()
  await page.locator('.privacy-option-row[data-value="followers"]').click()
  await page.locator('#savePrivacyBtn').click()
  await waitForToast(page, '隐私设置已保存')
  const afterPrivacy = await prisma.userProfile.findUnique({ where: { userId } })
  if (afterPrivacy?.profileVisibility !== 'followers') throw new Error('privacy preference was not persisted')
  console.log('PASS settings browser saves privacy preferences')

  await page.locator('.sidebar-item[data-section="addresses"]').click()
  await page.locator('#section-addresses.active').waitFor()
  await page.getByRole('button', { name: /新增地址/ }).click()
  await page.locator('#addressModal.open').waitFor({ timeout: 10000 })
  await page.locator('#addrFName').fill('测试收件人')
  await page.locator('#addrFPhone').fill('13800138000')
  await chooseFirstRegion(page, '#addrFProvince')
  await page.locator('#addrFCity:not([disabled])').waitFor({ timeout: 10000 })
  await chooseFirstRegion(page, '#addrFCity')
  await page.locator('#addrFDistrict:not([disabled])').waitFor({ timeout: 10000 })
  await chooseFirstRegion(page, '#addrFDistrict')
  await page.locator('#addrFDetail').fill('测试大道 88 号 501 室')
  await page.locator('#addrLabelTags .label-tag[data-label="家"]').click()
  await page.getByRole('button', { name: '保存地址' }).click()
  await waitForToast(page, '地址已添加')
  await page.getByText('测试收件人').waitFor({ timeout: 10000 })
  const addresses = await prisma.userAddress.findMany({ where: { userId } })
  if (addresses.length !== 1 || !addresses[0].isDefault || addresses[0].label !== '家') {
    throw new Error('address was not created as the first default address')
  }
  console.log('PASS settings browser creates the first default address')

  if (pageErrors.length) throw new Error(`settings page errors: ${pageErrors.join(' | ')}`)
  console.log('Settings browser UI checks passed')
} finally {
  await cleanup()
}
