import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
const phone = `192${runId}`
let userId = null
let modelId = null
let compatibleSkuId = null
let incompatibleSkuId = null
let assetId = null
let versionId = null
let workId = null
let mediaFileId = null
let mediaObjectKey = null

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
      ...(options.headers || {}),
    },
  })
}

async function cleanup() {
  if (workId) await prisma.collabWork.deleteMany({ where: { id: workId } })
  if (mediaFileId) await prisma.privateFile.deleteMany({ where: { id: mediaFileId } })
  if (versionId) await prisma.animationAssetVersion.deleteMany({ where: { id: versionId } })
  if (assetId) await prisma.animationAsset.deleteMany({ where: { id: assetId } })
  const skuIds = [compatibleSkuId, incompatibleSkuId].filter(Boolean)
  if (skuIds.length) await prisma.machineModelSku.deleteMany({ where: { id: { in: skuIds } } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  if (userId) {
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { OR: [{ userId }, { phone }] } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({
    data: {
      phone,
      role: 2,
      staffRole: 'COLLAB_OPS',
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'sale-config-test',
      profile: { create: { nickname: `销售配置验收-${runId}` } },
    },
  })
  userId = user.id

  const model = await prisma.machineModel.create({
    data: { name: `销售配置款式-${runId}`, ratios: '["1:1"]', frameOptions: '[12,14]', sizes: '["5x5cm"]' },
  })
  modelId = model.id
  const compatibleSku = await prisma.machineModelSku.create({
    data: {
      modelId,
      size: '5x5cm', material: '椴木板', frameCount: 12,
      colorName: `原色-${runId}`, colorHex: '#E8D6B0', price: 100,
      skuCode: `SALE-OK-${runId}`,
    },
  })
  compatibleSkuId = compatibleSku.id
  const incompatibleSku = await prisma.machineModelSku.create({
    data: {
      modelId,
      size: '5x5cm', material: '椴木板', frameCount: 14,
      colorName: `测试色-${runId}`, colorHex: '#333333', price: 120,
      skuCode: `SALE-NO-${runId}`,
    },
  })
  incompatibleSkuId = incompatibleSku.id

  const asset = await prisma.animationAsset.create({
    data: {
      assetNo: `ANM-SALE-${runId}`,
      ownerUserId: userId,
      title: `销售配置动画-${runId}`,
      sourceType: 'STAFF_CREATED', sourceChannel: 'INTERNAL_CREATED', usageType: 'COLLAB_SALE',
      assetType: 'COLLAB', collabStatus: 'AUTHORIZED', rightsHolderType: 'COMPANY',
      authorizationStatus: 'AUTHORIZED', currentVersionNo: 1,
    },
  })
  assetId = asset.id
  const version = await prisma.animationAssetVersion.create({
    data: {
      assetId,
      versionNo: 1,
      sourceKey: `COLLAB_SALE_CONFIG_TEST:${runId}`,
      sourceType: 'STAFF_CREATED',
      frameKeys: ['test/1.png', 'test/2.png', 'test/3.png', 'test/4.png'],
      baseFrameCount: 4,
      manifestHash: `sale-config-${runId}`,
    },
  })
  versionId = version.id

  const work = await prisma.collabWork.create({
    data: {
      creatorId: userId,
      title: `销售配置作品-${runId}`,
      description: '自动验收作品',
      coverUrl: 'data:image/png;base64,iVBORw0KGgo=',
      animationFrames: '["test/1.png","test/2.png","test/3.png","test/4.png"]',
      supportedSkus: '[]',
      status: 'approved',
      agreementSignedAt: new Date(),
      approvedAt: new Date(),
      approvedBy: userId,
      isOnShelf: false,
      shelfStatus: 'off_shelf',
      animationAssetId: assetId,
      animationVersionId: versionId,
    },
  })
  workId = work.id

  const mediaFile = await prisma.privateFile.create({
    data: {
      ownerUserId: userId,
      purpose: 'COLLAB_STOREFRONT_MEDIA',
      objectKey: `private/collab_storefront_media/${userId}/${runId}.png`,
      originalName: 'product-cover.png',
      declaredMimeType: 'image/png',
      detectedMimeType: 'image/png',
      declaredSizeBytes: 128,
      sizeBytes: 128,
      status: 'READY',
      uploadedAt: new Date(),
    },
  })
  mediaFileId = mediaFile.id
  mediaObjectKey = mediaFile.objectKey

  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const loginResponse = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' }),
  })
  const login = await loginResponse.json()
  assert(loginResponse.ok && login.success, '合作运营登录成功')
  const token = login.data.accessToken

  const publicBefore = await request(`/api/collab/works/${workId}`)
  assert(publicBefore.status === 404, '未完成销售配置的作品不会出现在顾客端')

  const relistBefore = await request(`/api/admin/collab/${workId}/relist`, token, { method: 'PUT', body: '{}' })
  const relistBeforeBody = await relistBefore.json()
  assert(relistBefore.status === 409 && relistBeforeBody.blockers?.some(item => item.includes('SKU')), '缺少销售配置时服务器阻止上架并返回原因')

  const configResponse = await request(`/api/admin/collab/${workId}/product-workspace`, token)
  const configBody = await configResponse.json()
  const compatibleCandidate = configBody.data.candidates.find(item => item.id === compatibleSkuId)
  const incompatibleCandidate = configBody.data.candidates.find(item => item.id === incompatibleSkuId)
  assert(configResponse.ok && compatibleCandidate?.compatible === true && incompatibleCandidate?.compatible === false, '后台候选 SKU 正确标记帧数兼容性')
  assert(configBody.data.readinessGroups.content.some(item => item.includes('重新上传商品封面')), '旧版内嵌封面会明确要求重新上传')

  const incompleteDraft = await request(`/api/admin/collab/${workId}/product-workspace`, token, {
    method: 'PUT',
    body: JSON.stringify({
      storefrontTitle: '待补封面的商品草稿',
      storefrontSummary: '尚未上传正式封面',
      storefrontDescription: '允许先保存其他商品资料。',
      skus: [],
    }),
  })
  const incompleteDraftBody = await incompleteDraft.json()
  const draftStored = await prisma.collabWork.findUnique({ where: { id: workId }, select: { storefrontCoverUrl: true } })
  assert(incompleteDraft.ok && incompleteDraftBody.data.ready === false && draftStored.storefrontCoverUrl === null, '草稿保存不会把旧版内嵌封面复制进正式商品字段')

  const invalidFrame = await request(`/api/admin/collab/${workId}/product-workspace`, token, {
    method: 'PUT',
    body: JSON.stringify({ storefrontTitle: '测试商品', storefrontSummary: '测试', storefrontDescription: '测试商品详情', skus: [{ skuId: incompatibleSkuId, finalPrice: 130, fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 7 }] }),
  })
  assert(invalidFrame.status === 409, '服务器拒绝帧数不兼容的 SKU')

  const invalidPrice = await request(`/api/admin/collab/${workId}/product-workspace`, token, {
    method: 'PUT',
    body: JSON.stringify({ storefrontTitle: '测试商品', storefrontSummary: '测试', storefrontDescription: '测试商品详情', skus: [{ skuId: compatibleSkuId, finalPrice: 99, fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 7 }] }),
  })
  assert(invalidPrice.status === 400, '服务器拒绝低于 SKU 基础价的最终售价')

  const saveResponse = await request(`/api/admin/collab/${workId}/product-workspace`, token, {
    method: 'PUT',
    body: JSON.stringify({
      storefrontSummary: '一款用于验收的联名商品',
      storefrontTitle: '完整联名测试商品',
      storefrontDescription: '用于检查联名商品工作区保存与上架流程。',
      storefrontSeries: '自动验收系列',
      storefrontTags: ['测试', '联名'],
      storefrontKeywords: '自动 验收',
      storefrontMedia: [mediaObjectKey],
      coverKey: mediaObjectKey,
      storefrontSortOrder: 20,
      skus: [{ skuId: compatibleSkuId, finalPrice: 128.5, fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 9 }],
    }),
  })
  const saved = await saveResponse.json()
  assert(saveResponse.ok && saved.data.ready === true, '有效销售配置保存后满足上架条件')

  const stored = await prisma.collabWork.findUnique({ where: { id: workId }, include: { saleSkus: true } })
  assert(stored.saleSkus.length === 1 && Number(stored.saleSkus[0].finalPrice) === 128.5, '正式销售配置按作品与 SKU 独立保存')
  assert(stored.storefrontTitle === '完整联名测试商品' && stored.productNo?.startsWith('COL-'), '商品资料与稳定商品编号正确保存')
  assert(stored.description === '自动验收作品' && stored.storefrontDescription.includes('工作区'), '销售详情独立保存，不覆盖创作者审核原说明')
  const linkedMedia = await prisma.privateFile.findUnique({ where: { id: mediaFileId } })
  assert(linkedMedia.linkedResourceType === 'COLLAB_WORK' && linkedMedia.linkedResourceId === workId, '商品展示素材校验所有权后绑定到当前联名商品')
  assert(JSON.parse(stored.supportedSkus)[0] === compatibleSkuId, '旧 SKU 字段由正式配置自动同步而不是独立维护')

  const relist = await request(`/api/admin/collab/${workId}/relist`, token, { method: 'PUT', body: '{}' })
  assert(relist.ok, '配置完整后作品可以正式上架')

  const publicAfter = await request(`/api/collab/works/${workId}`)
  const publicBody = await publicAfter.json()
  assert(publicAfter.ok && publicBody.data.title === '完整联名测试商品' && Number(publicBody.data.supportedSkus[0].finalPrice) === 128.5, '顾客端读取正式商品标题与最终价格')
  assert(publicBody.data.supportedSkus[0].leadTimeDays === 9, '顾客端获得已配置的预计发货天数')

  await prisma.collabSaleSku.create({
    data: {
      collabWorkId: workId,
      skuId: incompatibleSkuId,
      finalPrice: 130,
      fulfillmentMode: 'MAKE_TO_ORDER',
      leadTimeDays: 7,
      sortOrder: 1,
      createdBy: userId,
      updatedBy: userId,
    },
  })
  const corruptedDetail = await request(`/api/collab/works/${workId}`)
  const corruptedBody = await corruptedDetail.json()
  assert(corruptedDetail.ok && corruptedBody.data.supportedSkus.every(item => item.id !== incompatibleSkuId), '公开详情自动排除数据库中的异常不兼容 SKU')
  const incompatibleAdd = await request('/api/cart/add', token, {
    method: 'POST',
    body: JSON.stringify({ itemType: 'MARKET', contentId: workId, hardwareSkuId: incompatibleSkuId, quantity: 1 }),
  })
  assert(incompatibleAdd.status === 409, '购物车再次拒绝数据库中的异常不兼容 SKU')
  await prisma.collabSaleSku.delete({ where: { collabWorkId_skuId: { collabWorkId: workId, skuId: incompatibleSkuId } } })

  const log = await prisma.operationLog.findFirst({
    where: { userId, targetId: workId, target: 'COLLAB_PRODUCT' },
    orderBy: { createdAt: 'desc' },
  })
  assert(log?.action?.includes('联名商品') && log.outcome === 'SUCCESS', '保存商品工作区留下员工操作记录')

  await prisma.machineModelSku.update({ where: { id: compatibleSkuId }, data: { isActive: false } })
  const publicDisabled = await request(`/api/collab/works/${workId}`)
  assert(publicDisabled.status === 404, 'SKU 停用后作品立即停止公开销售')

  const disabledWorkspaceResponse = await request(`/api/admin/collab/${workId}/product-workspace`, token)
  const disabledWorkspace = await disabledWorkspaceResponse.json()
  assert(disabledWorkspace.data.selected[0].isEnabled === false && disabledWorkspace.data.candidates.find(row => row.id === compatibleSkuId)?.isActive === false, '停用 SKU 在工作区保留历史配置并明确标为停售')
  const preserveDisabled = await request(`/api/admin/collab/${workId}/product-workspace`, token, {
    method: 'PUT',
    body: JSON.stringify({
      storefrontTitle: '完整联名测试商品',
      storefrontSummary: '一款用于验收的联名商品',
      storefrontDescription: '用于检查联名商品工作区保存与上架流程。',
      storefrontMedia: [mediaObjectKey],
      coverKey: mediaObjectKey,
      skus: [{ skuId: compatibleSkuId, finalPrice: 128.5, fulfillmentMode: 'MAKE_TO_ORDER', leadTimeDays: 9, isEnabled: false }],
    }),
  })
  const preservedRow = await prisma.collabSaleSku.findUnique({ where: { collabWorkId_skuId: { collabWorkId: workId, skuId: compatibleSkuId } } })
  assert(preserveDisabled.ok && preservedRow?.isEnabled === false, '停售 SKU 保存时不会被删除，历史配置继续保留')

  console.log('Collab sale configuration checks passed')
} finally {
  await cleanup()
}
