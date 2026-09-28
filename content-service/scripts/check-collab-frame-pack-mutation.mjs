import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
const phone = `191${runId}`
let userId = null
let workId = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function request(path, token, body) {
  return fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function cleanup() {
  if (workId) {
    await prisma.collabFramePack.deleteMany({ where: { collabWorkId: workId } })
    await prisma.collabWork.deleteMany({ where: { id: workId } })
  }
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
      privacyPolicyVersion: 'pack-test',
      profile: { create: { nickname: `帧包变更验收-${runId}` } },
    },
  })
  userId = user.id
  const work = await prisma.collabWork.create({
    data: {
      creatorId: userId,
      title: `帧包变更作品-${runId}`,
      animationFrames: '[]',
      supportedSkus: '[]',
      status: 'approved',
      agreementSignedAt: new Date(),
      approvedAt: new Date(),
      approvedBy: userId,
    },
  })
  workId = work.id
  await prisma.smsCode.create({
    data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) },
  })
  const loginResponse = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' }),
  })
  const login = await loginResponse.json()
  assert(loginResponse.ok && login.success, '合作运营可以登录帧素材包管理')
  const token = login.data.accessToken
  const path = `/api/admin/collab/${workId}/frame-packs/5x5cm/update`

  const anonymous = await request(path, null, {
    stockType: 'stocked', quantity: 5, clientRequestId: `anonymous-${runId}`,
  })
  assert(anonymous.status === 401, '未登录请求不能调整联名帧素材包库存')

  const firstKey = `frame-pack-first-${runId}`
  const first = await request(path, token, {
    stockType: 'stocked', quantity: 5, clientRequestId: firstKey,
  })
  const firstBody = await first.json()
  assert(first.ok && firstBody.data.currentStock === 5 && firstBody.data.replayed === false, '库存类型和数量在一次请求中原子写入')

  const replay = await request(path, token, {
    stockType: 'stocked', quantity: 5, clientRequestId: firstKey,
  })
  const replayBody = await replay.json()
  const afterReplay = await prisma.collabFramePack.findUnique({
    where: { collabWorkId_size: { collabWorkId: workId, size: '5x5cm' } },
  })
  assert(replay.ok && replayBody.data.replayed === true && afterReplay.currentStock === 5, '相同请求键重放不会重复增加库存')

  const conflict = await request(path, token, {
    stockType: 'stocked', quantity: 6, clientRequestId: firstKey,
  })
  assert(conflict.status === 409, '同一请求键不能改写为另一项库存操作')

  const rejected = await request(path, token, {
    stockType: 'on_demand', quantity: -6, clientRequestId: `frame-pack-rejected-${runId}`,
  })
  const afterRejected = await prisma.collabFramePack.findUnique({
    where: { collabWorkId_size: { collabWorkId: workId, size: '5x5cm' } },
  })
  assert(rejected.status === 409 && afterRejected.stockType === 'stocked' && afterRejected.currentStock === 5, '库存不足时类型与数量均不发生部分成功')

  const concurrentKey = `frame-pack-concurrent-${runId}`
  const concurrentBody = {
    stockType: 'stocked', quantity: 3, clientRequestId: concurrentKey,
  }
  const sameKeyResponses = await Promise.all([
    request(path, token, concurrentBody),
    request(path, token, concurrentBody),
  ])
  const afterSameKey = await prisma.collabFramePack.findUnique({
    where: { collabWorkId_size: { collabWorkId: workId, size: '5x5cm' } },
  })
  const sameKeyMutations = await prisma.collabFramePackMutation.count({
    where: { clientRequestId: concurrentKey },
  })
  assert(sameKeyResponses.every(response => response.ok) && afterSameKey.currentStock === 8 && sameKeyMutations === 1, '同键并发只执行一次库存增量')

  const decrements = await Promise.all([
    request(path, token, {
      stockType: 'stocked', quantity: -6, clientRequestId: `frame-pack-dec-a-${runId}`,
    }),
    request(path, token, {
      stockType: 'stocked', quantity: -6, clientRequestId: `frame-pack-dec-b-${runId}`,
    }),
  ])
  const afterDecrements = await prisma.collabFramePack.findUnique({
    where: { collabWorkId_size: { collabWorkId: workId, size: '5x5cm' } },
  })
  assert(decrements.filter(response => response.ok).length === 1 && decrements.filter(response => response.status === 409).length === 1 && afterDecrements.currentStock === 2, '不同请求并发扣减不会把库存降到零以下')

  console.log('Collab frame-pack atomic mutation checks passed')
} finally {
  await cleanup()
}
