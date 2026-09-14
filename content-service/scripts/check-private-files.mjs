import fs from 'fs/promises'
import { PrismaClient } from '@prisma/client'
import { requireIsolatedTestDatabase } from './test-db-guard.mjs'
import { cleanupAbandonedAvatars } from '../src/lib/private-file-cleanup.js'

requireIsolatedTestDatabase()
const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-7)
const createdUsers = []
const createdKeys = []

const PNG = Buffer.from([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01
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
  const phone = `198${runId}${index}`
  const user = await prisma.user.create({
    data: {
      phone, role, staffRole,
      privacyAgreedAt: new Date(), privacyPolicyVersion: 'private-file-test',
      profile: { create: { nickname: `file-test-${label}` } },
    }
  })
  createdUsers.push({ id: user.id, phone })
  await prisma.smsCode.create({ data: { phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) } })
  const login = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone, code: '123456', mode: 'LOGIN' })
  })
  assertStatus(`${label} login`, login.status, 200)
  const json = await login.json()
  return { ...user, phone, token: json.data.accessToken }
}

async function uploadFile(user, purpose, body = PNG, fileType = 'image/png', fileName = 'proof.png') {
  const init = await request('/api/upload/presign', user.token, {
    method: 'POST',
    body: JSON.stringify({ purpose, fileName, fileType, fileSize: body.length })
  })
  assertStatus(`${purpose} create upload`, init.status, 200)
  const data = (await init.json()).data
  createdKeys.push(data.objectKey)
  const upload = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': fileType }, body })
  assertStatus(`${purpose} upload content`, upload.status, 204)
  const complete = await request(new URL(data.completeUrl).pathname, user.token, { method: 'POST' })
  assertStatus(`${purpose} complete`, complete.status, 200)
  return data.objectKey
}

async function localStorageDelete(objectKey) {
  await fs.rm(new URL(`../storage/private/${objectKey}`, import.meta.url), { force: true })
}

async function cleanup() {
  // 匿名联络接口刻意不返回内部记录 ID；仅清理由本自检固定文案产生的残留记录。
  await prisma.contactSubmission.deleteMany({ where: {
    type: 'join', contact: 'test@example.com', message: 'Private file security test submission'
  } })
  const ids = createdUsers.map(item => item.id)
  const phones = createdUsers.map(item => item.phone)
  if (createdKeys.length) {
    for (const key of createdKeys) {
      await fs.rm(new URL(`../storage/private/${key}`, import.meta.url), { force: true }).catch(() => {})
    }
  }
  if (!ids.length) return
  await prisma.operationLog.deleteMany({ where: { userId: { in: ids } } })
  const carts = await prisma.cart.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  if (carts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map(cart => cart.id) } } })
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } })
  await prisma.customProduct.deleteMany({ where: { userId: { in: ids } } })
  await prisma.privateFile.deleteMany({ where: {
    OR: [
      { ownerUserId: { in: ids } },
      { objectKey: { in: createdKeys } }
    ]
  } })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.smsCode.deleteMany({ where: { phone: { in: phones } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

try {
  const owner = await createLogin('owner', 1, 'OWNER', 3)
  const support = await createLogin('support', 2, 'CUSTOMER_SERVICE', 2)
  const production = await createLogin('production', 3, 'PRODUCTION', 2)
  const collab = await createLogin('collab', 4, 'COLLAB_OPS', 2)
  const userA = await createLogin('user-a', 5)
  const userB = await createLogin('user-b', 6)

  const frameBatch = await request('/api/upload/presign-batch', userA.token, {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'CUSTOMIZATION_FRAME',
      files: Array.from({ length: 24 }, (_, index) => ({
        fileName: `frame-${index + 1}.png`, fileType: 'image/png', fileSize: PNG.length
      }))
    })
  })
  assertStatus('one 24-frame upload is accepted as one normal operation', frameBatch.status, 200)
  const uploadBuckets = await prisma.rateLimitBucket.findMany({
    where: { scope: { in: ['UPLOAD_ACCOUNT_REQUESTS_10_MINUTES', 'UPLOAD_ACCOUNT_FILES_10_MINUTES'] } },
    orderBy: { updatedAt: 'desc' }, take: 2
  })
  if (!uploadBuckets.some(bucket => bucket.scope === 'UPLOAD_ACCOUNT_REQUESTS_10_MINUTES' && bucket.count === 1)
    || !uploadBuckets.some(bucket => bucket.scope === 'UPLOAD_ACCOUNT_FILES_10_MINUTES' && bucket.count === 24)) {
    throw new Error('account upload request and file budgets were not counted separately')
  }
  console.log('PASS upload abuse protection counts operations and file volume separately')

  const avatarKey = await uploadFile(userA, 'AVATAR', PNG, 'image/png', 'avatar.png')
  const avatarFile = await prisma.privateFile.findUnique({ where: { objectKey: avatarKey } })
  assertStatus('unadopted avatar is not public', (await request(`/api/upload/public/${avatarFile.id}`)).status, 404)
  assertStatus('other user cannot adopt avatar', (await request(`/api/upload/files/${avatarFile.id}/use-as-avatar`, userB.token, { method: 'POST' })).status, 404)
  assertStatus('profile rejects arbitrary avatar URL', (await request('/api/v1/account/profile', userA.token, {
    method: 'PUT', body: JSON.stringify({ avatarUrl: 'https://example.invalid/avatar.png' })
  })).status, 400)
  const adoptAvatar = await request(`/api/upload/files/${avatarFile.id}/use-as-avatar`, userA.token, { method: 'POST' })
  assertStatus('owner adopts completed avatar', adoptAvatar.status, 200)
  assertStatus('adopted avatar is public', (await request(`/api/upload/public/${avatarFile.id}`)).status, 200)

  const currentAvatarKey = await uploadFile(userA, 'AVATAR', PNG, 'image/png', 'current-avatar.png')
  const currentAvatar = await prisma.privateFile.findUnique({ where: { objectKey: currentAvatarKey } })
  assertStatus('replacement avatar is adopted', (await request(`/api/upload/files/${currentAvatar.id}/use-as-avatar`, userA.token, { method: 'POST' })).status, 200)
  const abandonedAvatarKey = await uploadFile(userA, 'AVATAR', PNG, 'image/png', 'abandoned-avatar.png')
  const abandonedAvatar = await prisma.privateFile.findUnique({ where: { objectKey: abandonedAvatarKey } })
  const retryAvatarKey = await uploadFile(userA, 'AVATAR', PNG, 'image/png', 'retry-avatar.png')
  const retryAvatar = await prisma.privateFile.findUnique({ where: { objectKey: retryAvatarKey } })
  const oldEnough = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await prisma.privateFile.updateMany({
    where: { id: { in: [avatarFile.id, abandonedAvatar.id, retryAvatar.id] } },
    data: { updatedAt: oldEnough }
  })

  const cleanupFastify = {
    prisma,
    storageDelete: localStorageDelete,
    config: { privateFileCleanup: { avatarRetentionHours: 24, batchSize: 100 } },
    log: { warn: () => {} }
  }
  const cleaned = await cleanupAbandonedAvatars(cleanupFastify, {
    candidateIds: [avatarFile.id, abandonedAvatar.id],
    now: new Date()
  })
  if (cleaned.deleted !== 2) throw new Error(`avatar cleanup expected 2 deletions, received ${cleaned.deleted}`)
  const cleanedFiles = await prisma.privateFile.findMany({ where: { id: { in: [avatarFile.id, abandonedAvatar.id] } } })
  if (cleanedFiles.some(item => item.status !== 'DELETED' || !item.deletedAt)) throw new Error('avatar cleanup did not retain deletion records')
  const preservedCurrent = await prisma.privateFile.findUnique({ where: { id: currentAvatar.id } })
  if (preservedCurrent?.status !== 'READY' || preservedCurrent.linkedResourceType !== 'USER_PROFILE') {
    throw new Error('avatar cleanup changed the current avatar')
  }
  assertStatus('current avatar remains public after cleanup', (await request(`/api/upload/public/${currentAvatar.id}`)).status, 200)
  console.log('PASS abandoned and replaced avatars are deleted while the current avatar is preserved')

  const failedCleanup = await cleanupAbandonedAvatars({
    ...cleanupFastify,
    storageDelete: async () => { throw new Error('simulated storage failure') }
  }, { candidateIds: [retryAvatar.id], now: new Date() })
  if (failedCleanup.failed !== 1) throw new Error('avatar cleanup failure was not recorded')
  const failedFile = await prisma.privateFile.findUnique({ where: { id: retryAvatar.id } })
  if (failedFile?.status !== 'DELETE_FAILED' || failedFile.deletedAt) throw new Error('failed avatar deletion has an invalid state')
  await prisma.privateFile.update({ where: { id: retryAvatar.id }, data: { updatedAt: oldEnough } })
  const retriedCleanup = await cleanupAbandonedAvatars(cleanupFastify, {
    candidateIds: [retryAvatar.id],
    now: new Date(),
    retryMinutes: 1
  })
  if (retriedCleanup.deleted !== 1) throw new Error('failed avatar deletion was not retried')
  console.log('PASS failed avatar deletion is retained and succeeds on retry')

  const evidenceKey = await uploadFile(userA, 'AFTERSALE_EVIDENCE')
  const evidence = await prisma.privateFile.findUnique({ where: { objectKey: evidenceKey } })
  if (evidence?.status !== 'READY' || evidence.detectedMimeType !== 'image/png') throw new Error('uploaded file was not validated')
  console.log('PASS uploaded content was validated and registered')

  assertStatus('owner cannot read unlinked file', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, owner.token)).status, 403)
  assertStatus('support cannot read unlinked file', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, support.token)).status, 403)
  assertStatus('other user cannot read file', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, userB.token)).status, 403)
  assertStatus('other user cannot bind file', (await request('/api/custom-products', userB.token, {
    method: 'POST', body: JSON.stringify({ animationFrames: JSON.stringify([evidenceKey]) })
  })).status, 400)

  await prisma.privateFile.update({ where: { objectKey: evidenceKey }, data: { linkedResourceType: 'AFTERSALE_REQUEST', linkedResourceId: 'test-aftersale' } })
  assertStatus('support reads linked aftersale evidence', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, support.token)).status, 200)
  assertStatus('owner reads linked business file', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, owner.token)).status, 200)
  assertStatus('production cannot read aftersale evidence', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, production.token)).status, 403)
  assertStatus('collab cannot read aftersale evidence', (await request(`/api/upload/presign-get?key=${encodeURIComponent(evidenceKey)}`, collab.token)).status, 403)

  const fake = await request('/api/upload/presign', userA.token, {
    method: 'POST', body: JSON.stringify({ purpose: 'AFTERSALE_EVIDENCE', fileName: 'fake.png', fileType: 'image/png', fileSize: 10 })
  })
  const fakeData = (await fake.json()).data
  createdKeys.push(fakeData.objectKey)
  const fakeUpload = await fetch(fakeData.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not-an-image') })
  assertStatus('fake image content rejected', fakeUpload.status, 400)

  assertStatus('unregistered key is not readable', (await request('/api/upload/presign-get?key=private%2Fguessed.png', owner.token)).status, 404)

  const creatorFrameKey = await uploadFile(userA, 'CREATOR_FRAME')
  const customProductResponse = await request('/api/custom-products', userA.token, {
    method: 'POST',
    body: JSON.stringify({ animationFrames: JSON.stringify([creatorFrameKey]), frameCount: 1 })
  })
  assertStatus('creator frame binds to draft', customProductResponse.status, 200)
  const customProduct = (await customProductResponse.json()).data
  assertStatus('linked creator frame can update same draft', (await request(`/api/custom-products/${customProduct.id}`, userA.token, {
    method: 'PUT', body: JSON.stringify({ animationFrames: JSON.stringify([creatorFrameKey]), frameCount: 1 })
  })).status, 200)
  const sku = await prisma.machineModelSku.findFirst({ select: { id: true } })
  if (!sku) throw new Error('private file cart check requires at least one machine model SKU')
  assertStatus('unreviewed private-frame draft cannot enter cart', (await request('/api/cart/add', userA.token, {
    method: 'POST', body: JSON.stringify({ itemType: 'CUSTOM', contentId: customProduct.id, hardwareSkuId: sku.id, quantity: 1 })
  })).status, 409)
  const libraryResponse = await request('/api/custom-products?page=1&limit=20', userA.token)
  assertStatus('creator library loads', libraryResponse.status, 200)
  const library = await libraryResponse.json()
  const listedProduct = library.data.items.find(item => item.id === customProduct.id)
  if (!listedProduct?.previewFrameUrl) throw new Error('creator library did not return a private preview URL')
  assertStatus('creator private preview downloads', (await fetch(listedProduct.previewFrameUrl)).status, 200)
  console.log('PASS creator draft keeps private key and returns temporary preview')

  const guestSession = `guest_${runId}_secure_upload_session`
  const resume = Buffer.from('%PDF-1.4\nprivate file test')
  const anonymousInit = await request('/api/upload/presign', null, {
    method: 'POST',
    headers: { 'X-Upload-Session': guestSession },
    body: JSON.stringify({ purpose: 'CONTACT_RESUME', fileName: 'resume.pdf', fileType: 'application/pdf', fileSize: resume.length })
  })
  assertStatus('anonymous resume create upload', anonymousInit.status, 200)
  const anonymousData = (await anonymousInit.json()).data
  createdKeys.push(anonymousData.objectKey)
  assertStatus('anonymous resume upload content', (await fetch(anonymousData.uploadUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: resume
  })).status, 204)
  assertStatus('anonymous resume complete', (await request(new URL(anonymousData.completeUrl).pathname, null, {
    method: 'POST', headers: { 'X-Upload-Session': guestSession }
  })).status, 200)
  const contactResponse = await request('/api/contact', null, {
    method: 'POST',
    headers: { 'X-Upload-Session': guestSession },
    body: JSON.stringify({
      type: 'join', name: 'Test Applicant', contact: 'test@example.com',
      message: 'Private file security test submission', attachments: [anonymousData.objectKey]
    })
  })
  assertStatus('anonymous resume binds to contact', contactResponse.status, 200)
  await contactResponse.json()
  const boundResume = await prisma.privateFile.findUnique({ where: { objectKey: anonymousData.objectKey } })
  const contactId = boundResume?.linkedResourceType === 'CONTACT_SUBMISSION' ? boundResume.linkedResourceId : null
  if (!contactId || !(await prisma.contactSubmission.findUnique({ where: { id: contactId }, select: { id: true } }))) {
    throw new Error('anonymous resume was not linked to its contact submission')
  }
  console.log('PASS anonymous resume ownership and business binding')
  await prisma.contactSubmission.delete({ where: { id: contactId } })
  console.log('Private file security checks passed')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
