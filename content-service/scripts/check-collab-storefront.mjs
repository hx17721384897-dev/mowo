import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
const phone = `193${runId}`
const workIds = []
let userId = null
let modelId = null
let skuId = null
let unsupportedSkuId = null
let animationAssetId = null
let animationVersionId = null
let mediaFileId = null

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

async function createWork(creatorId, suffix, overrides = {}) {
  const work = await prisma.collabWork.create({
    data: {
      creatorId,
      title: `联名商城验收-${runId}-${suffix}`,
      description: '仅用于自动验收',
      coverUrl: 'data:image/png;base64,iVBORw0KGgo=',
      storefrontTitle: `正式商品-${runId}-${suffix}`,
      storefrontSummary: '顾客可见卖点',
      storefrontDescription: '顾客可见完整详情',
      storefrontCoverUrl: `private/collab_storefront_media/${userId || creatorId}/${runId}-${suffix}-cover.png`,
      storefrontMedia: JSON.stringify([`private/collab_storefront_media/${userId || creatorId}/${runId}-${suffix}-video.mp4`]),
      storefrontTags: JSON.stringify(['自动验收', '联名商品']),
      animationFrames: '[]',
      supportedSkus: JSON.stringify([skuId]),
      creatorMarkups: JSON.stringify({ [skuId]: 17.25 }),
      animationAssetId,
      animationVersionId,
      status: 'approved',
      agreementSignedAt: new Date(),
      approvedAt: new Date(),
      approvedBy: 'internal-reviewer-should-not-be-public',
      revenueRate: 0.37,
      isOnShelf: true,
      shelfStatus: 'on_sale',
      isRevision: false,
      offShelfReason: 'internal-note-should-not-be-public',
      ...overrides,
    },
  })
  workIds.push(work.id)
  await prisma.collabSaleSku.create({
    data: {
      collabWorkId: work.id,
      skuId,
      finalPrice: 117.25,
      fulfillmentMode: 'MAKE_TO_ORDER',
      leadTimeDays: 7,
      createdBy: creatorId,
      updatedBy: creatorId,
    },
  })
  return work
}

async function cleanup() {
  if (userId) {
    const carts = await prisma.cart.findMany({ where: { userId }, select: { id: true } })
    if (carts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map(cart => cart.id) } } })
    await prisma.cart.deleteMany({ where: { userId } })
  }
  if (workIds.length) await prisma.collabWork.deleteMany({ where: { id: { in: workIds } } })
  if (mediaFileId) await prisma.privateFile.deleteMany({ where: { id: mediaFileId } })
  if (animationVersionId) await prisma.animationAssetVersion.deleteMany({ where: { id: animationVersionId } })
  if (animationAssetId) await prisma.animationAsset.deleteMany({ where: { id: animationAssetId } })
  if (userId) {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { OR: [{ userId }, { phone }] } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  const skuIds = [skuId, unsupportedSkuId].filter(Boolean)
  if (skuIds.length) await prisma.machineModelSku.deleteMany({ where: { id: { in: skuIds } } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  await prisma.$disconnect()
}

try {
  const user = await prisma.user.create({
    data: {
      phone,
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'collab-test',
      profile: { create: { nickname: `联名商城验收-${runId}` } },
      creditScore: { create: { score: 100 } },
    },
  })
  userId = user.id

  const model = await prisma.machineModel.create({
    data: {
      name: `联名商城验收款-${runId}`,
      ratios: '["1:1"]',
      frameOptions: '[12]',
      sizes: '["5x5cm"]',
    },
  })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({
    data: {
      modelId,
      size: '5x5cm',
      material: '椴木板',
      frameCount: 12,
      colorName: `原色-${runId}`,
      colorHex: '#E8D6B0',
      price: 100,
      skuCode: `TEST-COLLAB-${runId}`,
    },
  })
  skuId = sku.id
  const unsupportedSku = await prisma.machineModelSku.create({
    data: {
      modelId,
      size: '5x5cm',
      material: '椴木板',
      frameCount: 12,
      colorName: `测试色-${runId}`,
      colorHex: '#222222',
      price: 100,
      skuCode: `TEST-OTHER-${runId}`,
    },
  })
  unsupportedSkuId = unsupportedSku.id

  const asset = await prisma.animationAsset.create({
    data: {
      assetNo: `ANM-TEST-${runId}`,
      ownerUserId: user.id,
      title: `联名商城验收动画-${runId}`,
      sourceType: 'STAFF_CREATED',
      sourceChannel: 'INTERNAL_CREATED',
      usageType: 'COLLAB_SALE',
      assetType: 'COLLAB',
      collabStatus: 'AUTHORIZED',
      rightsHolderType: 'COMPANY',
      authorizationStatus: 'AUTHORIZED',
      currentVersionNo: 1,
    },
  })
  animationAssetId = asset.id
  const version = await prisma.animationAssetVersion.create({
    data: {
      assetId: asset.id,
      versionNo: 1,
      sourceKey: `COLLAB_STOREFRONT_TEST:${runId}`,
      sourceType: 'STAFF_CREATED',
      frameKeys: ['test/frame-1.png'],
      baseFrameCount: 1,
      manifestHash: `collab-storefront-${runId}`,
    },
  })
  animationVersionId = version.id

  const live = await createWork(user.id, 'live')
  const mediaFile = await prisma.privateFile.create({
    data: {
      ownerUserId: user.id,
      purpose: 'COLLAB_STOREFRONT_MEDIA',
      objectKey: `private/collab_storefront_media/${user.id}/${runId}-live-video.mp4`,
      originalName: 'detail-video.mp4',
      declaredMimeType: 'video/mp4',
      detectedMimeType: 'video/mp4',
      declaredSizeBytes: 128,
      sizeBytes: 128,
      status: 'READY',
      uploadedAt: new Date(),
    },
  })
  mediaFileId = mediaFile.id
  const hidden = await createWork(user.id, 'hidden', { isOnShelf: false })
  const suspended = await createWork(user.id, 'suspended', { shelfStatus: 'suspended' })
  const revision = await createWork(user.id, 'revision', { isRevision: true })

  const listResponse = await request(`/api/collab/works?creatorId=${encodeURIComponent(user.id)}&limit=50`)
  const listBody = await listResponse.json()
  assert(listResponse.ok && listBody.data.works.length === 1 && listBody.data.works[0].id === live.id, '公开列表只显示真正上架的正式版本')
  assert(Number(listBody.data.works[0].minPrice) === 117.25, '列表最低价来自正式销售配置')
  assert(!('likeCount' in listBody.data.works[0]) && !('isLiked' in listBody.data.works[0]), '公开列表不再返回首版未启用的互动字段')

  const detailResponse = await request(`/api/collab/works/${live.id}`)
  const detailBody = await detailResponse.json()
  const detail = detailBody.data
  assert(detailResponse.ok && Number(detail.supportedSkus[0].finalPrice) === 117.25, '详情页规格价格使用统一最终价')
  assert(detail.title.startsWith('正式商品-') && detail.description === '顾客可见完整详情' && detail.storefrontTags.length === 2, '详情页读取后台配置的正式标题、详情和标签')
  assert(detail.storefrontMedia.length === 1 && detail.storefrontMedia[0].url && detail.storefrontMedia[0].kind === 'video', '详情页轮播素材只返回签名地址和正确媒体类型')
  for (const field of ['creatorMarkups', 'revenueRate', 'approvedBy', 'offShelfReason', 'changeLog']) {
    assert(!(field in detail), `公开详情不暴露内部字段 ${field}`)
  }
  assert(!('price' in detail.supportedSkus[0]) && !('markup' in detail.supportedSkus[0]), '公开规格不拆出内部基础价和加价')

  for (const inaccessible of [hidden, suspended, revision]) {
    const response = await request(`/api/collab/works/${inaccessible.id}`)
    assert(response.status === 404, '未上架、暂停或修订版本不可通过详情地址绕过访问')
  }

  await prisma.smsCode.create({
    data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) },
  })
  const loginResponse = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST',
    body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' }),
  })
  const login = await loginResponse.json()
  assert(loginResponse.ok && login.success, '测试用户登录成功')
  const token = login.data.accessToken

  const addResponse = await request('/api/cart/add', token, {
    method: 'POST',
    body: JSON.stringify({ itemType: 'MARKET', contentId: live.id, hardwareSkuId: skuId, quantity: 1 }),
  })
  const added = await addResponse.json()
  assert(addResponse.ok && Number(added.data.snapshotPrice) === 117.25, '加入购物车保存统一最终价快照')
  assert(added.data.snapshotTitle.startsWith('正式商品-') && added.data.coverUrl?.includes('collab_storefront_media'), '购物车保存顾客看到的正式标题和封面')

  const invalidQuantity = await request('/api/cart/add', token, {
    method: 'POST',
    body: JSON.stringify({ itemType: 'MARKET', contentId: live.id, hardwareSkuId: skuId, quantity: 11 }),
  })
  assert(invalidQuantity.status === 400, '直接请求也不能让单个商品数量超过 10 件')

  const mergedOverflow = await request('/api/cart/add', token, {
    method: 'POST',
    body: JSON.stringify({ itemType: 'MARKET', contentId: live.id, hardwareSkuId: skuId, quantity: 10 }),
  })
  assert(mergedOverflow.status === 400, '重复加入购物车后的合计数量也不能超过 10 件')

  const hiddenAdd = await request('/api/cart/add', token, {
    method: 'POST',
    body: JSON.stringify({ itemType: 'MARKET', contentId: hidden.id, hardwareSkuId: skuId, quantity: 1 }),
  })
  assert(hiddenAdd.status === 404, '隐藏作品不能通过购物车接口绕过加入')

  const wrongSkuAdd = await request('/api/cart/add', token, {
    method: 'POST',
    body: JSON.stringify({ itemType: 'MARKET', contentId: live.id, hardwareSkuId: unsupportedSkuId, quantity: 1 }),
  })
  assert(wrongSkuAdd.status === 409, '未配置给该作品的 SKU 不能绕过加入购物车')

  await prisma.collabWork.update({ where: { id: live.id }, data: { shelfStatus: 'suspended' } })
  const cartResponse = await request('/api/cart', token)
  const cartBody = await cartResponse.json()
  assert(cartResponse.ok && cartBody.data.items[0].status === 'invalid', '作品暂停后旧购物车条目自动失效')

  const checkoutResponse = await request('/api/cart/checkout', token, {
    method: 'POST',
    body: JSON.stringify({ cartItemIds: [cartBody.data.items[0].id], idempotencyKey: `collab-${runId}` }),
  })
  assert(checkoutResponse.status === 400, '已暂停的联名商品无法继续结算')

  console.log('Collab storefront checks passed')
} finally {
  await cleanup()
}
