import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend'
const runId = String(Date.now()).slice(-8)
let browser
let userId
let modelId
let skuId
let assetId
let versionId
let workId

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  if (workId) await prisma.collabWork.deleteMany({ where: { id: workId } })
  if (versionId) await prisma.animationAssetVersion.deleteMany({ where: { id: versionId } })
  if (assetId) await prisma.animationAsset.deleteMany({ where: { id: assetId } })
  if (skuId) await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  if (userId) {
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({ data: {
    phone: `194${runId}`, privacyAgreedAt: new Date(), privacyPolicyVersion: 'detail-ui',
    profile: { create: { nickname: '联名详情测试创作者' } }, creditScore: { create: { score: 100 } },
  } })
  userId = user.id
  const model = await prisma.machineModel.create({ data: { name: '标准款', ratios: '["1:1"]', frameOptions: '[12]', sizes: '["5x5cm"]' } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId, size: '5x5cm', material: '椴木板', frameCount: 12, colorName: '原色', colorHex: '#e8d6b0',
    price: 89, skuCode: `DETAIL-${runId}`,
  } })
  skuId = sku.id
  const asset = await prisma.animationAsset.create({ data: {
    assetNo: `ANM-DETAIL-${runId}`, ownerUserId: userId, title: '详情测试动画', sourceType: 'STAFF_CREATED',
    sourceChannel: 'INTERNAL_CREATED', usageType: 'COLLAB_SALE', assetType: 'COLLAB', collabStatus: 'AUTHORIZED',
    rightsHolderType: 'COMPANY', authorizationStatus: 'AUTHORIZED', currentVersionNo: 1,
  } })
  assetId = asset.id
  const imageUrl = `${webBase}/assets/hero-main.png`
  const version = await prisma.animationAssetVersion.create({ data: {
    assetId, versionNo: 1, sourceKey: `DETAIL_BROWSER:${runId}`, sourceType: 'STAFF_CREATED',
    frameKeys: [imageUrl, imageUrl], baseFrameCount: 2, manifestHash: `detail-browser-${runId}`,
  } })
  versionId = version.id
  const work = await prisma.collabWork.create({ data: {
    creatorId: userId, title: '审核原题', description: '审核原说明', coverUrl: imageUrl,
    animationFrames: JSON.stringify([imageUrl, imageUrl]), supportedSkus: JSON.stringify([skuId]), status: 'approved',
    agreementSignedAt: new Date(), approvedAt: new Date(), isOnShelf: true, shelfStatus: 'on_sale',
    animationAssetId: assetId, animationVersionId: versionId, storefrontTitle: '会转动的测试动画',
    storefrontSummary: '后台填写的商品卖点会出现在这里。', storefrontDescription: '第一段完整介绍。\n第二段制作说明。',
    storefrontCoverUrl: imageUrl, storefrontMedia: JSON.stringify([imageUrl]),
    storefrontTags: JSON.stringify(['桌面摆件', '联名作品']), storefrontSeries: '测试系列',
  } })
  workId = work.id
  await prisma.collabSaleSku.create({ data: {
    collabWorkId: workId, skuId, finalPrice: 109, fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 7,
    createdBy: userId, updatedBy: userId,
  } })

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(apiBase => { window.MOWO_RUNTIME_API_BASE = apiBase }, apiBase)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${webBase}/pages/showcase-detail.html?workId=${workId}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '会转动的测试动画' }).waitFor()
  if (await page.locator('.tag').count() !== 2 || await page.locator('.sku-card').count() !== 1) throw new Error('详情标签或 SKU 没有完整显示')
  if (!await page.locator('#detailCopy').innerText().then(text => text.includes('第二段制作说明'))) throw new Error('完整商品详情没有显示')
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error('桌面详情页出现横向溢出')
  await page.getByRole('button', { name: '加入购物车', exact: true }).first().click()
  await page.locator('.auth-overlay.open').waitFor()
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('mowo_pending_purchase') || 'null'))
  if (pending?.workId !== workId || pending?.skuId !== skuId) throw new Error('未登录购买意图没有正确保存')
  console.log('PASS desktop detail renders configured content and preserves login purchase intent')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '会转动的测试动画' }).waitFor()
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error('手机详情页出现横向溢出')
  if (!await page.locator('.purchase-bar').isVisible()) throw new Error('手机底部购买栏不可见')
  if (errors.length) throw new Error(`浏览器脚本错误：${errors.join(' | ')}`)
  console.log('PASS mobile detail fits viewport and keeps purchase actions visible')
} finally {
  await cleanup()
}
