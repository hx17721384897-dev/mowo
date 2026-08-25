import { FILE_PURPOSE } from './private-files.js'
import { Prisma } from '@prisma/client'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

async function deleteCandidates(fastify, candidates, now, label, requireUnlinked = false) {
  const result = { selected: candidates.length, deleted: 0, failed: 0, skipped: 0 }
  for (const file of candidates) {
    const ownershipGuard = requireUnlinked
      ? { linkedResourceType: null, linkedResourceId: null }
      : { linkedResourceType: file.linkedResourceType, linkedResourceId: file.linkedResourceId }
    const claimed = await fastify.prisma.privateFile.updateMany({
      where: {
        id: file.id,
        status: file.status,
        updatedAt: file.updatedAt,
        deletedAt: null,
        ...ownershipGuard
      },
      data: { status: 'DELETING' }
    })

    if (claimed.count !== 1) {
      result.skipped += 1
      continue
    }

    try {
      await fastify.storageDelete(file.objectKey)
      await fastify.prisma.privateFile.updateMany({
        where: { id: file.id, status: 'DELETING', ...ownershipGuard },
        data: {
          status: 'DELETED',
          deletedAt: now,
          uploadTokenHash: null,
          uploadExpiresAt: null
        }
      })
      result.deleted += 1
    } catch (error) {
      await fastify.prisma.privateFile.updateMany({
        where: { id: file.id, status: 'DELETING' },
        data: { status: 'DELETE_FAILED' }
      })
      result.failed += 1
      fastify.log?.warn(`[private-file-cleanup] ${label}清理失败 ${file.id}: ${error.message}`)
    }
  }
  return result
}

export async function cleanupAbandonedAvatars(fastify, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const retentionHours = options.retentionHours ?? fastify.config?.privateFileCleanup?.avatarRetentionHours ?? 24
  const retryMinutes = options.retryMinutes ?? 15
  const batchSize = options.batchSize ?? fastify.config?.privateFileCleanup?.batchSize ?? 100
  const abandonedBefore = new Date(now.getTime() - retentionHours * HOUR_MS)
  const retryBefore = new Date(now.getTime() - retryMinutes * MINUTE_MS)
  const candidateIds = Array.isArray(options.candidateIds) ? options.candidateIds : null

  const candidates = await fastify.prisma.privateFile.findMany({
    where: {
      purpose: FILE_PURPOSE.AVATAR,
      linkedResourceType: null,
      linkedResourceId: null,
      deletedAt: null,
      ...(candidateIds ? { id: { in: candidateIds } } : {}),
      OR: [
        { status: { in: ['PENDING', 'READY', 'REJECTED'] }, updatedAt: { lte: abandonedBefore } },
        { status: { in: ['DELETING', 'DELETE_FAILED'] }, updatedAt: { lte: retryBefore } }
      ]
    },
    select: { id: true, objectKey: true, status: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: batchSize
  })

  return deleteCandidates(fastify, candidates, now, '头像文件', true)
}

// 上传完成但未绑定业务记录的定制素材属于中断上传，默认保留 24 小时后删除。
export async function cleanupAbandonedCustomizationFiles(fastify, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const retentionHours = options.retentionHours ?? 24
  const retryMinutes = options.retryMinutes ?? 15
  const batchSize = options.batchSize ?? fastify.config?.privateFileCleanup?.batchSize ?? 100
  const abandonedBefore = new Date(now.getTime() - retentionHours * HOUR_MS)
  const retryBefore = new Date(now.getTime() - retryMinutes * MINUTE_MS)
  const candidates = await fastify.prisma.privateFile.findMany({
    where: {
      purpose: { in: [
        FILE_PURPOSE.CUSTOMIZATION_SOURCE,
        FILE_PURPOSE.CUSTOMIZATION_FRAME,
        FILE_PURPOSE.LIBRARY_SOURCE,
        FILE_PURPOSE.LIBRARY_FRAME
      ] },
      linkedResourceType: null,
      linkedResourceId: null,
      deletedAt: null,
      OR: [
        { status: { in: ['PENDING', 'READY', 'REJECTED'] }, updatedAt: { lte: abandonedBefore } },
        { status: { in: ['DELETING', 'DELETE_FAILED'] }, updatedAt: { lte: retryBefore } }
      ]
    },
    select: {
      id: true, objectKey: true, status: true, updatedAt: true,
      linkedResourceType: true, linkedResourceId: true
    },
    orderBy: { updatedAt: 'asc' },
    take: batchSize
  })
  return deleteCandidates(fastify, candidates, now, '中断上传的定制素材', true)
}

// 云端草稿保留 7 天。到期后保留一条“已过期”记录用于解释，但删除原素材和帧图。
export async function cleanupExpiredCustomizationDrafts(fastify, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const retentionDays = options.retentionDays ?? 7
  const retryMinutes = options.retryMinutes ?? 15
  const batchSize = options.batchSize ?? fastify.config?.privateFileCleanup?.batchSize ?? 100
  const expiredBefore = new Date(now.getTime() - retentionDays * DAY_MS)
  const retryBefore = new Date(now.getTime() - retryMinutes * MINUTE_MS)
  const drafts = await fastify.prisma.customizationRequest.findMany({
    where: {
      OR: [
        { status: 'DRAFT', updatedAt: { lte: expiredBefore } },
        { status: 'EXPIRING', updatedAt: { lte: retryBefore } }
      ]
    },
    orderBy: { updatedAt: 'asc' },
    take: batchSize
  })
  const result = { selected: drafts.length, expired: 0, filesDeleted: 0, failed: 0, skipped: 0 }

  for (const draft of drafts) {
    // 先抢占草稿，防止用户提交与定时清理同时发生时误删刚提交的素材。
    const claimed = await fastify.prisma.customizationRequest.updateMany({
      where: { id: draft.id, status: draft.status, updatedAt: draft.updatedAt },
      data: { status: 'EXPIRING' }
    })
    if (claimed.count !== 1) {
      result.skipped += 1
      continue
    }
    const keys = [...new Set([
      ...(Array.isArray(draft.sourceKeys) ? draft.sourceKeys : []),
      ...(Array.isArray(draft.selectedFrameKeys) ? draft.selectedFrameKeys : [])
    ])]
    const files = keys.length ? await fastify.prisma.privateFile.findMany({
      where: {
        objectKey: { in: keys },
        ownerUserId: draft.userId,
        deletedAt: null,
        OR: [
          { linkedResourceType: 'CUSTOMIZATION_REQUEST', linkedResourceId: draft.id },
          ...(draft.customProductId
            ? [{ linkedResourceType: 'CUSTOM_PRODUCT', linkedResourceId: draft.customProductId }]
            : [])
        ]
      },
      select: {
        id: true, objectKey: true, status: true, updatedAt: true,
        linkedResourceType: true, linkedResourceId: true
      }
    }) : []
    const deletion = await deleteCandidates(fastify, files, now, '过期定制草稿素材')
    result.filesDeleted += deletion.deleted
    result.failed += deletion.failed
    result.skipped += deletion.skipped
    if (deletion.failed > 0) continue

    await fastify.prisma.$transaction(async tx => {
      if (draft.customProductId) {
        const hasCartItem = await tx.cartItem.count({ where: { customProductId: draft.customProductId } })
        if (!hasCartItem) {
          await tx.customProduct.deleteMany({
            where: { id: draft.customProductId, userId: draft.userId, status: { not: 'ordered' } }
          })
        }
      }
      const updated = await tx.customizationRequest.updateMany({
        where: { id: draft.id, status: 'EXPIRING' },
        data: {
          status: 'CLOSED', customProductId: null, sourceKeys: [], selectedFrameKeys: [],
          screeningData: Prisma.JsonNull, editorData: Prisma.JsonNull, userNote: null
        }
      })
      if (updated.count === 1) {
        await tx.customizationRequestEvent.create({ data: {
          requestId: draft.id, actorType: 'SYSTEM', eventType: 'DRAFT_EXPIRED',
          fromStatus: 'DRAFT', toStatus: 'CLOSED', publicMessage: '草稿超过 7 天未提交，素材已自动清理'
        } })
      }
    })
    result.expired += 1
  }
  return result
}
