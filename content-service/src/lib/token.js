// src/lib/token.js
// 双Token生成：AccessToken（15min）+ RefreshToken（30天 HttpOnly Cookie）
// 设计规范 v6 — generateTokenResponse

import crypto from 'crypto'
import { effectiveStaffRole } from './permissions.js'

const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRE_DAYS = 30

/**
 * 生成双Token并设置Cookie，返回响应
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} user - 含 id, phone, certifyStatus, role, profile
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
export async function generateTokenResponse(fastify, prisma, user, req, reply, options = {}) {
  const sessionId = options.sessionId || crypto.randomUUID()
  // 1. 签发 AccessToken（15分钟，保留原有 payload 字段保证向后兼容）
  const accessToken = fastify.jwt.sign(
    {
      userId:        user.id,
      phone:         user.phone,
      certifyStatus: user.certifyStatus ?? 0,
      role:          user.role ?? 0,
      staffRole:     effectiveStaffRole(user),
      sid:           sessionId,
      sub:           user.id  // 设计规范 sub 字段
    },
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  )

  // 2. 生成 RefreshToken（原始值→Cookie，SHA256哈希→DB）
  const rawRefresh  = crypto.randomBytes(32).toString('hex')
  const refreshHash = crypto.createHash('sha256').update(rawRefresh).digest('hex')
  const expiresAt   = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshHash, sessionId, expiresAt }
  })

  // 3. 更新最后登录信息
  try {
    await prisma.userProfile.update({
      where: { userId: user.id },
      data: {
        lastLoginIp: req.ip || null,
        lastLoginAt: new Date()
      }
    })
  } catch (_) {
    // profile 可能尚未创建，不影响主流程
  }

  // 4. 设置 HttpOnly Cookie（开发模式允许 http）
  // ⚠️ 本地开发要求前端和后端都用 localhost（不能混用 127.0.0.1），
  //    否则浏览器视为不同 origin，Cookie 无法随 fetch credentials:'include' 传递。
  //    前端：http://localhost:5500，后端：http://localhost:3001
  const isProd = fastify.config.isProduction
  reply.setCookie('refresh_token', rawRefresh, {
    httpOnly: true,
    secure:   isProd,           // 生产必须 https；本地 http 时设 false
    sameSite: isProd ? 'strict' : 'lax',
    path:     '/',
    maxAge:   REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
  })

  // 5. 返回响应（同时返回 token 字段保证前端旧代码向后兼容）
  return reply.send({
    success: true,
    data: {
      token:       accessToken, // 向后兼容
      accessToken,
      user: {
        id:           user.id,
        phone:        user.phone,
        certifyStatus: user.certifyStatus ?? 0,
        role:         user.role ?? 0,
        staffRole:    effectiveStaffRole(user),
        nickname:     user.profile?.nickname || null,
        avatarUrl:    user.profile?.avatarUrl || null
      }
    }
  })
}
