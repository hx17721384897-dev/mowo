// src/lib/security.js
// 安全服务：账号状态检查 + 设备会话撤销
// 设计规范 v6 — SecurityService

/**
 * 检查用户是否被封禁或已删除。
 * @param {string} userId
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function isUserBanned(userId, prisma) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBanned: true, status: true }
  })
  if (!user) return true // 用户不存在视为封禁
  if (user.isBanned || user.status === 'SUSPENDED' || user.status === 'DELETED') return true

  return false
}

/**
 * 检查用户是否处于限制状态（不能进行资金操作）
 * @param {string} userId
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function isUserLimited(userId, prisma) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true }
  })
  return user?.status === 'LIMITED'
}

/**
 * 撤销全部设备会话。每个 Access Token 都会检查对应 sessionId 是否仍有效，
 * 因此不需要使用用户级黑名单阻止用户重新登录。
 * @param {string} userId
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} reason
 */
export async function revokeAllSessions(userId, prisma, reason = 'security_event') {
  const now = new Date()

  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now }
    }),
    prisma.auditLog.create({
      data: {
        userId,
        action: 'ALL_SESSIONS_REVOKED',
        detail: { reason }
      }
    })
  ], { timeout: 5000 })
}

export async function revokeCurrentSession(userId, sessionId, prisma, reason = 'user_logout') {
  if (!sessionId) return revokeAllSessions(userId, prisma, reason)

  const now = new Date()
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId, sessionId, revokedAt: null },
      data: { revokedAt: now }
    }),
    prisma.auditLog.create({
      data: {
        userId,
        action: 'CURRENT_SESSION_REVOKED',
        detail: { reason }
      }
    })
  ], { timeout: 5000 })
}
