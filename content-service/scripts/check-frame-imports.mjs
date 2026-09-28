import fs from 'fs'
import path from 'path'
import { createCanvas } from 'canvas'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
const phone = `193${runId}`
let userId = null
let batchId = null
const assetIds = []
const objectKeys = []
const uiFolder = path.resolve(process.cwd(), '.codex-tmp', `frame-import-ui-${runId}`)
let browser = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

function png(color, label) {
  const canvas = createCanvas(80, 80)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, 80, 80)
  context.fillStyle = '#111'
  context.font = '20px sans-serif'
  context.fillText(label, 30, 46)
  return canvas.toBuffer('image/png')
}

async function request(url, token, options = {}) {
  return fetch(`${apiBase}${url}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } })
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  await fs.promises.rm(uiFolder, { recursive: true, force: true }).catch(() => {})
  const files = objectKeys.length ? await prisma.privateFile.findMany({ where: { objectKey: { in: objectKeys } } }) : []
  if (assetIds.length) {
    await prisma.animationAssetTag.deleteMany({ where: { assetId: { in: assetIds } } }).catch(() => {})
    await prisma.animationAssetVersion.deleteMany({ where: { assetId: { in: assetIds } } }).catch(() => {})
  }
  if (batchId) await prisma.frameAssetImportBatch.deleteMany({ where: { id: batchId } }).catch(() => {})
  if (assetIds.length) await prisma.animationAsset.deleteMany({ where: { id: { in: assetIds } } }).catch(() => {})
  await prisma.animationTag.deleteMany({ where: { name: { in: ['批量测试', '共同标签', '共同追加'] }, assets: { none: {} } } }).catch(() => {})
  if (files.length) await prisma.privateFile.deleteMany({ where: { id: { in: files.map(file => file.id) } } }).catch(() => {})
  for (const file of files) {
    const target = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR || 'storage', ...file.objectKey.split('/'))
    await fs.promises.rm(target, { force: true }).catch(() => {})
  }
  if (userId) {
    await prisma.operationLog.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.smsCode.deleteMany({ where: { OR: [{ userId }, { phone }] } }).catch(() => {})
    await prisma.userProfile.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({ data: {
    phone, role: 3, staffRole: 'OWNER', privacyAgreedAt: new Date(), privacyPolicyVersion: 'frame-import-test',
    profile: { create: { nickname: `frame-import-${runId}` } }
  } })
  userId = user.id
  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const loginResponse = await fetch(`${apiBase}/api/v1/auth/sms/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' }) })
  const login = await loginResponse.json()
  assert(loginResponse.ok && login.success, '批量导入测试负责人可以登录')
  const token = login.data.accessToken

  const frames = [png('#f7dc6f', '1'), png('#82e0aa', '2'), png('#85c1e9', '3'), png('#f1948a', '4')]
  const groups = [
    { folderName: `两帧-${runId}`, title: `两帧动画-${runId}`, tags: ['批量测试'], files: frames.slice(0, 2).map((buffer, index) => ({ name: `${index + 1}.png`, type: 'image/png', size: buffer.length })) },
    { folderName: `四帧-${runId}`, title: `四帧动画-${runId}`, tags: ['批量测试'], files: frames.map((buffer, index) => ({ name: `${index + 1}.png`, type: 'image/png', size: buffer.length })) }
  ]
  const createBody = {
    clientRequestId: `frame-import-${runId}`,
    batchType: 'COMPANY', defaults: { sourceChannel: 'INTERNAL_CREATED', usageType: 'INTERNAL_TEST', rightsHolderType: 'COMPANY', rightsHolderName: '哞屋', authorizationStatus: 'PRIVATE_ONLY', tags: ['共同标签'] }, groups
  }
  const createResponse = await request('/api/admin/frame-imports', token, { method: 'POST', body: JSON.stringify(createBody) })
  const created = await createResponse.json()
  assert(createResponse.status === 201 && created.data.uploads.length === 6, '一个批次登记两套动画和六张序列帧')
  batchId = created.data.id
  const replayResponse = await request('/api/admin/frame-imports', token, { method: 'POST', body: JSON.stringify(createBody) })
  const replayed = await replayResponse.json()
  assert(replayResponse.ok && replayed.data.id === batchId && replayed.data.uploads.length === 6, '相同创建标识重试复用原批次并重新签发待上传凭证')
  objectKeys.push(...replayed.data.uploads.map(upload => upload.objectKey))
  const buffers = [...frames.slice(0, 2), ...frames]
  for (let index = 0; index < replayed.data.uploads.length; index += 1) {
    const upload = replayed.data.uploads[index]
    const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: buffers[index] })
    assert(put.ok, `第 ${index + 1} 张测试帧上传成功`)
    const complete = await request(upload.completeUrl.replace(apiBase, ''), token, { method: 'POST' })
    assert(complete.ok, `第 ${index + 1} 张测试帧内容校验成功`)
  }

  const preflightResponse = await request(`/api/admin/frame-imports/${batchId}/preflight`, token, { method: 'POST' })
  const preflight = await preflightResponse.json()
  assert(preflightResponse.ok && preflight.data.ready === 2 && preflight.data.blocked === 0, '两帧和四帧动画均通过服务器预检')
  let detailResponse = await request(`/api/admin/frame-imports/${batchId}`, token)
  let detail = await detailResponse.json()
  assert(detail.data.items.every(item => item.previewUrl && ['READY', 'WARNING'].includes(item.status)), '批次详情提供私有首帧预览和逐套状态')
  const itemIds = detail.data.items.map(item => item.id)
  const bulkResponse = await request(`/api/admin/frame-imports/${batchId}/items`, token, { method: 'PATCH', body: JSON.stringify({ itemIds, addTags: ['共同追加'] }) })
  assert(bulkResponse.ok, '选中项目可以批量追加共同标签')

  const commitResponse = await request(`/api/admin/frame-imports/${batchId}/commit`, token, { method: 'POST', body: JSON.stringify({ itemIds }) })
  const committed = await commitResponse.json()
  assetIds.push(...committed.data.results.filter(item => item.status === 'IMPORTED').map(item => item.id && detail.data.items.find(row => row.id === item.id)?.animationAssetId).filter(Boolean))
  assert(commitResponse.ok && committed.data.results.every(item => item.status === 'IMPORTED'), '两套动画分别完成正式入库')
  detailResponse = await request(`/api/admin/frame-imports/${batchId}`, token)
  detail = await detailResponse.json()
  assetIds.length = 0
  assetIds.push(...detail.data.items.map(item => item.animationAssetId).filter(Boolean))
  assert(detail.data.status === 'COMPLETED' && detail.data.items.every(item => item.assetNo?.startsWith('ANM-')), '批次完成并为每个文件夹生成独立 ANM')
  const versions = await prisma.animationAssetVersion.findMany({ where: { assetId: { in: assetIds } }, orderBy: { baseFrameCount: 'asc' } })
  assert(versions.length === 2 && versions[0].versionNo === 1 && versions[0].baseFrameCount === 2 && versions[1].baseFrameCount === 4, '每套动画生成不可覆盖的 V1 并保留实际帧数')
  const tagLinks = await prisma.animationAssetTag.findMany({ where: { assetId: { in: assetIds } }, include: { tag: true } })
  assert(tagLinks.some(link => link.tag.name === '共同追加'), '批量追加的标签写入正式资产')

  await fs.promises.mkdir(path.join(uiFolder, '动画甲'), { recursive: true })
  await fs.promises.mkdir(path.join(uiFolder, '动画乙'), { recursive: true })
  await fs.promises.writeFile(path.join(uiFolder, '动画甲', '1.png'), frames[0])
  await fs.promises.writeFile(path.join(uiFolder, '动画甲', '2.png'), frames[1])
  await fs.promises.writeFile(path.join(uiFolder, '动画乙', '1.png'), frames[2])
  await fs.promises.writeFile(path.join(uiFolder, '动画乙', '2.png'), frames[3])
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token, apiBase })
  await page.goto('http://127.0.0.1:4173/app/admin/frame-imports', { waitUntil: 'networkidle' })
  await page.locator('#folderInput').setInputFiles(uiFolder)
  await page.locator('input.row-title[value="动画甲"]').waitFor()
  assert(await page.locator('#itemRows tr').count() === 2 && await page.getByText(/2 套动画 · 4 张图片/).count() === 1, '浏览器把第一层两个子文件夹识别为两套动画')
  await page.locator('#defaultTags').fill('网页共同标签')
  await page.getByRole('button', { name: '将共同资料应用到全部' }).click()
  assert(await page.locator('input.row-tags[value="网页共同标签"]').count() === 2, '页面可以一次把共同标签应用到全部动画')
  await page.goto(`http://127.0.0.1:4173/app/admin/frame-imports?batchId=${encodeURIComponent(batchId)}`, { waitUntil: 'networkidle' })
  await page.getByText(detail.data.items[0].assetNo, { exact: true }).waitFor()
  assert(await page.locator('#itemRows .status-imported').count() === 2, '已完成批次重新打开后展示逐套入库结果和 ANM')
  await page.goto(`http://127.0.0.1:5500/mowo/frontend/pages/admin-frame-imports.html?batchId=${encodeURIComponent(batchId)}`, { waitUntil: 'networkidle' })
  assert(new URL(page.url()).pathname === '/app/admin/frame-imports' && new URL(page.url()).searchParams.get('batchId') === batchId, '旧批量导入地址保留查询参数并交给 Vue')
  await page.getByText(detail.data.items[0].assetNo, { exact: true }).waitFor()
  assert(await page.locator('#itemRows .status-imported').count() === 2, '旧地址跳转后仍可查看已完成批次')
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'frame-imports-completed.png'), fullPage: true })
  await context.close()
  await browser.close()
  browser = null
  console.log('Frame asset batch import checks passed')
} finally {
  await cleanup()
}
