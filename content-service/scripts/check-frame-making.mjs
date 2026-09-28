import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'fs'
import path from 'path'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const vueBase = process.env.TEST_VUE_BASE || 'http://127.0.0.1:4173/app'
const runId = String(Date.now()).slice(-7)
const users = []
const fileIds = []
const draftIds = []
const assetIds = []
let browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function request(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
}

async function createStaff(label, staffRole, role, index) {
  const phone = `196${runId}${index}`
  const user = await prisma.user.create({ data: {
    phone, role, staffRole, privacyAgreedAt: new Date(), privacyPolicyVersion: 'frame-making-test',
    profile: { create: { nickname: `making-${label}-${runId}` } }
  } })
  users.push(user)
  await prisma.smsCode.create({ data: { phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const response = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assert(response.status === 200, `${label}测试账号可以登录`)
  return { ...user, token: (await response.json()).data.accessToken }
}

async function readyFile(ownerUserId, purpose, suffix) {
  const file = await prisma.privateFile.create({ data: {
    ownerUserId, purpose, objectKey: `private/${purpose.toLowerCase()}/${ownerUserId}/${runId}-${suffix}.png`,
    originalName: `${suffix}.png`, declaredMimeType: 'image/png', detectedMimeType: 'image/png',
    declaredSizeBytes: 68, sizeBytes: 68, sha256: suffix.padEnd(64, '0').slice(0, 64),
    status: 'READY', uploadedAt: new Date()
  } })
  fileIds.push(file.id)
  return file
}

async function cleanup() {
  const ids = users.map(user => user.id)
  const ownedDrafts = ids.length ? await prisma.frameAssetDraft.findMany({
    where: { createdByStaffId: { in: ids } }, select: { id: true, animationAssetId: true }
  }) : []
  const allDraftIds = [...new Set([...draftIds, ...ownedDrafts.map(row => row.id)])]
  const allAssetIds = [...new Set([...assetIds, ...ownedDrafts.map(row => row.animationAssetId).filter(Boolean)])]
  const testFileWhere = { OR: [
    { id: { in: fileIds } },
    { ownerUserId: { in: ids } },
    { linkedResourceType: 'FRAME_ASSET_DRAFT', linkedResourceId: { in: allDraftIds } },
    { linkedResourceType: 'ANIMATION_ASSET', linkedResourceId: { in: allAssetIds } }
  ] }
  const ownedFiles = await prisma.privateFile.findMany({ where: testFileWhere, select: { objectKey: true } })
  if (allDraftIds.length) await prisma.frameAssetDraft.deleteMany({ where: { id: { in: allDraftIds } } })
  if (allAssetIds.length) {
    await prisma.animationAssetTag.deleteMany({ where: { assetId: { in: allAssetIds } } })
    await prisma.animationAssetVersion.deleteMany({ where: { assetId: { in: allAssetIds } } })
    await prisma.animationAsset.deleteMany({ where: { id: { in: allAssetIds } } })
  }
  await prisma.animationTag.deleteMany({ where: { name: '制作验收', assets: { none: {} } } })
  await prisma.privateFile.deleteMany({ where: testFileWhere })
  if ((process.env.STORAGE_PROVIDER || 'local') === 'local') {
    const storageRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || 'storage/private')
    for (const file of ownedFiles) {
      const target = path.resolve(storageRoot, ...file.objectKey.replace(/\\/g, '/').split('/'))
      if (target.startsWith(`${storageRoot}${path.sep}`)) await fs.promises.rm(target, { force: true })
    }
  }
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
  const owner = await createStaff('负责人', 'OWNER', 3, 1)
  const production = await createStaff('生产人员', 'PRODUCTION', 2, 2)
  const collab = await createStaff('联名运营', 'COLLAB_OPS', 2, 3)
  const support = await createStaff('客服', 'CUSTOMER_SERVICE', 2, 4)

  assert((await request('/api/admin/frame-making/drafts', owner.token)).status === 200, '负责人可以进入帧图制作')
  assert((await request('/api/admin/frame-making/drafts', production.token)).status === 200, '生产人员可以进入帧图制作')
  assert((await request('/api/admin/frame-making/drafts', collab.token)).status === 403, '联名运营不能进入制作工作台')
  assert((await request('/api/admin/frame-making/drafts', support.token)).status === 403, '客服不能进入制作工作台')

  const source = await readyFile(production.id, 'LIBRARY_SOURCE', 'source')
  const createRequestId = `frame-making-check-${runId}`
  const create = await request('/api/admin/frame-making/drafts', production.token, {
    method: 'POST', body: JSON.stringify({
      clientRequestId: createRequestId,
      sourceKeys: [source.objectKey], sourceType: 'IMAGES', targetRatio: '1:1',
      title: `制作验收-${runId}`, sourceMetadata: { width: 100, height: 100 }
    })
  })
  const created = await create.json()
  assert(create.status === 201 && /^FD-/.test(created.data.draftNo), '导入原素材会生成独立 FD 制作草稿')
  draftIds.push(created.data.id)
  const repeatedCreate = await request('/api/admin/frame-making/drafts', production.token, {
    method: 'POST', body: JSON.stringify({
      clientRequestId: createRequestId,
      sourceKeys: [source.objectKey], sourceType: 'IMAGES', targetRatio: '1:1',
      title: `制作验收-${runId}`, sourceMetadata: { width: 100, height: 100 }
    })
  })
  const repeatedCreated = await repeatedCreate.json()
  assert(repeatedCreate.status === 200 && repeatedCreated.data.id === created.data.id,
    '网络重试同一创建请求不会生成重复草稿')
  const linkedSource = await prisma.privateFile.findUnique({ where: { id: source.id } })
  assert(linkedSource.linkedResourceType === 'FRAME_ASSET_DRAFT', '原素材只绑定制作草稿，不会伪装成正式帧图')

  const detailResponse = await request(`/api/admin/frame-making/drafts/${created.data.id}`, owner.token)
  const detail = (await detailResponse.json()).data
  assert(detailResponse.status === 200 && detail.sources[0].url && !Object.hasOwn(detail, 'sourceKeys'), '员工只收到短期素材地址，不暴露内部存储路径')

  const save = await request(`/api/admin/frame-making/drafts/${created.data.id}`, production.token, {
    method: 'PATCH', body: JSON.stringify({
      revision: created.data.revision, editorData: { selectedIds: ['image-0'], playbackMs: 220 },
      title: `制作验收-${runId}`, tags: ['制作验收']
    })
  })
  const saved = await save.json()
  assert(save.status === 200 && saved.data.revision === created.data.revision + 1, '生产人员可以保存筛选结果')
  const conflict = await request(`/api/admin/frame-making/drafts/${created.data.id}`, owner.token, {
    method: 'PATCH', body: JSON.stringify({ revision: created.data.revision, title: '过期修改' })
  })
  assert(conflict.status === 409, '多人同时编辑时会拦截旧版本覆盖')

  const submitReview = await request(`/api/admin/frame-making/drafts/${created.data.id}/submit-review`, production.token, {
    method: 'POST', body: JSON.stringify({ revision: saved.data.revision })
  })
  const submitted = await submitReview.json()
  assert(submitReview.status === 200 && submitted.data.status === 'READY_FOR_REVIEW', '生产人员完成筛帧后会提交负责人确认')
  const productionEditAfterSubmit = await request(`/api/admin/frame-making/drafts/${created.data.id}`, production.token, {
    method: 'PATCH', body: JSON.stringify({ revision: submitted.data.revision, title: '不应被修改' })
  })
  assert(productionEditAfterSubmit.status === 409, '待负责人确认后生产人员不能继续修改')
  const ownerReviewSave = await request(`/api/admin/frame-making/drafts/${created.data.id}`, owner.token, {
    method: 'PATCH', body: JSON.stringify({ revision: submitted.data.revision, tags: ['制作验收'] })
  })
  const ownerReviewed = await ownerReviewSave.json()
  assert(ownerReviewSave.status === 200 && ownerReviewed.data.revision === submitted.data.revision + 1, '负责人可以在确认阶段补充资料')

  const productionPublish = await request(`/api/admin/frame-making/drafts/${created.data.id}/publish`, production.token, {
    method: 'POST', body: JSON.stringify({ frameKeys: [] })
  })
  assert(productionPublish.status === 403, '生产人员不能把草稿正式发布进资产库')

  const beforeRequests = await prisma.customizationRequest.count()
  const beforeOrders = await prisma.salesOrder.count()
  const frame = await readyFile(owner.id, 'LIBRARY_FRAME', 'frame')
  const publish = await request(`/api/admin/frame-making/drafts/${created.data.id}/publish`, owner.token, {
    method: 'POST', body: JSON.stringify({ frameKeys: [frame.objectKey] })
  })
  const published = await publish.json()
  assert(publish.status === 201 && /^ANM-/.test(published.data.assetNo), '负责人确认后生成正式 ANM 和 V1')
  assetIds.push(published.data.id)
  const storedDraft = await prisma.frameAssetDraft.findUnique({ where: { id: created.data.id } })
  const storedAsset = await prisma.animationAsset.findUnique({ where: { id: published.data.id }, include: { versions: true } })
  assert(storedDraft.status === 'PUBLISHED' && storedDraft.animationAssetId === storedAsset.id, 'FD 草稿保留并关联正式资产，来源可追溯')
  assert(storedAsset.versions.length === 1 && storedAsset.versions[0].versionNo === 1, '正式入库形成不可覆盖的 V1')
  assert(await prisma.customizationRequest.count() === beforeRequests && await prisma.salesOrder.count() === beforeOrders, '后台制作不会误生成用户定制或销售订单')
  assert((await request(`/api/admin/frame-making/drafts/${created.data.id}/publish`, owner.token, {
    method: 'POST', body: JSON.stringify({ frameKeys: [frame.objectKey] })
  })).status === 200, '重复确认不会生成第二套动画')

  const abandonSource = await readyFile(production.id, 'LIBRARY_SOURCE', 'abandon')
  const abandonCreate = await request('/api/admin/frame-making/drafts', production.token, {
    method: 'POST', body: JSON.stringify({ sourceKeys: [abandonSource.objectKey], sourceType: 'IMAGES', targetRatio: '1:1' })
  })
  const abandonDraft = (await abandonCreate.json()).data
  draftIds.push(abandonDraft.id)
  assert((await request(`/api/admin/frame-making/drafts/${abandonDraft.id}/abandon`, production.token, {
    method: 'POST', body: '{}'
  })).status === 200, '草稿建立者可以放弃未完成草稿')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token: owner.token, apiBase })
  await page.goto(`${vueBase}/admin/frame-making`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '制作草稿' }).waitFor()
  assert(await page.getByText('帧图制作', { exact: true }).count() >= 1, 'Vue 后台导航和独立制作页面正常显示')
  assert(await page.getByRole('button', { name: '开始制作' }).count() === 1, '负责人可以从后台开始新的制作流程')
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.locator('.menu-btn').isVisible(), '窄屏下保留可操作的后台菜单')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '开始制作' }).click()
  await page.getByLabel('草稿名称').fill(`浏览器制作验收-${runId}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'browser-frame.png', mimeType: 'image/png',
    buffer: fs.readFileSync(path.resolve(process.cwd(), '../frontend-vue/node_modules/cropperjs/src/images/bg.png'))
  })
  await page.getByRole('button', { name: '上传并开始筛选' }).click()
  await page.waitForURL(/\/app\/admin\/frame-making\/[^/?]+\/?(?:\?.*)?$/, { timeout: 30_000 }).catch(async error => {
    const diagnostic = {
      url: page.url(),
      buttonDisabled: await page.getByRole('button', { name: '上传并开始筛选' }).isDisabled().catch(() => null),
      error: await page.locator('.error-box').textContent().catch(() => null),
      toast: await page.locator('.toast').textContent().catch(() => null)
    }
    throw new Error(`Vue 制作草稿未进入编辑器：${JSON.stringify(diagnostic)}`, { cause: error })
  })
  await page.locator('.candidate.selected').first().waitFor()
  assert(await page.getByText('1 帧', { exact: true }).count() >= 1, '浏览器真实上传图片后会进入 Vue 完整筛帧器并选中候选帧')
  assert(await page.getByRole('button', { name: /相似帧去重|每 2 帧抽取|撤销/ }).count() === 3,
    'Vue 后台保留去重、抽帧和撤销功能')
  assert(await page.locator('.making-topbar').isVisible(), '后台筛帧期间不会跳回用户前台导航')
  await page.getByRole('button', { name: '填写入库资料' }).click()
  await page.getByRole('heading', { name: '确认入库资料' }).waitFor()
  await page.getByRole('button', { name: '确认并加入资产库' }).click()
  await page.waitForURL(/\/app\/admin\/frame-library\?keyword=ANM-/)
  await page.locator('.asset-card').first().waitFor()
  assert(await page.getByText(`浏览器制作验收-${runId}`).count() >= 1, '负责人可以从浏览器完整发布并在总库定位新动画')
  await context.close()

  const audit = await prisma.auditLog.findFirst({ where: { userId: owner.id, action: 'FRAME_MAKING_DRAFT_PUBLISHED' } })
  assert(Boolean(audit), '正式入库会留下负责人审计记录')
  console.log('Frame making checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
