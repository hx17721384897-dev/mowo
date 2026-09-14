// src/routes/auth.js
// 用户身份相关接口：注册、登录、获取当前用户、更新资料

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
  }, async (_request, reply) => {
    return reply.code(410).send({
      success: false,
      message: '旧注册入口已停用，请使用短信验证码',
      code: 'LEGACY_AUTH_RETIRED'
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
  }, async (_request, reply) => {
    return reply.code(410).send({
      success: false,
      message: '旧登录入口已停用，请使用新版登录',
      code: 'LEGACY_AUTH_RETIRED'
    })
  })

  // ─────────────────────────────────────────
  // GET /api/auth/me 获取当前登录用户信息
  // ─────────────────────────────────────────
  // 需要登录才能访问（preHandler: fastify.authenticate）
  // 返回当前账户的兼容基础信息。
  fastify.get('/me', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { userId } = request.user

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
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
        isBanned: user.isBanned,
        profile: user.profile
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
