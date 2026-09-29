import AdmZip from 'adm-zip'
import { createCanvas } from 'canvas'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
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
  size: '5x5cm', framesPerSheet: 12, frameWidthMm: null, frameHeightMm: null
})
const zip = new AdmZip(output)
const xml = zip.getEntry('word/document.xml').getData().toString('utf8')
const media = zip.getEntries().filter(entry => entry.entryName.startsWith('word/media/mowo-production-'))
assert(media.length === 24, '24 帧文件会自动复制一页模板并插入 24 张图片')
assert((xml.match(/rIdMowoProduction/g) || []).length === 24, '每个帧位均绑定独立图片关系')
assert(xml.includes('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"') && xml.includes('xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'), '生成文件声明完整的 Word 图片命名空间')
assert(xml.includes('<wp:extent cx="1800000" cy="1800000"/>'), '旧打印组宽高为空时会从 5x5cm 推算实际显示尺寸')
assert(media[0].getData().equals(frames[0]) && media[4].getData().equals(frames[0]), '4 张编辑帧按 1、2、3、4 循环插入')
const secondPageOnly = buildProductionDocx(template, frames, 24, {
  size: '5x5cm', framesPerSheet: 12, frameWidthMm: null, frameHeightMm: null
}, [2])
const secondPageZip = new AdmZip(secondPageOnly)
const secondPageXml = secondPageZip.getEntry('word/document.xml').getData().toString('utf8')
const secondPageMedia = secondPageZip.getEntries().filter(entry => entry.entryName.startsWith('word/media/mowo-production-'))
assert(secondPageMedia.length === 12 && (secondPageXml.match(/w:type="page"/g) || []).length === 0, '24 帧返工只选择第 2 页时只生成一页 12 个帧位')

const partialPageOutput = buildProductionDocx(template, frames, 16, {
  size: '8x8cm', framesPerSheet: 6, frameWidthMm: 80, frameHeightMm: 80
})
const partialPageZip = new AdmZip(partialPageOutput)
const partialPageXml = partialPageZip.getEntry('word/document.xml').getData().toString('utf8')
const partialPageMedia = partialPageZip.getEntries().filter(entry => entry.entryName.startsWith('word/media/mowo-production-'))
assert(partialPageMedia.length === 16 && (partialPageXml.match(/w:type="page"/g) || []).length === 2, '16 帧使用每页 6 帧模板时生成 6+6+4 共三页')
const partialLastPage = buildProductionDocx(template, frames, 16, {
  size: '8x8cm', framesPerSheet: 6, frameWidthMm: 80, frameHeightMm: 80
}, [3])
const partialLastPageZip = new AdmZip(partialLastPage)
const partialLastPageMedia = partialLastPageZip.getEntries().filter(entry => entry.entryName.startsWith('word/media/mowo-production-'))
assert(partialLastPageMedia.length === 4, '16 帧文件返工第 3 页时只插入最后 4 帧')
console.log('Production artifact checks passed')

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const storageRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || 'storage/private')
const runId = String(Date.now()).slice(-9)
const physicalKeys = []
let userId, assetId, versionId, groupId, browser
let reprintModelId, reprintSkuId, reprintPreOrderId, reprintOrderId, reprintItemId, reprintTaskId, reprintBatchId

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
    profile: { create: { nickname: `artifact-owner-${runId}` } }
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
  assert(storedFile.render.frameKeys.every((key, index) => key.endsWith(`/frame-${String(index + 1).padStart(3, '0')}.png`)), '加工帧在独立任务目录内按 frame-001.png 顺序命名')

  const renderFramesResponse = await request(`/api/admin/frame-library/${assetId}/production-files/${generated.data.id}/frames`, token)
  const renderFrames = (await renderFramesResponse.json()).data
  assert(renderFramesResponse.status === 200 && renderFrames.frames.length === 4 && renderFrames.frames[0].name === 'frame-001.png', '加工帧预览接口按顺序返回友好文件名和临时地址')

  const detailResponse = await request(`/api/admin/frame-library/${assetId}`, token)
  const detail = (await detailResponse.json()).data
  assert(detail.productionFiles[0].displayName === generated.data.displayName && detail.productionFiles[0].downloadUrl, '资产详情返回具体文件名和下载链接')
  const downloadResponse = await fetch(detail.productionFiles[0].downloadUrl)
  const downloaded = Buffer.from(await downloadResponse.arrayBuffer())
  assert(downloadResponse.status === 200 && inspectDocxTemplate(downloaded).cellCount === 24, '浏览器签名链接可以下载包含两页帧位的 Word 文件')

  const reprintModel = await prisma.machineModel.create({ data: {
    name: `返工测试款-${runId}`, ratios: '["1:1"]', frameOptions: '[24]', sizes: '["5×5cm"]'
  } })
  reprintModelId = reprintModel.id
  const reprintSku = await prisma.machineModelSku.create({ data: {
    modelId: reprintModelId, size: '5×5cm', material: '测试材料', frameCount: 24,
    colorName: '测试色', colorHex: '#FFFFFF', skuCode: `REPRINT-${runId}`
  } })
  reprintSkuId = reprintSku.id
  await prisma.printCutRule.create({ data: { groupId, skuId: reprintSkuId, pagesPerUnit: 2 } })
  const preOrder = await prisma.preOrder.create({ data: {
    userId, cartItemIds: '[]', checkoutIdempotencyKey: `reprint-${runId}`, status: 'paid',
    totalAmount: '10.00', receiverName: '返工测试', receiverPhone: `196${runId.slice(-8)}`,
    receiverAddress: '测试地址', receiverCity: '测试市', expiresAt: new Date(Date.now() + 600000)
  } })
  reprintPreOrderId = preOrder.id
  const salesOrder = await prisma.salesOrder.create({ data: {
    orderNo: `SO-REPRINT-${runId}`, userId, preOrderId: reprintPreOrderId, status: 'paid',
    fulfillmentStatus: 'PRODUCING', totalAmount: '10.00', receiverName: '返工测试',
    receiverPhone: `196${runId.slice(-8)}`, receiverAddress: '测试地址', receiverCity: '测试市', paidAt: new Date()
  } })
  reprintOrderId = salesOrder.id
  const salesItem = await prisma.salesOrderItem.create({ data: {
    itemNo: `SO-REPRINT-${runId}-01`, salesOrderId: reprintOrderId, itemType: 'CUSTOM', contentId: assetId,
    animationAssetId: assetId, animationVersionId: versionId, skuId: reprintSkuId, skuCode: reprintSku.skuCode,
    snapshotTitle: '返工测试商品', unitPrice: '10.00', quantity: 1, lineTotal: '10.00'
  } })
  reprintItemId = salesItem.id
  const task = await prisma.customizeOrder.create({ data: {
    orderNo: `PU-REPRINT-${runId}`, userId, modelId: reprintModelId, modelName: reprintModel.name,
    frameCount: 24, size: '5×5cm', material: '测试材料', color: '#FFFFFF', colorName: '测试色',
    skuId: reprintSkuId, ossPath: '', frameUrls: JSON.stringify(frameKeys), status: 'producing',
    sourceType: 'custom', receiverName: '返工测试', receiverPhone: `196${runId.slice(-8)}`,
    receiverAddress: '测试地址', receiverCity: '测试市', salesOrderItemId: reprintItemId, unitIndex: 1
  } })
  reprintTaskId = task.id
  reprintBatchId = `PB-20990101-${runId.slice(-6).toUpperCase()}`
  await prisma.productionBatch.create({ data: {
    id: reprintBatchId, operatorId: userId, clientRequestId: `artifact-${runId}`,
    requestFingerprint: '0'.repeat(64), status: 'IN_PROGRESS', salesOrderCount: 1,
    productionUnitCount: 1, skuCount: 1
  } })
  await prisma.productionBatchOrder.create({ data: {
    batchId: reprintBatchId, salesOrderId: reprintOrderId, orderNoSnapshot: salesOrder.orderNo, status: 'PRODUCING'
  } })
  await prisma.productionBatchUnit.create({ data: {
    batchId: reprintBatchId, productionUnitId: reprintTaskId, salesOrderId: reprintOrderId,
    skuId: reprintSkuId, productionNoSnapshot: task.orderNo, printGroupId: groupId,
    printGroupCode: group.code, printGroupName: group.name, printSequence: 1, printPageCount: 2,
    frameStatus: 'IN_PROGRESS', materialStatus: 'IN_PROGRESS'
  } })
  const oldPack = await prisma.productionFramePack.create({ data: {
    code: `FP-REPRINT-${runId}-01`, productionUnitId: reprintTaskId, salesOrderId: reprintOrderId,
    batchId: reprintBatchId, skuId: reprintSkuId, animationVersionId: versionId,
    targetFrameCount: 24, size: '5×5cm', status: 'IN_PROGRESS', createdBy: userId
  } })
  const reprintResponse = await request(`/api/admin/production-workflow/units/${reprintTaskId}/reprint`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages: [2], reason: '自动测试：第2页裁切损坏', clientRequestId: `artifact-reprint-${runId}` })
  })
  const reprintPayload = await reprintResponse.json()
  assert(reprintResponse.status === 200 && reprintPayload.data.pages.length === 1, '真实返工接口接受只重印 24 帧文件第 2 页')
  const [oldPackAfter, activePack, reprintRecord] = await Promise.all([
    prisma.productionFramePack.findUnique({ where: { id: oldPack.id } }),
    prisma.productionFramePack.findFirst({ where: { productionUnitId: reprintTaskId, isActive: true } }),
    prisma.productionFrameReprint.findFirst({ where: { productionUnitId: reprintTaskId } })
  ])
  assert(oldPackAfter.status === 'VOID' && !oldPackAfter.isActive && activePack.attemptNo === 2, '返工后 FP-01 作废且新的 FP-02 成为唯一有效码')
  assert(reprintRecord.oldFramePackCode === oldPack.code && reprintRecord.newFramePackCode === activePack.code && reprintRecord.requestedPages[0] === 2, '返工记录保存新旧码、指定页和原因')
  const reprintFile = await prisma.productionPrintFile.findUnique({ where: { id: reprintRecord.productionPrintFileId } })
  physicalKeys.push(reprintFile.objectKey)
  const reprintDownload = await fetch(reprintPayload.data.downloadUrl)
  const reprintDocx = Buffer.from(await reprintDownload.arrayBuffer())
  assert(inspectDocxTemplate(reprintDocx).cellCount === 12, '返工下载文件只包含指定的一页 12 个帧位')
  const batchDetailResponse = await request(`/api/admin/production-batches/${encodeURIComponent(reprintBatchId)}`, token)
  const batchDetail = await batchDetailResponse.json()
  assert(batchDetailResponse.ok && batchDetail.data.ledgerCheck.currentMarker === `${reprintBatchId} / 返工1次`, '批次详情返回可与纸质清单比对的当前返工标记')
  assert(batchDetail.data.reprintTimeline.length === 1 && batchDetail.data.reprintTimeline[0].oldFramePackCode === oldPack.code && batchDetail.data.reprintTimeline[0].newFramePackCode === activePack.code, '批次详情返回返工新旧码和处理进度')
  const ledgerResponse = await request(`/api/admin/production-workflow/batches/${encodeURIComponent(reprintBatchId)}/production-ledger`, token)
  const ledgerZip = new AdmZip(Buffer.from(await ledgerResponse.arrayBuffer()))
  const ledgerDetail = ledgerZip.readAsText('xl/worksheets/sheet1.xml')
  assert(ledgerResponse.ok && ledgerDetail.includes(`${reprintBatchId} / 返工1次`) && ledgerDetail.includes(oldPack.code) && ledgerDetail.includes(activePack.code), '生产清单记录导出时返工次数以及新旧帧包码')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token, apiBase })
  await page.goto(`${webBase}/admin-production-batches.html?batchId=${encodeURIComponent(reprintBatchId)}`, { waitUntil: 'networkidle' })
  await page.getByText(`${reprintBatchId} / 返工1次`, { exact: true }).waitFor()
  assert((await page.getByText('纸面数字不一致即为旧清单').count()) === 1 && (await page.getByText('返工记录与当前进度', { exact: true }).count()) === 1, '批次页面醒目标出旧清单判断和返工步骤')
  if (process.env.SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'production-batch-reprint-check.png'), fullPage: true })
  }
  await page.goto(`${webBase}/admin-print-production.html`, { waitUntil: 'networkidle' })
  await page.getByText(group.name).waitFor()
  assert((await page.getByText(/测试打印纸.*50×50mm.*单页12帧.*300DPI/).count()) === 1, '打印设置页清楚展示纸张、成品尺寸、单页帧数和 DPI')
  assert((await page.getByText(/当前模板：A4-5x5-12\.docx · V1/).count()) === 1, '打印设置页展示当前 Word 模板版本')
  await page.goto(`${process.env.TEST_VUE_BASE || 'http://127.0.0.1:4173/app'}/admin/frame-library?keyword=${encodeURIComponent(asset.assetNo)}`, { waitUntil: 'networkidle' })
  await page.getByText(generated.data.displayName).first().waitFor()
  assert((await page.getByText(generated.data.displayName).count()) >= 1, '资产卡片直接展示可下载的规格文件名')
  await page.locator('.asset-card').filter({ hasText: generated.data.displayName }).first().click()
  await page.getByRole('button', { name: '新增文件版本' }).waitFor()
  assert((await page.getByText('生产文件', { exact: true }).count()) >= 1, '资产详情包含独立生产文件模块')
  assert((await page.getByRole('button', { name: '查看加工帧' }).count()) >= 1 && (await page.getByRole('button', { name: '删除' }).count()) >= 1, '未入批生产文件提供加工帧预览和负责人删除入口')
  await page.getByRole('button', { name: '查看加工帧' }).first().click()
  await page.locator('#renderFramesGrid img').first().waitFor()
  assert((await page.locator('#renderFramesGrid img').count()) === 4 && (await page.getByText('frame-001.png').count()) === 1, '加工帧弹窗按序号展示全部编辑图片')
  await page.getByRole('button', { name: '关闭' }).last().click()
  await page.getByRole('button', { name: '新增文件版本' }).click()
  await page.locator('#productionTargetFrames').fill('24')
  assert((await page.locator(`#productionTemplate option[value="${uploadPayload.data.id}"]`).count()) === 1, '新增文件时会列出本次验证通过的兼容模板')
  await context.close()

  const deleteResponse = await request(`/api/admin/frame-library/${assetId}/production-files/${generated.data.id}`, token, { method: 'DELETE' })
  assert(deleteResponse.status === 200 && !await prisma.productionPrintFile.findUnique({ where: { id: generated.data.id } }) && !fs.existsSync(path.resolve(storageRoot, ...storedFile.objectKey.split('/'))), '负责人可删除未入批的 Word 记录和物理文件')
  console.log('Production artifact integration checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  if (reprintTaskId) await prisma.productionFrameReprint.deleteMany({ where: { productionUnitId: reprintTaskId } }).catch(() => {})
  if (reprintTaskId) await prisma.productionFramePack.deleteMany({ where: { productionUnitId: reprintTaskId } }).catch(() => {})
  if (reprintBatchId) await prisma.productionBatchUnit.deleteMany({ where: { batchId: reprintBatchId } }).catch(() => {})
  if (reprintBatchId) await prisma.productionBatchOrder.deleteMany({ where: { batchId: reprintBatchId } }).catch(() => {})
  if (reprintBatchId) await prisma.productionBatch.deleteMany({ where: { id: reprintBatchId } }).catch(() => {})
  if (reprintTaskId) await prisma.customizeOrder.deleteMany({ where: { id: reprintTaskId } }).catch(() => {})
  if (reprintItemId) await prisma.salesOrderItem.deleteMany({ where: { id: reprintItemId } }).catch(() => {})
  if (reprintOrderId) await prisma.salesOrder.deleteMany({ where: { id: reprintOrderId } }).catch(() => {})
  if (reprintPreOrderId) await prisma.preOrder.deleteMany({ where: { id: reprintPreOrderId } }).catch(() => {})
  if (reprintSkuId) await prisma.printCutRule.deleteMany({ where: { skuId: reprintSkuId } }).catch(() => {})
  if (reprintSkuId) await prisma.machineModelSku.deleteMany({ where: { id: reprintSkuId } }).catch(() => {})
  if (reprintModelId) await prisma.machineModel.deleteMany({ where: { id: reprintModelId } }).catch(() => {})
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
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
  }
  for (const key of [...new Set(physicalKeys)]) {
    await fs.promises.rm(path.resolve(storageRoot, ...key.split('/')), { force: true }).catch(() => {})
  }
  await prisma.$disconnect()
}
