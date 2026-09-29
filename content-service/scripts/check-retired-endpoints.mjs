import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-7)
const users = []
const importedOrderIds = []

const probes = [
  '/api/articles',
  '/api/articles/retired-probe/comments',
  '/api/feed',
  '/api/users/retired-user/articles',
  '/api/users/retired-user/follow',
  '/api/collab/works/retired-work/like',
  '/api/products',
  '/api/products/retired-product',
  '/api/animations',
  '/api/animations/retired-animation/frames',
  '/api/collab/apply',
  '/api/collab/my-works',
  '/api/earnings',
  '/api/creator/settlement',
  '/api/admin/settlement',
  '/api/admin/revenue',
  '/api/creator/bull',
  '/api/admin/bull',
  '/api/creator/links',
  '/api/admin/links',
  '/api/admin/collab/activities',
  '/api/admin/collab/retired-work/approve',
  '/api/admin/collab/retired-work/regen-gif',
  '/api/admin/collab/retired-work/shelf',
  '/api/admin/collab/retired-work/frame-packs/S',
  '/api/admin/collab/retired-work/frame-packs/S/restock',
  '/api/admin/collab/policy',
  '/api/admin/contracts',
  '/api/certify/status'
]
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, token, method = 'GET', body = null) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(!['GET'].includes(method) ? { 'Content-Type': 'application/json' } : {})
    },
    ...(!['GET'].includes(method) ? { body: JSON.stringify(body || {}) } : {})
  })
}

async function createCaller(label, staffRole, role, index) {
  const phone = `196${runId}${index}`
  const user = await prisma.user.create({
    data: {
      phone,
      role,
      staffRole,
      privacyAgreedAt: new Date(),
      privacyPolicyVersion: 'retirement-test',
      profile: { create: { nickname: `retirement-${label}` } }
    }
  })
  users.push({ ...user, phone })
  await prisma.smsCode.create({
    data: { phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) }
  })
  const login = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assert(login.status === 200, `${label} login failed: ${login.status}`)
  return (await login.json()).data.accessToken
}

async function retainedSnapshot() {
  const [orders, mappings, quotas, collabWorks, contacts, salesOrders] = await Promise.all([
    prisma.customizeOrder.count(),
    prisma.platformSkuMapping.count(),
    prisma.channelQuota.count(),
    prisma.collabWork.count(),
    prisma.contactSubmission.count(),
    prisma.salesOrder.count()
  ])
  return { orders, mappings, quotas, collabWorks, contacts, salesOrders }
}

async function cleanup() {
  const ids = users.map(user => user.id)
  const phones = users.map(user => user.phone)
  if (!ids.length) return
  if (importedOrderIds.length) await prisma.customizeOrder.deleteMany({ where: { id: { in: importedOrderIds } } })
  await prisma.operationLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.smsCode.deleteMany({ where: { phone: { in: phones } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

try {
  const userToken = await createCaller('user', null, 0, 1)
  const staffToken = await createCaller('staff', 'OWNER', 3, 2)
  const before = await retainedSnapshot()
  const callers = [['anonymous', null], ['user', userToken], ['staff', staffToken]]
  let checked = 0

  for (const [caller, token] of callers) {
    for (const path of probes) {
      for (const method of methods) {
        const response = await request(path, token, method)
        const expected = path.startsWith('/api/admin/')
          ? ({ anonymous: 401, user: 403, staff: 404 })[caller]
          : 404
        assert(response.status === expected, `${caller} ${method} ${path}: expected ${expected}, received ${response.status}`)
        checked += 1
      }
    }
  }

  const after = await retainedSnapshot()
  assert(JSON.stringify(after) === JSON.stringify(before), 'retired URL probes changed retained business data')

  assert((await request('/api/admin/import/pending', null)).status === 401, 'external import rejects anonymous access')
  assert((await request('/api/admin/import/pending', userToken)).status === 403, 'external import rejects ordinary users')
  assert((await request('/api/admin/import/pending', staffToken)).status === 200, 'external import remains available to authorized staff')
  assert((await request('/api/admin/sku-mapping', staffToken)).status === 200, 'external SKU mapping remains available to authorized staff')
  const importResponse = await request('/api/admin/import/manual', staffToken, 'POST', {
    platform: 'XHS',
    externalOrderId: `R1B-${runId}`,
    receiverName: '导入验收',
    receiverPhone: 'invalid',
    receiverAddress: '待补全',
    receiverCity: '上海'
  })
  const importBody = await importResponse.json()
  assert(importResponse.status === 200 && importBody.success, 'authorized staff can create an external manual import')
  const imported = await prisma.customizeOrder.findFirst({
    where: { platform: 'XHS', externalOrderId: `R1B-${runId}` }
  })
  assert(imported?.importStatus === 'pending_info', 'external import keeps its exception-completion state')
  importedOrderIds.push(imported.id)

  console.log(`Physical retirement passed for ${checked} caller/method/path combinations; external order import remains staff-only and operational`)
} finally {
  await cleanup()
  await prisma.$disconnect()
}
