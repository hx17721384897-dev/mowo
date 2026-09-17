import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const identifier = String(process.argv[2] || '').trim()

if (!identifier) {
  console.error('请输入创建测试账号时显示的账号 ID，或尚未注销的手机号。')
  process.exitCode = 1
} else {
  try {
    const user = await prisma.user.findFirst({
      where: identifier.includes('-') ? { id: identifier } : { phone: identifier },
      include: {
        profile: { select: { nickname: true, avatarUrl: true, email: true } },
        deletionRequest: true
      }
    })
    if (!user) {
      console.error('未找到该测试账号。最终注销后手机号会被释放，请改用账号 ID 查询。')
      process.exitCode = 1
    } else {
      console.log(`账号 ID：${user.id}`)
      console.log(`手机号：${user.phone || '已删除'}`)
      console.log(`昵称：${user.profile?.nickname || '已删除'}`)
      console.log(`账号状态：${user.status}`)
      console.log(`兼容角色等级：${user.role}`)
      console.log(`员工岗位：${user.staffRole || '无'}`)
      console.log(`注销任务：${user.deletionRequest?.status || '无'}`)
      if (user.deletionRequest?.scheduledAt) console.log(`计划处理：${user.deletionRequest.scheduledAt.toLocaleString('zh-CN')}`)
      if (user.deletionRequest?.completedAt) console.log(`完成时间：${user.deletionRequest.completedAt.toLocaleString('zh-CN')}`)
      if (user.deletionRequest?.lastError) console.log(`最近错误：${user.deletionRequest.lastError}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}
