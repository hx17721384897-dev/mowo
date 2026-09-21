import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const vueBase = process.env.TEST_VUE_BASE || 'http://127.0.0.1:4173/app'
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
  await page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 10000 })
}

async function chooseFirstRegion(select) {
  await select.waitFor({ timeout: 10000 })
  await select.evaluate((element) => {
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
  await page.goto(`${vueBase}/account/settings`, { waitUntil: 'networkidle' })
  const nicknameInput = page.getByPlaceholder('2～20个字符')
  await nicknameInput.waitFor({ timeout: 10000 })

  await page.locator('input[type="file"][accept="image/jpeg,image/png"]').setInputFiles({ name: 'settings-avatar.png', mimeType: 'image/png', buffer: PNG })
  const cropDialog = page.getByRole('dialog', { name: '裁剪头像' })
  await cropDialog.waitFor({ timeout: 15000 })
  await cropDialog.getByRole('button', { name: '确认上传' }).click()
  await waitForToast(page, '头像已更新')
  const uploadedAvatar = await prisma.privateFile.findFirst({ where: { ownerUserId: userId, purpose: 'AVATAR', status: 'READY' } })
  const profileAfterAvatar = await prisma.userProfile.findUnique({ where: { userId } })
  if (!uploadedAvatar || !profileAfterAvatar?.avatarUrl?.includes(uploadedAvatar.id)) {
    throw new Error('avatar upload was not adopted by the account profile')
  }
  console.log('PASS settings browser crops, uploads and adopts an avatar')

  const nickname = `设置验收${runId}`
  await nicknameInput.fill(nickname)
  await nicknameInput.blur()
  await page.locator('.input-wrap i', { hasText: '✅' }).waitFor({ timeout: 10000 })
  await page.getByPlaceholder('介绍一下自己，最多150字').fill('隔离测试账号的设置页浏览器验收资料')
  await page.getByRole('button', { name: '保存修改' }).click()
  await waitForToast(page, '保存成功')
  const savedProfile = await prisma.userProfile.findUnique({ where: { userId } })
  if (savedProfile?.nickname !== nickname || savedProfile.bio !== '隔离测试账号的设置页浏览器验收资料') {
    throw new Error('profile fields were not persisted')
  }
  console.log('PASS settings browser saves profile data')

  // Password login is intentionally disabled in the B1 environment. The phone
  // security row must remain usable because SMS remains the primary login.
  await page.getByRole('button', { name: /账号安全/ }).click()
  await page.getByRole('heading', { name: '账号安全' }).waitFor()
  if (!await page.getByText('登录手机号').isVisible()) throw new Error('phone change row is hidden when password login is disabled')
  if (await page.getByText('登录密码').isVisible()) throw new Error('password row is visible while password login is disabled')
  await prisma.smsCode.create({
    data: { userId, phone, code: '654321', purpose: 'BIND_PHONE', expiresAt: new Date(Date.now() + 300000) }
  })
  await prisma.smsCode.create({
    data: { userId, phone: replacementPhone, code: '654322', purpose: 'BIND_PHONE', expiresAt: new Date(Date.now() + 300000) }
  })
  await page.getByRole('button', { name: '换绑' }).click()
  const phoneDialog = page.getByRole('dialog', { name: '换绑手机号' })
  await phoneDialog.waitFor({ timeout: 10000 })
  await phoneDialog.getByPlaceholder('6位验证码').fill('654321')
  await phoneDialog.getByRole('button', { name: '下一步' }).click()
  await phoneDialog.getByText('新手机号').waitFor({ timeout: 10000 })
  await phoneDialog.locator('input').nth(0).fill(replacementPhone)
  await phoneDialog.getByPlaceholder('验证码').fill('654322')
  await phoneDialog.getByRole('button', { name: '确认换绑' }).click()
  await page.waitForURL(/\/app\/?$/, { timeout: 10000 })
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
  await page.goto(`${vueBase}/account/settings`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('2～20个字符').waitFor({ timeout: 10000 })

  await page.getByRole('button', { name: /收货地址/ }).click()
  await page.getByRole('heading', { name: '收货地址' }).waitFor()
  await page.getByRole('button', { name: /新增地址/ }).click()
  const addressDialog = page.getByRole('dialog', { name: '新增地址' })
  await addressDialog.waitFor({ timeout: 10000 })
  await addressDialog.getByPlaceholder('姓名').fill('测试收件人')
  await addressDialog.getByPlaceholder('11位手机号').fill('13800138000')
  const addressSelects = addressDialog.locator('select')
  await chooseFirstRegion(addressSelects.nth(0))
  await addressSelects.nth(1).waitFor({ state: 'visible', timeout: 10000 })
  await chooseFirstRegion(addressSelects.nth(1))
  await addressSelects.nth(2).waitFor({ state: 'visible', timeout: 10000 })
  await chooseFirstRegion(addressSelects.nth(2))
  await addressDialog.getByPlaceholder('街道、楼栋、门牌号等').fill('测试大道 88 号 501 室')
  await addressDialog.getByRole('button', { name: /家/ }).click()
  await addressDialog.getByRole('button', { name: '保存地址' }).click()
  await waitForToast(page, '地址已添加')
  await page.getByText('测试收件人').waitFor({ timeout: 10000 })
  const addresses = await prisma.userAddress.findMany({ where: { userId } })
  if (addresses.length !== 1 || !addresses[0].isDefault || addresses[0].label !== '家') {
    throw new Error('address was not created as the first default address')
  }
  console.log('PASS settings browser creates the first default address')

  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑地址' })
  await editDialog.waitFor({ timeout: 10000 })
  await editDialog.getByPlaceholder('11位手机号').fill('')
  await editDialog.getByRole('button', { name: '保存地址' }).click()
  await editDialog.getByRole('alert').filter({ hasText: '请填写正确的手机号' }).waitFor()
  await editDialog.getByPlaceholder('11位手机号').fill('13900139000')
  await editDialog.getByPlaceholder('街道、楼栋、门牌号等').fill('测试大道 99 号 602 室')
  await editDialog.getByRole('button', { name: '保存地址' }).click()
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
