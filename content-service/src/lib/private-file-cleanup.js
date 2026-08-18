import { FILE_PURPOSE } from './private-files.js'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

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

  const result = { selected: candidates.length, deleted: 0, failed: 0, skipped: 0 }
  for (const file of candidates) {
    const claimed = await fastify.prisma.privateFile.updateMany({
      where: {
        id: file.id,
        status: file.status,
        updatedAt: file.updatedAt,
        linkedResourceType: null,
        linkedResourceId: null,
        deletedAt: null
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
        where: {
          id: file.id,
          status: 'DELETING',
          linkedResourceType: null,
          linkedResourceId: null
        },
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
      fastify.log?.warn(`[private-file-cleanup] 头像文件清理失败 ${file.id}: ${error.message}`)
    }
  }

  return result
}
