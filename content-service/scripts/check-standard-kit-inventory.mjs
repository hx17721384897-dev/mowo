import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { readFileSync } from 'node:fs'
import { parse } from 'acorn'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const vueBase = process.env.TEST_VUE_BASE || 'http://127.0.0.1:4173/app'
const runId = String(Date.now()).slice(-8)
let userId
let modelId
let skuId
let orderId
let aftersaleId
const materialIds = []
let browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
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

async function cleanup() {
  if (aftersaleId) {
    const receipts = await prisma.inventoryReturnReceipt.findMany({ where: { aftersaleRequestId: aftersaleId }, select: { id: true } })
    if (receipts.length) await prisma.inventoryReturnInspectionItem.deleteMany({ where: { returnReceiptId: { in: receipts.map(row => row.id) } } })
    await prisma.inventoryReturnReceipt.deleteMany({ where: { aftersaleRequestId: aftersaleId } })
    await prisma.aftersaleRequest.deleteMany({ where: { id: aftersaleId } })
  }
  if (orderId) {
    await prisma.customizeOrder.deleteMany({ where: { replacementForId: orderId } })
    await prisma.customizeOrder.deleteMany({ where: { id: orderId } })
  }
  if (skuId) {
    await prisma.channelQuota.deleteMany({ where: { skuId } })
    await prisma.kitAssemblyBatch.deleteMany({ where: { skuId } })
    await prisma.kitContainer.deleteMany({ where: { skuId } })
    await prisma.inventoryLog.deleteMany({ where: { skuId } })
    await prisma.materialSkuBinding.deleteMany({ where: { skuId } })
    await prisma.skuInventory.deleteMany({ where: { skuId } })
    await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  }
  if (materialIds.length) {
    const prepBatches = await prisma.materialPreparationBatch.findMany({
      where: { outputMaterialId: { in: materialIds } }, select: { id: true }
    })
    if (prepBatches.length) await prisma.materialPreparationInput.deleteMany({ where: { prepBatchId: { in: prepBatches.map(row => row.id) } } })
    await prisma.materialPreparationBatch.deleteMany({ where: { outputMaterialId: { in: materialIds } } })
    await prisma.materialLog.deleteMany({ where: { materialId: { in: materialIds } } })
    await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } })
    await prisma.materialItem.deleteMany({ where: { id: { in: materialIds } } })
  }
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  if (userId) {
    await prisma.inventoryMaterialMutation.deleteMany({ where: { operatorId: userId } })
    await prisma.inventoryFormOption.deleteMany({ where: { createdBy: userId } })
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
}

try {
  for (const file of ['../../frontend/pages/admin-inventory.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8')
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    for (const [, source] of scripts) parse(source, { ecmaVersion:'latest', sourceType:'script' })
  }
  assert(true, '库存管理页面脚本语法正确')

  const phone = `195${runId}`
  const user = await prisma.user.create({ data: {
    phone, role: 3, staffRole: 'OWNER',
    privacyAgreedAt: new Date(), privacyPolicyVersion: 'kit-inventory-test',
    profile: { create: { nickname: `kit-inventory-test-${runId}` } },
  } })
  userId = user.id
  await prisma.smsCode.create({ data: { userId, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const login = await request('/api/v1/auth/sms/verify', null, { method:'POST', body:JSON.stringify({ phone, code:'123456', mode:'LOGIN' }) })
  assert(login.status === 200, '临时管理员可以登录')
  const token = (await login.json()).data.accessToken

  const model = await prisma.machineModel.create({ data: {
    name:`材料包测试款-${runId}`, description:'自动测试', ratios:'[]', frameOptions:'[]', sizes:'[]'
  } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId, size:'5x5cm', material:'椴木板', frameCount:12,
    colorName:'原色', colorHex:'#D4B896', price:199,
    skuCode:`KIT-TEST-${runId}`, skuBarcode:`MOWO-TEST-${runId}`
  } })
  skuId = sku.id
  await prisma.skuInventory.create({ data: { skuId } })

  const createMaterial = async body => {
    const payload = {...body,clientRequestId:`kit-create-${body.itemType}-${body.name}-${runId}`}
    const response = await request('/api/materials', token, { method:'POST', body:JSON.stringify(payload) })
    const json = await response.json()
    assert(response.status === 200 && json.success, `建立零件：${body.name}`)
    const replay = await request('/api/materials', token, { method:'POST', body:JSON.stringify(payload) })
    const replayJson = await replay.json()
    assert(replay.status === 200 && replayJson.data.id === json.data.id && replayJson.data.reused === true, `重复建立不会新增零件：${body.name}`)
    materialIds.push(json.data.id)
    return json.data
  }
  const wire = await createMaterial({ name:'5.5cm散装铁丝', itemType:'RAW', unit:'根', specification:'长度5.5cm' })
  const wirePack = await createMaterial({ name:'12根铁丝包', itemType:'PACKED', unit:'包', sourceMaterialId:wire.id, sourceQtyPerUnit:12 })
  const board = await createMaterial({ name:'5x5椴木板', itemType:'CONSUMABLE', unit:'块', specification:'5x5cm' })

  const receiptPayload = { orderedSpec:'订购50米，切成5.5cm', actualQty:120, acceptedQty:118, rejectedQty:2, clientRequestId:`kit-wire-${runId}` }
  const receipt = await request(`/api/materials/${wire.id}/restock`, token, { method:'POST', body:JSON.stringify(receiptPayload) })
  assert(receipt.status === 200, '采购入库接受实际合格数和次品数')
  const receiptReplay = await request(`/api/materials/${wire.id}/restock`, token, { method:'POST', body:JSON.stringify(receiptPayload) })
  assert(receiptReplay.status === 200 && (await receiptReplay.json()).data.reused === true, '采购入库响应丢失重试返回原结果')
  const receiptConflict = await request(`/api/materials/${wire.id}/restock`, token, { method:'POST', body:JSON.stringify({...receiptPayload,acceptedQty:117,actualQty:119}) })
  assert(receiptConflict.status === 409, '同一采购入库请求标识不能改写数量')
  const receiptRow = await prisma.materialReceipt.findFirst({ where: { materialId:wire.id } })
  assert(receiptRow?.acceptedQty === 118 && receiptRow?.rejectedQty === 2, '采购记录保留合格118根和次品2根')
  assert((await prisma.materialItem.findUnique({ where:{id:wire.id} })).currentStock === 118, '可用库存只增加118根合格铁丝')

  const preparePayload = { outputQty:9, lossQty:2, note:'模拟分装误差', clientRequestId:`kit-prepare-${runId}` }
  const prepare = await request(`/api/materials/${wirePack.id}/prepare`, token, { method:'POST', body:JSON.stringify(preparePayload) })
  assert(prepare.status === 200, '可以把散装铁丝分装成12根包并记录损耗')
  const prepareReplay = await request(`/api/materials/${wirePack.id}/prepare`, token, { method:'POST', body:JSON.stringify(preparePayload) })
  assert(prepareReplay.status === 200 && (await prepareReplay.json()).data.reused === true, '分装响应丢失重试不会重复扣料或增加小包')
  assert((await prisma.materialItem.findUnique({ where:{id:wire.id} })).currentStock === 8, '分装扣除108根正常用量和2根损耗')
  assert((await prisma.materialItem.findUnique({ where:{id:wirePack.id} })).currentStock === 9, '分装增加9包成品库存')

  const boardPayload = { acceptedQty:10, rejectedQty:0, actualQty:10, clientRequestId:`kit-board-${runId}` }
  const boardResponses = await Promise.all([
    request(`/api/materials/${board.id}/restock`, token, { method:'POST', body:JSON.stringify(boardPayload) }),
    request(`/api/materials/${board.id}/restock`, token, { method:'POST', body:JSON.stringify(boardPayload) })
  ])
  assert(boardResponses.every(response => response.status === 200), '并发同键采购入库均恢复为成功结果')
  assert((await prisma.materialItem.findUnique({where:{id:board.id}})).currentStock === 10, '并发同键采购入库只增加一次库存')
  const defectPayload = {quantity:1,note:'测试报损',clientRequestId:`kit-defect-${runId}`}
  const defect = await request(`/api/materials/${board.id}/defect`,token,{method:'POST',body:JSON.stringify(defectPayload)})
  const defectReplay = await request(`/api/materials/${board.id}/defect`,token,{method:'POST',body:JSON.stringify(defectPayload)})
  assert(defect.status === 200 && defectReplay.status === 200 && (await defectReplay.json()).data.reused === true,'报损重放不会重复扣减')
  assert((await prisma.materialItem.findUnique({where:{id:board.id}})).currentStock === 9,'报损仅扣减一次库存')
  const adjustPayload = {delta:1,note:'测试盘点恢复',clientRequestId:`kit-adjust-${runId}`}
  const adjust = await request(`/api/materials/${board.id}/adjust`,token,{method:'POST',body:JSON.stringify(adjustPayload)})
  const adjustReplay = await request(`/api/materials/${board.id}/adjust`,token,{method:'POST',body:JSON.stringify(adjustPayload)})
  assert(adjust.status === 200 && adjustReplay.status === 200 && (await adjustReplay.json()).data.reused === true,'盘点调整重放不会重复增加')
  assert((await prisma.materialItem.findUnique({where:{id:board.id}})).currentStock === 10,'盘点调整仅增加一次库存')
  const bom = await request(`/api/machine-models/skus/${skuId}/bom`, token, {
    method:'PUT', body:JSON.stringify({ items:[{materialId:wirePack.id,qtyPerUnit:1},{materialId:board.id,qtyPerUnit:1}] })
  })
  assert(bom.status === 200, 'SKU材料清单可以只引用库存页已有零件')

  const assemblyPayload = {skuId,quantity:5,boxCode:`BX-${runId}`,location:'测试库位',clientRequestId:`kit-assemble-${runId}`}
  const assembly = await request('/api/inventory/kits/assemble', token, { method:'POST', body:JSON.stringify(assemblyPayload) })
  assert(assembly.status === 200, '材料包入库可以一次完成扣零件和加库存')
  const assemblyReplay = await request('/api/inventory/kits/assemble', token, { method:'POST', body:JSON.stringify(assemblyPayload) })
  assert(assemblyReplay.status === 200 && (await assemblyReplay.json()).data.reused === true, '材料包组装响应丢失重试不会重复扣零件或入库')
  assert((await prisma.materialItem.findUnique({where:{id:wirePack.id}})).currentStock === 4, '材料包入库扣除5包铁丝')
  assert((await prisma.materialItem.findUnique({where:{id:board.id}})).currentStock === 5, '材料包入库扣除5块木板')
  assert((await prisma.skuInventory.findUnique({where:{skuId}})).currentStock === 5, '材料包库存增加5套')
  const batch = await prisma.kitAssemblyBatch.findFirst({where:{skuId}})
  assert(Boolean(batch) && JSON.parse(batch.bomSnapshot).length === 2, '组装记录冻结当时的材料清单快照')
  assert((await prisma.kitContainer.findUnique({where:{code:`BX-${runId}`}})).currentQty === 5, '可重复使用箱码记录当前5套材料包')

  const beforeShortage = await prisma.materialItem.findUnique({where:{id:wirePack.id}})
  const shortage = await request('/api/inventory/kits/assemble', token, {
    method:'POST', body:JSON.stringify({skuId,quantity:10,boxCode:`BX-${runId}`,clientRequestId:`kit-shortage-${runId}`})
  })
  assert(shortage.status === 400, '任一零件不足时拒绝材料包入库')
  assert((await prisma.materialItem.findUnique({where:{id:wirePack.id}})).currentStock === beforeShortage.currentStock, '入库失败时不会扣除任何零件')

  const originalOrder = await prisma.customizeOrder.create({ data: {
    orderNo:`PU-RETURN-${runId}`,userId,modelId,modelName:model.name,frameCount:12,
    size:'5x5cm',material:'椴木板',color:'#D4B896',colorName:'原色',skuId,
    ossPath:'test/return',frameUrls:'[]',status:'received'
  } })
  orderId = originalOrder.id
  const aftersale = await prisma.aftersaleRequest.create({ data: {
    orderId,userId,type:'quality',reason:'自动化退回检查',status:'approved'
  } })
  aftersaleId = aftersale.id
  const emptyReturns = await request('/api/inventory/returns?status=NOT_PRESENT',token)
  const emptyReturnsJson = await emptyReturns.json()
  assert(emptyReturns.status === 200 && Array.isArray(emptyReturnsJson.data) && emptyReturnsJson.data.length === 0,'退回列表空结果不会触发关联资料查询错误')
  const receivePayload = {
    aftersaleRequestId:aftersaleId,trackingCompany:'测试快递',trackingNo:`RT-${runId}`,
    note:'自动化退回',clientRequestId:`return-receive-${runId}`
  }
  const receive = await request('/api/inventory/returns/receive',token,{method:'POST',body:JSON.stringify(receivePayload)})
  const receiveJson = await receive.json()
  const receiveReplay = await request('/api/inventory/returns/receive',token,{method:'POST',body:JSON.stringify(receivePayload)})
  const receiveReplayJson = await receiveReplay.json()
  assert(
    receive.status === 200 && receiveReplay.status === 200 && receiveReplayJson.data?.reused === true,
    `退回收货重放恢复原记录（首次 ${receive.status}，重放 ${receiveReplay.status}：${receiveReplayJson.message || ''}）`
  )
  assert(await prisma.inventoryReturnReceipt.count({where:{aftersaleRequestId:aftersaleId}}) === 1,'一个售后只建立一条退回收货记录')
  const returnList = await request('/api/inventory/returns',token)
  const returnListJson = await returnList.json()
  assert(returnList.status === 200 && returnListJson.data[0]?.aftersale?.user?.nickname?.startsWith('kit-inventory-test-'),'退回列表从用户资料返回昵称且不查询不存在字段')
  const beforeReturnStock = (await prisma.skuInventory.findUnique({where:{skuId}})).currentStock
  const inspectPayload = {
    packageCondition:'UNOPENED_INTACT',receivedQty:1,items:[],note:'未拆封检查合格',
    clientRequestId:`return-inspect-${runId}`
  }
  const inspect = await request(`/api/inventory/returns/${receiveJson.data.id}/inspect`,token,{method:'POST',body:JSON.stringify(inspectPayload)})
  const inspectReplay = await request(`/api/inventory/returns/${receiveJson.data.id}/inspect`,token,{method:'POST',body:JSON.stringify(inspectPayload)})
  const inspectReplayJson = await inspectReplay.json()
  assert(inspect.status === 200 && inspectReplay.status === 200 && inspectReplayJson.data.reused === true,'退回检查重放恢复原结论')
  assert((await prisma.skuInventory.findUnique({where:{skuId}})).currentStock === beforeReturnStock + 1,'退回检查只回库一次')
  assert(await prisma.inventoryReturnInspectionItem.count({where:{returnReceiptId:receiveJson.data.id}}) === 1,'退回检查只保留一份检查明细')

  const invalidQuota = await request(`/api/inventory/channel-quotas/${skuId}`,token,{method:'PUT',body:JSON.stringify({taobaoQty:-1})})
  assert(invalidQuota.status === 400,'渠道配额拒绝负数')
  const oversoldQuota = await request(`/api/inventory/channel-quotas/${skuId}`,token,{method:'PUT',body:JSON.stringify({taobaoQty:6,douyinQty:0,xhsQty:0,bufferPool:1})})
  assert(oversoldQuota.status === 409 && await prisma.channelQuota.count({where:{skuId}}) === 0,'渠道配额超量时服务端要求确认且不会提前写入')
  const quotaPayload = {taobaoQty:2,douyinQty:1,xhsQty:1,bufferPool:1,livestreamMode:false}
  const quotaSave = await request(`/api/inventory/channel-quotas/${skuId}`,token,{method:'PUT',body:JSON.stringify(quotaPayload)})
  const quotaReplay = await request(`/api/inventory/channel-quotas/${skuId}`,token,{method:'PUT',body:JSON.stringify(quotaPayload)})
  assert(quotaSave.status === 200 && quotaReplay.status === 200 && await prisma.channelQuota.count({where:{skuId}}) === 1,'渠道配额按绝对值保存，重复提交不会累加或新建重复记录')
  const forcedQuota = await request(`/api/inventory/channel-quotas/${skuId}`,token,{method:'PUT',body:JSON.stringify({...quotaPayload,taobaoQty:6,forceOversell:true})})
  const forcedQuotaJson = await forcedQuota.json()
  assert(forcedQuota.status === 200 && forcedQuotaJson.data?.oversold === true,'明确确认后可以保存超量渠道配额并返回风险状态')
  const quotaList = await request('/api/inventory/channel-quotas',token)
  const quotaListJson = await quotaList.json()
  assert(quotaList.status === 200 && quotaListJson.data.some(row => row.skuId === skuId && row.modelName === model.name),'渠道配额列表返回完整款式展示信息')
  const replacementPayload = {clientRequestId:`return-replacement-${runId}`}
  const replacement = await request(`/api/inventory/returns/${receiveJson.data.id}/replacement`,token,{method:'POST',body:JSON.stringify(replacementPayload)})
  const replacementReplay = await request(`/api/inventory/returns/${receiveJson.data.id}/replacement`,token,{method:'POST',body:JSON.stringify(replacementPayload)})
  const replacementReplayJson = await replacementReplay.json()
  assert(replacement.status === 200 && replacementReplay.status === 200 && replacementReplayJson.data.reused === true,'补发任务重放恢复原任务')
  assert(await prisma.customizeOrder.count({where:{replacementForId:orderId,aftersaleRequestId:aftersaleId}}) === 1,'一个售后只建立一个补发生产任务')

  browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport:{width:1440,height:900} })
  const page = await context.newPage()
  await page.addInitScript(({ token, apiBase }) => {
    window.MOWO_RUNTIME_API_BASE = apiBase
    localStorage.setItem('mowo_token', token)
  }, { token, apiBase })
  await page.goto(`${webBase}/admin-inventory.html`, { waitUntil:'networkidle' })
  await page.locator('#tabBtnPacked').click()
  await page.getByRole('button', {name:'新增分装小包'}).click()
  assert(await page.locator('#matModalType').inputValue() === 'PACKED', '分装小包入口自动锁定为分装类型')
  assert(await page.locator('#matModalType').isHidden(), '员工不需要填写内部零件类型')
  assert(await page.locator('#matModalCode').count() === 0, '员工不需要填写系统自动生成的零件编码')
  await page.locator('#matNameSelect .managed-select-trigger').click()
  assert(await page.locator('#matNameSelect .managed-select-menu').isVisible(), '点击零件名称会展开选项列表')
  assert(await page.locator('#matNameSelect .managed-option-delete').count() > 0, '名称选项右侧提供删除按钮')
  assert(await page.locator('#matNameNewOption').isVisible(), '名称列表底部可以填写新增选项')
  await page.locator('#matNameSelect .managed-select-trigger').click()
  await page.locator('#matUnitSelect .managed-select-trigger').click()
  assert(await page.locator('#matUnitSelect .managed-select-menu').isVisible(), '点击单位会展开选项列表')
  assert(await page.locator('#matUnitSelect .managed-option-delete').count() > 0, '单位选项右侧提供删除按钮')
  assert(await page.locator('#matUnitNewOption').isVisible(), '单位列表底部可以填写新增选项')
  await page.locator('#matUnitSelect .managed-select-trigger').click()
  await page.locator('#matModal').getByRole('button', {name:'取消'}).click()
  await page.locator('#tabBtnRaw').click()
  await page.getByRole('button', {name:'新增基础零件'}).click()
  assert(await page.locator('#matModalType').inputValue() === 'RAW', '基础零件入口自动锁定为基础类型')
  await page.locator('#matModal').getByRole('button', {name:'取消'}).click()
  await page.locator('#tabBtnStock').click()
  await page.getByRole('button', {name:'材料包入库'}).first().click()
  assert(await page.locator('#kitAssemblySku').isVisible(), '库存页可以打开材料包入库操作')
  await page.goto(`${vueBase}/admin/models`, { waitUntil:'networkidle' })
  const modelCard = page.locator('.catalog-card').filter({hasText:`材料包测试款-${runId}`})
  await modelCard.getByRole('button', {name:'展开规格'}).click()
  await modelCard.getByRole('button', {name:'材料清单'}).click()
  assert(await page.locator('.bom-modal').isVisible(), '款式页可以打开 SKU 材料清单')
  await page.waitForFunction(() => !document.querySelector('.catalog-material-list')?.textContent?.includes('正在加载'))
  const bomText = await page.locator('.catalog-material-list').textContent()
  assert(bomText.includes('12根铁丝包'), `款式页只能选择库存页已有零件（当前内容：${bomText.trim()}）`)
  await context.close()

  console.log('Standard kit inventory checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
