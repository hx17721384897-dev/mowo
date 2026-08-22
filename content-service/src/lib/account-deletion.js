import { Prisma } from '@prisma/client'

const ACTIVE_ORDER_STATUSES = ['pending', 'paid', 'locked', 'processing', 'producing', 'shipped', 'aftersale']
const OPEN_AFTERSALE_STATUSES = ['pending', 'approved']
const OPEN_WITHDRAWAL_STATUSES = ['pending', 'processing', 'failed']
const OPEN_SETTLEMENT_STATUSES = ['pending', 'failed']
const OPEN_REVENUE_STATUSES = ['estimated', 'cooling', 'available']
const ACTIVE_CUSTOMIZATION_STATUSES = ['SUBMITTED', 'REVIEWING', 'NEEDS_SUPPLEMENT', 'OPTIONS_READY', 'FRAME_ACCEPTED', 'STYLE_SELECTED', 'CONFIRMED']
const PROTECTED_FILE_LINKS = new Set(['AFTERSALE_REQUEST', 'CUSTOMIZE_ORDER', 'CONTRACT', 'FRAME_PACK'])

function blocker(code, message, count = 1) {
  return { code, message, count }
}

export async function getAccountDeletionBlockers(prisma, userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, role: true, staffRole: true }
  })
  if (!user) return [blocker('ACCOUNT_NOT_FOUND', '账号不存在')]

  const [
    activeOrders,
    openAftersales,
    pendingPreOrders,
    pendingCertification,
    openContacts,
    activeCollabWorks,
    unsettledCollabOrders,
    unsettledEarnings,
    balance,
    openWithdrawals,
    reserve,
    openSettlements,
    activeContracts,
    openReports,
    activeCustomizationRequests
  ] = await Promise.all([
    prisma.customizeOrder.count({ where: { userId, status: { in: ACTIVE_ORDER_STATUSES } } }),
    prisma.aftersaleRequest.count({ where: { userId, status: { in: OPEN_AFTERSALE_STATUSES } } }),
    prisma.preOrder.count({ where: { userId, status: 'pending_payment' } }),
    prisma.certifyApplication.count({ where: { userId, status: 'pending' } }),
    prisma.contactSubmission.count({ where: { submitterUserId: userId, status: { in: ['pending', 'processing'] } } }),
    prisma.collabWork.count({ where: {
      creatorId: userId,
      OR: [
        { status: 'pending' },
        { isOnShelf: true },
        { shelfStatus: 'pending_delist' }
      ]
    } }),
    prisma.collabOrder.count({ where: {
      creatorId: userId,
      OR: [
        { revenueStatus: { in: OPEN_REVENUE_STATUSES } },
        { settlementStatus: { in: OPEN_SETTLEMENT_STATUSES } }
      ]
    } }),
    prisma.earning.count({ where: { creatorId: userId, status: { in: ['pending', 'available'] } } }),
    prisma.balance.findUnique({ where: { creatorId: userId } }),
    prisma.withdrawalRequest.count({ where: { creatorId: userId, status: { in: OPEN_WITHDRAWAL_STATUSES } } }),
    prisma.creatorReserve.findUnique({ where: { creatorId: userId } }),
    prisma.settlementRecord.count({ where: { creatorId: userId, status: { in: OPEN_SETTLEMENT_STATUSES } } }),
    prisma.creatorContract.count({ where: { creatorId: userId, status: 'active' } }),
    prisma.report.count({ where: {
      status: 'pending',
      OR: [
        { reporterId: userId },
        { targetType: 'user', targetId: userId }
      ]
    } }),
    prisma.customizationRequest.count({ where: { userId, status: { in: ACTIVE_CUSTOMIZATION_STATUSES } } })
  ])

  const blockers = []
  // 创作者身份由 certifyStatus 表示；role>0 是旧后台权限等级，也必须先完成工作交接。
  if (user.staffRole || user.role > 0) blockers.push(blocker('STAFF_ACCOUNT', '工作人员账号不能自助注销，请先由负责人完成权限和职责移交'))
  if (!['ACTIVE', 'PENDING_DELETE'].includes(user.status)) blockers.push(blocker('ACCOUNT_STATUS', '当前账号状态不允许申请注销'))
  if (activeOrders) blockers.push(blocker('ACTIVE_ORDERS', `有 ${activeOrders} 个未完结订单，请完成收货、取消或售后处理后再申请`, activeOrders))
  if (openAftersales) blockers.push(blocker('OPEN_AFTERSALES', `有 ${openAftersales} 个售后仍在处理中`, openAftersales))
  if (pendingPreOrders) blockers.push(blocker('PENDING_PREORDERS', `有 ${pendingPreOrders} 个待付款订单，请先取消或等待失效`, pendingPreOrders))
  if (pendingCertification) blockers.push(blocker('PENDING_CERTIFICATION', '创作者认证正在审核，请先联系工作人员结束申请'))
  if (openContacts) blockers.push(blocker('OPEN_CONTACTS', `有 ${openContacts} 条联络或合作申请仍在处理中`, openContacts))
  if (activeCollabWorks) blockers.push(blocker('ACTIVE_COLLAB_WORKS', `有 ${activeCollabWorks} 个联名作品仍在审核、销售或下架处理中`, activeCollabWorks))
  if (unsettledCollabOrders || unsettledEarnings) blockers.push(blocker('UNSETTLED_REVENUE', '仍有联名订单收益尚未结清'))
  if (balance && [balance.pendingAmount, balance.availableAmount].some(value => Number(value) !== 0)) blockers.push(blocker('ACCOUNT_BALANCE', '创作者账户仍有待结算或可提现余额'))
  if (openWithdrawals) blockers.push(blocker('OPEN_WITHDRAWALS', `有 ${openWithdrawals} 笔提现尚未完成`, openWithdrawals))
  if (reserve && [reserve.frozenAmount, reserve.releasableAmount].some(value => Number(value) !== 0)) blockers.push(blocker('CREATOR_RESERVE', '仍有冻结或待释放的创作者储备金'))
  if (openSettlements) blockers.push(blocker('OPEN_SETTLEMENTS', `有 ${openSettlements} 笔结算尚未完成`, openSettlements))
  if (activeContracts) blockers.push(blocker('ACTIVE_CONTRACTS', `有 ${activeContracts} 份生效中的合作合同`, activeContracts))
  if (openReports) blockers.push(blocker('OPEN_DISPUTES', `有 ${openReports} 个投诉或举报尚未处理`, openReports))
  if (activeCustomizationRequests) blockers.push(blocker(
    'ACTIVE_CUSTOMIZATION_REQUESTS',
    `有 ${activeCustomizationRequests} 个定制申请仍在处理中，请先结束申请再注销`,
    activeCustomizationRequests
  ))
  return blockers
}

async function filesToDelete(prisma, userId) {
  const files = await prisma.privateFile.findMany({
    where: { ownerUserId: userId, status: { not: 'DELETED' } }
  })
  const customProductIds = [...new Set(files
    .filter(file => file.linkedResourceType === 'CUSTOM_PRODUCT' && file.linkedResourceId)
    .map(file => file.linkedResourceId))]
  const orderedProducts = customProductIds.length
    ? await prisma.customProduct.findMany({ where: { id: { in: customProductIds }, status: 'ordered' }, select: { id: true } })
    : []
  const orderedIds = new Set(orderedProducts.map(item => item.id))

  return files.filter(file => {
    if (PROTECTED_FILE_LINKS.has(file.linkedResourceType)) return false
    if (file.linkedResourceType === 'CUSTOM_PRODUCT' && orderedIds.has(file.linkedResourceId)) return false
    return true
  })
}

async function deleteAccountFiles(fastify, userId, now) {
  const files = await filesToDelete(fastify.prisma, userId)
  for (const file of files) {
    const claimed = await fastify.prisma.privateFile.updateMany({
      where: { id: file.id, ownerUserId: userId, status: file.status },
      data: { status: 'DELETING' }
    })
    if (claimed.count !== 1) continue
    try {
      await fastify.storageDelete(file.objectKey)
      await fastify.prisma.privateFile.update({
        where: { id: file.id },
        data: {
          status: 'DELETED', deletedAt: now, ownerUserId: null,
          anonymousOwnerHash: null, uploadTokenHash: null, uploadExpiresAt: null
        }
      })
    } catch (error) {
      await fastify.prisma.privateFile.updateMany({
        where: { id: file.id, status: 'DELETING' },
        data: { status: 'DELETE_FAILED' }
      })
      throw new Error(`文件 ${file.id} 删除失败：${error.message}`)
    }
  }
}

async function anonymizeAccountData(prisma, userId, requestId, now) {
  const [user, cart, disposableProducts, ownArticles] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    prisma.cart.findUnique({ where: { userId }, select: { id: true } }),
    prisma.customProduct.findMany({ where: { userId, status: { not: 'ordered' } }, select: { id: true } }),
    prisma.article.findMany({ where: { userId }, select: { id: true } })
  ])
  const disposableProductIds = disposableProducts.map(item => item.id)
  const articleIds = ownArticles.map(item => item.id)

  await prisma.$transaction(async tx => {
    if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } })
    await tx.cart.deleteMany({ where: { userId } })
    // 已成交预订单是正式销售订单的支付凭证，只清理未形成正式订单的记录。
    await tx.preOrder.deleteMany({ where: { userId, salesOrder: { is: null } } })
    if (disposableProductIds.length) await tx.customProduct.deleteMany({ where: { id: { in: disposableProductIds } } })
    await tx.userAddress.deleteMany({ where: { userId } })

    if (articleIds.length) {
      await tx.like.deleteMany({ where: { targetType: 'article', targetId: { in: articleIds } } })
      await tx.comment.deleteMany({ where: { articleId: { in: articleIds } } })
      await tx.collect.deleteMany({ where: { articleId: { in: articleIds } } })
      await tx.articleProduct.deleteMany({ where: { articleId: { in: articleIds } } })
      await tx.article.deleteMany({ where: { id: { in: articleIds } } })
    }
    await tx.comment.updateMany({ where: { userId }, data: { content: '[已删除]', status: 'deleted', replyToUserId: null } })
    await tx.like.deleteMany({ where: { userId } })
    await tx.collect.deleteMany({ where: { userId } })
    await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } })

    await tx.product.updateMany({ where: { userId, status: { in: ['draft', 'pending', 'rejected'] } }, data: { status: 'removed' } })
    await tx.animation.updateMany({ where: { userId, status: { in: ['draft', 'pending', 'rejected'] } }, data: { status: 'removed' } })

    await tx.contactSubmission.updateMany({
      where: { submitterUserId: userId },
      data: {
        name: '已注销用户', contact: '已删除', message: '[个人资料已删除]', extra: null,
        attachments: null, submitterUserId: null, ip: null, userAgent: null
      }
    })
    await tx.certifyApplication.updateMany({
      where: { userId },
      data: { creatorName: '已注销创作者', realName: '已删除', idNumberLast4: '****', portfolioUrls: null, rejectReason: null }
    })
    await tx.creatorSocialLink.deleteMany({ where: { creatorId: userId } })
    await tx.creatorReferralLink.updateMany({ where: { creatorId: userId }, data: { isActive: false } })
    await tx.referralClick.updateMany({ where: { creatorId: userId }, data: { ip: null, userAgent: null, referrer: null } })
    await tx.creatorNotification.deleteMany({ where: { userId } })
    await tx.customizationRequestEvent.updateMany({
      where: { request: { userId } },
      data: { internalNote: null, detail: Prisma.JsonNull }
    })
    await tx.customizationRequest.updateMany({
      where: { userId },
      data: {
        customProductId: null, sourceKeys: [], selectedFrameKeys: [], screeningData: Prisma.JsonNull,
        editorData: Prisma.JsonNull, userNote: null, creatorDeclared: false,
        copyrightConfirmed: false, cooperationInterested: false
      }
    })
    await tx.actionToken.deleteMany({ where: { userId } })
    await tx.refreshToken.deleteMany({ where: { userId } })
    await tx.smsCode.deleteMany({ where: { OR: [{ userId }, ...(user?.phone ? [{ phone: user.phone }] : [])] } })
    await tx.creditLog.deleteMany({ where: { userId } })
    await tx.creditScore.deleteMany({ where: { userId } })
    await tx.creatorProfile.updateMany({
      where: { userId },
      data: { styleTags: null, weiboUrl: null, xiaohongshuUrl: null, bilibiliUrl: null, isExclusive: false, exclusiveSignedAt: null, exclusiveExpiredAt: null }
    })
    await tx.userProfile.updateMany({
      where: { userId },
      data: {
        nickname: '已注销用户', avatarUrl: null, bio: null, gender: 0, birthday: null,
        city: null, mbti: null, email: null, notifyInteraction: false, notifyOrder: false,
        notifySystem: false, notifyPromo: false, profileVisibility: 'private', loginFailCount: 0,
        loginLockedUntil: null, lastLoginIp: null, lastLoginAt: null, nicknameUpdatedAt: null
      }
    })
    await tx.privateFile.updateMany({
      where: { ownerUserId: userId },
      data: { ownerUserId: null, anonymousOwnerHash: null }
    })
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED', phone: null, passwordHash: null, wechatOpenid: null, wechatUnionid: null,
        certifyStatus: 0, isBanned: false, role: 0, staffRole: null, lastLoginAt: null,
        deletedAt: now, deleteReason: null
      }
    })
    await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', completedAt: now, nextRetryAt: null, lastError: null, blockers: [] }
    })
    await tx.auditLog.create({
      data: { userId, action: 'ACCOUNT_DELETION_COMPLETED', detail: { requestId, completedAt: now.toISOString() } }
    })
  }, { timeout: 30000 })
}

export async function processAccountDeletion(fastify, requestId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const request = await fastify.prisma.accountDeletionRequest.findUnique({ where: { id: requestId } })
  if (!request || !['REQUESTED', 'FAILED'].includes(request.status)) return { status: 'SKIPPED' }
  const dueAt = request.status === 'FAILED' ? request.nextRetryAt : request.scheduledAt
  if (!dueAt || dueAt > now) return { status: 'NOT_DUE' }

  const claimed = await fastify.prisma.accountDeletionRequest.updateMany({
    where: { id: request.id, status: request.status, updatedAt: request.updatedAt },
    data: { status: 'PROCESSING', processingStartedAt: now, attemptCount: { increment: 1 }, lastError: null }
  })
  if (claimed.count !== 1) return { status: 'SKIPPED' }

  try {
    const blockers = await getAccountDeletionBlockers(fastify.prisma, request.userId)
    if (blockers.length) {
      await fastify.prisma.$transaction([
        fastify.prisma.accountDeletionRequest.update({
          where: { id: request.id },
          data: { status: 'BLOCKED', blockers, nextRetryAt: null, lastError: null }
        }),
        fastify.prisma.user.update({
          where: { id: request.userId },
          data: { status: 'ACTIVE', deletedAt: null, deleteReason: null }
        }),
        fastify.prisma.auditLog.create({
          data: { userId: request.userId, action: 'ACCOUNT_DELETION_BLOCKED', detail: { requestId: request.id, blockers } }
        })
      ])
      return { status: 'BLOCKED', blockers }
    }

    await deleteAccountFiles(fastify, request.userId, now)
    await anonymizeAccountData(fastify.prisma, request.userId, request.id, now)
    return { status: 'COMPLETED' }
  } catch (error) {
    const retryMinutes = fastify.config.accountDeletion.retryMinutes ?? 15
    const manualAfterAttempts = fastify.config.accountDeletion.manualAfterAttempts ?? 3
    const manualAfterMinutes = fastify.config.accountDeletion.manualAfterMinutes ?? 60
    const firstFailedAt = request.firstFailedAt || now
    const attemptCount = request.attemptCount + 1
    const failureMinutes = (now.getTime() - firstFailedAt.getTime()) / 60000
    const needsManualReview =
      attemptCount >= manualAfterAttempts ||
      failureMinutes >= manualAfterMinutes
    const retryAt = needsManualReview
      ? null
      : new Date(now.getTime() + retryMinutes * 60 * 1000)
    const failureData = {
      status: needsManualReview ? 'MANUAL_REVIEW' : 'FAILED',
      nextRetryAt: retryAt,
      firstFailedAt,
      manualReviewAt: needsManualReview ? now : null,
      lastError: String(error.message || error).slice(0, 1000)
    }
    await fastify.prisma.$transaction(async tx => {
      await tx.accountDeletionRequest.updateMany({
        where: { id: request.id, status: 'PROCESSING' },
        data: failureData
      })
      if (needsManualReview) {
        await tx.auditLog.create({
          data: {
            userId: request.userId,
            action: 'ACCOUNT_DELETION_MANUAL_REVIEW',
            detail: { requestId: request.id, attemptCount, firstFailedAt: firstFailedAt.toISOString() }
          }
        })
      }
    })
    fastify.log?.error(`[account-deletion] 注销处理失败 ${request.id}: ${error.message}`)
    return { status: failureData.status, retryAt, error }
  }
}

export async function processDueAccountDeletions(fastify, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const batchSize = options.batchSize ?? fastify.config.accountDeletion.batchSize
  const manualAfterMinutes = fastify.config.accountDeletion.manualAfterMinutes ?? 60
  const manualCutoff = new Date(now.getTime() - manualAfterMinutes * 60 * 1000)
  const staleFailures = await fastify.prisma.accountDeletionRequest.findMany({
    where: { status: 'FAILED', firstFailedAt: { lte: manualCutoff } },
    select: { id: true, userId: true, attemptCount: true, firstFailedAt: true }
  })
  for (const stale of staleFailures) {
    const promoted = await fastify.prisma.accountDeletionRequest.updateMany({
      where: { id: stale.id, status: 'FAILED' },
      data: { status: 'MANUAL_REVIEW', manualReviewAt: now, nextRetryAt: null }
    })
    if (promoted.count === 1) {
      await fastify.prisma.auditLog.create({
        data: {
          userId: stale.userId,
          action: 'ACCOUNT_DELETION_MANUAL_REVIEW',
          detail: {
            requestId: stale.id,
            attemptCount: stale.attemptCount,
            reason: 'FAILED_OVER_TIME',
            firstFailedAt: stale.firstFailedAt?.toISOString()
          }
        }
      })
    }
  }
  const requests = await fastify.prisma.accountDeletionRequest.findMany({
    where: {
      OR: [
        { status: 'REQUESTED', scheduledAt: { lte: now } },
        { status: 'FAILED', nextRetryAt: { lte: now } }
      ]
    },
    select: { id: true },
    orderBy: { scheduledAt: 'asc' },
    take: batchSize
  })
  const results = []
  for (const request of requests) results.push(await processAccountDeletion(fastify, request.id, { now }))
  return results
}
