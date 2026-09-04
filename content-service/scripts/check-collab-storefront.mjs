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
      animationFrames: '[]',
      supportedSkus: JSON.stringify([skuId]),
      creatorMarkups: JSON.stringify({ [skuId]: 17.25 }),
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
  return work
}

async function cleanup() {
  if (userId) {
    const carts = await prisma.cart.findMany({ where: { userId }, select: { id: true } })
    if (carts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map(cart => cart.id) } } })
    await prisma.cart.deleteMany({ where: { userId } })
  }
  if (workIds.length) await prisma.collabWork.deleteMany({ where: { id: { in: workIds } } })
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

  const live = await createWork(user.id, 'live')
  const hidden = await createWork(user.id, 'hidden', { isOnShelf: false })
  const suspended = await createWork(user.id, 'suspended', { shelfStatus: 'suspended' })
  const revision = await createWork(user.id, 'revision', { isRevision: true })

  const listResponse = await request(`/api/collab/works?creatorId=${encodeURIComponent(user.id)}&limit=50`)
  const listBody = await listResponse.json()
  assert(listResponse.ok && listBody.data.works.length === 1 && listBody.data.works[0].id === live.id, '公开列表只显示真正上架的正式版本')
  assert(Number(listBody.data.works[0].minPrice) === 117.25, '列表最低价包含创作者加价')
  assert(!('likeCount' in listBody.data.works[0]) && !('isLiked' in listBody.data.works[0]), '公开列表不再返回首版未启用的互动字段')

  const detailResponse = await request(`/api/collab/works/${live.id}`)
  const detailBody = await detailResponse.json()
  const detail = detailBody.data
  assert(detailResponse.ok && Number(detail.supportedSkus[0].finalPrice) === 117.25, '详情页规格价格使用统一最终价')
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
