// src/lib/security.js
// 安全服务：账号状态检查 + 会话熔断
// 设计规范 v6 — SecurityService

/**
 * 检查用户是否被封禁（包含：isBanned=true / status=SUSPENDED/DELETED / TokenBlacklist命中）
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

  // 检查 TokenBlacklist（改密/注销后15min黑名单）
  const blacklisted = await prisma.tokenBlacklist.findFirst({
    where: { userId, expiresAt: { gte: new Date() } }
  })
  return !!blacklisted
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
 * 会话熔断：撤销所有 RefreshToken + 写入 TokenBlacklist + 审计日志
 * 在改密/换手机/注销时调用
 * @param {string} userId
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} reason
 */
export async function revokeAllSessions(userId, prisma, reason = 'security_event') {
  const now = new Date()
  const blacklistExpiry = new Date(Date.now() + 15 * 60 * 1000) // 15min，让现有AccessToken也失效

  await prisma.$transaction([
    // 撤销所有未过期的 RefreshToken
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now }
    }),
    // 写入黑名单（使已发出的 AccessToken 在15min内也失效）
    prisma.tokenBlacklist.create({
      data: { userId, reason, expiresAt: blacklistExpiry }
    }),
    // 写审计日志
    prisma.auditLog.create({
      data: {
        userId,
        action: 'ALL_SESSIONS_REVOKED',
        detail: { reason }
      }
    })
  ], { timeout: 5000 })
}
