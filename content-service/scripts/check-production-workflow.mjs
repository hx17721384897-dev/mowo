import fs from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const root = new URL('../', import.meta.url)

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

try {
  const [schema, routes, orderPage, batchPage, scanPage, oldAdmin] = await Promise.all([
    fs.readFile(new URL('prisma/schema.prisma', root), 'utf8'),
    fs.readFile(new URL('src/routes/production-workflow.js', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/admin-orders.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/admin-production-batches.html', root), 'utf8'),
    fs.readFile(new URL('../frontend/pages/production-scan.html', root), 'utf8'),
    fs.readFile(new URL('src/routes/admin.js', root), 'utf8')
  ])
  assert(schema.includes('fulfillmentStatus') && schema.includes('model ProductionFramePack'), '数据库区分付款事实、履约阶段和唯一帧素材包')
  assert(schema.includes('model ProductionUnitPairing') && schema.includes('model ProductionPackingSession'), '数据库持久保存单件配对与整单装箱会话')
  assert(schema.includes('model ProductionFrameReprint') && schema.includes('requestedPages'), '数据库持久保存指定页返工和新旧帧包码')
  assert(routes.includes('PENDING_ADDRESS_EXPORT') && routes.includes('WAITING_TRACKING') && routes.includes('READY_FOR_PRODUCTION'), '后端实现待处理、处理中和待生产阶段')
  assert(routes.includes('export-production') && routes.includes('framePackCode'), '首次生产资料导出会建立帧包身份并启动两条生产线')
  assert(routes.includes('ensureBatchPrintFiles') && routes.includes('再次导出时系统会自动补生成'), '补上传模板后可以为旧批次自动补生成 Word')
  assert(routes.includes("fastify.get('/orders'") && routes.includes("fastify.post('/units/:productionUnitId/reprint'"), '订单环节页和按页返工使用正式生产接口')
  assert(routes.includes('kitAssemblyBatch.updateMany') && routes.includes('skuInventory.updateMany'), '材料包配对采用条件扣减并同步汇总库存')
  assert(routes.includes('refreshReadyToShip') && routes.includes("fulfillmentStatus: 'SHIPPED'"), '全部单件装箱完成后才允许发货')
  assert(oldAdmin.includes('正式 PB 批次必须走总订单地址导出'), '旧地址导出不能覆盖正式生产批次')
  assert(oldAdmin.includes('旧帧图压缩包接口已停用'), '旧帧图导出不能覆盖正式生产批次')
  assert(orderPage.includes('/api/admin/production-workflow/orders') && orderPage.includes('/reprint'), '订单环节页只读取正式订单并提供返工入口')
  assert(batchPage.includes('进入当前订单环节') && !batchPage.includes('onclick="exportAddresses()"') && !batchPage.includes('onclick="exportProduction()"'), '生产批次页只做总览和环节跳转，不重复推进状态')
  assert(scanPage.includes('单件配对') && scanPage.includes('整单装箱与发货') && scanPage.includes('待齐套区'), '扫码页面分开单件配对与整单装箱')
  await Promise.all([
    prisma.productionFramePack.count(), prisma.productionUnitPairing.count(),
    prisma.productionPackingSession.count(), prisma.productionPackingScan.count(),
    prisma.productionFrameReprint.count()
  ])
  console.log('Production workflow checks passed')
} finally {
  await prisma.$disconnect()
}
