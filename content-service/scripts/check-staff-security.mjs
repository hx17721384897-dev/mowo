import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

// 该脚本会创建员工、改变岗位、暂停注销任务；只能在隔离测试库运行。
requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-7)
const roles = [
  ['owner', 'OWNER', 3],
  ['support', 'CUSTOMER_SERVICE', 2],
  ['production', 'PRODUCTION', 2],
  ['collab', 'COLLAB_OPS', 2],
  ['user', null, 0]
]
const users = new Map()

function testPhone(index) {
  return `199${runId}${index}`
}

function assertStatus(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`)
  console.log(`PASS ${label}: ${actual}`)
}

async function request(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
}

async function createAndLogin(label, staffRole, role, index) {
  const phone = testPhone(index)
  const user = await prisma.user.create({
    data: {
      phone, role, staffRole,
      privacyAgreedAt: new Date(), privacyPolicyVersion: 'security-test',
      profile: { create: { nickname: `security-test-${label}` } },
    }
  })
  users.set(label, { ...user, phone })
  await prisma.smsCode.create({
    data: { phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) }
  })
  const login = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assertStatus(`${label} login`, login.status, 200)
  const payload = await login.json()
  users.set(label, { ...user, phone, token: payload.data.accessToken })
}

async function cleanup() {
  const values = [...users.values()]
  const ids = values.map(user => user.id)
  const phones = values.map(user => user.phone)
  if (!ids.length) return
  await prisma.operationLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.consentRecord.deleteMany({ where: { userId: { in: ids } } })
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: ids } } })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.smsCode.deleteMany({ where: { phone: { in: [...phones, testPhone(9)] } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

try {
  for (let index = 0; index < roles.length; index += 1) await createAndLogin(...roles[index], index + 1)

  const owner = users.get('owner')
  const support = users.get('support')
  const production = users.get('production')
  const collab = users.get('collab')
  const normalUser = users.get('user')

  const unregisteredPhone = testPhone(9)
  assertStatus('unregistered phone cannot request login code', (await request('/api/v1/auth/sms/send', null, {
    method: 'POST', body: JSON.stringify({ phone: unregisteredPhone, purpose: 'LOGIN' })
  })).status, 404)
  assertStatus('registered phone cannot request registration code', (await request('/api/v1/auth/sms/send', null, {
    method: 'POST', body: JSON.stringify({ phone: normalUser.phone, purpose: 'REGISTER' })
  })).status, 409)
  await prisma.smsCode.create({
    data: { phone: unregisteredPhone, code: '654321', purpose: 'REGISTER', expiresAt: new Date(Date.now() + 300000) }
  })
  assertStatus('login mode never auto-registers an unknown phone', (await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone: unregisteredPhone, code: '654321', mode: 'LOGIN' })
  })).status, 404)
  assertStatus('registration requires privacy agreement', (await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone: unregisteredPhone, code: '654321', mode: 'REGISTER' })
  })).status, 400)

  const ownerMeResponse = await request('/api/v1/account/me', owner.token)
  assertStatus('owner current-user response', ownerMeResponse.status, 200)
  const ownerMe = await ownerMeResponse.json()
  if (ownerMe.data?.staffRole !== 'OWNER') throw new Error('owner current-user response omitted OWNER staffRole')
  console.log('PASS owner current-user response contains OWNER')

  const userMeResponse = await request('/api/v1/account/me', normalUser.token)
  assertStatus('normal current-user response', userMeResponse.status, 200)
  const userMe = await userMeResponse.json()
  if (userMe.data?.staffRole != null) throw new Error('normal user unexpectedly received a staff role')
  console.log('PASS normal current-user response has no staff role')

  assertStatus('unauthenticated aftersales denied', (await request('/api/admin/aftersales')).status, 401)
  assertStatus('support can read users', (await request('/api/admin/users', support.token)).status, 200)
  await prisma.user.update({ where: { id: normalUser.id }, data: { status: 'PENDING_DELETE' } })
  const deletionTask = await prisma.accountDeletionRequest.create({
    data: {
      userId: normalUser.id, status: 'MANUAL_REVIEW', requestedAt: new Date(),
      scheduledAt: new Date(), attemptCount: 3, firstFailedAt: new Date(), manualReviewAt: new Date(),
      lastError: 'security test failure'
    }
  })
  assertStatus('support can read account deletion tasks', (await request('/api/admin/account-deletions', support.token)).status, 200)
  assertStatus('support cannot retry account deletion tasks', (await request(`/api/admin/account-deletions/${deletionTask.id}/retry`, support.token, {
    method: 'POST'
  })).status, 403)
  assertStatus('owner can pause account deletion tasks', (await request(`/api/admin/account-deletions/${deletionTask.id}/pause`, owner.token, {
    method: 'POST', body: JSON.stringify({
      reason: '自动化测试内部暂停原因',
      userMessage: '账号注销任务暂时需要人工核对，请稍后查看处理状态'
    })
  })).status, 200)
  assertStatus('owner can resume account deletion tasks', (await request(`/api/admin/account-deletions/${deletionTask.id}/resume`, owner.token, {
    method: 'POST'
  })).status, 200)
  assertStatus('support cannot read security logs', (await request('/api/admin/logs', support.token)).status, 403)
  assertStatus('collab can read collab work queue', (await request('/api/admin/collab/works', collab.token)).status, 200)
  assertStatus('support cannot read collab work queue', (await request('/api/admin/collab/works', support.token)).status, 403)
  assertStatus('production cannot read collab work queue', (await request('/api/admin/collab/works', production.token)).status, 403)
  assertStatus('collab cannot access contact submissions', (await request('/api/admin/contact', collab.token)).status, 403)
  assertStatus('production cannot access contact submissions', (await request('/api/admin/contact', production.token)).status, 403)
  assertStatus('support can access contact submissions', (await request('/api/admin/contact?limit=1', support.token)).status, 200)
  assertStatus('support cannot delete contact submissions', (await request('/api/admin/contact/not-a-real-id', support.token, {
    method: 'DELETE'
  })).status, 403)
  assertStatus('owner can reach contact deletion handler', (await request('/api/admin/contact/not-a-real-id', owner.token, {
    method: 'DELETE'
  })).status, 404)
  assertStatus('collab can read contracts', (await request('/api/admin/contracts?limit=1', collab.token)).status, 200)
  assertStatus('support cannot read contracts', (await request('/api/admin/contracts?limit=1', support.token)).status, 403)
  assertStatus('collab cannot delete contracts', (await request('/api/admin/contracts/not-a-real-id', collab.token, {
    method: 'DELETE'
  })).status, 403)
  assertStatus('owner can reach contract deletion handler', (await request('/api/admin/contracts/not-a-real-id', owner.token, {
    method: 'DELETE'
  })).status, 404)
  assertStatus('collab can read collab policy', (await request('/api/admin/collab/policy', collab.token)).status, 200)
  assertStatus('collab cannot update collab policy', (await request('/api/admin/collab/policy', collab.token, {
    method: 'PUT', body: JSON.stringify({})
  })).status, 403)
  assertStatus('support cannot ban staff', (await request(`/api/admin/users/${production.id}/ban`, support.token, {
    method: 'PUT', body: JSON.stringify({ isBanned: true })
  })).status, 403)
  assertStatus('production can read inventory', (await request('/api/inventory?limit=1', production.token)).status, 200)
  assertStatus('production cannot read users', (await request('/api/admin/users', production.token)).status, 403)
  assertStatus('collab role cannot probe retired revenue paths', (await request('/api/admin/revenue/configs', collab.token)).status, 403)
  assertStatus('retired revenue config has no route for owner', (await request('/api/admin/revenue/configs', owner.token)).status, 404)
  assertStatus('collab cannot read users', (await request('/api/admin/users', collab.token)).status, 403)
  assertStatus('owner can read security logs', (await request('/api/admin/logs', owner.token)).status, 200)
  const closedLegacyOrders = await request('/api/admin/orders', owner.token)
  assertStatus('authenticated legacy order entry is closed', closedLegacyOrders.status, 410)
  if ((await closedLegacyOrders.json()).code !== 'LEGACY_ENDPOINT_CLOSED') throw new Error('legacy order entry omitted closure code')
  console.log('PASS legacy order entry returns explicit closure code')
  assertStatus('production can use formal order workflow', (await request('/api/admin/production-workflow/orders', production.token)).status, 200)
  assertStatus('retained legacy batch list remains available for its recorded page consumer', (await request('/api/admin/batches?limit=1', production.token)).status, 200)
  assertStatus('anonymous direct customize order entry remains protected', (await request('/api/customize-orders')).status, 401)
  assertStatus('unused direct customize order entry is closed', (await request('/api/customize-orders', normalUser.token)).status, 410)
  assertStatus('owner cannot change own role', (await request(`/api/admin/users/${owner.id}/role`, owner.token, {
    method: 'PUT', body: JSON.stringify({ staffRole: 'CUSTOMER_SERVICE' })
  })).status, 400)

  const secretBody = {
    isBanned: false,
    password: 'NeverStoreThisPassword', otp: '654321', phone: '13912345678',
    receiverAddress: 'Never Store This Address', trackingNo: 'NeverStoreTracking'
  }
  assertStatus('support can update normal user status', (await request(`/api/admin/users/${normalUser.id}/ban`, support.token, {
    method: 'PUT', body: JSON.stringify(secretBody)
  })).status, 200)

  await new Promise(resolve => setTimeout(resolve, 150))
  const audit = await prisma.operationLog.findFirst({
    where: { userId: support.id, path: `/api/admin/users/${normalUser.id}/ban`, after: { not: null } },
    orderBy: { createdAt: 'desc' }
  })
  if (!audit?.after) throw new Error('sanitized audit entry was not created')
  for (const secret of ['NeverStoreThisPassword', '654321', '13912345678', 'Never Store This Address', 'NeverStoreTracking']) {
    if (audit.after.includes(secret)) throw new Error(`audit leaked sensitive value: ${secret}`)
  }
  if (!audit.after.includes('[REDACTED]')) throw new Error('audit did not mark redacted fields')
  console.log('PASS audit body is redacted')

  assertStatus('owner changes production role', (await request(`/api/admin/users/${production.id}/role`, owner.token, {
    method: 'PUT', body: JSON.stringify({ staffRole: 'CUSTOMER_SERVICE' })
  })).status, 200)
  assertStatus('changed staff old session revoked', (await request('/api/v1/account/me', production.token)).status, 401)
  console.log('Staff permission and audit security checks passed')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
