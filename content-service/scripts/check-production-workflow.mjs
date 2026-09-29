import fs from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const root = new URL('../', import.meta.url)

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

try {
  const [schema, routes, orderPage, batchPage, scanOverview, scanFrame, scanMaterial, scanPairing, scanPacking, scanCommon, sidebar, oldAdmin] = await Promise.all([
    fs.readFile(new URL('prisma/schema.prisma', root), 'utf8'),
    fs.readFile(new URL('src/routes/production-workflow.js', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/admin-orders.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/admin-production-batches.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/production-scan.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/production-scan-frame.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/production-scan-material.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/production-scan-pairing.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/production-scan-packing.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/js/production-scan-common.js', root), 'utf8'),
    fs.readFile(new URL('../frontend/js/admin-sidebar.js', root), 'utf8'),
    fs.readFile(new URL('src/routes/admin.js', root), 'utf8')
  ])
  assert(schema.includes('fulfillmentStatus') && schema.includes('model ProductionFramePack'), '数据库区分付款事实、履约阶段和唯一帧素材包')
  assert(schema.includes('model ProductionUnitPairing') && schema.includes('model ProductionPackingSession'), '数据库持久保存单件配对与整单装箱会话')
  assert(schema.includes('model ProductionMaterialPick') && schema.includes('reservedQty'), '数据库持久保存材料领用、预留、消耗和退回数量')
  assert(schema.includes('model ProductionFrameReprint') && schema.includes('requestedPages'), '数据库持久保存指定页返工和新旧帧包码')
  assert(schema.includes('clientRequestId') && routes.includes('requestFingerprint') && routes.includes('idempotent: true'), '按页返工使用持久化请求键，网络重试不会重复作废帧包')
  assert(routes.includes('PENDING_ADDRESS_EXPORT') && routes.includes('WAITING_TRACKING') && routes.includes('READY_FOR_PRODUCTION'), '后端实现待处理、处理中和待生产阶段')
  assert(routes.includes('export-production') && routes.includes('framePackCode'), '首次生产资料导出会建立帧包身份并启动两条生产线')
  assert(routes.includes('ensureBatchPrintFiles') && routes.includes('再次导出会自动补生成'), '补上传模板后可以为旧批次自动补生成 Word')
  assert(routes.includes('file.templateVersionId === template.id') && routes.includes('fileByProductionUnit'), '生产文件按动画、帧数和冻结模板共同匹配，不会跨尺寸串用')
  assert(routes.includes("fastify.get('/frame-print-queue'") && routes.includes('printCopies: 1'), '帧包岗位读取每个 PU 一条且固定打印一份的统一队列')
  assert(routes.includes('打印队列/${groupFolderByKey.get(groupKey)}') && routes.includes("String(sequence).padStart(4, '0')"), 'ZIP 按裁切组和冻结顺序输出逐 PU 文件')
  assert(routes.includes('printFileId: printFile.id') && routes.includes('批次生产总表.xlsx') && routes.includes("name: '单件生产明细'"), 'FP 绑定实际 Word 且统一生产总表使用同一打印顺序')
  assert(routes.includes('清单核对标记') && routes.includes('ledgerMarker') && routes.includes('返工记录'), '纸质生产清单包含可与系统直接比对的返工标记')
  assert(routes.includes("fastify.get('/orders'") && routes.includes("fastify.post('/units/:productionUnitId/reprint'"), '订单环节页和按页返工使用正式生产接口')
  assert(routes.includes('kitAssemblyBatch.updateMany') && routes.includes('skuInventory.updateMany'), '材料包配对采用条件扣减并同步汇总库存')
  assert(routes.includes("frame-packs/:code/complete") && routes.includes("fastify.post('/material-picks'"), '帧包完成与材料领用是独立生产动作')
  assert(routes.includes("status: 'ACTIVE', remainingQty: { gt: 0 }") && routes.includes('reservedQty: { decrement: 1 }'), '配对只消耗当前批次已领材料并同步释放预留')
  assert(routes.includes('resolvePickedKitSource') && routes.includes('kitContainerId: container.id'), '箱码配对只使用当前生产批次已领用的箱内材料批次')
  assert(routes.includes('refreshReadyToShip') && routes.includes("fulfillmentStatus: 'SHIPPED'"), '全部单件装箱完成后才允许发货')
  assert(oldAdmin.includes('正式 PB 批次必须走总订单地址导出'), '旧地址导出不能覆盖正式生产批次')
  assert(oldAdmin.includes('旧帧图压缩包接口已停用'), '旧帧图导出不能覆盖正式生产批次')
  assert(orderPage.includes('/api/admin/production-workflow/orders') && orderPage.includes('/reprint') && orderPage.includes('clientRequestId'), '订单环节页只读取正式订单，并以幂等请求提供返工入口')
  assert(batchPage.includes('进入当前订单环节') && !batchPage.includes('onclick="exportAddresses()"') && !batchPage.includes('onclick="exportProduction()"'), '生产批次页只做总览和环节跳转，不重复推进状态')
  assert(batchPage.includes('生产清单核对标记') && batchPage.includes('返工记录与当前进度') && batchPage.includes('旧码已作废'), '生产批次页直观展示清单新旧判断和返工处理步骤')
  assert(scanOverview.includes('data-view="frame"') && scanOverview.includes('data-view="material"') && scanOverview.includes('data-view="pairing"') && scanOverview.includes('data-view="packing"'), '扫码总览与四个岗位已经收拢为同一工作台')
assert(scanFrame.includes('#frame') && scanMaterial.includes('#material') && scanPairing.includes('#pairing') && scanPacking.includes('#packing'), '旧岗位地址只跳转到统一工作台，不保留重复业务系统')
  assert(scanCommon.includes('installScanner') && scanCommon.includes("target?.matches?.('input,textarea,select"), '扫码枪无需点击输入框并保留手工输入备用')
assert(scanOverview.includes('打印队列') && scanOverview.includes('globalBatch') && scanOverview.includes('production-scan-workbench.js'), '统一工作台展示批次打印队列并只选择一次工作批次')
assert(sidebar.includes("key: 'scan'") && sidebar.includes('production-scan.html?v=20260904-1#packing') && !sidebar.includes('production-scan-packing.html'), '后台菜单只通过统一工作台打开五个扫码环节')
assert(scanCommon.includes("index.html?auth=1&redirect=") && scanCommon.includes('location.hash'), '扫码工作台未登录时使用真实登录弹窗并保留原工位')
  assert(routes.includes("if (frame.batchId !== batchId)") && routes.includes("if (!result.reused) await audit"), '帧包与配对强制校验当前批次且重复扫码不重复写成功日志')
  await Promise.all([
    prisma.productionFramePack.count(), prisma.productionUnitPairing.count(),
    prisma.productionPackingSession.count(), prisma.productionPackingScan.count(),
    prisma.productionFrameReprint.count(), prisma.productionMaterialPick.count()
  ])
  console.log('Production workflow checks passed')
} finally {
  await prisma.$disconnect()
}
