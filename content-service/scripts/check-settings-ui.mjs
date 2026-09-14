import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-7)
const phone = `198${runId}1`
const replacementPhone = `199${runId}1`
let userId = null
let browser = null

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7S0WQAAAABJRU5ErkJggg==',
  'base64'
)

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
    const privateFiles = await prisma.privateFile.findMany({ where: { ownerUserId: userId }, select: { objectKey: true } })
    await prisma.userAddress.deleteMany({ where: { userId } })
    await prisma.privateFile.deleteMany({ where: { ownerUserId: userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.actionToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await Promise.all(privateFiles.map((file) => fs.rm(new URL(`../storage/private/${file.objectKey}`, import.meta.url), { force: true }).catch(() => {})))
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({
    data: {
      phone,
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'settings-ui-test',
      profile: { create: { nickname: `settings-${runId}` } }
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
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token: login.data.accessToken, apiBase })
  await page.goto(`${webBase}/settings.html`, { waitUntil: 'networkidle' })
  await page.locator('#nicknameInput').waitFor({ timeout: 10000 })

  await page.locator('#avatarFileInput').setInputFiles({ name: 'settings-avatar.png', mimeType: 'image/png', buffer: PNG })
  await page.locator('#cropperModal.open').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '确认上传' }).click()
  await waitForToast(page, '头像已更新')
  const uploadedAvatar = await prisma.privateFile.findFirst({ where: { ownerUserId: userId, purpose: 'AVATAR', status: 'READY' } })
  const profileAfterAvatar = await prisma.userProfile.findUnique({ where: { userId } })
  if (!uploadedAvatar || !profileAfterAvatar?.avatarUrl?.includes(uploadedAvatar.id)) {
    throw new Error('avatar upload was not adopted by the account profile')
  }
  console.log('PASS settings browser crops, uploads and adopts an avatar')

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

  // Password login is intentionally disabled in the B1 environment. The phone
  // security row must remain usable because SMS remains the primary login.
  await page.locator('.sidebar-item[data-section="security"]').click()
  await page.locator('#section-security.active').waitFor()
  await page.locator('#phoneSecurityRow').waitFor()
  if (!await page.locator('#phoneSecurityRow').isVisible()) throw new Error('phone change row is hidden when password login is disabled')
  if (await page.locator('#passwordSecurityRow').isVisible()) throw new Error('password row is visible while password login is disabled')
  await prisma.smsCode.create({
    data: { userId, phone, code: '654321', purpose: 'BIND_PHONE', expiresAt: new Date(Date.now() + 300000) }
  })
  await prisma.smsCode.create({
    data: { userId, phone: replacementPhone, code: '654322', purpose: 'BIND_PHONE', expiresAt: new Date(Date.now() + 300000) }
  })
  await page.getByRole('button', { name: '换绑' }).click()
  await page.locator('#phoneModal.open').waitFor({ timeout: 10000 })
  await page.locator('#oldOtpInput').fill('654321')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.locator('#phoneStep2.active').waitFor({ timeout: 10000 })
  await page.locator('#newPhoneInput').fill(replacementPhone)
  await page.locator('#newOtpInput').fill('654322')
  await page.getByRole('button', { name: '确认换绑' }).click()
  await page.waitForURL(/index\.html/, { timeout: 10000 })
  const changedPhoneUser = await prisma.user.findUnique({ where: { id: userId } })
  if (changedPhoneUser?.phone !== replacementPhone) throw new Error('phone change was not persisted')
  console.log('PASS settings browser changes the SMS login phone while password login is disabled')

  // Phone change revokes every existing session. Obtain a fresh SMS session
  // before continuing the independent settings checks below.
  await prisma.smsCode.create({
    data: { userId, phone: replacementPhone, code: '123457', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) }
  })
  const refreshedLoginResponse = await api('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone: replacementPhone, code: '123457', mode: 'LOGIN' })
  })
  const refreshedLogin = await refreshedLoginResponse.json()
  if (!refreshedLoginResponse.ok || !refreshedLogin.success) throw new Error('phone change re-login failed')
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token: refreshedLogin.data.accessToken, apiBase })
  await page.goto(`${webBase}/settings.html`, { waitUntil: 'networkidle' })
  await page.locator('#nicknameInput').waitFor({ timeout: 10000 })

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

  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('#addressModal.open').waitFor({ timeout: 10000 })
  await page.locator('#addrFPhone').fill('')
  await page.getByRole('button', { name: '保存地址' }).click()
  await waitForToast(page, '请填写正确的手机号')
  await page.locator('#addrFPhone').fill('13900139000')
  await page.locator('#addrFDetail').fill('测试大道 99 号 602 室')
  await page.getByRole('button', { name: '保存地址' }).click()
  await waitForToast(page, '地址已更新')
  const editedAddress = await prisma.userAddress.findFirst({ where: { userId } })
  if (editedAddress?.phone !== '13900139000' || editedAddress.detail !== '测试大道 99 号 602 室') {
    throw new Error('address edit was not persisted')
  }
  console.log('PASS settings browser validates and edits an address')

  if (pageErrors.length) throw new Error(`settings page errors: ${pageErrors.join(' | ')}`)
  console.log('Settings browser UI checks passed')
} finally {
  await cleanup()
}
