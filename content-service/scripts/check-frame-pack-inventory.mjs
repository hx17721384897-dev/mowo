import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
let userId
const workIds = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}
async function request(path, token, method = 'POST', body) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
}
async function cleanup() {
  if (workIds.length) {
    const variants = await prisma.framePackVariant.findMany({ where: { workId: { in: workIds } }, select: { id: true } })
    await prisma.framePackLog.deleteMany({ where: { variantId: { in: variants.map(row => row.id) } } })
    await prisma.framePackVariant.deleteMany({ where: { workId: { in: workIds } } })
    await prisma.framePackWork.deleteMany({ where: { id: { in: workIds } } })
  }
  if (userId) {
    await prisma.inventoryMaterialMutation.deleteMany({ where: { operatorId: userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
}

try {
  const phone = `193${runId}`
  const user = await prisma.user.create({ data: {
    phone, role: 3, staffRole: 'OWNER', privacyAgreedAt: new Date(),
    privacyPolicyVersion: 'fp-test', profile: { create: { nickname: `frame-pack-${runId}` } }
  } })
  userId = user.id
  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const login = await fetch(`${apiBase}/api/v1/auth/sms/verify`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({phone,code:'123456',mode:'LOGIN'}) })
  const token = (await login.json()).data.accessToken
  assert(login.ok && token, '临时负责人可以登录')

  const firstWork = await prisma.framePackWork.create({ data: { name:`帧包测试A-${runId}`, createdBy:userId } })
  const secondWork = await prisma.framePackWork.create({ data: { name:`帧包测试B-${runId}`, createdBy:userId } })
  workIds.push(firstWork.id, secondWork.id)
  const variant = await prisma.framePackVariant.create({ data: { workId:firstWork.id, size:'5x5cm', frameCount:12, currentStock:10, createdBy:userId } })
  const path = `/api/frame-packs/${firstWork.id}/variants/${variant.id}`

  assert((await request(`${path}/restock`, token, 'POST', {quantity:2})).status === 400, '帧包入库缺少请求键时拒绝写入')
  const restock = {quantity:5,note:'专项入库',clientRequestId:`frame-pack-restock-${runId}`}
  const first = await request(`${path}/restock`, token, 'POST', restock)
  const replay = await request(`${path}/restock`, token, 'POST', restock)
  const replayBody = await replay.json()
  assert(first.ok && replay.ok && replayBody.data.reused === true, '帧包入库同键重放恢复原结果')
  assert((await prisma.framePackVariant.findUnique({where:{id:variant.id}})).currentStock === 15, '帧包入库重放不会重复增加')
  assert(await prisma.framePackLog.count({where:{variantId:variant.id,type:'purchase_in'}}) === 1, '帧包入库重放只写一条流水')

  const mismatch = await request(`/api/frame-packs/${secondWork.id}/variants/${variant.id}/restock`, token, 'POST', {quantity:1,clientRequestId:`frame-pack-mismatch-${runId}`})
  assert(mismatch.status === 404, '规格不能借用其他作品 URL 修改库存')

  const adjust = {delta:-3,note:'专项盘点',clientRequestId:`frame-pack-adjust-${runId}`}
  const adjusted = await request(`${path}/adjust`, token, 'POST', adjust)
  const adjustedReplay = await request(`${path}/adjust`, token, 'POST', adjust)
  assert(adjusted.ok && adjustedReplay.ok && (await adjustedReplay.json()).data.reused === true, '帧包调减同键重放不重复扣减')
  assert((await prisma.framePackVariant.findUnique({where:{id:variant.id}})).currentStock === 12, '帧包调减结果正确且不为负数')

  const concurrent = await Promise.all([
    request(`${path}/restock`, token, 'POST', {quantity:2,clientRequestId:`frame-pack-concurrent-a-${runId}`}),
    request(`${path}/restock`, token, 'POST', {quantity:3,clientRequestId:`frame-pack-concurrent-b-${runId}`})
  ])
  assert(concurrent.every(response => response.ok), '不同请求键并发入库均成功')
  assert((await prisma.framePackVariant.findUnique({where:{id:variant.id}})).currentStock === 17, '不同请求键并发入库使用原子增量且不覆盖')

  for (const [method, retiredPath] of [
    ['DELETE', `/api/frame-packs/${firstWork.id}`],
    ['PUT', path],
    ['DELETE', path],
    ['GET', `${path}/logs`]
  ]) {
    const response = await request(retiredPath, token, method, ['PUT','DELETE'].includes(method) ? {note:'retired'} : undefined)
    assert(response.status === 404, `已退役帧包接口保持关闭：${method} ${retiredPath}`)
  }

  console.log('Frame pack inventory checks passed')
} finally {
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
