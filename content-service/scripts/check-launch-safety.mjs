import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const run = String(Date.now()).slice(-8)
const phone = `198${run}`
let userId = null
const smsTestPhones = Array.from({ length: 11 }, (_, index) => `187${run.slice(0, 6)}${String(index).padStart(2, '0')}`)

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function request(path, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  })
}

async function cleanup() {
  if (userId) {
    await prisma.consentRecord.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.smsCode.deleteMany({ where: { phone } })
  await prisma.smsCode.deleteMany({ where: { phone: { in: smsTestPhones } } })
  await prisma.rateLimitBucket.deleteMany()
}

try {
  if (process.env.NODE_ENV === 'production') throw new Error('launch safety checks must not run in production')
  await prisma.rateLimitBucket.deleteMany()
  const flagsResponse = await request('/api/config/features')
  assert(flagsResponse.status === 200, 'feature configuration is public and readable')
  assert(flagsResponse.headers.get('x-content-type-options') === 'nosniff', 'security response headers are present')
  assert(flagsResponse.headers.get('cross-origin-resource-policy') === 'same-site', 'ordinary API responses keep strict resource isolation')
  const avatarProbe = await request('/api/upload/public/not-a-real-avatar')
  assert(avatarProbe.headers.get('cross-origin-resource-policy') === 'cross-origin', 'public avatar responses can render from the static frontend origin')
  const signedFileProbe = await request('/api/storage/local')
  assert(signedFileProbe.headers.get('cross-origin-resource-policy') === 'cross-origin', 'signed local file responses can render from the static frontend origin')
  const flags = (await flagsResponse.json()).data
  for (const feature of ['community', 'creatorFinance', 'bullSystem', 'mockCertification', 'creatorCollabSelfService']) {
    assert(flags[feature] === false, `${feature} is disabled for invitation testing`)
  }

  const closedPaths = [
    '/api/articles',
    '/api/feed',
    '/api/earnings',
    '/api/admin/bull/configs',
    '/api/certify/status',
    '/api/collab/my-works'
  ]
  for (const path of closedPaths) {
    const response = await request(path)
    const body = await response.json()
    assert(response.status === 404 && body.code === 'FEATURE_NOT_AVAILABLE', `${path} is denied by the server gate`)
  }
  assert((await request('/api/collab/works?limit=1')).status === 200, 'approved collaboration showcase remains available')

  for (let index = 0; index < smsTestPhones.length; index += 1) {
    const response = await request('/api/v1/auth/sms/send', {
      method: 'POST',
      body: JSON.stringify({ phone: smsTestPhones[index], purpose: 'REGISTER' })
    })
    const expected = index < 10 ? 200 : 429
    assert(response.status === expected, `SMS distinct-phone attempt ${index + 1} returns ${expected}`)
  }

  const cooldownRetry = await request('/api/v1/auth/sms/send', {
    method: 'POST',
    body: JSON.stringify({ phone: smsTestPhones[0], purpose: 'REGISTER' })
  })
  const cooldownBody = await cooldownRetry.json()
  assert(cooldownRetry.status === 429 && cooldownBody.code === 'SMS_TOO_FREQUENT', 'SMS cooldown blocks an immediate retry')
  const phoneDailyBuckets = await prisma.rateLimitBucket.findMany({
    where: { scope: 'SMS_PHONE_DAILY' },
    select: { count: true }
  })
  assert(phoneDailyBuckets.every(bucket => bucket.count === 1), 'blocked cooldown retries do not consume daily SMS quota')

  for (let index = 0; index < 6; index += 1) {
    const response = await request('/api/contact', {
      method: 'POST',
      body: JSON.stringify({ type: 'invalid-test' })
    })
    const expected = index < 5 ? 400 : 429
    assert(response.status === expected, `contact attempt ${index + 1} returns ${expected}`)
  }

  await prisma.smsCode.create({
    data: { phone, code: '123456', purpose: 'REGISTER', expiresAt: new Date(Date.now() + 300000) }
  })
  const register = await request('/api/v1/auth/sms/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code: '123456', mode: 'REGISTER', agreedToPrivacy: true })
  })
  assert(register.status === 200, 'test account can register with explicit agreement')
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } })
  userId = user?.id || null
  assert(Boolean(userId), 'registered user exists')
  const consents = await prisma.consentRecord.findMany({ where: { userId }, orderBy: { type: 'asc' } })
  assert(consents.length === 2, 'registration stores two separate consent records')
  assert(consents.some(item => item.type === 'PRIVACY_POLICY' && item.version === 'dev-2026-08'), 'privacy policy version is recorded')
  assert(consents.some(item => item.type === 'USER_AGREEMENT' && item.version === 'test-2026-08'), 'user agreement version is recorded')

  const now = new Date()
  const windowMs = 60 * 60 * 1000
  const windowKey = String(Math.floor(now.getTime() / windowMs) * windowMs)
  const expiresAt = new Date(Number(windowKey) + windowMs)
  await prisma.rateLimitBucket.create({
    data: {
      scope: 'LAUNCH_TEST_LIMIT', subjectHash: 'test-subject', targetHash: '',
      windowKey, count: 10, expiresAt
    }
  })
  const bucket = await prisma.rateLimitBucket.findFirst({ where: { scope: 'LAUNCH_TEST_LIMIT' } })
  assert(bucket?.count === 10, 'database-backed rate limit buckets are writable')

  console.log('Launch safety checks passed')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
