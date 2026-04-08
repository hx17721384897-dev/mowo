// src/routes/auth.js
// 用户身份相关接口：注册、登录、获取当前用户、更新资料

import { hashPassword, verifyPassword, signToken } from '../lib/auth.js'

export default async function authRoutes(fastify) {

  // ─────────────────────────────────────────
  // POST /api/auth/register 注册
  // ─────────────────────────────────────────
  // 接收手机号、密码、昵称
  // 检查手机号是否已注册
  // 密码加密后写入 users 表
  // 同时自动创建 user_profiles 和 credit_scores 记录
  // 返回 token
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'password'],
        properties: {
          phone:    { type: 'string', minLength: 11, maxLength: 11 },
          password: { type: 'string', minLength: 6,  maxLength: 50 },
          nickname: { type: 'string', minLength: 1,  maxLength: 50 }
        }
      }
    }
  }, async (request, reply) => {
    const { phone, password } = request.body
    // nickname 选填，默认用「用户」+ 手机号后四位
    const nickname = request.body.nickname || `用户${phone.slice(-4)}`

    // 检查手机号是否已注册
    const existing = await fastify.prisma.user.findUnique({ where: { phone } })
    if (existing) {
      return reply.code(400).send({ success: false, message: '该手机号已注册' })
    }

    // 加密密码
    const passwordHash = await hashPassword(password)

    // 事务：同时创建 users、user_profiles、credit_scores 三条记录
    // 用事务是为了保证三条记录要么全部成功，要么全部失败，不会出现只创建了一半的情况
    const user = await fastify.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          phone,
          passwordHash,
          certifyStatus: 0
        }
      })

      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          nickname
        }
      })

      await tx.creditScore.create({
        data: {
          userId: newUser.id,
          score: 100
        }
      })

      return newUser
    })

    // 生成 token 返回给前端
    const token = signToken(fastify, user)

    return reply.code(201).send({
      success: true,
      message: '注册成功',
      data: { token }
    })
  })

  // ─────────────────────────────────────────
  // POST /api/auth/login 登录
  // ─────────────────────────────────────────
  // 接收手机号和密码
  // 查用户是否存在，验证密码，检查是否被封号
  // 更新最后登录时间
  // 返回 token 和基本用户信息
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'password'],
        properties: {
          phone: { type: 'string' },
          password: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { phone, password } = request.body

    // 查找用户，同时带出 profile 里的昵称和头像
    const user = await fastify.prisma.user.findUnique({
      where: { phone },
      include: {
        profile: {
          select: { nickname: true, avatarUrl: true }
        }
      }
    })

    // 用户不存在或密码错误，返回同一个错误信息
    // 不区分「用户不存在」和「密码错误」，防止被人探测哪些手机号已注册
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ success: false, message: '手机号或密码错误' })
    }

    // 检查是否被封号
    if (user.isBanned) {
      return reply.code(403).send({ success: false, message: '账号已被封禁，请联系客服' })
    }

    // 更新最后登录时间
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    })

    // 生成 token
    const token = signToken(fastify, user)

    return reply.send({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          phone: user.phone,
          certifyStatus: user.certifyStatus,
          nickname: user.profile?.nickname || null,
          avatarUrl: user.profile?.avatarUrl || null
        }
      }
    })
  })

  // ─────────────────────────────────────────
  // GET /api/auth/me 获取当前登录用户信息
  // ─────────────────────────────────────────
  // 需要登录才能访问（preHandler: fastify.authenticate）
  // 返回用户完整的主页信息，包括信用分
  fastify.get('/me', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        creatorProfile: true,
        creditScore: true
      }
    })

    if (!user) {
      return reply.code(404).send({ success: false, message: '用户不存在' })
    }

    return reply.send({
      success: true,
      data: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        certifyStatus: user.certifyStatus,
        isBanned: user.isBanned,
        profile: user.profile,
        creatorProfile: user.creatorProfile,
        creditScore: user.creditScore?.score || 100
      }
    })
  })

  // ─────────────────────────────────────────
  // PUT /api/auth/profile 更新个人资料
  // ─────────────────────────────────────────
  // 需要登录才能访问
  // 可以更新昵称、头像、简介、性别、生日、城市、MBTI、邮箱
  // 所有字段都是选填的，只传要改的字段
  fastify.put('/profile', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          nickname: { type: 'string', minLength: 1, maxLength: 50 },
          avatarUrl: { type: 'string' },
          bio: { type: 'string', maxLength: 500 },
          gender: { type: 'integer', enum: [0, 1, 2] },
          birthday: { type: 'string' },
          city: { type: 'string', maxLength: 50 },
          mbti: { type: 'string', maxLength: 4 },
          email: { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.user
    const updateData = request.body

    // 如果传了 birthday，转换成 Date 对象
    if (updateData.birthday) {
      updateData.birthday = new Date(updateData.birthday)
    }

    const profile = await fastify.prisma.userProfile.update({
      where: { userId },
      data: updateData
    })

    return reply.send({
      success: true,
      message: '资料更新成功',
      data: profile
    })
  })
}
