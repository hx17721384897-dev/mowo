import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

// 只在隔离库临时建立员工、款式、SKU、初始库存；结束后清理，不创建订单或草稿。
requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const phone = `199${String(Date.now()).slice(-7)}7`
let userId = null
let modelId = null
let skuId = null

async function request(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

function assertStatus(label, response, expected) {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, got ${response.status}`)
  console.log(`PASS ${label}: ${expected}`)
}

try {
  const user = await prisma.user.create({
    data: {
      phone,
      role: 3,
      staffRole: 'OWNER',
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'catalog-test',
      profile: { create: { nickname: 'catalog-test-owner' } }
    }
  })
  userId = user.id
  await prisma.smsCode.create({
    data: { phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) }
  })
  const login = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assertStatus('login', login, 200)
  const token = (await login.json()).data.accessToken

  const created = await request('/api/machine-models', token, {
    method: 'POST',
    body: JSON.stringify({
      name: `catalog-test-${Date.now()}`,
      description: '候选迁移临时款式',
      videoUrl: 'https://example.com/catalog-test.mp4',
      modelType: 'single'
    })
  })
  assertStatus('create model', created, 201)
  modelId = (await created.json()).data.id
  const savedModel = await prisma.machineModel.findUniqueOrThrow({ where: { id: modelId } })
  if (savedModel.videoUrl !== 'https://example.com/catalog-test.mp4') throw new Error('videoUrl was not saved')
  console.log('PASS model video URL persisted')

  const createdSku = await request(`/api/machine-models/${modelId}/skus`, token, {
    method: 'POST',
    body: JSON.stringify({
      size: '5x5cm', material: '椴木板', frameCount: 12,
      colorName: '原色', colorHex: '#D4B896', price: 199
    })
  })
  assertStatus('create SKU', createdSku, 201)
  skuId = (await createdSku.json()).data.id
  const stock = await prisma.skuInventory.findUnique({ where: { skuId } })
  if (!stock || stock.currentStock !== 0 || stock.reservedStock !== 0) throw new Error('initial inventory missing')
  console.log('PASS SKU and initial inventory created together')
} finally {
  if (skuId) {
    await prisma.skuInventory.deleteMany({ where: { skuId } })
    await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  }
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  if (userId) {
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.consentRecord.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { phone } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}
