// src/routes/account.js
// 账号设置接口（用户自助修改）：基本信息、账号安全、通知、隐私、注销
// 前缀：/api/v1/account

import crypto from 'crypto'
import { hashPassword, verifyPassword } from '../lib/auth.js'
import { sendSmsCode, verifySmsCode } from '../lib/sms.js'
import { revokeAllSessions } from '../lib/security.js'

export default async function accountRoutes(fastify) {

  // ─────────────────────────────────────────────────────────
  // GET /api/v1/account/me — 获取自己的完整 profile
  // ─────────────────────────────────────────────────────────
  fastify.get('/me', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        certifyStatus: true,
        role: true,
        status: true,
        deletedAt: true,
        createdAt: true,
        profile: {
          select: {
            nickname: true,
            avatarUrl: true,
            bio: true,
            gender: true,
            birthday: true,
            nicknameUpdatedAt: true,
            notifyInteraction: true,
            notifyOrder: true,
            notifySystem: true,
            notifyPromo: true,
            profileVisibility: true,
          }
        }
      }
    })

    if (!user) return reply.code(404).send({ success: false, message: '用户不存在' })

    // 脱敏手机号
    const maskedPhone = user.phone ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : null

    // 冷静期剩余天数
    let deactivateDaysLeft = null
    if (user.status === 'PENDING_DELETE' && user.deletedAt) {
      const msLeft = user.deletedAt.getTime() - Date.now()
      deactivateDaysLeft = Math.max(0, Math.ceil(msLeft / 86400000))
    }

    return reply.send({
      success: true,
      data: {
        id: user.id,
        maskedPhone,
        certifyStatus: user.certifyStatus,
        role: user.role,
        status: user.status,
        deactivateDaysLeft,
        createdAt: user.createdAt,
        profile: user.profile
      }
    })
  })

  // ─────────────────────────────────────────────────────────
  // GET /api/v1/account/nickname-check — 昵称唯一性校验
  // ─────────────────────────────────────────────────────────
  fastify.get('/nickname-check', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { nickname } = req.query
    const userId = req.user.userId

    if (!nickname || nickname.length < 2 || nickname.length > 20) {
      return reply.code(400).send({ success: false, message: '昵称需在 2～20 个字符之间' })
    }

    const existing = await fastify.prisma.userProfile.findFirst({
      where: { nickname, userId: { not: userId } },
      select: { userId: true }
    })

    return reply.send({ success: true, data: { available: !existing } })
  })

  // ─────────────────────────────────────────────────────────
  // PUT /api/v1/account/profile — 更新基本信息
  // ─────────────────────────────────────────────────────────
  fastify.put('/profile', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          nickname:  { type: 'string', minLength: 2, maxLength: 20 },
          bio:       { type: 'string', maxLength: 150 },
          gender:    { type: 'integer', enum: [0, 1, 2] },
          birthday:  { type: 'string', nullable: true },
          avatarUrl: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { nickname, bio, gender, birthday, avatarUrl } = req.body

    const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } })
    if (!profile) return reply.code(404).send({ success: false, message: '用户信息不存在' })

    const updateData = {}

    // 昵称：唯一性 + 30天频率限制
    if (nickname !== undefined) {
      if (profile.nicknameUpdatedAt) {
        const daysSince = (Date.now() - profile.nicknameUpdatedAt.getTime()) / 86400000
        if (daysSince < 30) {
          const daysLeft = Math.ceil(30 - daysSince)
          return reply.code(429).send({
            success: false,
            message: `昵称将于 ${daysLeft} 天后可再次修改`,
            code: 'NICKNAME_RATE_LIMITED',
            daysLeft
          })
        }
      }

      // 仅在昵称有变化时校验唯一性
      if (nickname !== profile.nickname) {
        const taken = await fastify.prisma.userProfile.findFirst({
          where: { nickname, userId: { not: userId } }
        })
        if (taken) {
          return reply.code(409).send({ success: false, message: '该昵称已被使用，请换一个', code: 'NICKNAME_TAKEN' })
        }
        updateData.nickname = nickname
        updateData.nicknameUpdatedAt = new Date()
      }
    }

    if (bio !== undefined)       updateData.bio = bio
    if (gender !== undefined)    updateData.gender = gender
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl

    if (birthday !== undefined) {
      if (birthday === null || birthday === '') {
        updateData.birthday = null
      } else {
        const d = new Date(birthday)
        if (isNaN(d.getTime())) {
          return reply.code(400).send({ success: false, message: '生日格式不正确' })
        }
        // 不可选未来日期
        if (d > new Date()) {
          return reply.code(400).send({ success: false, message: '生日不能为未来日期' })
        }
        // 年龄需满13周岁
        const age = (Date.now() - d.getTime()) / (365.25 * 86400000)
        if (age < 13) {
          return reply.code(400).send({ success: false, message: '年龄需满13周岁' })
        }
        updateData.birthday = d
      }
    }

    if (Object.keys(updateData).length === 0) {
      return reply.send({ success: true, message: '没有需要更新的内容' })
    }

    const updated = await fastify.prisma.userProfile.update({
      where: { userId },
      data: updateData,
      select: {
        nickname: true, avatarUrl: true, bio: true,
        gender: true, birthday: true, nicknameUpdatedAt: true
      }
    })

    // 若更新了昵称，同步更新 localStorage 缓存中用户信息（前端自行处理）
    return reply.send({ success: true, data: updated })
  })

  // ─────────────────────────────────────────────────────────
  // GET /api/v1/account/password-status — 是否已设置密码
  // ─────────────────────────────────────────────────────────
  fastify.get('/password-status', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true }
    })
    return reply.send({ success: true, data: { hasPassword: !!user?.passwordHash } })
  })

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/password — 设置或修改密码
  // ─────────────────────────────────────────────────────────
  fastify.post('/password', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword:     { type: 'string', minLength: 8, maxLength: 20 }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { currentPassword, newPassword } = req.body

    // 密码规则：必须包含字母和数字
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return reply.code(400).send({
        success: false,
        message: '密码必须同时包含字母和数字',
        code: 'PASSWORD_WEAK'
      })
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true }
    })

    // 已有密码：需要验证旧密码
    if (user.passwordHash) {
      if (!currentPassword) {
        return reply.code(400).send({ success: false, message: '请输入当前密码', code: 'CURRENT_PASSWORD_REQUIRED' })
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash)
      if (!valid) {
        return reply.code(401).send({ success: false, message: '密码错误，请重新输入', code: 'PASSWORD_INCORRECT' })
      }
    }

    const newHash = await hashPassword(newPassword)
    await fastify.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash }
    })

    await fastify.prisma.auditLog.create({
      data: {
        userId,
        action: user.passwordHash ? 'PASSWORD_CHANGED' : 'PASSWORD_SET',
        detail: {},
        ip: req.ip
      }
    })

    return reply.send({ success: true, message: user.passwordHash ? '密码修改成功' : '密码设置成功' })
  })

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/phone/send-old-otp — 向当前手机号发验证码
  // ─────────────────────────────────────────────────────────
  fastify.post('/phone/send-old-otp', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true }
    })
    if (!user?.phone) {
      return reply.code(400).send({ success: false, message: '当前账号未绑定手机号' })
    }

    try {
      const result = await sendSmsCode(fastify.prisma, user.phone, 'BIND_PHONE')
      const resp = { success: true, message: '验证码已发送至当前手机号' }
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

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/phone/verify-old — 验证旧手机号 OTP，返回 actionToken
  // ─────────────────────────────────────────────────────────
  fastify.post('/phone/verify-old', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 6, maxLength: 6 } }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { code } = req.body

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true }
    })
    if (!user?.phone) {
      return reply.code(400).send({ success: false, message: '当前账号未绑定手机号' })
    }

    try {
      await verifySmsCode(fastify.prisma, user.phone, code, 'BIND_PHONE')
    } catch (err) {
      const msgMap = {
        CODE_NOT_FOUND:         '验证码不存在或已过期',
        CODE_TOO_MANY_ATTEMPTS: '验证码尝试次数过多，请重新获取',
        CODE_INVALID:           '验证码不正确'
      }
      return reply.code(400).send({
        success: false,
        message: msgMap[err.code] || '验证失败',
        code: err.code
      })
    }

    // 生成 5 分钟有效的 actionToken
    const rawToken = crypto.randomBytes(32).toString('hex')
    const uaHash   = crypto.createHash('sha256').update(req.headers['user-agent'] || '').digest('hex')
    await fastify.prisma.actionToken.create({
      data: {
        userId,
        token:     rawToken,
        action:    'CHANGE_PHONE',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        uaHash
      }
    })

    return reply.send({ success: true, data: { actionToken: rawToken } })
  })

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/phone/change — 完成换绑（新手机号 + 验证码 + actionToken）
  // ─────────────────────────────────────────────────────────
  fastify.post('/phone/change', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['newPhone', 'newOtp', 'actionToken'],
        properties: {
          newPhone:    { type: 'string', minLength: 11, maxLength: 11 },
          newOtp:      { type: 'string', minLength: 6, maxLength: 6 },
          actionToken: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { newPhone, newOtp, actionToken } = req.body

    if (!/^1[3-9]\d{9}$/.test(newPhone)) {
      return reply.code(400).send({ success: false, message: '新手机号格式不正确' })
    }

    // 验证 actionToken
    const uaHash = crypto.createHash('sha256').update(req.headers['user-agent'] || '').digest('hex')
    const tokenRecord = await fastify.prisma.actionToken.findUnique({
      where: { token: actionToken }
    })

    if (
      !tokenRecord ||
      tokenRecord.userId !== userId ||
      tokenRecord.action !== 'CHANGE_PHONE' ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date() ||
      tokenRecord.uaHash !== uaHash
    ) {
      return reply.code(401).send({ success: false, message: '操作凭证无效或已过期，请重新验证' })
    }

    // 验证新手机号 OTP
    try {
      await verifySmsCode(fastify.prisma, newPhone, newOtp, 'BIND_PHONE')
    } catch (err) {
      const msgMap = {
        CODE_NOT_FOUND:         '新手机验证码不存在或已过期',
        CODE_TOO_MANY_ATTEMPTS: '验证码尝试次数过多，请重新获取',
        CODE_INVALID:           '新手机验证码不正确'
      }
      return reply.code(400).send({
        success: false,
        message: msgMap[err.code] || '新手机验证失败',
        code: err.code
      })
    }

    // 检查新手机号未被占用
    const phoneExisting = await fastify.prisma.user.findUnique({
      where: { phone: newPhone },
      select: { id: true }
    })
    if (phoneExisting && phoneExisting.id !== userId) {
      return reply.code(409).send({ success: false, message: '该手机号已被其他账号绑定', code: 'PHONE_TAKEN' })
    }

    // 标记 actionToken 已使用
    await fastify.prisma.actionToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() }
    })

    // 换绑 + 强制退出其他设备
    await fastify.prisma.user.update({ where: { id: userId }, data: { phone: newPhone } })
    await revokeAllSessions(userId, fastify.prisma, 'phone_changed')

    await fastify.prisma.auditLog.create({
      data: { userId, action: 'PHONE_CHANGED', detail: { newPhone: newPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }, ip: req.ip }
    })

    return reply.send({ success: true, message: '手机号换绑成功，其他设备已退出登录' })
  })

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/phone/send-new-otp — 向新手机号发验证码
  // ─────────────────────────────────────────────────────────
  fastify.post('/phone/send-new-otp', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['newPhone'],
        properties: { newPhone: { type: 'string', minLength: 11, maxLength: 11 } }
      }
    }
  }, async (req, reply) => {
    const { newPhone } = req.body

    if (!/^1[3-9]\d{9}$/.test(newPhone)) {
      return reply.code(400).send({ success: false, message: '手机号格式不正确' })
    }

    // 检查新手机号未被占用
    const userId = req.user.userId
    const existing = await fastify.prisma.user.findUnique({
      where: { phone: newPhone },
      select: { id: true }
    })
    if (existing && existing.id !== userId) {
      return reply.code(409).send({ success: false, message: '该手机号已被其他账号绑定', code: 'PHONE_TAKEN' })
    }

    try {
      const result = await sendSmsCode(fastify.prisma, newPhone, 'BIND_PHONE')
      const resp = { success: true, message: '验证码已发送至新手机号' }
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

  // ─────────────────────────────────────────────────────────
  // GET /api/v1/account/notifications — 获取通知设置
  // ─────────────────────────────────────────────────────────
  fastify.get('/notifications', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const profile = await fastify.prisma.userProfile.findUnique({
      where: { userId },
      select: {
        notifyInteraction: true,
        notifyOrder:       true,
        notifySystem:      true,
        notifyPromo:       true
      }
    })
    if (!profile) return reply.code(404).send({ success: false, message: '用户信息不存在' })
    return reply.send({ success: true, data: profile })
  })

  // ─────────────────────────────────────────────────────────
  // PUT /api/v1/account/notifications — 更新通知设置
  // ─────────────────────────────────────────────────────────
  fastify.put('/notifications', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          interaction: { type: 'boolean' },
          order:       { type: 'boolean' },
          system:      { type: 'boolean' },
          promo:       { type: 'boolean' }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { interaction, order, system, promo } = req.body

    const updateData = {}
    if (interaction !== undefined) updateData.notifyInteraction = interaction
    if (promo !== undefined)       updateData.notifyPromo = promo
    // order 和 system 不可关闭（设计书要求）
    if (order !== undefined && order === false) {
      return reply.code(400).send({
        success: false,
        message: '该类通知关系您的账号安全与订单权益，无法关闭',
        code: 'NOTIFY_REQUIRED'
      })
    }
    if (system !== undefined && system === false) {
      return reply.code(400).send({
        success: false,
        message: '该类通知关系您的账号安全与订单权益，无法关闭',
        code: 'NOTIFY_REQUIRED'
      })
    }

    if (Object.keys(updateData).length === 0) {
      return reply.send({ success: true, message: '没有需要更新的内容' })
    }

    await fastify.prisma.userProfile.update({ where: { userId }, data: updateData })
    return reply.send({ success: true, message: '通知设置已保存' })
  })

  // ─────────────────────────────────────────────────────────
  // GET /api/v1/account/privacy — 获取隐私设置
  // ─────────────────────────────────────────────────────────
  fastify.get('/privacy', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const profile = await fastify.prisma.userProfile.findUnique({
      where: { userId },
      select: { profileVisibility: true }
    })
    if (!profile) return reply.code(404).send({ success: false, message: '用户信息不存在' })
    return reply.send({ success: true, data: profile })
  })

  // ─────────────────────────────────────────────────────────
  // PUT /api/v1/account/privacy — 更新隐私设置
  // ─────────────────────────────────────────────────────────
  fastify.put('/privacy', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['profileVisibility'],
        properties: {
          profileVisibility: { type: 'string', enum: ['public', 'followers', 'private'] }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { profileVisibility } = req.body

    await fastify.prisma.userProfile.update({
      where: { userId },
      data: { profileVisibility }
    })
    return reply.send({ success: true, message: '隐私设置已保存' })
  })

  // ─────────────────────────────────────────────────────────
  // GET /api/v1/account/deactivate/check — 检查注销前置条件
  // ─────────────────────────────────────────────────────────
  fastify.get('/deactivate/check', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true }
    })

    if (user.status === 'PENDING_DELETE') {
      return reply.code(400).send({ success: false, message: '账号已在注销冷静期中', code: 'ALREADY_PENDING' })
    }

    const issues = []

    // 检查待处理订单
    const pendingOrders = await fastify.prisma.customizeOrder.count({
      where: {
        userId,
        status: { in: ['pending', 'paid', 'locked', 'processing', 'producing'] }
      }
    })
    if (pendingOrders > 0) {
      issues.push(`您有 ${pendingOrders} 个进行中的订单，请处理完毕后再注销`)
    }

    return reply.send({
      success: true,
      data: {
        canProceed: issues.length === 0,
        issues
      }
    })
  })

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/deactivate/send-otp — 注销身份验证：发送验证码
  // ─────────────────────────────────────────────────────────
  fastify.post('/deactivate/send-otp', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, status: true }
    })

    if (user.status === 'PENDING_DELETE') {
      return reply.code(400).send({ success: false, message: '账号已在注销冷静期中' })
    }

    if (!user?.phone) {
      return reply.code(400).send({ success: false, message: '当前账号未绑定手机号' })
    }

    try {
      const result = await sendSmsCode(fastify.prisma, user.phone, 'DEACTIVATE')
      const resp = { success: true, message: '验证码已发送' }
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

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/deactivate/apply — 申请注销（启动7天冷静期）
  // ─────────────────────────────────────────────────────────
  fastify.post('/deactivate/apply', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['otp'],
        properties: {
          otp:    { type: 'string', minLength: 6, maxLength: 6 },
          reason: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (req, reply) => {
    const userId = req.user.userId
    const { otp, reason } = req.body

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, status: true }
    })

    if (user.status === 'PENDING_DELETE') {
      return reply.code(400).send({ success: false, message: '账号已在注销冷静期中' })
    }

    // 验证 OTP
    try {
      await verifySmsCode(fastify.prisma, user.phone, otp, 'DEACTIVATE')
    } catch (err) {
      const msgMap = {
        CODE_NOT_FOUND:         '验证码不存在或已过期',
        CODE_TOO_MANY_ATTEMPTS: '验证码尝试次数过多，请重新获取',
        CODE_INVALID:           '验证码不正确'
      }
      return reply.code(400).send({
        success: false,
        message: msgMap[err.code] || '验证失败',
        code: err.code
      })
    }

    // 设置7天冷静期
    const deleteAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await fastify.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status:       'PENDING_DELETE',
          deletedAt:    deleteAt,
          deleteReason: reason || null
        }
      })
      await tx.auditLog.create({
        data: {
          userId,
          action: 'DEACTIVATE_APPLIED',
          detail: { deleteAt: deleteAt.toISOString(), reason: reason || null },
          ip: req.ip
        }
      })
    })

    return reply.send({
      success: true,
      message: '注销申请已提交，账号将在7天后正式注销',
      data: { deleteAt }
    })
  })

  // ─────────────────────────────────────────────────────────
  // POST /api/v1/account/deactivate/cancel — 撤销注销申请
  // ─────────────────────────────────────────────────────────
  fastify.post('/deactivate/cancel', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true }
    })

    if (user.status !== 'PENDING_DELETE') {
      return reply.code(400).send({ success: false, message: '当前账号没有待处理的注销申请' })
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE', deletedAt: null, deleteReason: null }
      })
      await tx.auditLog.create({
        data: {
          userId,
          action: 'DEACTIVATE_CANCELLED',
          detail: {},
          ip: req.ip
        }
      })
    })

    return reply.send({ success: true, message: '已撤销注销申请，账号恢复正常' })
  })
}
