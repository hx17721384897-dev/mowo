import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend'
const runId = String(Date.now()).slice(-8)
const workIds = []
let browser
let creatorId
let secondCreatorId
let modelId
let skuId
let assetId
let versionId

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL ${message}`)
  console.log(`PASS ${message}`)
}

async function json(path, options) {
  const response = await fetch(`${apiBase}${path}`, options)
  const body = await response.json()
  return { response, body }
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  if (workIds.length) await prisma.collabWork.deleteMany({ where: { id: { in: workIds } } })
  if (versionId) await prisma.animationAssetVersion.deleteMany({ where: { id: versionId } })
  if (assetId) await prisma.animationAsset.deleteMany({ where: { id: assetId } })
  if (skuId) await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  for (const userId of [creatorId, secondCreatorId].filter(Boolean)) {
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}

try {
  const creators = []
  for (const [index, nickname] of [`货架甲${runId}`, `货架乙${runId}`].entries()) {
    creators.push(await prisma.user.create({ data: {
      phone: `${index ? '193' : '192'}${runId}`,
      privacyAgreedAt: new Date(), privacyPolicyVersion: 'listing-test',
      profile: { create: { nickname } }, creditScore: { create: { score: 100 } },
    } }))
  }
  creatorId = creators[0].id
  secondCreatorId = creators[1].id

  const model = await prisma.machineModel.create({ data: {
    name: `货架款${runId}`, ratios: '["1:1"]', frameOptions: '[12]', sizes: '["5x5cm"]',
  } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId, size: '5x5cm', material: '椴木板', frameCount: 12,
    colorName: '原色', colorHex: '#e8d6b0', price: 89, skuCode: `LIST-${runId}`,
  } })
  skuId = sku.id
  const asset = await prisma.animationAsset.create({ data: {
    assetNo: `ANM-LIST-${runId}`, ownerUserId: creatorId, title: '货架测试动画',
    sourceType: 'STAFF_CREATED', sourceChannel: 'INTERNAL_CREATED', usageType: 'COLLAB_SALE',
    assetType: 'COLLAB', collabStatus: 'AUTHORIZED', rightsHolderType: 'COMPANY',
    authorizationStatus: 'AUTHORIZED', currentVersionNo: 1,
  } })
  assetId = asset.id
  const imageUrl = `${webBase}/assets/hero-main.png`
  const version = await prisma.animationAssetVersion.create({ data: {
    assetId, versionNo: 1, sourceKey: `LISTING:${runId}`, sourceType: 'STAFF_CREATED',
    frameKeys: [imageUrl, imageUrl], baseFrameCount: 2, manifestHash: `listing-${runId}`,
  } })
  versionId = version.id

  const baseTime = Date.now() - 20 * 60 * 1000
  for (let index = 0; index < 13; index += 1) {
    const work = await prisma.collabWork.create({ data: {
      creatorId: index === 12 ? secondCreatorId : creatorId,
      title: `审核原题 ${index}`, description: '审核原说明', coverUrl: imageUrl,
      animationFrames: JSON.stringify([imageUrl, imageUrl]), supportedSkus: JSON.stringify([skuId]),
      status: 'approved', agreementSignedAt: new Date(), approvedAt: new Date(baseTime + index * 60000),
      isOnShelf: true, shelfStatus: 'on_sale', animationAssetId: assetId, animationVersionId: versionId,
      storefrontTitle: `${runId} 联名商品 ${String(index).padStart(2, '0')}`,
      storefrontSummary: `第 ${index} 件商品的列表卖点`, storefrontDescription: '完整商品介绍',
      storefrontCoverUrl: imageUrl, storefrontKeywords: index === 5 ? `独特关键词${runId}` : '',
      storefrontSeries: '货架验收系列', storefrontSortOrder: index === 3 ? 999 : index,
      storefrontViewCount: index === 7 ? 500 : index,
    } })
    workIds.push(work.id)
    await prisma.collabSaleSku.create({ data: {
      collabWorkId: work.id, skuId, finalPrice: 109 + index,
      fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 7 + (index % 3),
      createdBy: creatorId, updatedBy: creatorId,
    } })
  }

  const encodedRun = encodeURIComponent(runId)
  const pageOne = await json(`/api/collab/works?q=${encodedRun}&page=1&limit=12&sort=recommended`)
  assert(pageOne.response.ok && pageOne.body.data.works.length === 12, '联名列表从服务器返回正式第一页')
  assert(pageOne.body.data.total === 13 && pageOne.body.data.hasMore === true, '第一页返回准确总数和下一页标记')
  assert(pageOne.body.data.works[0].id === workIds[3], '推荐排序使用后台推荐顺序')
  assert(pageOne.body.data.works.every(item => item.previewFrames.length === 2), '列表直接返回轻量动画预览而不逐卡请求详情')
  assert(pageOne.body.data.works.every(item => !Object.hasOwn(item, 'storefrontViewCount')), '顾客列表不公开内部浏览汇总')

  const pageTwo = await json(`/api/collab/works?q=${encodedRun}&page=2&limit=12&sort=recommended`)
  assert(pageTwo.response.ok && pageTwo.body.data.works.length === 1 && !pageTwo.body.data.hasMore, '加载更多读取服务器第二页')

  const latest = await json(`/api/collab/works?q=${encodedRun}&sort=latest&limit=12`)
  assert(latest.body.data.works[0].id === workIds[12], '最新排序使用审核上架时间')
  const popular = await json(`/api/collab/works?q=${encodedRun}&sort=popular&limit=12`)
  assert(popular.body.data.works[0].id === workIds[7], '热门排序使用有效浏览量')
  const keyword = await json(`/api/collab/works?q=${encodeURIComponent(`独特关键词${runId}`)}`)
  assert(keyword.body.data.total === 1 && keyword.body.data.works[0].id === workIds[5], '服务端可以搜索后台关键词')
  const creatorSearch = await json(`/api/collab/works?q=${encodeURIComponent(`货架乙${runId}`)}`)
  assert(creatorSearch.body.data.total === 1 && creatorSearch.body.data.works[0].id === workIds[12], '服务端可以搜索创作者')
  const creatorFilter = await json(`/api/collab/works?creatorId=${secondCreatorId}`)
  assert(creatorFilter.body.data.total === 1 && creatorFilter.body.data.works[0].id === workIds[12], '创作者筛选读取全部正式商品')

  const before = await prisma.collabWork.findUnique({ where: { id: workIds[0] }, select: { storefrontViewCount: true } })
  const viewBody = visitorId => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId }),
  })
  const firstView = await json(`/api/collab/works/${workIds[0]}/view`, viewBody(`listing_visitor_a_${runId}`))
  const invalidView = await json(`/api/collab/works/${workIds[0]}/view`, viewBody('short'))
  const repeatedView = await json(`/api/collab/works/${workIds[0]}/view`, viewBody(`listing_visitor_a_${runId}`))
  const secondView = await json(`/api/collab/works/${workIds[0]}/view`, viewBody(`listing_visitor_b_${runId}`))
  const after = await prisma.collabWork.findUnique({ where: { id: workIds[0] }, select: { storefrontViewCount: true } })
  assert(firstView.body.data.counted && !repeatedView.body.data.counted && secondView.body.data.counted, '同一访客同日重复打开只计一次')
  assert(after.storefrontViewCount === before.storefrontViewCount + 2, '不同访客有效浏览正确累计')
  assert(invalidView.response.status === 400, '无效浏览标识不会写入统计')

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${webBase}/pages/showcase.html?q=${encodedRun}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 12)
  assert(await page.locator('.work-card').count() === 12, '顾客列表首屏显示服务器第一页')
  assert(await page.locator('.card-price').first().isVisible() && await page.locator('.card-spec').first().isVisible(), '商品卡片显示价格、规格和交期')
  await page.getByRole('button', { name: '加载更多' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 13)
  assert(await page.locator('.work-card').count() === 13, '顾客点击加载更多后追加第二页')
  await page.getByRole('button', { name: '热门' }).click()
  await page.waitForFunction(id => document.querySelector('.work-card')?.dataset.id === id, workIds[7])
  assert(true, '顾客端热门按钮触发服务端重新排序')
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), '桌面联名列表没有横向溢出')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.work-card').first().waitFor()
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), '手机联名列表没有横向溢出')
  assert(await page.locator('.sort-tab').count() === 3 && await page.locator('.work-card').first().isVisible(), '手机端保留排序和商品浏览能力')
  assert(pageErrors.length === 0, `联名列表没有浏览器脚本错误${pageErrors.length ? `：${pageErrors.join(' | ')}` : ''}`)
  console.log('Collab listing checks passed')
} finally {
  await cleanup()
}
