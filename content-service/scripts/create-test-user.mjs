import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const rawArgs = process.argv.slice(2)
const args = Object.fromEntries(rawArgs.filter(arg => arg.startsWith('--')).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=')]
}))
const positional = rawArgs.filter(arg => !arg.startsWith('--'))
const phone = String(args.phone || positional[0] || '').trim()
const nickname = String(args.nickname || positional[1] || `注销测试${phone.slice(-4)}`).trim()

if (!/^1[3-9]\d{9}$/.test(phone)) {
  console.error('手机号格式不正确。示例：npm run test-user:create -- 18800000001 注销测试1')
  process.exitCode = 1
} else if (!nickname || nickname.length > 20) {
  console.error('昵称需为 1 至 20 个字符。')
  process.exitCode = 1
} else {
  try {
    const existing = await prisma.user.findUnique({ where: { phone } })
    if (existing) {
      console.error(`手机号 ${phone} 已存在，账号 ID：${existing.id}，状态：${existing.status}`)
      process.exitCode = 1
    } else {
      const user = await prisma.user.create({
        data: {
          phone,
          status: 'ACTIVE',
          role: 0,
          privacyAgreedAt: new Date(),
          privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || 'test-account',
          profile: { create: { nickname } },
        },
        include: { profile: true }
      })
      console.log('测试账号创建成功')
      console.log(`账号 ID：${user.id}`)
      console.log(`手机号：${user.phone}`)
      console.log(`昵称：${user.profile.nickname}`)
      console.log('身份：普通用户，可用于注销流程测试')
      console.log(`查看状态：npm run test-user:inspect -- ${user.id}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}
