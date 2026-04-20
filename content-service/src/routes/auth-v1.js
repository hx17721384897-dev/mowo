// src/routes/auth-v1.js
// v1 账户系统路由：SMS登录/注册、密码登录（含锁定）、Token刷新、登出、账号注销
// 前缀：/api/v1/auth/* 和 /api/v1/user/*

import crypto from 'crypto'
import { sendSmsCode, verifySmsCode } from '../lib/sms.js'
import { generateTokenResponse } from '../lib/token.js'
import { hashPassword, verifyPassword, maybeUpgradeHash, checkLoginLock, recordLoginFail, resetLoginFail } from '../lib/auth.js'
import { isUserBanned, revokeAllSessions } from '../lib/security.js'

const CURRENT_PRIVACY_VERSION = process.env.CURRENT_PRIVACY_VERSION || '2025-01'

// ─── 注册认证路由（prefix: /api/v1/auth）───
export async function authV1Routes(fastify) {

  // ────────────────────────────────────────────
  // POST /api/v1/auth/sms/send — 发送短信验证码
  // ────────────────────────────────────────────
  fastify.post('/sms/send', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'purpose'],
        properties: {
          phone:   { type: 'string', minLength: 11, maxLength: 11 },
          purpose: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { phone, purpose } = req.body

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return reply.code(400).send({ success: false, message: '手机号格式不正确' })
    }

    const validPurposes = ['LOGIN', 'REGISTER', 'RESET_PASSWORD', 'BIND_PHONE', 'DEACTIVATE',
      'STEP_UP_WITHDRAW', 'STEP_UP_CHANGE_PAYOUT', 'STEP_UP_CHANGE_PASSWORD']
    if (!validPurposes.includes(purpose)) {
      return reply.code(400).send({ success: false, message: '无效的短信用途' })
    }

    try {
      const result = await sendSmsCode(fastify.prisma, phone, purpose)
      const resp = { success: true, message: '验证码已发送' }
      // 开发Mock模式：在响应中返回验证码（生产环境不暴露）
      if (result.mock) resp._devCode = result.code
      return reply.send(resp)
    } catch (err) {
      const codeMap = {
        SMS_QUOTA_EXCEEDED: [429, '今日短信发送已达上限，请明日再试'],
        SMS_TOO_FREQUENT:   [429, '发送太频繁，请60秒后重试']
      }
      const [status, message] = codeMap[err.code] || [500, '短信发送失败，请稍后重试']
      return reply.code(status).send({ success: false, message, code: err.code })
    }
  })

  // ────────────────────────────────────────────
  // POST /api/v1/auth/sms/verify — 验证码登录/注册
  // 已存在手机号 → 登录；新手机号 → 注册（需 agreedToPrivacy=true）
  // ────────────────────────────────────────────
  fastify.post('/sms/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'code'],
        properties: {
          phone:            { type: 'string', minLength: 11, maxLength: 11 },
          code:             { type: 'string', minLength: 6, maxLength: 6 },
          agreedToPrivacy:  { type: 'boolean' }
        }
      }
    }
  }, async (req, reply) => {
    const { phone, code, agreedToPrivacy } = req.body

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return reply.code(400).send({ success: false, message: '手机号格式不正确' })
    }

    // 验证短信验证码
    try {
      await verifySmsCode(fastify.prisma, phone, code, 'LOGIN')
    } catch (err) {
      // 尝试 REGISTER 用途（兼容注册流程）
      try {
        await verifySmsCode(fastify.prisma, phone, code, 'REGISTER')
      } catch (_) {
        const msgMap = {
          CODE_NOT_FOUND:          '验证码不存在或已过期',
          CODE_TOO_MANY_ATTEMPTS:  '验证码尝试次数过多，请重新获取',
          CODE_INVALID:            '验证码不正确'
        }
        return reply.code(400).send({
          success: false,
          message: msgMap[err.code] || '验证码验证失败',
          code:    err.code
        })
      }
    }

    let user = await fastify.prisma.user.findUnique({
      where: { phone },
      include: { profile: { select: { nickname: true, avatarUrl: true } } }
    })

    if (!user) {
      // ── 新用户注册 ──
      if (!agreedToPrivacy) {
        return reply.code(400).send({
          success: false,
          message: '注册前请阅读并同意《隐私政策》和《用户协议》',
          code:    'PRIVACY_NOT_AGREED'
        })
      }

      const nickname = `用户${phone.slice(-4)}`
      user = await fastify.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            phone,
            certifyStatus:       0,
            privacyAgreedAt:     new Date(),
            privacyPolicyVersion: CURRENT_PRIVACY_VERSION
          }
        })
        await tx.userProfile.create({ data: { userId: newUser.id, nickname } })
        await tx.creditScore.create({ data: { userId: newUser.id, score: 100 } })
        // PIPL合规审计日志
        await tx.auditLog.create({
          data: {
            userId: newUser.id,
            action: 'PRIVACY_AGREED',
            detail: { version: CURRENT_PRIVACY_VERSION },
            ip:     req.ip
          }
        })
        return newUser
      })

      // 补充profile供generateTokenResponse使用
      user.profile = { nickname, avatarUrl: null }

    } else {
      // ── 已有用户登录，仅检查账号封禁状态（不检查黑名单，黑名单不阻止重新登录）
      if (user.isBanned || user.status === 'SUSPENDED' || user.status === 'DELETED') {
        return reply.code(403).send({ success: false, message: '账号已被封禁，请联系客服' })
      }

      // 更新最后登录时间
      await fastify.prisma.user.update({
        where: { id: user.id },
        data:  { lastLoginAt: new Date() }
      })
    }

    return generateTokenResponse(fastify, fastify.prisma, user, req, reply)
  })

  // ────────────────────────────────────────────
  // POST /api/v1/auth/password/login — 密码登录（含失败计数 + 30min锁定）
  // ────────────────────────────────────────────
  fastify.post('/password/login', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'password'],
        properties: {
          phone:    { type: 'string', minLength: 11, maxLength: 11 },
          password: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    const { phone, password } = req.body

    const user = await fastify.prisma.user.findUnique({
      where: { phone },
      include: { profile: { select: { nickname: true, avatarUrl: true } } }
    })

    // 故意不区分"用户不存在"和"密码错误"，防止手机号探测
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ success: false, message: '手机号或密码错误' })
    }

    // 仅检查账号封禁状态（黑名单不阻止重新登录）
    if (user.isBanned || user.status === 'SUSPENDED' || user.status === 'DELETED') {
      return reply.code(403).send({ success: false, message: '账号已被封禁，请联系客服' })
    }

    // 检查登录锁定
    const { locked, remainingMs } = await checkLoginLock(fastify.prisma, user.id)
    if (locked) {
      const remainingMin = Math.ceil(remainingMs / 60000)
      return reply.code(429).send({
        success:  false,
        message:  `登录失败次数过多，账号已锁定 ${remainingMin} 分钟`,
        code:     'LOGIN_LOCKED',
        remainingMin
      })
    }

    // 验证密码
    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      await recordLoginFail(fastify.prisma, user.id)
      return reply.code(401).send({ success: false, message: '手机号或密码错误' })
    }

    // 登录成功：清零失败计数 + 透明升级bcrypt哈希
    await Promise.all([
      resetLoginFail(fastify.prisma, user.id),
      maybeUpgradeHash(fastify.prisma, user.id, password, user.passwordHash),
      fastify.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    ])

    return generateTokenResponse(fastify, fastify.prisma, user, req, reply)
  })

  // ────────────────────────────────────────────
  // POST /api/v1/auth/refresh — 刷新 AccessToken
  // 读取 HttpOnly Cookie 中的 refresh_token，签发新 AccessToken
  // ────────────────────────────────────────────
  fastify.post('/refresh', async (req, reply) => {
    const rawRefresh = req.cookies?.refresh_token
    if (!rawRefresh) {
      return reply.code(401).send({ success: false, message: '未找到刷新凭证，请重新登录', code: 'NO_REFRESH_TOKEN' })
    }

    const refreshHash = crypto.createHash('sha256').update(rawRefresh).digest('hex')

    const record = await fastify.prisma.refreshToken.findUnique({
      where: { token: refreshHash },
      include: {
        user: {
          include: { profile: { select: { nickname: true, avatarUrl: true } } }
        }
      }
    })

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      return reply.code(401).send({ success: false, message: '刷新凭证已失效，请重新登录', code: 'REFRESH_TOKEN_INVALID' })
    }

    // 检查封禁
    if (await isUserBanned(record.userId, fastify.prisma)) {
      return reply.code(403).send({ success: false, message: '账号已被封禁' })
    }

    // 轮换 Refresh Token（撤销旧的，发放新的）
    await fastify.prisma.refreshToken.update({
      where: { id: record.id },
      data:  { revokedAt: new Date() }
    })

    return generateTokenResponse(fastify, fastify.prisma, record.user, req, reply)
  })

  // ────────────────────────────────────────────
  // POST /api/v1/auth/logout — 退出登录（会话熔断）
  // ────────────────────────────────────────────
  fastify.post('/logout', {
    preHandler: fastify.authenticate
  }, async (req, reply) => {
    const userId = req.user.userId ?? req.user.sub
    await revokeAllSessions(userId, fastify.prisma, 'user_logout')
    // 清除 Cookie
    reply.clearCookie('refresh_token', { path: '/' })
    return reply.send({ success: true, message: '已退出登录' })
  })
}

// ─── 注册用户账号路由（prefix: /api/v1/user）───
export async function userV1Routes(fastify) {

  // ────────────────────────────────────────────
  // POST /api/v1/user/account/deactivate — 账号注销（PIPL软删除+匿名化）
  // ────────────────────────────────────────────
  fastify.post('/account/deactivate', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1 },
          reason:   { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId ?? req.user.sub
    const { password, reason } = req.body

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, passwordHash: true, status: true }
    })

    if (!user) {
      return reply.code(404).send({ success: false, message: '用户不存在' })
    }
    if (user.status === 'DELETED') {
      return reply.code(400).send({ success: false, message: '账号已注销' })
    }

    // 验证密码（身份确认）
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ success: false, message: '密码不正确，无法注销' })
    }

    // 匿名化处理
    const anonPhone = `DELETED_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`

    await fastify.prisma.$transaction(async (tx) => {
      // 软删除 + 匿名化
      await tx.user.update({
        where: { id: userId },
        data: {
          status:       'DELETED',
          deletedAt:    new Date(),
          deleteReason: reason || null,
          phone:        anonPhone,  // 匿名化手机号，释放手机号唯一键
          passwordHash: null        // 清除密码
        }
      })
      // 写审计日志
      await tx.auditLog.create({
        data: {
          userId,
          action:   'ACCOUNT_DEACTIVATED',
          detail:   { reason: reason || null },
          ip:       req.ip
        }
      })
    }, { timeout: 5000 })

    // 会话熔断（注销后立即让所有Token失效）
    await revokeAllSessions(userId, fastify.prisma, 'account_deactivated')

    // 清除 Cookie
    reply.clearCookie('refresh_token', { path: '/' })

    return reply.send({ success: true, message: '账号已注销，感谢您使用哞屋' })
  })
}
