import fs from 'fs/promises'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { getAccountDeletionBlockers } from '../src/lib/account-deletion.js'
import {
  cleanupAbandonedCustomizationFiles,
  cleanupExpiredCustomizationDrafts
} from '../src/lib/private-file-cleanup.js'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-7)
const users = []
const keys = []
let modelId = null
let skuId = null

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
])

function assertStatus(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`)
  console.log(`PASS ${label}: ${actual}`)
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

async function createLogin(label, index, staffRole = null, role = 0) {
  const phone = `197${runId}${index}`
  const user = await prisma.user.create({ data: {
    phone, role, staffRole,
    privacyAgreedAt: new Date(), privacyPolicyVersion: 'custom-flow-test',
    profile: { create: { nickname: `customization-test-${label}` } },
  } })
  users.push({ id: user.id, phone })
  await prisma.smsCode.create({ data: {
    userId: user.id, phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000)
  } })
  const login = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assertStatus(`${label} login`, login.status, 200)
  const body = await login.json()
  return { ...user, phone, token: body.data.accessToken }
}

async function upload(user, purpose, name) {
  const init = await request('/api/upload/presign', user.token, {
    method: 'POST',
    body: JSON.stringify({ purpose, fileName: name, fileType: 'image/png', fileSize: PNG.length })
  })
  assertStatus(`${purpose} create upload`, init.status, 200)
  const data = (await init.json()).data
  keys.push(data.objectKey)
  assertStatus(`${purpose} upload`, (await fetch(data.uploadUrl, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG
  })).status, 204)
  assertStatus(`${purpose} complete`, (await request(new URL(data.completeUrl).pathname, user.token, {
    method: 'POST'
  })).status, 200)
  return data.objectKey
}

async function createSelfDraft(user, suffix) {
  const [sourceKey, frameKey] = await Promise.all([
    upload(user, 'CUSTOMIZATION_SOURCE', `source-${suffix}.png`),
    upload(user, 'CUSTOMIZATION_FRAME', `frame-${suffix}.png`)
  ])
  const productResponse = await request('/api/custom-products', user.token, {
    method: 'POST', body: JSON.stringify({
      animationFrames: JSON.stringify([frameKey]), frameCount: 1,
      configJson: JSON.stringify({ modelId, frameCount: 1 })
    })
  })
  assertStatus(`self product ${suffix}`, productResponse.status, 200)
  const product = (await productResponse.json()).data
  const response = await request('/api/customization-requests/draft', user.token, {
    method: 'POST', body: JSON.stringify({
      clientDraftKey: `test-${runId}-${suffix}`,
      customProductId: product.id,
      machineModelId: modelId,
      sourceKeys: [sourceKey],
      selectedFrameKeys: [frameKey],
      screeningData: { sourceCount: 1 },
      editorData: { recipeVersion: 1 }
    })
  })
  assertStatus(`self request draft ${suffix}`, response.status, 201)
  return { request: (await response.json()).data, product, sourceKey, frameKey }
}

async function storageDelete(objectKey) {
  await fs.rm(new URL(`../storage/private/${objectKey}`, import.meta.url), { force: true })
}

async function cleanup() {
  const ids = users.map(item => item.id)
  const phones = users.map(item => item.phone)
  if (ids.length) {
    await prisma.operationLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.customizationRequestEvent.deleteMany({ where: {
      OR: [{ actorUserId: { in: ids } }, { request: { userId: { in: ids } } }]
    } })
    await prisma.customizationRequest.deleteMany({ where: { userId: { in: ids } } })
    await prisma.animationAssetVersion.deleteMany({ where: { asset: { ownerUserId: { in: ids } } } })
    await prisma.animationAsset.deleteMany({ where: { ownerUserId: { in: ids } } })
    const carts = await prisma.cart.findMany({ where: { userId: { in: ids } }, select: { id: true } })
    if (carts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map(item => item.id) } } })
    await prisma.cart.deleteMany({ where: { userId: { in: ids } } })
    await prisma.customProduct.deleteMany({ where: { userId: { in: ids } } })
    await prisma.privateFile.deleteMany({ where: { OR: [{ ownerUserId: { in: ids } }, { objectKey: { in: keys } }] } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.smsCode.deleteMany({ where: { phone: { in: phones } } })
    await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
  if (skuId) await prisma.machineModelSku.deleteMany({ where: { id: skuId } })
  if (modelId) await prisma.machineModel.deleteMany({ where: { id: modelId } })
  for (const key of keys) await storageDelete(key).catch(() => {})
}

try {
  const owner = await createLogin('owner', 1, 'OWNER', 3)
  const support = await createLogin('support', 2, 'CUSTOMER_SERVICE', 2)
  const production = await createLogin('production', 3, 'PRODUCTION', 2)
  const collab = await createLogin('collab', 4, 'COLLAB_OPS', 2)
  const customer = await createLogin('customer', 5)
  const other = await createLogin('other', 6)

  const model = await prisma.machineModel.create({ data: {
    name: `定制流程测试款-${runId}`, ratios: '["1:1"]', frameOptions: '[1]', sizes: '["S"]'
  } })
  modelId = model.id
  const sku = await prisma.machineModelSku.create({ data: {
    modelId, size: 'S', material: 'TEST', frameCount: 1,
    colorName: `测试色-${runId}`, colorHex: '#FFFFFF', price: 199
  } })
  skuId = sku.id

  const manualSource = await upload(customer, 'CUSTOMIZATION_SOURCE', 'manual-source.png')
  const manualPayload = {
    mode: 'HUMAN', machineModelId: modelId, sourceKeys: [manualSource],
    clientRequestKey: `human-${runId}-manual`,
    userNote: '请工作人员帮助筛选', creatorDeclared: true,
    copyrightConfirmed: true, cooperationInterested: true,
    screeningData: { sourceCount: 1, asyncAcknowledged: true }
  }
  const manualResponse = await request('/api/customization-requests', customer.token, {
    method: 'POST', body: JSON.stringify(manualPayload)
  })
  assertStatus('human-assisted request submits', manualResponse.status, 201)
  const manual = (await manualResponse.json()).data
  if (!/^DZ-\d{8}-[A-Z2-9]{6}$/.test(manual.requestNo) || manual.status !== 'SUBMITTED') {
    throw new Error('formal customization number or status is invalid')
  }
  const linkedSource = await prisma.privateFile.findUnique({ where: { objectKey: manualSource } })
  if (linkedSource?.linkedResourceType !== 'CUSTOMIZATION_REQUEST' || linkedSource.linkedResourceId !== manual.id) {
    throw new Error('manual source was not linked to its customization request')
  }
  console.log('PASS formal request receives independent DZ number and source binding')
  const manualRetry = await request('/api/customization-requests', customer.token, {
    method: 'POST', body: JSON.stringify(manualPayload)
  })
  assertStatus('human submission retry is idempotent', manualRetry.status, 200)
  const manualRetryBody = await manualRetry.json()
  if (!manualRetryBody.reused || manualRetryBody.data.id !== manual.id || manualRetryBody.data.requestNo !== manual.requestNo) {
    throw new Error('human submission retry created or returned a different request')
  }

  assertStatus('customer lists own customizations', (await request('/api/customization-requests/mine', customer.token)).status, 200)
  assertStatus('other customer cannot read request', (await request(`/api/customization-requests/mine/${manual.id}`, other.token)).status, 403)
  assertStatus('support receives customization queue', (await request('/api/admin/customization-requests', support.token)).status, 200)
  assertStatus('production receives customization queue', (await request('/api/admin/customization-requests', production.token)).status, 200)
  assertStatus('owner receives customization queue', (await request('/api/admin/customization-requests', owner.token)).status, 200)
  assertStatus('collaboration staff cannot read customization queue', (await request('/api/admin/customization-requests', collab.token)).status, 403)
  assertStatus('ordinary customer cannot read customization queue', (await request('/api/admin/customization-requests', other.token)).status, 403)
  const detailResponse = await request(`/api/admin/customization-requests/${manual.id}`, support.token)
  assertStatus('support reads customization detail', detailResponse.status, 200)
  const detail = (await detailResponse.json()).data
  if (detail.user.phone || detail.user.phoneTail !== customer.phone.slice(-4) || detail.sourceFiles.length !== 1) {
    throw new Error('admin detail did not mask phone or include source')
  }
  assertStatus('authorized signed source downloads', (await fetch(detail.sourceFiles[0].url)).status, 200)

  assertStatus('support cannot claim frame task', (await request(`/api/admin/customization-requests/${manual.id}/claim`, support.token, {
    method: 'POST'
  })).status, 403)
  assertStatus('production claims frame task', (await request(`/api/admin/customization-requests/${manual.id}/claim`, production.token, {
    method: 'POST'
  })).status, 200)
  assertStatus('second staff cannot take active frame task', (await request(`/api/admin/customization-requests/${manual.id}/claim`, owner.token, {
    method: 'POST'
  })).status, 409)

  const staffFrameV1 = await upload(production, 'CUSTOMIZATION_FRAME', 'staff-frame-v1.png')
  const selectionV1Response = await request(`/api/admin/customization-requests/${manual.id}/frame-selections`, production.token, {
    method: 'POST', body: JSON.stringify({
      frameKeys: [staffFrameV1], editorData: { selectedIndexes: [0], frameCount: 1 },
      staffMessage: '第一版筛帧结果', internalNote: '自动测试内部备注'
    })
  })
  assertStatus('production submits first frame selection', selectionV1Response.status, 200)
  const selectionV1 = (await selectionV1Response.json()).data
  if (selectionV1.request.status !== 'OPTIONS_READY' || selectionV1.selection.version !== 1) {
    throw new Error('first staff frame selection did not enter user confirmation')
  }
  assertStatus('other customer cannot see selected frames', (await request(`/api/customization-requests/mine/${manual.id}/frame-selection`, other.token)).status, 403)
  const userSelectionV1Response = await request(`/api/customization-requests/mine/${manual.id}/frame-selection`, customer.token)
  assertStatus('customer sees first selected-frame version', userSelectionV1Response.status, 200)
  const userSelectionV1 = (await userSelectionV1Response.json()).data
  if (userSelectionV1.selection.frames.length !== 1 || userSelectionV1.selection.staffMessage !== '第一版筛帧结果') {
    throw new Error('customer did not receive the exact staff selection')
  }
  assertStatus('customer requests frame adjustment', (await request(`/api/customization-requests/mine/${manual.id}/frame-selection/revision`, customer.token, {
    method: 'POST', body: JSON.stringify({ message: '希望更换动作画面' })
  })).status, 200)
  assertStatus('production reclaims revised task', (await request(`/api/admin/customization-requests/${manual.id}/claim`, production.token, {
    method: 'POST'
  })).status, 200)

  const staffFrameV2 = await upload(production, 'CUSTOMIZATION_FRAME', 'staff-frame-v2.png')
  const selectionV2Response = await request(`/api/admin/customization-requests/${manual.id}/frame-selections`, production.token, {
    method: 'POST', body: JSON.stringify({
      frameKeys: [staffFrameV2], editorData: { selectedIndexes: [0], frameCount: 1 },
      staffMessage: '已按反馈更换画面'
    })
  })
  assertStatus('production submits second frame selection', selectionV2Response.status, 200)
  const selectionV2 = (await selectionV2Response.json()).data
  if (selectionV2.selection.version !== 2) throw new Error('frame selection history did not create version 2')
  const selectionHistory = await prisma.customizationFrameSelection.findMany({ where: { requestId: manual.id }, orderBy: { version: 'asc' } })
  if (selectionHistory.length !== 2 || selectionHistory[0].status !== 'REVISION_REQUESTED' || selectionHistory[1].status !== 'SUBMITTED') {
    throw new Error('frame selection version history was overwritten or has invalid status')
  }
  console.log('PASS staff selection keeps immutable version history')

  const transferredFrame = await prisma.privateFile.findUnique({ where: { objectKey: staffFrameV2 } })
  if (transferredFrame?.ownerUserId !== customer.id || transferredFrame.linkedResourceId !== selectionV2.selection.id) {
    throw new Error('submitted staff frame was not securely transferred to the customer request')
  }
  console.log('PASS selected frames transfer to customer ownership and request binding')
  const acceptResponses = await Promise.all([1, 2].map(() => request(`/api/customization-requests/mine/${manual.id}/frame-selection/accept`, customer.token, {
    method: 'POST'
  })))
  acceptResponses.forEach((response, index) => assertStatus(`customer concurrent frame accept ${index + 1}`, response.status, 200))
  const acceptedManual = await prisma.customizationRequest.findUnique({ where: { id: manual.id } })
  const manualAsset = acceptedManual?.animationAssetId
    ? await prisma.animationAsset.findUnique({ where: { id: acceptedManual.animationAssetId }, include: { versions: true } })
    : null
  if (!manualAsset || !/^ANM-\d{8}-[A-Z2-9]{6}$/.test(manualAsset.assetNo) || manualAsset.versions.length !== 1 || manualAsset.versions[0].sourceType !== 'STAFF_SCREENED') {
    throw new Error('accepted staff screening did not create exactly one immutable animation asset version')
  }
  console.log('PASS accepted staff screening creates one reusable animation asset version')
  assertStatus('customer lists animation assets', (await request('/api/animation-assets', customer.token)).status, 200)
  assertStatus('other customer cannot read animation asset', (await request(`/api/animation-assets/${manualAsset.id}`, other.token)).status, 404)
  assertStatus('customer renames private animation asset', (await request(`/api/animation-assets/${manualAsset.id}`, customer.token, {
    method: 'PATCH', body: JSON.stringify({ title: '人工筛帧测试动画' })
  })).status, 200)
  const reusePayload = {
    clientRequestKey: `asset-reuse-${runId}`,
    machineModelId: modelId,
    desiredSkuId: skuId,
    userNote: '使用已有动画选择新款式',
    requestedOptions: [{ skuId, frame: 1, size: 'S', material: 'TEST', colorName: `测试色-${runId}`, referencePrice: 199 }]
  }
  assertStatus('other customer cannot reuse animation asset', (await request(`/api/animation-assets/${manualAsset.id}/reuse`, other.token, {
    method: 'POST', body: JSON.stringify({ ...reusePayload, clientRequestKey: `other-reuse-${runId}` })
  })).status, 404)
  await prisma.animationAssetVersion.update({ where: { id: manualAsset.versions[0].id }, data: { baseFrameCount: 2 } })
  assertStatus('incompatible SKU cannot reuse animation asset', (await request(`/api/animation-assets/${manualAsset.id}/reuse`, customer.token, {
    method: 'POST', body: JSON.stringify({ ...reusePayload, clientRequestKey: `bad-reuse-${runId}` })
  })).status, 400)
  await prisma.animationAssetVersion.update({ where: { id: manualAsset.versions[0].id }, data: { baseFrameCount: 1 } })
  const reuseResponse = await request(`/api/animation-assets/${manualAsset.id}/reuse`, customer.token, {
    method: 'POST', body: JSON.stringify(reusePayload)
  })
  assertStatus('customer reuses animation asset for a new purchase', reuseResponse.status, 201)
  const reusedPurchase = (await reuseResponse.json()).data
  const reusedProduct = await prisma.customProduct.findUnique({ where: { id: reusedPurchase.customProductId } })
  const versionsAfterReuse = await prisma.animationAssetVersion.count({ where: { assetId: manualAsset.id } })
  if (
    reusedPurchase.request.status !== 'CONFIRMED' ||
    reusedPurchase.request.animationAssetId !== manualAsset.id ||
    reusedPurchase.request.acceptedAnimationVersionId !== manualAsset.versions[0].id ||
    reusedProduct?.animationVersionId !== manualAsset.versions[0].id ||
    versionsAfterReuse !== 1
  ) {
    throw new Error('asset reuse did not create a new purchase record pinned to the existing animation version')
  }
  const reuseRetry = await request(`/api/animation-assets/${manualAsset.id}/reuse`, customer.token, {
    method: 'POST', body: JSON.stringify(reusePayload)
  })
  assertStatus('animation reuse retry is idempotent', reuseRetry.status, 200)
  const reuseRetryBody = await reuseRetry.json()
  if (!reuseRetryBody.reused || reuseRetryBody.data.customProductId !== reusedPurchase.customProductId) {
    throw new Error('animation reuse retry created a duplicate purchase record')
  }
  assertStatus('reused animation enters cart with the new SKU', (await request('/api/cart/add', customer.token, {
    method: 'POST', body: JSON.stringify({ itemType: 'CUSTOM', contentId: reusedPurchase.customProductId, hardwareSkuId: skuId })
  })).status, 201)
  console.log('PASS reuse creates a new DZ purchase record while keeping the same ANM version')

  const editedFrameKey = await upload(customer, 'CUSTOMIZATION_FRAME', `asset-v2-${runId}.png`)
  const versionPayload = {
    baseVersionId: manualAsset.versions[0].id,
    clientVersionKey: `asset-version-${runId}-owner`,
    frameKeys: [editedFrameKey],
    editorData: { recipeVersion: 1, operation: 'automated-v2-test' }
  }
  assertStatus('other customer cannot create an animation version', (await request(`/api/animation-assets/${manualAsset.id}/versions`, other.token, {
    method: 'POST', body: JSON.stringify({ ...versionPayload, clientVersionKey: `asset-version-${runId}-other` })
  })).status, 404)
  const versionResponse = await request(`/api/animation-assets/${manualAsset.id}/versions`, customer.token, {
    method: 'POST', body: JSON.stringify(versionPayload)
  })
  assertStatus('owner saves animation changes as V2', versionResponse.status, 201)
  const versionBody = await versionResponse.json()
  const versionV2 = versionBody.data.version
  if (versionV2.versionNo !== 2 || versionV2.sourceType !== 'USER_EDITED') {
    throw new Error('animation edit did not append USER_EDITED V2')
  }
  const versionsAfterEdit = await prisma.animationAssetVersion.findMany({
    where: { assetId: manualAsset.id }, orderBy: { versionNo: 'asc' }
  })
  const productAfterEdit = await prisma.customProduct.findUnique({ where: { id: reusedPurchase.customProductId } })
  if (
    versionsAfterEdit.length !== 2 ||
    versionsAfterEdit[0].id !== manualAsset.versions[0].id ||
    versionsAfterEdit[1].id !== versionV2.id ||
    productAfterEdit?.animationVersionId !== manualAsset.versions[0].id
  ) {
    throw new Error('V2 creation overwrote V1 or changed an existing purchase version')
  }
  const versionRetry = await request(`/api/animation-assets/${manualAsset.id}/versions`, customer.token, {
    method: 'POST', body: JSON.stringify(versionPayload)
  })
  assertStatus('animation V2 retry is idempotent', versionRetry.status, 200)
  if (!(await versionRetry.json()).reused) throw new Error('animation V2 retry was not marked as reused')
  assertStatus('stale animation edit cannot overwrite the current version', (await request(`/api/animation-assets/${manualAsset.id}/versions`, customer.token, {
    method: 'POST', body: JSON.stringify({ ...versionPayload, clientVersionKey: `asset-version-${runId}-stale` })
  })).status, 409)
  console.log('PASS animation edits append V2 while V1 and old purchases remain unchanged')

  await prisma.animationAsset.update({ where: { id: manualAsset.id }, data: { assetType: 'COLLAB', collabStatus: 'AUTHORIZED' } })
  assertStatus('authorized collab animation cannot be edited directly', (await request(`/api/animation-assets/${manualAsset.id}/versions`, customer.token, {
    method: 'POST', body: JSON.stringify({
      ...versionPayload,
      baseVersionId: versionV2.id,
      clientVersionKey: `asset-version-${runId}-collab`
    })
  })).status, 409)
  assertStatus('authorized collab animation cannot be deleted', (await request(`/api/animation-assets/${manualAsset.id}`, customer.token, {
    method: 'DELETE'
  })).status, 409)
  await prisma.animationAsset.update({ where: { id: manualAsset.id }, data: { assetType: 'PRIVATE', collabStatus: 'NONE' } })
  const chooseResponses = await Promise.all([1, 2].map(() => request(`/api/customization-requests/mine/${manual.id}/choose-sku`, customer.token, {
    method: 'POST', body: JSON.stringify({ desiredSkuId: skuId, userNote: '筛帧与款式均已确认' })
  })))
  chooseResponses.forEach((response, index) => assertStatus(`customer concurrent style choice ${index + 1}`, response.status, 200))
  const completedManual = await prisma.customizationRequest.findUnique({ where: { id: manual.id } })
  if (completedManual?.status !== 'CONFIRMED' || completedManual.desiredSkuId !== skuId) {
    throw new Error('accepted manual request did not become order-ready')
  }
  assertStatus('manual screening can enter cart without another review', (await request('/api/cart/add', customer.token, {
    method: 'POST', body: JSON.stringify({ itemType: 'CUSTOM', contentId: completedManual.customProductId, hardwareSkuId: skuId })
  })).status, 201)
  console.log('PASS manual screening advances directly to order checkout without creating a duplicate request')

  const blockers = await getAccountDeletionBlockers(prisma, customer.id)
  if (!blockers.some(item => item.code === 'ACTIVE_CUSTOMIZATION_REQUESTS')) {
    throw new Error('active customization did not block account deletion')
  }
  console.log('PASS active customization blocks account deletion')

  const self = await createSelfDraft(customer, 'submit')
  if (self.request.requestNo || self.request.status !== 'DRAFT') throw new Error('cloud draft received a formal number too early')
  assertStatus('unconfirmed customization cannot enter cart', (await request('/api/cart/add', customer.token, {
    method: 'POST', body: JSON.stringify({ itemType: 'CUSTOM', contentId: self.product.id, hardwareSkuId: skuId })
  })).status, 409)
  const submitResponse = await request(`/api/customization-requests/${self.request.id}/submit`, customer.token, {
    method: 'POST', body: JSON.stringify({ desiredSkuId: skuId, userNote: '自己筛选完成' })
  })
  assertStatus('self-screened draft submits', submitResponse.status, 200)
  const submittedSelf = (await submitResponse.json()).data
  if (!submittedSelf.requestNo || submittedSelf.status !== 'CONFIRMED') throw new Error('self draft was not directly confirmed for checkout')
  const selfAsset = submittedSelf.animationAssetId
    ? await prisma.animationAsset.findUnique({ where: { id: submittedSelf.animationAssetId }, include: { versions: true } })
    : null
  if (!selfAsset || selfAsset.versions.length !== 1 || selfAsset.versions[0].sourceType !== 'SELF_SCREENED') {
    throw new Error('confirmed self screening did not create exactly one immutable animation asset version')
  }
  console.log('PASS confirmed self screening creates one reusable animation asset version')
  const selfRetry = await request(`/api/customization-requests/${self.request.id}/submit`, customer.token, {
    method: 'POST', body: JSON.stringify({ desiredSkuId: skuId, userNote: '重复提交' })
  })
  assertStatus('self submission retry is idempotent', selfRetry.status, 200)
  const selfRetryBody = await selfRetry.json()
  if (!selfRetryBody.reused || selfRetryBody.data.requestNo !== submittedSelf.requestNo) {
    throw new Error('self submission retry did not return the original request')
  }
  assertStatus('submitted frame draft cannot be edited', (await request(`/api/custom-products/${self.product.id}`, customer.token, {
    method: 'PUT', body: JSON.stringify({ frameCount: 1 })
  })).status, 409)
  assertStatus('submitted frame draft cannot be deleted', (await request(`/api/custom-products/${self.product.id}`, customer.token, {
    method: 'DELETE'
  })).status, 409)
  assertStatus('confirmed self customization can enter cart', (await request('/api/cart/add', customer.token, {
    method: 'POST', body: JSON.stringify({ itemType: 'CUSTOM', contentId: self.product.id, hardwareSkuId: skuId })
  })).status, 201)
  assertStatus('customer can remove private asset from frontend', (await request(`/api/animation-assets/${selfAsset.id}`, customer.token, {
    method: 'DELETE'
  })).status, 200)
  const retainedVersion = await prisma.animationAssetVersion.findUnique({ where: { id: selfAsset.versions[0].id } })
  const hiddenAsset = await prisma.animationAsset.findUnique({ where: { id: selfAsset.id } })
  if (!retainedVersion || hiddenAsset?.status !== 'USER_DELETED' || !hiddenAsset.frontDeletedAt) {
    throw new Error('frontend deletion removed backend animation history or failed to hide the asset')
  }
  assertStatus('frontend-deleted asset is no longer readable by customer', (await request(`/api/animation-assets/${selfAsset.id}`, customer.token)).status, 404)
  console.log('PASS frontend deletion hides private asset and retains immutable backend version')

  const abandonedKey = await upload(other, 'CUSTOMIZATION_SOURCE', 'abandoned.png')
  await prisma.privateFile.update({ where: { objectKey: abandonedKey }, data: { updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } })
  const cleanupFastify = {
    prisma, storageDelete, config: { privateFileCleanup: { batchSize: 100 } },
    log: { warn: () => {} }
  }
  const abandonedResult = await cleanupAbandonedCustomizationFiles(cleanupFastify, { now: new Date() })
  if (abandonedResult.deleted < 1) throw new Error('abandoned customization source was not deleted')
  console.log('PASS interrupted upload is automatically deleted after 24 hours')

  const expired = await createSelfDraft(other, 'expired')
  await prisma.customizationRequest.update({
    where: { id: expired.request.id }, data: { updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }
  })
  const expiredResult = await cleanupExpiredCustomizationDrafts(cleanupFastify, { now: new Date(), retentionDays: 7 })
  if (expiredResult.expired < 1) throw new Error('expired customization draft was not processed')
  const closed = await prisma.customizationRequest.findUnique({ where: { id: expired.request.id } })
  if (closed?.status !== 'CLOSED' || closed.sourceKeys.length || closed.selectedFrameKeys.length) {
    throw new Error('expired draft metadata was not cleared')
  }
  const deletedDraftFiles = await prisma.privateFile.findMany({ where: { objectKey: { in: [expired.sourceKey, expired.frameKey] } } })
  if (deletedDraftFiles.some(item => item.status !== 'DELETED')) throw new Error('expired draft files were not physically deleted')
  console.log('PASS seven-day draft expiry keeps status history and removes materials')

  const raced = await createSelfDraft(other, 'race')
  await prisma.customizationRequest.update({
    where: { id: raced.request.id }, data: { updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }
  })
  await Promise.allSettled([
    cleanupExpiredCustomizationDrafts(cleanupFastify, { now: new Date(), retentionDays: 7 }),
    request(`/api/customization-requests/${raced.request.id}/submit`, other.token, {
      method: 'POST', body: JSON.stringify({ desiredSkuId: skuId })
    })
  ])
  const racedResult = await prisma.customizationRequest.findUnique({ where: { id: raced.request.id } })
  const racedFiles = await prisma.privateFile.findMany({ where: { objectKey: { in: [raced.sourceKey, raced.frameKey] } } })
  const submittedConsistently = racedResult?.status === 'CONFIRMED' && racedFiles.every(item => item.status === 'READY')
  const expiredConsistently = racedResult?.status === 'CLOSED' && racedFiles.every(item => item.status === 'DELETED')
  if (!submittedConsistently && !expiredConsistently) {
    throw new Error(`cleanup/submit race left inconsistent state: ${racedResult?.status}`)
  }
  console.log('PASS draft cleanup and user submission cannot corrupt each other')

  console.log('Customization flow checks passed')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
