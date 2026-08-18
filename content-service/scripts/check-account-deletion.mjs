import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { getAccountDeletionBlockers, processAccountDeletion } from '../src/lib/account-deletion.js'

const prisma = new PrismaClient()
const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:3001'
const runId = String(Date.now()).slice(-7)
const users = []
const phones = []
const objectKeys = []
const orderIds = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function request(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
}

async function createUser(label, index, staffRole = null, role = 0) {
  const phone = `197${runId}${index}`
  const user = await prisma.user.create({
    data: {
      phone, role, staffRole,
      privacyAgreedAt: new Date(), privacyPolicyVersion: 'deletion-test',
      profile: { create: { nickname: `delete-${label}`, bio: 'private bio', email: `${label}@example.test` } },
      creditScore: { create: { score: 100 } }
    }
  })
  users.push(user.id)
  phones.push(phone)
  return { ...user, phone }
}

async function login(user) {
  await prisma.smsCode.create({
    data: { userId: user.id, phone: user.phone, code: '123456', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 300000) }
  })
  const response = await request('/api/v1/auth/sms/verify', null, {
    method: 'POST', body: JSON.stringify({ phone: user.phone, code: '123456', mode: 'LOGIN' })
  })
  assert(response.status === 200, `${user.phone} can log in`)
  return (await response.json()).data.accessToken
}

async function deletionOtp(user) {
  await prisma.smsCode.create({
    data: { userId: user.id, phone: user.phone, code: '654321', purpose: 'DEACTIVATE', expiresAt: new Date(Date.now() + 300000) }
  })
}

async function applyDeletion(user, token) {
  await deletionOtp(user)
  return request('/api/v1/account/deactivate/apply', token, {
    method: 'POST', body: JSON.stringify({ otp: '654321', reason: 'automated test reason' })
  })
}

async function pauseDeletion(taskId, staffToken, suffix) {
  return request(`/api/admin/account-deletions/${taskId}/pause`, staffToken, {
    method: 'POST',
    body: JSON.stringify({
      reason: `internal pause reason ${suffix}`,
      userMessage: `public pause message ${suffix}`
    })
  })
}

async function localDelete(objectKey) {
  await fs.rm(new URL(`../storage/private/${objectKey}`, import.meta.url), { force: true })
}

function deletionFastify(storageDelete = localDelete) {
  return {
    prisma,
    storageDelete,
    config: {
      accountDeletion: {
        batchSize: 20,
        retryMinutes: 15,
        manualAfterAttempts: 3,
        manualAfterMinutes: 60
      }
    },
    log: { error: () => {} }
  }
}

async function createAvatarFile(user, suffix) {
  const id = randomUUID()
  const objectKey = `private/avatar/${user.id}/${id}.png`
  objectKeys.push(objectKey)
  const target = new URL(`../storage/private/${objectKey}`, import.meta.url)
  await fs.mkdir(new URL('.', target), { recursive: true })
  await fs.writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const file = await prisma.privateFile.create({
    data: {
      id, ownerUserId: user.id, purpose: 'AVATAR', storageProvider: 'local', objectKey,
      originalName: `${suffix}.png`, declaredMimeType: 'image/png', detectedMimeType: 'image/png',
      declaredSizeBytes: 4, sizeBytes: 4, status: 'READY', uploadedAt: new Date(),
      linkedResourceType: 'USER_PROFILE', linkedResourceId: user.id
    }
  })
  await prisma.userProfile.update({
    where: { userId: user.id },
    data: { avatarUrl: `${apiBase}/api/upload/public/${file.id}` }
  })
  return file
}

async function assertDeletionBlocker(user, code, message) {
  const blockers = await getAccountDeletionBlockers(prisma, user.id)
  assert(blockers.some(item => item.code === code), message)
}

async function cleanup() {
  for (const key of objectKeys) await localDelete(key).catch(() => {})
  if (!users.length) return
  const whereUser = { in: users }
  await prisma.operationLog.deleteMany({ where: { userId: whereUser } })
  await prisma.auditLog.deleteMany({ where: { userId: whereUser } })
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: whereUser } })
  await prisma.refreshToken.deleteMany({ where: { userId: whereUser } })
  await prisma.actionToken.deleteMany({ where: { userId: whereUser } })
  await prisma.smsCode.deleteMany({ where: { OR: [{ userId: whereUser }, { phone: { in: phones } }] } })
  await prisma.preOrder.deleteMany({ where: { userId: whereUser } })
  await prisma.aftersaleRequest.deleteMany({ where: { userId: whereUser } })
  await prisma.customizeOrder.deleteMany({ where: { id: { in: orderIds } } })
  await prisma.report.deleteMany({ where: { OR: [{ reporterId: whereUser }, { targetType: 'user', targetId: whereUser }] } })
  await prisma.creatorContract.deleteMany({ where: { OR: [{ creatorId: whereUser }, { createdBy: whereUser }] } })
  await prisma.settlementRecord.deleteMany({ where: { OR: [{ creatorId: whereUser }, { settledBy: whereUser }] } })
  await prisma.reserveLog.deleteMany({ where: { creatorId: whereUser } })
  await prisma.creatorReserve.deleteMany({ where: { creatorId: whereUser } })
  await prisma.withdrawalRequest.deleteMany({ where: { creatorId: whereUser } })
  await prisma.balance.deleteMany({ where: { creatorId: whereUser } })
  await prisma.earning.deleteMany({ where: { creatorId: whereUser } })
  await prisma.collabOrder.deleteMany({ where: { creatorId: whereUser } })
  const collabWorks = await prisma.collabWork.findMany({ where: { creatorId: whereUser }, select: { id: true } })
  if (collabWorks.length) await prisma.collabFramePack.deleteMany({ where: { collabWorkId: { in: collabWorks.map(item => item.id) } } })
  await prisma.collabWork.deleteMany({ where: { creatorId: whereUser } })
  await prisma.contactSubmission.deleteMany({ where: { submitterUserId: whereUser } })
  await prisma.certifyApplication.deleteMany({ where: { userId: whereUser } })
  const carts = await prisma.cart.findMany({ where: { userId: whereUser }, select: { id: true } })
  if (carts.length) await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map(item => item.id) } } })
  await prisma.cart.deleteMany({ where: { userId: whereUser } })
  await prisma.customProduct.deleteMany({ where: { userId: whereUser } })
  await prisma.userAddress.deleteMany({ where: { userId: whereUser } })
  await prisma.privateFile.deleteMany({ where: { OR: [{ ownerUserId: whereUser }, { objectKey: { in: objectKeys } }] } })
  await prisma.creditLog.deleteMany({ where: { userId: whereUser } })
  await prisma.creditScore.deleteMany({ where: { userId: whereUser } })
  await prisma.creatorNotification.deleteMany({ where: { userId: whereUser } })
  await prisma.userProfile.deleteMany({ where: { userId: whereUser } })
  await prisma.user.deleteMany({ where: { id: whereUser } })
}

try {
  const blocked = await createUser('blocked', 1)
  const staff = await createUser('staff', 2, 'OWNER', 3)
  const cancellable = await createUser('cancel', 3)
  const deletable = await createUser('delete', 4)
  const retryable = await createUser('retry', 5)
  const manualReview = await createUser('manual', 6)
  const pausedBeforeCleanup = await createUser('pause-before', 7)
  const blockerMatrix = await createUser('blocker-matrix', 8)

  const blockedToken = await login(blocked)
  const staffToken = await login(staff)
  const cancellableToken = await login(cancellable)
  const deletableToken = await login(deletable)
  const retryableToken = await login(retryable)
  const manualReviewToken = await login(manualReview)
  const pausedBeforeCleanupToken = await login(pausedBeforeCleanup)

  await prisma.preOrder.create({
    data: {
      userId: blocked.id, cartItemIds: '[]', checkoutIdempotencyKey: `delete-test-${runId}`,
      totalAmount: 1, expiresAt: new Date(Date.now() + 600000)
    }
  })
  const blockedCheck = await request('/api/v1/account/deactivate/check', blockedToken)
  const blockedBody = await blockedCheck.json()
  assert(blockedCheck.status === 200 && !blockedBody.data.canProceed, 'pending payment blocks deletion check')
  assert((await applyDeletion(blocked, blockedToken)).status === 409, 'direct deletion apply cannot bypass blockers')
  assert((await request('/api/v1/account/deactivate/check', staffToken)).status === 200, 'staff deletion check responds safely')
  const staffCheck = await (await request('/api/v1/account/deactivate/check', staffToken)).json()
  assert(staffCheck.data.blockers.some(item => item.code === 'STAFF_ACCOUNT'), 'staff account cannot self-delete')

  const activeOrder = await prisma.customizeOrder.create({
    data: {
      orderNo: `DEL-BLOCK-${runId}`, userId: blockerMatrix.id,
      modelId: 'deletion-blocker-model', modelName: '注销拦截测试款', frameCount: 12,
      size: 'test', material: 'test', color: '#000000', colorName: 'test',
      skuId: 'deletion-blocker-sku', ossPath: 'protected/order/blocker.zip', frameUrls: '[]',
      status: 'pending'
    }
  })
  orderIds.push(activeOrder.id)
  await assertDeletionBlocker(blockerMatrix, 'ACTIVE_ORDERS', 'active customization order blocks deletion')
  await prisma.customizeOrder.update({ where: { id: activeOrder.id }, data: { status: 'received' } })

  const aftersale = await prisma.aftersaleRequest.create({
    data: { orderId: activeOrder.id, userId: blockerMatrix.id, type: 'quality', reason: 'automated deletion blocker test' }
  })
  await assertDeletionBlocker(blockerMatrix, 'OPEN_AFTERSALES', 'open aftersale request blocks deletion')
  await prisma.aftersaleRequest.update({ where: { id: aftersale.id }, data: { status: 'completed' } })

  const certification = await prisma.certifyApplication.create({
    data: {
      userId: blockerMatrix.id, creatorName: 'blocker creator', creatorType: 'individual',
      realName: 'Test User', idNumberLast4: '0000'
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'PENDING_CERTIFICATION', 'pending creator certification blocks deletion')
  await prisma.certifyApplication.update({ where: { id: certification.id }, data: { status: 'rejected' } })

  const contact = await prisma.contactSubmission.create({
    data: {
      type: 'feedback', name: 'blocker contact', contact: blockerMatrix.phone,
      message: 'automated deletion blocker test', submitterUserId: blockerMatrix.id
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'OPEN_CONTACTS', 'open contact submission blocks deletion')
  await prisma.contactSubmission.update({ where: { id: contact.id }, data: { status: 'done' } })

  const collabWork = await prisma.collabWork.create({
    data: {
      creatorId: blockerMatrix.id, title: 'blocker work', animationFrames: '[]', supportedSkus: '[]',
      agreementSignedAt: new Date(), status: 'pending'
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'ACTIVE_COLLAB_WORKS', 'active collaboration work blocks deletion')
  await prisma.collabWork.update({
    where: { id: collabWork.id },
    data: { status: 'rejected', isOnShelf: false, shelfStatus: 'off_shelf' }
  })

  const collabOrder = await prisma.collabOrder.create({
    data: {
      orderId: activeOrder.id, collabWorkId: collabWork.id, creatorId: blockerMatrix.id,
      salePrice: 100, revenueRate: 0.2, revenueAmount: 20
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'UNSETTLED_REVENUE', 'unsettled collaboration revenue blocks deletion')
  await prisma.collabOrder.update({
    where: { id: collabOrder.id }, data: { revenueStatus: 'withdrawn', settlementStatus: 'settled' }
  })

  const balance = await prisma.balance.create({
    data: { creatorId: blockerMatrix.id, pendingAmount: 1 }
  })
  await assertDeletionBlocker(blockerMatrix, 'ACCOUNT_BALANCE', 'non-zero creator balance blocks deletion')
  await prisma.balance.update({ where: { id: balance.id }, data: { pendingAmount: 0, availableAmount: 0 } })

  const withdrawal = await prisma.withdrawalRequest.create({
    data: {
      creatorId: blockerMatrix.id, amount: 1, method: 'bankcard',
      accountName: 'Test User', accountNumber: 'test-account'
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'OPEN_WITHDRAWALS', 'open withdrawal blocks deletion')
  await prisma.withdrawalRequest.update({ where: { id: withdrawal.id }, data: { status: 'paid' } })

  const reserve = await prisma.creatorReserve.create({
    data: { creatorId: blockerMatrix.id, frozenAmount: 1 }
  })
  await assertDeletionBlocker(blockerMatrix, 'CREATOR_RESERVE', 'frozen creator reserve blocks deletion')
  await prisma.creatorReserve.update({ where: { id: reserve.id }, data: { frozenAmount: 0, releasableAmount: 0 } })

  const settlement = await prisma.settlementRecord.create({
    data: {
      settlementWeek: `T-${runId}`, creatorId: blockerMatrix.id, orderCount: 1,
      totalRevenue: 20, reserveDeducted: 3, payoutAmount: 17
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'OPEN_SETTLEMENTS', 'open settlement record blocks deletion')
  await prisma.settlementRecord.update({ where: { id: settlement.id }, data: { status: 'paid' } })

  const contract = await prisma.creatorContract.create({
    data: {
      creatorId: blockerMatrix.id, creatorName: 'blocker creator', contractType: 'revenue_share',
      startAt: new Date(), createdBy: staff.id
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'ACTIVE_CONTRACTS', 'active creator contract blocks deletion')
  await prisma.creatorContract.update({ where: { id: contract.id }, data: { status: 'terminated' } })

  const report = await prisma.report.create({
    data: {
      reporterId: blockerMatrix.id, targetType: 'user', targetId: blockerMatrix.id,
      reason: 'automated test', description: 'deletion blocker matrix'
    }
  })
  await assertDeletionBlocker(blockerMatrix, 'OPEN_DISPUTES', 'open report or dispute blocks deletion')
  await prisma.report.update({ where: { id: report.id }, data: { status: 'resolved' } })
  assert((await getAccountDeletionBlockers(prisma, blockerMatrix.id)).length === 0, 'resolved business records no longer block deletion')

  const oldEndpoint = await request('/api/v1/user/account/deactivate', cancellableToken, {
    method: 'POST', body: JSON.stringify({ password: 'anything' })
  })
  assert(oldEndpoint.status === 410, 'legacy immediate deletion endpoint is retired')

  const applied = await applyDeletion(cancellable, cancellableToken)
  assert(applied.status === 200, 'eligible account enters deletion processing')
  assert((await request('/api/v1/account/me', cancellableToken)).status === 401, 'deletion request revokes existing sessions')
  const cancelToken = await login(cancellable)
  assert((await request('/api/v1/account/profile', cancelToken, {
    method: 'PUT', body: JSON.stringify({ bio: 'should not change' })
  })).status === 403, 'pending deletion account cannot create or change ordinary data')
  const cancelResponse = await request('/api/v1/account/deactivate/cancel', cancelToken, { method: 'POST' })
  assert(cancelResponse.status === 200, 'deletion can be cancelled before processing starts')
  const cancelledUser = await prisma.user.findUnique({ where: { id: cancellable.id } })
  assert(cancelledUser.status === 'ACTIVE', 'cancelled account returns to active')

  assert((await applyDeletion(pausedBeforeCleanup, pausedBeforeCleanupToken)).status === 200, 'pre-cleanup pause test account can apply')
  const pausedBeforeTask = await prisma.accountDeletionRequest.findUnique({ where: { userId: pausedBeforeCleanup.id } })
  assert((await pauseDeletion(pausedBeforeTask.id, staffToken, 'before-cleanup')).status === 200, 'owner can pause before cleanup starts')
  const pausedBeforeToken = await login(pausedBeforeCleanup)
  const pausedBeforeMe = await (await request('/api/v1/account/me', pausedBeforeToken)).json()
  assert(pausedBeforeMe.data.deletionRequest.canCancel === true, 'paused task remains cancellable before cleanup starts')
  assert(pausedBeforeMe.data.deletionRequest.pauseUserMessage === 'public pause message before-cleanup', 'user receives the public pause explanation')
  assert(pausedBeforeMe.data.deletionRequest.pauseReason === undefined, 'internal pause reason is not exposed to the user')
  assert((await request('/api/v1/account/deactivate/cancel', pausedBeforeToken, { method: 'POST' })).status === 200, 'user can cancel a paused task before cleanup starts')

  await prisma.userAddress.create({
    data: { userId: deletable.id, name: 'Private Name', phone: '13900000000', province: 'Test', city: 'Test', district: 'Test', detail: 'Private Address' }
  })
  await prisma.customProduct.create({
    data: { userId: deletable.id, animationFrames: '[]', draftData: 'private draft', status: 'draft' }
  })
  const completedOrder = await prisma.customizeOrder.create({
    data: {
      orderNo: `DEL-KEEP-${runId}`, userId: deletable.id,
      modelId: 'deletion-test-model', modelName: '保留交易测试款', frameCount: 12,
      size: 'test', material: 'test', color: '#000000', colorName: 'test',
      skuId: 'deletion-test-sku', ossPath: 'protected/order/source.zip', frameUrls: '[]',
      status: 'received', receiverName: '交易留存测试', receiverPhone: '13900000000',
      receiverAddress: '交易记录依法留存测试地址', receivedAt: new Date()
    }
  })
  orderIds.push(completedOrder.id)
  const avatar = await createAvatarFile(deletable, 'delete')
  const protectedFile = await createAvatarFile(deletable, 'order-source')
  await prisma.privateFile.update({
    where: { id: protectedFile.id },
    data: { purpose: 'CUSTOMIZATION_FRAME', linkedResourceType: 'CUSTOMIZE_ORDER', linkedResourceId: completedOrder.id }
  })
  const deletionApply = await applyDeletion(deletable, deletableToken)
  assert(deletionApply.status === 200, 'account with disposable personal data can apply')
  const deletionApplyBody = await deletionApply.json()
  assert(deletionApplyBody.data.graceMinutes === 10, 'eligible account receives a 10 minute cancellation window')
  const deletionRequest = await prisma.accountDeletionRequest.findUnique({ where: { userId: deletable.id } })
  await prisma.accountDeletionRequest.update({ where: { id: deletionRequest.id }, data: { scheduledAt: new Date(Date.now() - 1000) } })
  const processed = await processAccountDeletion(deletionFastify(), deletionRequest.id, { now: new Date() })
  assert(processed.status === 'COMPLETED', 'due deletion request completes')
  const deletedUser = await prisma.user.findUnique({ where: { id: deletable.id }, include: { profile: true } })
  assert(deletedUser.status === 'DELETED' && deletedUser.phone === null && deletedUser.passwordHash === null, 'login identifiers are erased')
  assert(deletedUser.profile.nickname === '已注销用户' && !deletedUser.profile.avatarUrl && !deletedUser.profile.email, 'profile is anonymized')
  assert(await prisma.userAddress.count({ where: { userId: deletable.id } }) === 0, 'address book is deleted')
  assert(await prisma.customProduct.count({ where: { userId: deletable.id } }) === 0, 'unsubmitted drafts are deleted')
  assert(await prisma.customizeOrder.count({ where: { id: completedOrder.id } }) === 1, 'completed transaction record is retained')
  const deletedAvatar = await prisma.privateFile.findUnique({ where: { id: avatar.id } })
  assert(deletedAvatar.status === 'DELETED' && deletedAvatar.ownerUserId === null, 'avatar content is deleted and ownership removed')
  const retainedOrderFile = await prisma.privateFile.findUnique({ where: { id: protectedFile.id } })
  assert(retainedOrderFile.status === 'READY' && retainedOrderFile.ownerUserId === null, 'order production file is retained without account ownership')

  const retryAvatar = await createAvatarFile(retryable, 'retry')
  assert((await applyDeletion(retryable, retryableToken)).status === 200, 'retry test account can apply')
  const retryRequest = await prisma.accountDeletionRequest.findUnique({ where: { userId: retryable.id } })
  await prisma.accountDeletionRequest.update({ where: { id: retryRequest.id }, data: { scheduledAt: new Date(Date.now() - 1000) } })
  const failed = await processAccountDeletion(deletionFastify(async () => { throw new Error('simulated delete failure') }), retryRequest.id, { now: new Date() })
  assert(failed.status === 'FAILED', 'storage deletion failure is recorded')
  const failedRequest = await prisma.accountDeletionRequest.findUnique({ where: { id: retryRequest.id } })
  assert(failedRequest.status === 'FAILED' && failedRequest.nextRetryAt && failedRequest.lastError, 'failed request keeps retry details')
  await prisma.accountDeletionRequest.update({ where: { id: retryRequest.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } })
  const retried = await processAccountDeletion(deletionFastify(), retryRequest.id, { now: new Date() })
  assert(retried.status === 'COMPLETED', 'failed deletion succeeds on retry')
  const retriedAvatar = await prisma.privateFile.findUnique({ where: { id: retryAvatar.id } })
  assert(retriedAvatar.status === 'DELETED', 'retried file deletion completes')

  await createAvatarFile(manualReview, 'manual-review')
  assert((await applyDeletion(manualReview, manualReviewToken)).status === 200, 'manual review test account can apply')
  const manualRequest = await prisma.accountDeletionRequest.findUnique({ where: { userId: manualReview.id } })
  await prisma.accountDeletionRequest.update({ where: { id: manualRequest.id }, data: { scheduledAt: new Date(Date.now() - 1000) } })
  const alwaysFails = deletionFastify(async () => { throw new Error('simulated repeated failure') })
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await processAccountDeletion(alwaysFails, manualRequest.id, { now: new Date() })
    if (attempt < 3) {
      assert(result.status === 'FAILED', `repeated failure ${attempt} remains in automatic retry`)
      await prisma.accountDeletionRequest.update({ where: { id: manualRequest.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } })
    } else {
      assert(result.status === 'MANUAL_REVIEW', 'third consecutive failure enters manual review')
    }
  }
  const manualTask = await prisma.accountDeletionRequest.findUnique({ where: { id: manualRequest.id } })
  assert(manualTask.status === 'MANUAL_REVIEW' && manualTask.manualReviewAt && !manualTask.nextRetryAt, 'manual review task stops automatic retries')
  assert((await pauseDeletion(manualTask.id, staffToken, 'after-cleanup')).status === 200, 'owner can pause a task after cleanup has started')
  const pausedAfterToken = await login(manualReview)
  const pausedAfterMe = await (await request('/api/v1/account/me', pausedAfterToken)).json()
  assert(pausedAfterMe.data.deletionRequest.canCancel === false, 'paused task cannot be cancelled after cleanup starts')
  assert(pausedAfterMe.data.deletionRequest.cleanupStarted === true, 'user status identifies that cleanup has started')
  assert((await request('/api/v1/account/deactivate/cancel', pausedAfterToken, { method: 'POST' })).status === 409, 'server rejects cancellation after cleanup starts')

  console.log('Account deletion checks passed')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
