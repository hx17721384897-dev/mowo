// src/lib/auth.js
// 身份验证相关工具函数

import bcrypt from 'bcryptjs'

// 加密密码
// bcrypt 会自动加盐（salt），同一个密码每次加密结果都不同，更安全
// 数字 10 是加密强度，越高越安全但越慢，10 是生产环境推荐值
export async function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

// 验证密码
// 把用户输入的密码和数据库里存的加密密码比对
// 返回 true 表示密码正确，false 表示错误
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

// 生成 JWT token
// payload 是存在 token 里的数据，前端拿到 token 后可以解码读取这些信息
// 包含用户 id、手机号、认证状态、角色，有效期 7 天
export function signToken(fastify, user) {
  return fastify.jwt.sign(
    {
      userId:        user.id,
      phone:         user.phone,
      certifyStatus: user.certifyStatus,
      role:          user.role ?? 0   // 0=User 1=Production 2=Admin 3=SuperAdmin
    },
    { expiresIn: '7d' }
  )
}