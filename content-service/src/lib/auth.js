// src/lib/auth.js
// 身份验证工具函数（v1升级：bcrypt cost=12 + 登录失败锁定）

import bcrypt from 'bcryptjs'

const BCRYPT_COST = 12          // 设计规范 v6 要求 cost=12
const OLD_BCRYPT_COST = 10      // 旧版本cost，登录成功后透明升级

const MAX_FAIL_COUNT  = 5       // 最多失败次数
const LOCK_DURATION_MS = 30 * 60 * 1000 // 锁定30分钟

// ── 密码哈希（新注册使用 cost=12）──
export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST)
}

// ── 验证密码，并在登录成功后透明升级旧哈希 ──
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

/**
 * 透明升级哈希（仅在密码验证成功后调用）
 * 若存储的哈希 cost < 12，自动重新哈希并更新 DB
 */
export async function maybeUpgradeHash(prisma, userId, password, currentHash) {
  try {
    const rounds = bcrypt.getRounds(currentHash)
    if (rounds < BCRYPT_COST) {
      const newHash = await hashPassword(password)
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash }
      })
    }
  } catch (_) {
    // 升级失败不阻断登录流程
  }
}

// ── 生成旧版JWT token（7天，保留向后兼容）──
export function signToken(fastify, user) {
  return fastify.jwt.sign(
    {
      userId:        user.id,
      phone:         user.phone,
      certifyStatus: user.certifyStatus,
      role:          user.role ?? 0
    },
    { expiresIn: '7d' }
  )
}

// ── 登录失败锁定 ──

/**
 * 检查用户是否被登录锁定
 * @returns {{ locked: boolean, remainingMs: number }}
 */
export async function checkLoginLock(prisma, userId) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { loginLockedUntil: true, loginFailCount: true }
  })
  if (!profile) return { locked: false, remainingMs: 0 }
  if (profile.loginLockedUntil && profile.loginLockedUntil > new Date()) {
    return {
      locked: true,
      remainingMs: profile.loginLockedUntil.getTime() - Date.now()
    }
  }
  return { locked: false, remainingMs: 0 }
}

/**
 * 记录一次登录失败，若累计 >= MAX_FAIL_COUNT 则锁定账号30分钟
 */
export async function recordLoginFail(prisma, userId) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { loginFailCount: true }
  })
  if (!profile) return

  const newCount = (profile.loginFailCount || 0) + 1
  const data = { loginFailCount: newCount }

  if (newCount >= MAX_FAIL_COUNT) {
    data.loginLockedUntil = new Date(Date.now() + LOCK_DURATION_MS)
  }

  await prisma.userProfile.update({ where: { userId }, data })
}

/**
 * 登录成功后清零失败计数
 */
export async function resetLoginFail(prisma, userId) {
  await prisma.userProfile.update({
    where: { userId },
    data: { loginFailCount: 0, loginLockedUntil: null }
  }).catch(() => {}) // profile可能不存在，忽略
}
