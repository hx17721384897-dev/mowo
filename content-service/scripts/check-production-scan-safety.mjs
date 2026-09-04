import AdmZip from 'adm-zip'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
const phone = `194${runId}`
let userId = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function cleanup() {
  if (userId) {
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.smsCode.deleteMany({ where: { OR: [{ userId }, { phone }] } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
}

try {
  const fixture = await prisma.productionFramePack.findFirst({
    where: { isActive: true, status: { in: ['COMPLETED', 'PAIRED', 'PACKED', 'SHIPPED'] } }, orderBy: { updatedAt: 'desc' }
  })
  if (!fixture) throw new Error('没有可用于生产清单检查的帧包')
  const activeBatches = await prisma.productionBatch.findMany({ where: { status: { in: ['READY', 'IN_PROGRESS'] } }, select: { id: true } })
  const fixtureBatchIsActive = activeBatches.some(batch => batch.id === fixture.batchId)
  const otherBatch = activeBatches.find(batch => batch.id !== fixture.batchId)
  const pick = await prisma.productionMaterialPick.findFirst({
    where: { batchId: fixture.batchId, status: 'ACTIVE', remainingQty: { gt: 0 } },
    include: { kitAssemblyBatch: true, kitContainer: true }
  })

  const user = await prisma.user.create({ data: {
    phone, role: 2, staffRole: 'OWNER', privacyAgreedAt: new Date(), privacyPolicyVersion: 'scan-safety-test',
    profile: { create: { nickname: `scan-safety-${runId}` } }, creditScore: { create: { score: 100 } }
  } })
  userId = user.id
  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const loginResponse = await fetch(`${apiBase}/api/v1/auth/sms/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  const login = await loginResponse.json()
  if (!loginResponse.ok || !login.success) throw new Error(login.message || '测试负责人登录失败')
  const headers = { Authorization: `Bearer ${login.data.accessToken}`, 'Content-Type': 'application/json' }

  if (fixtureBatchIsActive) {
    const beforeLogs = await prisma.operationLog.count({ where: { targetId: fixture.id, action: { contains: '完成裁切装袋' } } })
    const duplicateResponse = await fetch(`${apiBase}/api/admin/production-workflow/frame-packs/${encodeURIComponent(fixture.code)}/complete`, {
      method: 'POST', headers, body: JSON.stringify({ batchId: fixture.batchId })
    })
    const duplicate = await duplicateResponse.json()
    assert(duplicateResponse.ok && duplicate.data?.reused === true && duplicate.data?.changed === false, '重复扫描已完成或已进入后续环节的 FP 返回提醒且不重复推进')
    const afterLogs = await prisma.operationLog.count({ where: { targetId: fixture.id, action: { contains: '完成裁切装袋' } } })
    assert(afterLogs === beforeLogs, '重复扫描不会新增“完成裁切装袋”成功日志')
  } else {
    console.log('SKIP 当前只有已结束批次，不对真实已发货帧包执行重复扫码')
  }

  if (fixtureBatchIsActive && otherBatch) {
    const wrongResponse = await fetch(`${apiBase}/api/admin/production-workflow/frame-packs/${encodeURIComponent(fixture.code)}/complete`, {
      method: 'POST', headers, body: JSON.stringify({ batchId: otherBatch.id })
    })
    assert(wrongResponse.status === 409, '跨生产批次扫描 FP 会被服务器拒绝')
  }

  if (fixtureBatchIsActive && pick) {
    const sourceCode = pick.kitContainer?.code || pick.kitAssemblyBatch.batchNo
    const sourceResponse = await fetch(`${apiBase}/api/admin/production-workflow/pairing/material-source/${encodeURIComponent(sourceCode)}?batchId=${encodeURIComponent(fixture.batchId)}`, { headers })
    const source = await sourceResponse.json()
    assert(sourceResponse.ok && source.data?.remainingQty > 0, '配对前能核对当前批次已领材料来源和剩余数量')
  }

  const pairing = await prisma.productionUnitPairing.findUnique({ where: { productionUnitId: fixture.productionUnitId } })
  if (fixtureBatchIsActive && pairing && pairing.status !== 'VOID') {
    const [kitBatch, container] = await Promise.all([
      prisma.kitAssemblyBatch.findUnique({ where: { id: pairing.kitAssemblyBatchId } }),
      pairing.kitContainerId ? prisma.kitContainer.findUnique({ where: { id: pairing.kitContainerId } }) : null
    ])
    const sourceCode = container?.code || kitBatch?.batchNo
    const beforeStock = { availableQty: kitBatch.availableQty, reservedQty: kitBatch.reservedQty }
    const beforePairLogs = await prisma.operationLog.count({ where: { targetId: pairing.id, action: { contains: '配对' } } })
    const pairingResponse = await fetch(`${apiBase}/api/admin/production-workflow/pairing`, {
      method: 'POST', headers, body: JSON.stringify({ batchId: fixture.batchId, framePackCode: fixture.code, kitCode: sourceCode })
    })
    const pairingResult = await pairingResponse.json()
    const afterBatch = await prisma.kitAssemblyBatch.findUnique({ where: { id: pairing.kitAssemblyBatchId } })
    const afterPairLogs = await prisma.operationLog.count({ where: { targetId: pairing.id, action: { contains: '配对' } } })
    assert(pairingResponse.ok && pairingResult.data?.reused === true, '重复扫描已配对 FP 返回原配对结果')
    assert(afterBatch.availableQty === beforeStock.availableQty && afterBatch.reservedQty === beforeStock.reservedQty, '重复配对不会再次扣减材料库存或预留')
    assert(afterPairLogs === beforePairLogs, '重复配对不会新增成功配对日志')
  }

  const ledgerResponse = await fetch(`${apiBase}/api/admin/production-workflow/batches/${encodeURIComponent(fixture.batchId)}/production-ledger`, { headers })
  const ledger = Buffer.from(await ledgerResponse.arrayBuffer())
  const zip = new AdmZip(ledger)
  const workbook = zip.readAsText('xl/workbook.xml')
  const detail = zip.readAsText('xl/worksheets/sheet1.xml')
  const reprintCount = await prisma.productionFrameReprint.count({ where: { batchId: fixture.batchId } })
  assert(ledgerResponse.ok && workbook.includes('单件生产明细') && workbook.includes('材料需求汇总'), '生产总表包含单件明细和材料需求两个工作表')
  assert(detail.includes('MOWO-SKU-') && !detail.includes('SKU编码缺失'), '生产总表展示正式 SKU 编码而不是数据库内部 ID')
  assert(detail.includes('清单核对标记') && detail.includes(`${fixture.batchId} / 返工${reprintCount}次`), '生产总表打印后可用批次和返工次数与系统核对新旧')
  console.log('Production scan safety checks passed')
} finally {
  await cleanup()
}
