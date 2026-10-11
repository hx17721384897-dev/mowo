import { PrismaClient } from '@prisma/client'

import { requireIsolatedTestDatabase } from './test-db-guard.mjs'

requireIsolatedTestDatabase()

const prisma = new PrismaClient()
const recentSince = new Date(Date.now() - 2 * 60 * 60 * 1000)

try {
  const [
    shellProfiles,
    settingsProfiles,
    privateFileProfiles,
    collabProfiles,
    collabWorks,
    collabModels,
    fixedContacts,
    recentLogs
  ] = await Promise.all([
    prisma.userProfile.count({ where: { nickname: { startsWith: 'shell-' } } }),
    prisma.userProfile.count({ where: { nickname: { startsWith: 'settings-' } } }),
    prisma.userProfile.count({ where: { nickname: { startsWith: 'file-test-' } } }),
    prisma.userProfile.count({ where: { nickname: { startsWith: '联名商城验收-' } } }),
    prisma.collabWork.count({ where: { title: { startsWith: '联名商城验收-' } } }),
    prisma.machineModel.count({ where: { name: { startsWith: '联名商城验收款-' } } }),
    prisma.contactSubmission.count({
      where: {
        type: 'join',
        contact: 'test@example.com',
        message: 'Private file security test submission'
      }
    }),
    prisma.operationLog.findMany({
      where: { createdAt: { gte: recentSince } },
      select: { userId: true, path: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    })
  ])

  const fixtureCounts = {
    shellProfiles,
    settingsProfiles,
    privateFileProfiles,
    collabProfiles,
    collabWorks,
    collabModels,
    fixedContacts
  }
  const fixtureResidue = Object.values(fixtureCounts).reduce((sum, count) => sum + count, 0)

  const userIds = [...new Set(recentLogs.map((log) => log.userId))]
  const existingUsers = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })
    : []
  const existingIds = new Set(existingUsers.map((user) => user.id))
  const orphanGroups = new Map()
  for (const log of recentLogs) {
    if (existingIds.has(log.userId)) continue
    const group = orphanGroups.get(log.userId) || { count: 0, paths: new Set(), latestAt: log.createdAt }
    group.count += 1
    group.paths.add(log.path)
    orphanGroups.set(log.userId, group)
  }

  console.log(JSON.stringify({
    database: 'mowo_b1_test',
    fixtureCounts,
    fixtureResidue,
    recentOrphanOperationLogGroups: [...orphanGroups.values()].map((group) => ({
      count: group.count,
      paths: [...group.paths].sort(),
      latestAt: group.latestAt.toISOString()
    }))
  }, null, 2))

  if (fixtureResidue !== 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
