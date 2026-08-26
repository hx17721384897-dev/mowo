import AdmZip from 'adm-zip'
import { createCanvas } from 'canvas'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { buildProductionDocx, inspectDocxTemplate, parseFrameSizeMm } from '../src/lib/production-artifacts.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

function coloredPng(color, number) {
  const canvas = createCanvas(240, 240)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 240, 240)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 80px Arial'
  ctx.fillText(String(number), 90, 145)
  return canvas.toBuffer('image/png')
}

const rows = Array.from({ length: 3 }, () => new TableRow({
  children: Array.from({ length: 4 }, () => new TableCell({ children: [new Paragraph('FRAME')] }))
}))
const template = await Packer.toBuffer(new Document({ sections: [{ children: [new Table({ rows })] }] }))
const inspection = inspectDocxTemplate(template)
assert(inspection.cellCount === 12 && inspection.tableCount === 1, '一页 Word 模板可以识别 12 个帧位')
assert(parseFrameSizeMm('5×5cm').width === 50 && parseFrameSizeMm('16*9cm').height === 90, '尺寸文字可以转换为毫米')

const frames = ['#cc3344', '#278a55', '#2867b2', '#8c42a1'].map(coloredPng)
const output = buildProductionDocx(template, frames, 24, {
  framesPerSheet: 12, frameWidthMm: 50, frameHeightMm: 50
})
const zip = new AdmZip(output)
const xml = zip.getEntry('word/document.xml').getData().toString('utf8')
const media = zip.getEntries().filter(entry => entry.entryName.startsWith('word/media/mowo-production-'))
assert(media.length === 24, '24 帧文件会自动复制一页模板并插入 24 张图片')
assert((xml.match(/rIdMowoProduction/g) || []).length === 24, '每个帧位均绑定独立图片关系')
assert(media[0].getData().equals(frames[0]) && media[4].getData().equals(frames[0]), '4 张编辑帧按 1、2、3、4 循环插入')
console.log('Production artifact checks passed')

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const storageRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || 'storage/private')
const runId = String(Date.now()).slice(-9)
const physicalKeys = []
let userId, assetId, versionId, groupId, browser

async function request(url, token, options = {}) {
  return fetch(`${apiBase}${url}`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
}

async function store(key, buffer) {
  const target = path.resolve(storageRoot, ...key.split('/'))
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(target, buffer)
  physicalKeys.push(key)
}

try {
  const phone = `194${runId.slice(-8)}`
  const user = await prisma.user.create({ data: {
    phone, role: 3, staffRole: 'OWNER', privacyAgreedAt: new Date(), privacyPolicyVersion: 'print-artifact-test',
    profile: { create: { nickname: `artifact-owner-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  userId = user.id
  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const loginResponse = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const loginPayload = await loginResponse.json()
  const token = loginPayload.data?.accessToken
  assert(loginResponse.status === 200 && token, '生产文件端到端测试账号可以登录')

  const frameKeys = []
  for (let index = 0; index < frames.length; index++) {
    const key = `private/library-frame/artifact-test-${runId}-${index + 1}.png`
    await store(key, frames[index])
    frameKeys.push(key)
  }
  const asset = await prisma.animationAsset.create({ data: {
    assetNo: `ANM-T-${runId}`, title: `生产文件测试-${runId}`, sourceType: 'STAFF_CREATED',
    sourceChannel: 'INTERNAL_CREATED', usageType: 'INTERNAL_TEST', rightsHolderType: 'COMPANY',
    authorizationStatus: 'PRIVATE_ONLY', createdByStaffId: userId, currentVersionNo: 1
  } })
  assetId = asset.id
  const version = await prisma.animationAssetVersion.create({ data: {
    assetId, versionNo: 1, sourceKey: `PRINT_ARTIFACT_TEST:${runId}`, sourceType: 'STAFF_CREATED',
    createdByUserId: userId, frameKeys, baseFrameCount: 4, manifestHash: crypto.createHash('sha256').update(runId).digest('hex')
  } })
  versionId = version.id
  const group = await prisma.printCutGroup.create({ data: {
    code: `PCG-T-${runId}`, name: `A4 5x5 单页12帧测试-${runId}`, size: '5×5cm', paperSize: 'A4',
    paperType: '测试打印纸', orientation: 'LANDSCAPE', frameWidthMm: 50, frameHeightMm: 50,
    framesPerSheet: 12, renderDpi: 300, separatorMicrons: 460, createdBy: userId
  } })
  groupId = group.id

  const form = new FormData()
  form.append('file', new Blob([template], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'A4-5x5-12.docx')
  const uploadResponse = await request(`/api/admin/print-production/groups/${groupId}/templates`, token, { method: 'POST', body: form })
  const uploadPayload = await uploadResponse.json()
  assert(uploadResponse.status === 201 && uploadPayload.data.versionNo === 1, '真实接口可以上传并登记 Word 模板 V1')
  physicalKeys.push(uploadPayload.data.objectKey)

  const generateResponse = await request(`/api/admin/frame-library/${assetId}/production-files`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ animationVersionId: versionId, templateVersionId: uploadPayload.data.id, targetFrameCount: 24, markerEnabled: true })
  })
  const generated = await generateResponse.json()
  assert(generateResponse.status === 201 && generated.data.displayName.includes('24帧'), '真实接口可以生成按规格命名的 24 帧生产文件')
  const storedFile = await prisma.productionPrintFile.findUnique({ where: { id: generated.data.id }, include: { render: true } })
  physicalKeys.push(storedFile.objectKey, ...(Array.isArray(storedFile.render.frameKeys) ? storedFile.render.frameKeys : []))
  assert(storedFile.targetFrameCount === 24 && storedFile.render.frameKeys.length === 4, '24 帧文档只保存 4 张循环拼接帧')

  const detailResponse = await request(`/api/admin/frame-library/${assetId}`, token)
  const detail = (await detailResponse.json()).data
  assert(detail.productionFiles[0].displayName === generated.data.displayName && detail.productionFiles[0].downloadUrl, '资产详情返回具体文件名和下载链接')
  const downloadResponse = await fetch(detail.productionFiles[0].downloadUrl)
  const downloaded = Buffer.from(await downloadResponse.arrayBuffer())
  assert(downloadResponse.status === 200 && inspectDocxTemplate(downloaded).cellCount === 24, '浏览器签名链接可以下载包含两页帧位的 Word 文件')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), token)
  await page.goto(`${webBase}/admin-print-production.html`, { waitUntil: 'networkidle' })
  await page.getByText(group.name).waitFor()
  assert((await page.getByText(/测试打印纸.*50×50mm.*单页12帧.*300DPI/).count()) === 1, '打印设置页清楚展示纸张、成品尺寸、单页帧数和 DPI')
  assert((await page.getByText(/当前模板：A4-5x5-12\.docx · V1/).count()) === 1, '打印设置页展示当前 Word 模板版本')
  await page.goto(`${webBase}/admin-frame-library.html?keyword=${encodeURIComponent(asset.assetNo)}`, { waitUntil: 'networkidle' })
  await page.getByText(generated.data.displayName).first().waitFor()
  assert((await page.getByText(generated.data.displayName).count()) >= 1, '资产卡片直接展示可下载的规格文件名')
  await page.getByText(asset.assetNo).first().click()
  await page.getByRole('button', { name: '新增文件版本' }).waitFor()
  assert((await page.getByText('生产文件', { exact: true }).count()) >= 1, '资产详情包含独立生产文件模块')
  await page.getByRole('button', { name: '新增文件版本' }).click()
  await page.locator('#productionTargetFrames').fill('24')
  assert((await page.locator('#productionTemplate option').count()) === 1, '新增文件时只列出倍数和整页规则兼容的模板')
  await context.close()
  console.log('Production artifact integration checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  if (assetId) await prisma.productionPrintFile.deleteMany({ where: { assetId } }).catch(() => {})
  if (versionId) await prisma.productionFrameRender.deleteMany({ where: { animationVersionId: versionId } }).catch(() => {})
  if (groupId) await prisma.printTemplateVersion.deleteMany({ where: { groupId } }).catch(() => {})
  if (groupId) await prisma.printCutGroup.deleteMany({ where: { id: groupId } }).catch(() => {})
  if (versionId) await prisma.animationAssetVersion.deleteMany({ where: { id: versionId } }).catch(() => {})
  if (assetId) await prisma.animationAsset.deleteMany({ where: { id: assetId } }).catch(() => {})
  if (userId) {
    await prisma.smsCode.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.operationLog.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.userProfile.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.creditScore.deleteMany({ where: { userId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
  }
  for (const key of [...new Set(physicalKeys)]) {
    await fs.promises.rm(path.resolve(storageRoot, ...key.split('/')), { force: true }).catch(() => {})
  }
  await prisma.$disconnect()
}
