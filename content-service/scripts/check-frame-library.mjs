import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-7)
const users = []
const assetIds = []
const fileIds = []
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
  const phone = `197${runId}${index}`
  const user = await prisma.user.create({ data: {
    phone, role, staffRole, privacyAgreedAt: new Date(), privacyPolicyVersion: 'frame-library-test',
    profile: { create: { nickname: `frame-${label}-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  users.push(user)
  await prisma.smsCode.create({ data: { phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const response = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assert(response.status === 200, `${label} 测试账号可以登录`)
  return { ...user, phone, token: (await response.json()).data.accessToken }
}

async function readyFrame(ownerUserId, suffix) {
  const file = await prisma.privateFile.create({ data: {
    ownerUserId, purpose: 'LIBRARY_FRAME', objectKey: `private/library_frame/${ownerUserId}/${runId}-${suffix}.png`,
    originalName: `${suffix}.png`, declaredMimeType: 'image/png', detectedMimeType: 'image/png',
    declaredSizeBytes: 68, sizeBytes: 68, sha256: `${suffix}`.padEnd(64, '0').slice(0, 64), status: 'READY', uploadedAt: new Date()
  } })
  fileIds.push(file.id)
  return file
}

async function createAsset(token, frame, overrides = {}) {
  const response = await request('/api/admin/frame-library', token, { method: 'POST', body: JSON.stringify({
    title: `资产库测试-${runId}`, sourceChannel: 'OFFLINE_CUSTOM', usageType: 'PRIVATE_CUSTOM',
    rightsHolderType: 'OFFLINE_CUSTOMER', rightsHolderName: `线下客户-${runId}`,
    authorizationStatus: 'PRIVATE_ONLY', frameKeys: [frame.objectKey], tags: ['自动验收'], ...overrides
  }) })
  const payload = await response.json()
  if (response.status === 201) assetIds.push(payload.data.id)
  return { response, payload }
}

async function cleanup() {
  if (assetIds.length) {
    await prisma.collabWork.updateMany({ where: { animationAssetId: { in: assetIds } }, data: { animationAssetId: null, animationVersionId: null } })
    await prisma.animationAssetTag.deleteMany({ where: { assetId: { in: assetIds } } })
    await prisma.animationAssetVersion.deleteMany({ where: { assetId: { in: assetIds } } })
    await prisma.animationAsset.deleteMany({ where: { id: { in: assetIds } } })
  }
  await prisma.animationTag.deleteMany({ where: { name: '自动验收', assets: { none: {} } } })
  if (fileIds.length) await prisma.privateFile.deleteMany({ where: { id: { in: fileIds } } })
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
  const owner = await createStaff('负责人', 'OWNER', 3, 1)
  const production = await createStaff('生产人员', 'PRODUCTION', 2, 2)
  const collab = await createStaff('联名运营', 'COLLAB_OPS', 2, 3)
  const support = await createStaff('客服', 'CUSTOMER_SERVICE', 2, 4)

  assert((await request('/api/admin/frame-library?limit=1', production.token)).status === 200, '生产人员可以查看帧图总库')
  assert((await request('/api/admin/frame-library?limit=1', collab.token)).status === 200, '联名运营可以查看帧图总库')
  assert((await request('/api/admin/frame-library?limit=1', support.token)).status === 403, '客服不能浏览全部私人帧图')

  const offlineFrame = await readyFrame(owner.id, 'offline')
  const offline = await createAsset(owner.token, offlineFrame)
  assert(offline.response.status === 201 && /^ANM-/.test(offline.payload.data.assetNo), '线下客户素材会生成统一 ANM 编号和 V1')
  const offlineId = offline.payload.data.id
  const stored = await prisma.animationAsset.findUnique({ where: { id: offlineId }, include: { versions: true } })
  assert(stored.ownerUserId === null && stored.sourceChannel === 'OFFLINE_CUSTOM', '无网站账号的客户可以先以线下客户保存')
  assert(stored.usageType === 'PRIVATE_CUSTOM' && stored.authorizationStatus === 'PRIVATE_ONLY', '线下私人素材默认只能服务该客户')
  assert(stored.versions.length === 1 && stored.versions[0].versionNo === 1, '核心帧以不可覆盖版本保存')

  const bind = await request(`/api/admin/frame-library/${offlineId}`, owner.token, {
    method: 'PATCH', body: JSON.stringify({ ownerPhone: production.phone })
  })
  const bound = await prisma.animationAsset.findUnique({ where: { id: offlineId } })
  const boundFile = await prisma.privateFile.findUnique({ where: { id: offlineFrame.id } })
  assert(bind.status === 200 && bound.ownerUserId === production.id && boundFile.ownerUserId === production.id, '线下客户注册后可以绑定网站账号，帧图归属同步更新')

  const promote = await request(`/api/admin/frame-library/${offlineId}`, owner.token, {
    method: 'PATCH', body: JSON.stringify({ usageType: 'COLLAB_SALE', authorizationStatus: 'PRIVATE_ONLY' })
  })
  assert(promote.status === 400, '未经明确授权不能改为联名销售素材')
  assert((await request(`/api/admin/frame-library/${offlineId}`, owner.token, { method: 'DELETE' })).status === 409, '线下私人素材不能从总库永久删除')
  assert((await request(`/api/admin/frame-library/${offlineId}/archive`, owner.token, { method: 'POST', body: '{}' })).status === 200, '负责人可以归档私人素材')
  assert((await request(`/api/admin/frame-library/${offlineId}/restore`, owner.token, { method: 'POST', body: '{}' })).status === 200, '负责人可以恢复已归档素材')
  assert((await request(`/api/admin/frame-library/${offlineId}/archive`, production.token, { method: 'POST', body: '{}' })).status === 403, '生产人员不能修改或归档资产资料')

  const internalFrame = await readyFrame(owner.id, 'internal')
  const internal = await createAsset(owner.token, internalFrame, {
    title: `内部可删测试-${runId}`, sourceChannel: 'INTERNAL_CREATED', usageType: 'INTERNAL_TEST',
    rightsHolderType: 'COMPANY', rightsHolderName: '哞屋', authorizationStatus: 'PRIVATE_ONLY'
  })
  assert(internal.response.status === 201, '负责人可以登记内部测试帧图')
  const deleted = await request(`/api/admin/frame-library/${internal.payload.data.id}`, owner.token, { method: 'DELETE' })
  assert(deleted.status === 200, '无订单、联名、生产和历史版本关联的内部测试素材可以永久删除')
  assetIds.splice(assetIds.indexOf(internal.payload.data.id), 1)

  const list = await request(`/api/admin/frame-library?keyword=${runId}`, owner.token)
  const listData = (await list.json()).data
  assert(listData.items.some(item => item.id === offlineId && item.coverUrl), '总库支持搜索并按需返回私有预览地址')
  const version = await request(`/api/admin/frame-library/${offlineId}/versions/1`, production.token)
  const versionData = (await version.json()).data
  assert(version.status === 200 && versionData.frames[0].url && !Object.hasOwn(versionData.frames[0], 'key'), '浏览器只收到临时预览地址，不暴露内部存储路径')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), owner.token)
  await page.goto(`${webBase}/admin-frame-library.html`, { waitUntil: 'networkidle' })
  await page.getByText(offline.payload.data.assetNo).waitFor()
  assert(await page.getByRole('button', { name: '制作新帧图' }).count() === 1, '负责人页面显示后台制作入口')
  await page.getByText(offline.payload.data.assetNo).first().click()
  await page.getByText('不可覆盖版本').waitFor()
  assert(await page.getByText(`线下客户-${runId}`).count() >= 1, '详情页展示客户、版本和业务关系')
  await context.close()
  console.log('Frame library checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
