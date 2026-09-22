import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

// 仅在隔离库创建临时员工和合同，结束后清理；不触及定制草稿或订单。
requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const phone = `199${String(Date.now()).slice(-7)}8`
let userId = null
let contractId = null
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
      privacyPolicyVersion: 'contract-test',
      profile: { create: { nickname: 'contract-test-owner' } }
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
  const created = await request('/api/admin/contracts', token, {
    method: 'POST',
    body: JSON.stringify({ creatorName: '无站内账号合作方', contractType: 'buyout', buyoutAmount: 100, startAt: '2026-09-22' })
  })
  assertStatus('create contract without creatorId', created, 201)
  contractId = (await created.json()).data.id
  const key = crypto.randomUUID()
  const settleBody = JSON.stringify({ amount: 25, note: '一次人工打款记录', settledAt: '2026-09-22', clientRequestId: key })
  const [first, retry] = await Promise.all([
    request(`/api/admin/contracts/${contractId}/settle`, token, { method: 'POST', body: settleBody }),
    request(`/api/admin/contracts/${contractId}/settle`, token, { method: 'POST', body: settleBody })
  ])
  assertStatus('first payment', first, 200)
  assertStatus('same-key concurrent retry', retry, 200)
  const detail = await request(`/api/admin/contracts/${contractId}`, token)
  assertStatus('read contract', detail, 200)
  const saved = (await detail.json()).data
  if (saved.settlementLogs.length !== 1 || saved.totalPaid !== 25) {
    throw new Error(`payment duplicated: count=${saved.settlementLogs.length}, total=${saved.totalPaid}`)
  }
  console.log('PASS exactly one payment record')
  const conflict = await request(`/api/admin/contracts/${contractId}/settle`, token, {
    method: 'POST', body: JSON.stringify({ amount: 30, note: '不同记录', clientRequestId: key })
  })
  assertStatus('same key different amount rejected', conflict, 409)
} finally {
  if (contractId) await prisma.creatorContract.deleteMany({ where: { id: contractId } })
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
