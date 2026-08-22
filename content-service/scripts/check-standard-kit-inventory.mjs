import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { parse } from 'acorn'
import { chromium } from 'file:///C:/Users/25839/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const webBase = process.env.TEST_WEB_BASE || 'http://127.0.0.1:5500/mowo/frontend/pages'
const runId = String(Date.now()).slice(-8)
let userId
let modelId
let skuId
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
  if (skuId) {
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
    await prisma.smsCode.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.operationLog.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.userProfile.deleteMany({ where: { userId } })
    await prisma.creditScore.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
}

try {
  for (const file of ['../../frontend/pages/admin-models.html', '../../frontend/pages/admin-inventory.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8')
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    for (const [, source] of scripts) parse(source, { ecmaVersion:'latest', sourceType:'script' })
  }
  assert(true, '款式管理和库存管理页面脚本语法正确')

  const phone = `195${runId}`
  const user = await prisma.user.create({ data: {
    phone, role: 3, staffRole: 'OWNER',
    privacyAgreedAt: new Date(), privacyPolicyVersion: 'kit-inventory-test',
    profile: { create: { nickname: `kit-inventory-test-${runId}` } },
    creditScore: { create: { score: 100 } }
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
    const response = await request('/api/materials', token, { method:'POST', body:JSON.stringify(body) })
    const json = await response.json()
    assert(response.status === 200 && json.success, `建立零件：${body.name}`)
    materialIds.push(json.data.id)
    return json.data
  }
  const wire = await createMaterial({ name:'5.5cm散装铁丝', itemType:'RAW', unit:'根', specification:'长度5.5cm' })
  const wirePack = await createMaterial({ name:'12根铁丝包', itemType:'PACKED', unit:'包', sourceMaterialId:wire.id, sourceQtyPerUnit:12 })
  const board = await createMaterial({ name:'5x5椴木板', itemType:'CONSUMABLE', unit:'块', specification:'5x5cm' })

  const receipt = await request(`/api/materials/${wire.id}/restock`, token, {
    method:'POST', body:JSON.stringify({ orderedSpec:'订购50米，切成5.5cm', actualQty:120, acceptedQty:118, rejectedQty:2 })
  })
  assert(receipt.status === 200, '采购入库接受实际合格数和次品数')
  const receiptRow = await prisma.materialReceipt.findFirst({ where: { materialId:wire.id } })
  assert(receiptRow?.acceptedQty === 118 && receiptRow?.rejectedQty === 2, '采购记录保留合格118根和次品2根')
  assert((await prisma.materialItem.findUnique({ where:{id:wire.id} })).currentStock === 118, '可用库存只增加118根合格铁丝')

  const prepare = await request(`/api/materials/${wirePack.id}/prepare`, token, {
    method:'POST', body:JSON.stringify({ outputQty:9, lossQty:2, note:'模拟分装误差' })
  })
  assert(prepare.status === 200, '可以把散装铁丝分装成12根包并记录损耗')
  assert((await prisma.materialItem.findUnique({ where:{id:wire.id} })).currentStock === 8, '分装扣除108根正常用量和2根损耗')
  assert((await prisma.materialItem.findUnique({ where:{id:wirePack.id} })).currentStock === 9, '分装增加9包成品库存')

  await request(`/api/materials/${board.id}/restock`, token, { method:'POST', body:JSON.stringify({ acceptedQty:10, rejectedQty:0, actualQty:10 }) })
  const bom = await request(`/api/machine-models/skus/${skuId}/bom`, token, {
    method:'PUT', body:JSON.stringify({ items:[{materialId:wirePack.id,qtyPerUnit:1},{materialId:board.id,qtyPerUnit:1}] })
  })
  assert(bom.status === 200, 'SKU材料清单可以只引用库存页已有零件')

  const assembly = await request('/api/inventory/kits/assemble', token, {
    method:'POST', body:JSON.stringify({skuId,quantity:5,boxCode:`BX-${runId}`,location:'测试库位'})
  })
  assert(assembly.status === 200, '材料包入库可以一次完成扣零件和加库存')
  assert((await prisma.materialItem.findUnique({where:{id:wirePack.id}})).currentStock === 4, '材料包入库扣除5包铁丝')
  assert((await prisma.materialItem.findUnique({where:{id:board.id}})).currentStock === 5, '材料包入库扣除5块木板')
  assert((await prisma.skuInventory.findUnique({where:{skuId}})).currentStock === 5, '材料包库存增加5套')
  const batch = await prisma.kitAssemblyBatch.findFirst({where:{skuId}})
  assert(Boolean(batch) && JSON.parse(batch.bomSnapshot).length === 2, '组装记录冻结当时的材料清单快照')
  assert((await prisma.kitContainer.findUnique({where:{code:`BX-${runId}`}})).currentQty === 5, '可重复使用箱码记录当前5套材料包')

  const beforeShortage = await prisma.materialItem.findUnique({where:{id:wirePack.id}})
  const shortage = await request('/api/inventory/kits/assemble', token, {
    method:'POST', body:JSON.stringify({skuId,quantity:10,boxCode:`BX-${runId}`})
  })
  assert(shortage.status === 400, '任一零件不足时拒绝材料包入库')
  assert((await prisma.materialItem.findUnique({where:{id:wirePack.id}})).currentStock === beforeShortage.currentStock, '入库失败时不会扣除任何零件')

  browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport:{width:1440,height:900} })
  const page = await context.newPage()
  await page.addInitScript(value => localStorage.setItem('mowo_token', value), token)
  await page.goto(`${webBase}/admin-inventory.html`, { waitUntil:'networkidle' })
  await page.locator('#tabBtnPacked').click()
  await page.getByRole('button', {name:'新增分装小包'}).click()
  assert(await page.locator('#matModalType').isVisible(), '库存页可以新增和编辑零件类型')
  await page.locator('#matModal').getByRole('button', {name:'取消'}).click()
  await page.locator('#tabBtnStock').click()
  await page.getByRole('button', {name:'材料包入库'}).first().click()
  assert(await page.locator('#kitAssemblySku').isVisible(), '库存页可以打开材料包入库操作')
  await page.goto(`${webBase}/admin-models.html`, { waitUntil:'networkidle' })
  const modelCard = page.locator('.model-card').filter({hasText:`材料包测试款-${runId}`})
  await modelCard.locator('.model-card-header').click()
  await modelCard.getByRole('button', {name:'材料清单'}).click()
  assert(await page.locator('#bomOverlay').isVisible(), '款式页可以打开 SKU 材料清单')
  await page.waitForFunction(() => !document.querySelector('#bomMaterialList')?.textContent?.includes('正在加载'))
  const bomText = await page.locator('#bomMaterialList').textContent()
  assert(bomText.includes('12根铁丝包'), `款式页只能选择库存页已有零件（当前内容：${bomText.trim()}）`)
  await context.close()

  console.log('Standard kit inventory checks passed')
} finally {
  if (browser) await browser.close().catch(() => {})
  await cleanup().catch(error => console.error('cleanup failed:', error.message))
  await prisma.$disconnect()
}
