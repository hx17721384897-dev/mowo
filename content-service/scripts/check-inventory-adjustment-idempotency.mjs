import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
let userId
let modelId
let skuId

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function request(path, token, body) {
  return fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function cleanup() {
  if (skuId) {
    await prisma.inventoryLog.deleteMany({ where: { skuId } })
    await prisma.skuInventory.deleteMany({ where: { skuId } })
    await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  }
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  if (userId) {
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
}

try {
  const inventoryView = await readFile(new URL('../../frontend-vue/src/views/AdminInventoryView.vue', import.meta.url), 'utf8')
  assert(
    inventoryView.includes('mowo.inventory.pendingAdjustment') &&
      inventoryView.includes('clientRequestId'),
    'Vue 正式库存页在网络失败后复用同一库存调整请求标识'
  )

  const phone = `195${runId}`
  const user = await prisma.user.create({
    data: {
      phone,
      role: 3,
      staffRole: 'OWNER',
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'inv-idem-test',
      profile: { create: { nickname: `inventory-idempotency-${runId}` } }
    }
  })
  userId = user.id
  await prisma.smsCode.create({
    data: {
      userId,
      phone,
      code: '123456',
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + 300000)
    }
  })
  const login = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const loginBody = await login.json()
  assert(login.ok && loginBody.success, '临时负责人账号可以登录')
  const token = loginBody.data.accessToken

  const model = await prisma.machineModel.create({
    data: {
      name: `库存幂等测试款-${runId}`,
      description: '自动测试',
      ratios: '[]',
      frameOptions: '[]',
      sizes: '[]'
    }
  })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({
    data: {
      modelId,
      size: '5x5cm',
      material: '椴木板',
      frameCount: 12,
      colorName: '原色',
      colorHex: '#D4B896',
      price: 199,
      skuCode: `INV-IDEM-${runId}`
    }
  })
  skuId = sku.id
  await prisma.skuInventory.create({ data: { skuId, currentStock: 10 } })

  const missingKey = await request(`/api/inventory/${skuId}/restock`, token, {
    quantity: 5,
    note: '缺少请求标识'
  })
  assert(missingKey.status === 400, '缺少持久化请求标识时拒绝库存调整')

  const firstKey = `inventory-adjust-${runId}`
  const payload = { quantity: 5, note: '网络重试测试', clientRequestId: firstKey }
  const first = await request(`/api/inventory/${skuId}/restock`, token, payload)
  const firstBody = await first.json()
  assert(first.ok && firstBody.data.reused === false, '首次库存调整只执行一次')

  const replay = await request(`/api/inventory/${skuId}/restock`, token, payload)
  const replayBody = await replay.json()
  assert(replay.ok && replayBody.data.reused === true, '同键同内容重试返回原操作结果')
  assert(
    (await prisma.skuInventory.findUnique({ where: { skuId } })).currentStock === 15,
    '响应丢失重试不会重复增加库存'
  )
  assert(
    (await prisma.inventoryLog.count({ where: { idempotencyKey: `inventory-adjust:${firstKey}` } })) === 1,
    '同一库存调整只写一条库存流水'
  )

  const conflict = await request(`/api/inventory/${skuId}/restock`, token, {
    quantity: 6,
    note: '网络重试测试',
    clientRequestId: firstKey
  })
  const conflictBody = await conflict.json()
  assert(
    conflict.status === 409 && conflictBody.code === 'IDEMPOTENCY_KEY_CONFLICT',
    '同一请求标识不能改写库存数量或原因'
  )

  const concurrentKey = `inventory-concurrent-${runId}`
  const concurrentPayload = {
    quantity: 2,
    note: '并发重试测试',
    clientRequestId: concurrentKey
  }
  const concurrent = await Promise.all([
    request(`/api/inventory/${skuId}/restock`, token, concurrentPayload),
    request(`/api/inventory/${skuId}/restock`, token, concurrentPayload)
  ])
  assert(concurrent.every(response => response.ok), '并发同键请求均恢复为成功结果')
  assert(
    (await prisma.skuInventory.findUnique({ where: { skuId } })).currentStock === 17,
    '并发同键请求只增加一次库存'
  )
  assert(
    (await prisma.inventoryLog.count({ where: { idempotencyKey: `inventory-adjust:${concurrentKey}` } })) === 1,
    '并发同键请求只写一条库存流水'
  )

  console.log('Inventory adjustment idempotency checks passed')
} finally {
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
