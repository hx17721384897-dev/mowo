import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-7)
const users = []

const probes = [
  '/api/articles',
  '/api/articles/retired-probe',
  '/api/articles/retired-probe/like',
  '/api/articles/retired-probe/collect',
  '/api/articles/retired-probe/comments',
  '/api/feed',
  '/api/users/retired-user/articles',
  '/api/users/retired-user/follow',
  '/api/users/retired-user/follow-status',
  '/api/collab/works/retired-work/like',
  '/api/products',
  '/api/products/mine',
  '/api/products/retired-product',
  '/api/animations',
  '/api/animations/retired-animation',
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
  '/api/certify/status'
]
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, token, method = 'GET') {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(!['GET', 'OPTIONS'].includes(method) ? { 'Content-Type': 'application/json' } : {})
    },
    ...(!['GET', 'OPTIONS'].includes(method) ? { body: '{}' } : {})
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
      profile: { create: { nickname: `retirement-${label}` } },
      creditScore: { create: { score: 100 } }
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

async function snapshot() {
  const [articles, products, collabOrders, balances, withdrawals] = await Promise.all([
    prisma.article.count(),
    prisma.product.count(),
    prisma.collabOrder.count(),
    prisma.balance.count(),
    prisma.withdrawalRequest.count()
  ])
  return { articles, products, collabOrders, balances, withdrawals }
}

async function cleanup() {
  const ids = users.map(user => user.id)
  const phones = users.map(user => user.phone)
  if (!ids.length) return
  await prisma.operationLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.smsCode.deleteMany({ where: { phone: { in: phones } } })
  await prisma.creditScore.deleteMany({ where: { userId: { in: ids } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

try {
  const userToken = await createCaller('user', null, 0, 1)
  const staffToken = await createCaller('staff', 'OWNER', 3, 2)
  const before = await snapshot()
  const callers = [['anonymous', null], ['user', userToken], ['staff', staffToken]]
  let checked = 0

  for (const [caller, token] of callers) {
    for (const path of probes) {
      for (const method of methods) {
        const response = await request(path, token, method)
        const body = await response.json()
        assert(response.status === 404, `${caller} ${method} ${path}: expected 404, received ${response.status}`)
        assert(body.code === 'FEATURE_RETIRED', `${caller} ${method} ${path}: retirement code missing`)
        checked += 1
      }
    }
  }

  const after = await snapshot()
  assert(JSON.stringify(after) === JSON.stringify(before), 'retirement probes changed retired business data')
  console.log(`Retired endpoint isolation passed for ${checked} caller/method/path combinations with no business side effects`)
} finally {
  await cleanup()
  await prisma.$disconnect()
}
