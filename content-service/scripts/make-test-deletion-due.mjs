import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const phone = String(process.argv[2] || '').trim()

if (process.env.NODE_ENV === 'production') {
  console.error('该命令仅用于本地测试，生产环境禁止运行。')
  process.exitCode = 1
} else if (!/^1[3-9]\d{9}$/.test(phone)) {
  console.error('请输入已申请注销的测试账号手机号。')
  process.exitCode = 1
} else {
  try {
    const user = await prisma.user.findUnique({
      where: { phone },
      include: { deletionRequest: true, profile: { select: { nickname: true } } }
    })
    if (!user) {
      console.error('未找到该手机号对应的账号。')
      process.exitCode = 1
    } else if (user.status !== 'PENDING_DELETE' || user.deletionRequest?.status !== 'REQUESTED') {
      console.error('该账号没有处于可测试到期的注销申请状态。')
      process.exitCode = 1
    } else {
      await prisma.accountDeletionRequest.update({
        where: { id: user.deletionRequest.id },
        data: { scheduledAt: new Date(Date.now() - 60000) }
      })
      console.log(`已将 ${phone}（${user.profile?.nickname || '未命名'}）的注销申请调整为到期。`)
      console.log('后端定时任务将在最多 5 分钟内重新检查并执行资料清理。')
    }
  } finally {
    await prisma.$disconnect()
  }
}
