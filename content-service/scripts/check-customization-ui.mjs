import fs from 'node:fs/promises'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-7)
const userIds = []
const phones = []
const objectKeys = []
let modelId = null
let skuId = null
let browser

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7S0WQAAAABJRU5ErkJggg==', 'base64')

async function api(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type':'application/json' } : {}),
      ...(token ? { Authorization:`Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
}

async function createUser(label, index, staffRole = null, role = 0) {
  const phone = `196${runId}${index}`
  const user = await prisma.user.create({ data: {
    phone, role, staffRole, privacyAgreedAt:new Date(), privacyPolicyVersion:'custom-ui-test',
    profile:{ create:{ nickname:`ui-${label}-${runId}` } }, creditScore:{ create:{ score:100 } }
  } })
  userIds.push(user.id)
  phones.push(phone)
  await prisma.smsCode.create({ data:{ userId:user.id, phone, code:'123456', purpose:'LOGIN', expiresAt:new Date(Date.now() + 300000) } })
  const response = await api('/api/v1/auth/sms/verify', null, { method:'POST', body:JSON.stringify({ phone, code:'123456', mode:'LOGIN' }) })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(`${label} 登录准备失败`)
  return { ...user, token:result.data.accessToken }
}

async function upload(user, purpose, name) {
  const initResponse = await api('/api/upload/presign', user.token, {
    method:'POST', body:JSON.stringify({ purpose, fileName:name, fileType:'image/png', fileSize:PNG.length })
  })
  const init = await initResponse.json()
  if (!initResponse.ok || !init.success) throw new Error(init.message || '测试素材登记失败')
  objectKeys.push(init.data.objectKey)
  const put = await fetch(init.data.uploadUrl, { method:'PUT', headers:{ 'Content-Type':'image/png' }, body:PNG })
  if (put.status !== 204) throw new Error('测试素材上传失败')
  const complete = await api(new URL(init.data.completeUrl).pathname, user.token, { method:'POST' })
  if (!complete.ok) throw new Error('测试素材校验失败')
  return init.data.objectKey
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  const staleUsers = await prisma.user.findMany({
    where:{ privacyPolicyVersion:'custom-ui-test' }, select:{ id:true }
  })
  const cleanupUserIds = [...new Set([...userIds, ...staleUsers.map(item => item.id)])]
  const staleFiles = cleanupUserIds.length
    ? await prisma.privateFile.findMany({ where:{ ownerUserId:{ in:cleanupUserIds } }, select:{ objectKey:true } })
    : []
  const cleanupObjectKeys = [...new Set([...objectKeys, ...staleFiles.map(item => item.objectKey)])]
  if (cleanupUserIds.length) {
    await prisma.cartItem.deleteMany({ where:{ cart:{ userId:{ in:cleanupUserIds } } } })
    await prisma.cart.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.operationLog.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.auditLog.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.customizationRequestEvent.deleteMany({ where:{ OR:[{ actorUserId:{ in:cleanupUserIds } }, { request:{ userId:{ in:cleanupUserIds } } }] } })
    await prisma.customizationRequest.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.animationAssetVersion.deleteMany({ where:{ asset:{ ownerUserId:{ in:cleanupUserIds } } } })
    await prisma.animationAsset.deleteMany({ where:{ ownerUserId:{ in:cleanupUserIds } } })
    await prisma.customProduct.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.privateFile.deleteMany({ where:{ OR:[{ ownerUserId:{ in:cleanupUserIds } }, { objectKey:{ in:cleanupObjectKeys } }] } })
    await prisma.refreshToken.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.smsCode.deleteMany({ where:{ OR:[{ userId:{ in:cleanupUserIds } }, { phone:{ in:phones } }] } })
    await prisma.creditScore.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.userProfile.deleteMany({ where:{ userId:{ in:cleanupUserIds } } })
    await prisma.user.deleteMany({ where:{ id:{ in:cleanupUserIds } } })
  }
  if (skuId) await prisma.machineModelSku.deleteMany({ where:{ id:skuId } })
  if (modelId) await prisma.machineModel.deleteMany({ where:{ id:modelId } })
  for (const key of cleanupObjectKeys) {
    await fs.rm(new URL(`../storage/private/${key}`, import.meta.url), { force:true }).catch(() => {})
  }
  await prisma.$disconnect()
}

try {
  const owner = await createUser('owner', 1, 'OWNER', 3)
  const customer = await createUser('customer', 2)
  const model = await prisma.machineModel.create({ data:{
    name:`UI测试款-${runId}`, ratios:'["1:1"]', frameOptions:'[1]', sizes:'["S"]'
  } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data:{
    modelId, size:'S', material:'TEST', frameCount:1, colorName:`UI测试色-${runId}`, colorHex:'#FFFFFF', price:199
  } })
  skuId = sku.id
  const sourceKey = await upload(customer, 'CUSTOMIZATION_SOURCE', 'ui-source.png')
  const createResponse = await api('/api/customization-requests', customer.token, {
    method:'POST', body:JSON.stringify({
      mode:'HUMAN', machineModelId:modelId, sourceKeys:[sourceKey], clientRequestKey:`ui-${runId}`,
      userNote:'浏览器自动验收任务', screeningData:{ sourceCount:1 }
    })
  })
  const created = await createResponse.json()
  if (!createResponse.ok || !created.success) throw new Error(created.message || '人工任务创建失败')

  browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  let context = await browser.newContext({ viewport:{ width:1440, height:900 } })
  let page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), owner.token)
  await page.goto(`${webBase}/admin-customization-requests.html`, { waitUntil:'networkidle' })
  const taskRow = page.locator('.row').filter({ hasText:model.name })
  await taskRow.getByRole('button', { name:'开始筛帧' }).waitFor({ timeout:10000 })
  await taskRow.getByRole('button', { name:'开始筛帧' }).click()
  await page.locator('#stateEditor.active').waitFor({ timeout:15000 })
  await page.getByRole('button', { name:'提交给用户' }).click()
  await page.locator('#staffSubmitDialog').waitFor()
  await page.locator('#staffPublicMessage').fill('浏览器验收筛帧结果')
  await page.getByRole('button', { name:'确认提交' }).click()
  await page.waitForURL(/admin-customization-requests\.html/, { timeout:15000 })
  console.log('PASS admin claims, edits and submits frame result in browser')

  await context.close()
  context = await browser.newContext({ viewport:{ width:1440, height:900 } })
  page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  const orderDialogs = []
  page.on('dialog', async dialog => {
    orderDialogs.push(dialog.message())
    await dialog.dismiss()
  })
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), customer.token)
  await page.goto(`${webBase}/my-customizations.html`, { waitUntil:'networkidle' })
  await page.getByRole('link', { name:'确认筛帧' }).click()
  await page.locator('#stateEditor.active').waitFor({ timeout:10000 })
  await page.getByRole('button', { name:/满意，选择款式/ }).click()
  await page.waitForURL(/customize-confirm\.html/, { timeout:10000 })
  if (await page.locator('.price-card-btns input[type="checkbox"]').count()) throw new Error('私人定制仍显示联名或版权勾选项')
  if (await page.getByText(/当前金额为参考价格/).count()) throw new Error('私人定制仍显示人工确认价格提示')
  await page.locator('#frameOptions .opt-btn').first().click()
  await page.locator('#sizeOptions .opt-btn').first().click()
  await page.locator('#materialOptions .opt-btn').first().click()
  await page.locator('#colorOptions .color-opt').first().click()
  await page.getByRole('button', { name:/提交订单/ }).click()
  await page.waitForURL(/checkout\.html/, { timeout:20000 }).catch(() => {
    throw new Error(`提交订单后未进入结算页；停留在 ${page.url()}；页面提示：${orderDialogs.join(' | ') || '无'}`)
  })
  console.log('PASS customer previews staff frames and submits the customization directly to checkout')

  await page.goto(`${webBase}/my-animations.html`, { waitUntil:'networkidle' })
  const assetCard = page.locator('.anim-card').filter({ hasText:'ANM-' }).first()
  await assetCard.waitFor({ timeout:10000 })
  if (!await assetCard.getByText(/动画资产/).count() || !await assetCard.getByText(/V1/).count()) {
    throw new Error('我的动画没有把已确认内容显示为带版本的正式动画资产')
  }
  if (!await assetCard.getByRole('button', { name: /重命名/ }).count() || !await assetCard.getByRole('link', { name: /修改动画/ }).count() || !await assetCard.getByRole('link', { name: /选择新款式/ }).count()) {
    throw new Error('我的动画没有提供清晰的重命名、修改动画和再次制作入口')
  }
  await assetCard.getByRole('button', { name: /重命名/ }).click()
  await page.locator('#renameInput').fill('浏览器复购测试动画')
  await page.locator('#btnConfirmRename').click()
  await assetCard.getByText('浏览器复购测试动画').waitFor({ timeout:10000 })
  await assetCard.getByRole('link', { name: /选择新款式/ }).click()
  await page.waitForURL(/customize-start\.html\?assetId=/, { timeout:10000 })
  await page.locator('#reuseBanner.show').waitFor({ timeout:10000 })
  await page.locator('.model-card').first().getByRole('button', { name:'选择此款' }).click()
  await page.locator('#nextBtn').click()
  await page.waitForURL(/customize-confirm\.html\?.*assetId=/, { timeout:10000 })
  await page.locator('#frameOptions .opt-btn').first().click()
  await page.locator('#sizeOptions .opt-btn').first().click()
  await page.locator('#materialOptions .opt-btn').first().click()
  await page.locator('#colorOptions .color-opt').first().click()
  await page.getByRole('button', { name:/提交订单/ }).click()
  await page.waitForURL(/checkout\.html/, { timeout:20000 }).catch(() => {
    throw new Error(`已有动画选择新款式后未进入结算页；停留在 ${page.url()}；页面提示：${orderDialogs.join(' | ') || '无'}`)
  })
  console.log('PASS customer renames and reuses an animation asset for a new SKU in browser')
  console.log('PASS my animations separates reusable assets from temporary drafts')

  await page.goto(`${webBase}/my-animations.html`, { waitUntil:'networkidle' })
  const editableAssetCard = page.locator('.anim-card').filter({ hasText:'浏览器复购测试动画' }).first()
  await editableAssetCard.getByRole('link', { name:/修改动画/ }).click()
  await page.waitForURL(/customize-editor\.html\?assetId=/, { timeout:10000 })
  await page.locator('#stateEditor.active').waitFor({ timeout:10000 })
  await page.getByRole('button', { name:/保存为 V2/ }).click()
  await page.waitForURL(/my-animations\.html\?.*version=2/, { timeout:20000 })
  const v2Card = page.locator('.anim-card').filter({ hasText:'浏览器复购测试动画' }).first()
  await v2Card.getByText(/V2/).waitFor({ timeout:10000 })
  console.log('PASS customer edits the current animation and saves an immutable V2 in browser')

  await page.goto(`${webBase}/customize-editor.html?modelId=${encodeURIComponent(modelId)}`, { waitUntil:'networkidle' })
  await page.evaluate(({ meta, staleHumanRequestId }) => {
    localStorage.removeItem('mowo_customize_request_draft_id')
    localStorage.removeItem('mowo_customize_request_draft_key')
    localStorage.removeItem('mowo_customize_request_draft_owner')
    localStorage.setItem('mowo_customize_human_request_id', staleHumanRequestId)
    localStorage.setItem('mowo_customize_meta', JSON.stringify(meta))
  }, {
    meta:{ id:modelId, modelId, name:model.name, frames:[1], ratios:['1:1'], sizes:['S'], modelType:'single' },
    staleHumanRequestId:created.data.id
  })
  await page.reload({ waitUntil:'networkidle' })
  await page.locator('#fileInput').setInputFiles({ name:'self-source.png', mimeType:'image/png', buffer:PNG })
  await page.locator('#btnStartEdit').click()
  await page.locator('#stateEditor.active').waitFor({ timeout:10000 })
  await page.evaluate(() => {
    const block = 'x'.repeat(100 * 1024)
    for (let index = 0; index < 80; index += 1) {
      try { localStorage.setItem(`mowo_test_quota_${index}`, block) } catch { break }
    }
  })
  await page.getByRole('button', { name:/下一步/ }).click()
  await page.waitForURL(/customize-confirm\.html/, { timeout:20000 })
  if (!new URL(page.url()).searchParams.get('requestId')) throw new Error('选款式网址没有携带云端草稿编号')
  if (await page.evaluate(() => localStorage.getItem('mowo_customize_human_request_id'))) throw new Error('自己筛选没有清除旧人工筛选编号')
  console.log('PASS customer self-screened image reaches style selection when browser storage is full')
  await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mowo_test_quota_')).forEach(key => localStorage.removeItem(key)))

  // 即使旧版页面或手工操作再次留下人工编号，本次网址中的自己筛选草稿仍必须优先。
  await page.evaluate(staleHumanRequestId => localStorage.setItem('mowo_customize_human_request_id', staleHumanRequestId), created.data.id)
  await page.locator('#frameOptions .opt-btn').first().click()
  await page.locator('#sizeOptions .opt-btn').first().click()
  await page.locator('#materialOptions .opt-btn').first().click()
  await page.locator('#colorOptions .color-opt').first().click()
  await page.getByRole('button', { name:/提交订单/ }).click()
  await page.waitForURL(/checkout\.html/, { timeout:20000 }).catch(() => {
    throw new Error(`旧人工编号干扰了自己筛选提交；停留在 ${page.url()}；页面提示：${orderDialogs.join(' | ') || '无'}`)
  })
  console.log('PASS self-screened request ignores stale human-screening state and enters checkout')

  await page.setViewportSize({ width:390, height:844 })
  await page.goto(`${webBase}/my-customizations.html`, { waitUntil:'networkidle' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (overflow) throw new Error('我的定制移动端出现横向溢出')
  console.log('PASS customer customization list has no mobile horizontal overflow')

  if (pageErrors.length) throw new Error(`浏览器脚本错误：${pageErrors.join(' | ')}`)
  console.log('Customization browser UI checks passed')
} finally {
  await cleanup()
}
