import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { readFileSync } from 'node:fs'
import { parse } from 'acorn'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-8)
let userId, modelId, skuId, originalOrderId
const materialIds = []

const assert = (value, message) => {
  if (!value) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function api(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, { ...options, headers: {
    ...(options.body ? {'Content-Type':'application/json'} : {}),
    ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(options.headers || {})
  } })
}

async function cleanup() {
  if (originalOrderId) {
    const aftersales = await prisma.aftersaleRequest.findMany({ where:{ orderId:originalOrderId }, select:{id:true} })
    await prisma.inventoryReturnReceipt.deleteMany({ where:{ aftersaleRequestId:{in:aftersales.map(row=>row.id)} } })
    await prisma.aftersaleRequest.deleteMany({ where:{ orderId:originalOrderId } })
    await prisma.customizeOrder.deleteMany({ where:{ OR:[{id:originalOrderId},{replacementForId:originalOrderId}] } })
  }
  if (skuId) {
    await prisma.kitAssemblyBatch.deleteMany({ where:{skuId} })
    await prisma.kitContainer.deleteMany({ where:{skuId} })
    await prisma.inventoryLog.deleteMany({ where:{skuId} })
    await prisma.materialSkuBinding.deleteMany({ where:{skuId} })
    await prisma.skuInventory.deleteMany({ where:{skuId} })
    await prisma.machineModelSku.deleteMany({ where:{id:skuId} })
  }
  if (materialIds.length) {
    const prep = await prisma.materialPreparationBatch.findMany({where:{outputMaterialId:{in:materialIds}},select:{id:true}})
    await prisma.materialPreparationInput.deleteMany({where:{prepBatchId:{in:prep.map(row=>row.id)}}})
    await prisma.materialPreparationBatch.deleteMany({where:{outputMaterialId:{in:materialIds}}})
    await prisma.materialLog.deleteMany({where:{materialId:{in:materialIds}}})
    await prisma.materialReceipt.deleteMany({where:{materialId:{in:materialIds}}})
    await prisma.materialItem.deleteMany({where:{id:{in:materialIds}}})
  }
  if (modelId) await prisma.machineModel.deleteMany({where:{id:modelId}})
  if (userId) {
    await prisma.inventoryMaterialMutation.deleteMany({where:{operatorId:userId}})
    await prisma.inventoryFormOption.deleteMany({where:{createdBy:userId}})
    await prisma.operationLog.deleteMany({where:{userId}})
    await prisma.auditLog.deleteMany({where:{userId}})
    await prisma.smsCode.deleteMany({where:{userId}})
    await prisma.refreshToken.deleteMany({where:{userId}})
    await prisma.userProfile.deleteMany({where:{userId}})
    await prisma.user.deleteMany({where:{id:userId}})
  }
}

try {
  let html = ''
  for (const file of ['../../frontend/pages/admin-inventory.html']) {
    const sourceHtml = readFileSync(new URL(file, import.meta.url), 'utf8')
    if (file.includes('admin-inventory')) html = sourceHtml
    for (const [,source] of sourceHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      parse(source, {ecmaVersion:'latest',sourceType:'script'})
    }
  }
  assert(html.includes('panelPacked') && html.includes('panelRaw') && html.includes('panelReturns'), '库存页面明确分为分装小包、基础零件和退回检查')
  assert(!html.includes('零件只能在库存页维护；款式页只能选择使用'), '新增零件弹窗不显示内部维护说明')
  assert(!html.includes('id="matModalCode"') && html.includes('id="matNameSelect"') && html.includes('id="matUnitSelect"'), '编码自动生成，名称和单位使用可管理的下拉列表')

  const phone = `194${runId}`
  const user = await prisma.user.create({data:{phone,role:3,staffRole:'OWNER',privacyAgreedAt:new Date(),privacyPolicyVersion:'inventory-trace-test',profile:{create:{nickname:`trace-${runId}`}}}})
  userId = user.id
  await prisma.smsCode.create({data:{userId,phone,code:'123456',purpose:'LOGIN',expiresAt:new Date(Date.now()+300000)}})
  const login = await api('/api/v1/auth/sms/verify',null,{method:'POST',body:JSON.stringify({phone,code:'123456',mode:'LOGIN'})})
  const token = (await login.json()).data.accessToken

  const optionValue = `测试名称-${runId}`
  const addOption = await api('/api/materials/form-options',token,{method:'POST',body:JSON.stringify({category:'NAME',scope:'RAW',value:optionValue})})
  const optionRow = (await addOption.json()).data
  assert(addOption.ok && optionRow.value===optionValue,'可以新增基础零件名称选项并保存到数据库')
  const optionList = await api('/api/materials/form-options?scope=RAW',token)
  assert((await optionList.json()).data.names.some(row=>row.id===optionRow.id),'重新读取时仍能看到新增名称选项')
  const deleteOption = await api(`/api/materials/form-options/${optionRow.id}`,token,{method:'DELETE'})
  assert(deleteOption.ok,'点击删除只移除下拉选项')

  const model = await prisma.machineModel.create({data:{name:`追溯测试-${runId}`,description:'自动测试',ratios:'[]',frameOptions:'[]',sizes:'[]'}})
  modelId=model.id
  const sku = await prisma.machineModelSku.create({data:{modelId,size:'5x5cm',material:'椴木板',frameCount:12,colorName:'原色',colorHex:'#ddd',price:199,skuCode:`TRACE-${runId}`}})
  skuId=sku.id
  await prisma.skuInventory.create({data:{skuId}})

  const createMaterial = async body => {
    const payload={...body,clientRequestId:`trace-create-${body.itemType}-${body.name}-${runId}`}
    const res=await api('/api/materials',token,{method:'POST',body:JSON.stringify(payload)}); const json=await res.json()
    assert(res.ok,json.message||`建立 ${body.name}`); materialIds.push(json.data.id); return json.data
  }
  const wire=await createMaterial({name:`铁丝-${runId}`,itemType:'RAW',unit:'根'})
  const pack=await createMaterial({name:`5根铁丝包-${runId}`,itemType:'PACKED',unit:'包',sourceMaterialId:wire.id,sourceQtyPerUnit:5})
  const board=await createMaterial({name:`木板-${runId}`,itemType:'CONSUMABLE',unit:'块'})

  for (const [qty,location] of [[10,'A-01'],[20,'A-02']]) {
    const res=await api(`/api/materials/${wire.id}/restock`,token,{method:'POST',body:JSON.stringify({actualQty:qty,acceptedQty:qty,location,clientRequestId:`trace-restock-${location}-${runId}`})})
    assert(res.ok,`建立独立到货批次 ${location}`)
  }
  const wireLots=await prisma.materialReceipt.findMany({where:{materialId:wire.id},orderBy:{createdAt:'asc'}})
  const preview=await api(`/api/materials/${pack.id}/prepare-preview`,token,{method:'POST',body:JSON.stringify({outputQty:2,lossQty:2})})
  const previewJson=await preview.json()
  assert(previewJson.data.allocations.length===2 && previewJson.data.allocations[0].quantity===10, 'FIFO 推荐先用完最早10根批次，再使用下一批2根')
  const manualPrepare=await api(`/api/materials/${pack.id}/prepare`,token,{method:'POST',body:JSON.stringify({outputQty:1,lossQty:0,location:'B-02',allocations:[{sourceBatchId:wireLots[1].id,quantity:5}],clientRequestId:`trace-prepare-manual-${runId}`})})
  assert(manualPrepare.ok,'特殊情况可以由员工明确改选其他可用批次')
  const afterManual=await prisma.materialReceipt.findMany({where:{id:{in:wireLots.map(row=>row.id)}},orderBy:{createdAt:'asc'}})
  assert(afterManual[0].availableQty===10 && afterManual[1].availableQty===15,'人工改选不会偷偷消耗系统原推荐批次')
  const prepare=await api(`/api/materials/${pack.id}/prepare`,token,{method:'POST',body:JSON.stringify({outputQty:2,lossQty:2,location:'B-01',allocations:previewJson.data.allocations.map(row=>({sourceBatchId:row.sourceBatchId,quantity:row.quantity})),clientRequestId:`trace-prepare-fifo-${runId}`})})
  assert(prepare.ok,'员工确认推荐批次后完成分装')
  const afterLots=await prisma.materialReceipt.findMany({where:{id:{in:wireLots.map(row=>row.id)}},orderBy:{createdAt:'asc'}})
  assert(afterLots[0].availableQty===0 && afterLots[1].availableQty===13, 'FIFO 分装后两个到货批次剩余量分别为0和13')
  const prepBatch=await prisma.materialPreparationBatch.findFirst({where:{outputMaterialId:pack.id,outputQty:2}})
  const inputs=await prisma.materialPreparationInput.findMany({where:{prepBatchId:prepBatch.id}})
  assert(inputs.length===2 && inputs.every(row=>row.sourceReceiptId), '分装批次保存了实际来源到货批次')

  await api(`/api/materials/${board.id}/restock`,token,{method:'POST',body:JSON.stringify({actualQty:5,acceptedQty:5,location:'A-03',clientRequestId:`trace-board-${runId}`})})
  await api(`/api/machine-models/skus/${skuId}/bom`,token,{method:'PUT',body:JSON.stringify({items:[{materialId:pack.id,qtyPerUnit:1},{materialId:board.id,qtyPerUnit:1}]})})
  const assemblePreview=await api('/api/inventory/kits/assemble-preview',token,{method:'POST',body:JSON.stringify({skuId,quantity:1})})
  const assemblyPlan=(await assemblePreview.json()).data
  assert(assemblyPlan.plan.every(row=>row.allocations.length),'材料包组装前能看到每种材料的推荐批次')
  const assembly=await api('/api/inventory/kits/assemble',token,{method:'POST',body:JSON.stringify({skuId,quantity:1,boxCode:`BOX-${runId}`,allocations:assemblyPlan.plan.map(row=>({materialId:row.materialId,allocations:row.allocations.map(lot=>({sourceBatchId:lot.sourceBatchId,quantity:lot.quantity}))})),clientRequestId:`trace-assemble-${runId}`})})
  assert(assembly.ok,'材料包按确认批次完成组装入库')
  const kb=await prisma.kitAssemblyBatch.findFirst({where:{skuId,batchType:'ASSEMBLED'}})
  assert((await prisma.kitAssemblyConsumption.count({where:{kitAssemblyBatchId:kb.id}}))===2,'组装批次保存分装小包和基础零件的实际来源')

  const original=await prisma.customizeOrder.create({data:{orderNo:`PU-${runId}`,userId,modelId,modelName:model.name,frameCount:12,size:'5x5cm',material:'椴木板',color:'#ddd',colorName:'原色',skuId,ossPath:'test',frameUrls:'[]',status:'received'}})
  originalOrderId=original.id
  const aftersale=await prisma.aftersaleRequest.create({data:{orderId:original.id,userId,type:'quality',reason:'自动测试',status:'approved'}})
  const receive=await api('/api/inventory/returns/receive',token,{method:'POST',body:JSON.stringify({aftersaleRequestId:aftersale.id,trackingNo:`SF${runId}`})})
  const receipt=(await receive.json()).data
  assert(receive.ok && receipt.status==='QUARANTINED','退回收货后先进入隔离状态，不直接增加库存')
  const stockBefore=(await prisma.skuInventory.findUnique({where:{skuId}})).currentStock
  const inspect=await api(`/api/inventory/returns/${receipt.id}/inspect`,token,{method:'POST',body:JSON.stringify({packageCondition:'UNOPENED_INTACT',receivedQty:1})})
  assert(inspect.ok && (await prisma.skuInventory.findUnique({where:{skuId}})).currentStock===stockBefore+1,'未拆封完整材料包检查合格后以新批次回到新品库存')
  assert(Boolean(await prisma.kitAssemblyBatch.findFirst({where:{sourceReturnReceiptId:receipt.id,batchType:'RETURN_RECOVERED'}})),'回库批次保留退回来源链')
  const replacement=await api(`/api/inventory/returns/${receipt.id}/replacement`,token,{method:'POST',body:'{}'})
  const replacementJson=await replacement.json()
  assert(replacement.ok && replacementJson.data.replacementForId===original.id,'补发会创建新生产任务并关联原任务')

  const aftersale2=await prisma.aftersaleRequest.create({data:{orderId:original.id,userId,type:'quality',reason:'维修备用测试',status:'approved'}})
  const receive2=await api('/api/inventory/returns/receive',token,{method:'POST',body:JSON.stringify({aftersaleRequestId:aftersale2.id})})
  const receipt2=(await receive2.json()).data
  const normalBefore=(await prisma.materialItem.findUnique({where:{id:board.id}})).currentStock
  const inspect2=await api(`/api/inventory/returns/${receipt2.id}/inspect`,token,{method:'POST',body:JSON.stringify({packageCondition:'OPENED',receivedQty:1,items:[{inventoryLevel:'BASE',materialId:board.id,receivedQty:1,disposition:'SERVICE_ONLY'}]})})
  const boardAfter=await prisma.materialItem.findUnique({where:{id:board.id}})
  assert(inspect2.ok && boardAfter.currentStock===normalBefore && boardAfter.serviceStock===1,'已拆封可复用零件只进入维修备用，不混入新品库存')

  console.log('Inventory traceability checks passed')
} finally {
  await cleanup().catch(error=>console.error('cleanup failed:',error.message))
  await prisma.$disconnect()
}
