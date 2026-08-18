// src/routes/auth-v1.js
// v1 账户系统路由：SMS登录/注册、密码登录（含锁定）、Token刷新、登出、账号注销
// 前缀：/api/v1/auth/* 和 /api/v1/user/*

import crypto from 'crypto'
import { assertSmsCooldownAllowed, sendSmsCode, verifySmsCode } from '../lib/sms.js'
import { generateTokenResponse } from '../lib/token.js'
import { hashPassword, verifyPassword, maybeUpgradeHash, checkLoginLock, recordLoginFail, resetLoginFail } from '../lib/auth.js'
import { isUserBanned, revokeAllSessions, revokeCurrentSession } from '../lib/security.js'
import {
  assertSmsVerificationAllowed,
  enforceSmsSendLimits,
  recordSmsVerificationFailure
} from '../lib/rate-limit.js'

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

    if (purpose === 'LOGIN' || purpose === 'REGISTER') {
      const account = await fastify.prisma.user.findUnique({
        where: { phone },
        select: { id: true }
      })
      if (purpose === 'LOGIN' && !account) {
        return reply.code(404).send({
          success: false,
          message: '该手机号尚未注册，请前往注册',
          code: 'ACCOUNT_NOT_FOUND'
        })
      }
      if (purpose === 'REGISTER' && account) {
        return reply.code(409).send({
          success: false,
          message: '该手机号已注册，请直接登录',
          code: 'ACCOUNT_ALREADY_EXISTS'
        })
      }
    }

    try {
      await assertSmsCooldownAllowed(fastify.prisma, phone, purpose)
      if (!await enforceSmsSendLimits(fastify, req, reply, phone)) return
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
  // POST /api/v1/auth/sms/verify — 验证码登录或注册（必须明确 mode）
  // ────────────────────────────────────────────
  fastify.post('/sms/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'code', 'mode'],
        additionalProperties: false,
        properties: {
          phone:            { type: 'string', minLength: 11, maxLength: 11 },
          code:             { type: 'string', minLength: 6, maxLength: 6 },
          mode:             { type: 'string', enum: ['LOGIN', 'REGISTER'] },
          agreedToPrivacy:  { type: 'boolean' }
        }
      }
    }
  }, async (req, reply) => {
    const { phone, code, mode, agreedToPrivacy } = req.body

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return reply.code(400).send({ success: false, message: '手机号格式不正确' })
    }

    let user = await fastify.prisma.user.findUnique({
      where: { phone },
      include: { profile: { select: { nickname: true, avatarUrl: true } } }
    })

    if (mode === 'LOGIN' && !user) {
      return reply.code(404).send({
        success: false,
        message: '该手机号尚未注册，请前往注册',
        code: 'ACCOUNT_NOT_FOUND'
      })
    }
    if (mode === 'REGISTER' && user) {
      return reply.code(409).send({
        success: false,
        message: '该手机号已注册，请直接登录',
        code: 'ACCOUNT_ALREADY_EXISTS'
      })
    }
    if (mode === 'REGISTER' && !agreedToPrivacy) {
      return reply.code(400).send({
        success: false,
        message: '注册前请阅读并同意《隐私政策》和《用户协议》',
        code: 'PRIVACY_NOT_AGREED'
      })
    }

    // 登录码和注册码严格分开，不能跨用途复用。
    try {
      await assertSmsVerificationAllowed(fastify, req)
      await verifySmsCode(fastify.prisma, phone, code, mode)
    } catch (err) {
      if (err.code !== 'VERIFY_TEMPORARILY_LOCKED') {
        await recordSmsVerificationFailure(fastify, req)
      }
      if (err.code === 'VERIFY_TEMPORARILY_LOCKED') {
        reply.header('Retry-After', String(err.retryAfterSeconds))
        return reply.code(429).send({
          success: false, message: err.message, code: err.code,
          retryAfterSeconds: err.retryAfterSeconds
        })
      }
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

    if (mode === 'REGISTER') {
      // ── 新用户注册 ──
      const nickname = `用户${phone.slice(-4)}`
      user = await fastify.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            phone,
            certifyStatus:       0,
            privacyAgreedAt:     new Date(),
            privacyPolicyVersion: fastify.config.privacyVersion
          }
        })
        await tx.userProfile.create({ data: { userId: newUser.id, nickname } })
        await tx.creditScore.create({ data: { userId: newUser.id, score: 100 } })
        await tx.consentRecord.createMany({
          data: [
            {
              userId: newUser.id,
              type: 'USER_AGREEMENT',
              version: fastify.config.userAgreementVersion,
              scene: 'REGISTER',
              ip: req.ip || null,
              userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null
            },
            {
              userId: newUser.id,
              type: 'PRIVACY_POLICY',
              version: fastify.config.privacyVersion,
              scene: 'REGISTER',
              ip: req.ip || null,
              userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null
            }
          ]
        })
        // PIPL合规审计日志
        await tx.auditLog.create({
          data: {
            userId: newUser.id,
            action: 'PRIVACY_AGREED',
            detail: {
              privacyVersion: fastify.config.privacyVersion,
              userAgreementVersion: fastify.config.userAgreementVersion,
              scene: 'REGISTER'
            },
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
    if (!fastify.config.passwordLoginEnabled) {
      return reply.code(404).send({
        success: false,
        message: '当前版本仅支持短信验证码登录',
        code: 'PASSWORD_LOGIN_DISABLED'
      })
    }

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

    return generateTokenResponse(fastify, fastify.prisma, record.user, req, reply, {
      sessionId: record.sessionId || crypto.randomUUID()
    })
  })

  // ────────────────────────────────────────────
  // POST /api/v1/auth/logout — 只退出当前设备
  // ────────────────────────────────────────────
  fastify.post('/logout', {
    preHandler: fastify.authenticate
  }, async (req, reply) => {
    const userId = req.user.userId ?? req.user.sub
    await revokeCurrentSession(userId, req.user.sid, fastify.prisma, 'user_logout')
    reply.clearCookie('refresh_token', { path: '/' })
    return reply.send({ success: true, message: '当前设备已退出登录' })
  })

  // POST /api/v1/auth/logout-all — 退出账号下全部设备
  fastify.post('/logout-all', {
    preHandler: fastify.authenticate
  }, async (req, reply) => {
    const userId = req.user.userId ?? req.user.sub
    await revokeAllSessions(userId, fastify.prisma, 'user_logout_all')
    reply.clearCookie('refresh_token', { path: '/' })
    return reply.send({ success: true, message: '全部设备已退出登录' })
  })
}

// ─── 注册用户账号路由（prefix: /api/v1/user）───
export async function userV1Routes(fastify) {

  // ────────────────────────────────────────────
  // 旧立即注销入口永久停用，统一使用 /api/v1/account/deactivate/*。
  // ────────────────────────────────────────────
  fastify.post('/account/deactivate', async (_req, reply) => {
    return reply.code(410).send({
      success: false,
      message: '旧注销入口已停用，请在账号设置中提交注销申请',
      code: 'LEGACY_ACCOUNT_DELETION_RETIRED'
    })
  })
}
