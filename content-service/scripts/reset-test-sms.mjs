import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { rateLimitHashForTest } from '../src/lib/rate-limit.js'

const phones = process.argv.slice(2).map(value => String(value).trim()).filter(Boolean)

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

if (process.env.NODE_ENV === 'production') {
  fail('禁止在生产环境重置验证码测试数据。')
} else if (process.env.SMS_MOCK !== 'true') {
  fail('只有 SMS_MOCK=true 的本地测试环境允许执行此命令。')
} else if (phones.length === 0 || phones.some(phone => !/^1[3-9]\d{9}$/.test(phone))) {
  fail('请输入一个或多个合法测试手机号，例如：npm run test-sms:reset -- 18800009101')
} else {
  const prisma = new PrismaClient()
  try {
    const signingSecret = process.env.FILE_SIGNING_SECRET?.trim() || process.env.COOKIE_SECRET?.trim()
    if (!signingSecret) throw new Error('缺少 FILE_SIGNING_SECRET 或 COOKIE_SECRET，无法定位限流记录。')

    const phoneHashes = phones.map(phone => rateLimitHashForTest(signingSecret, phone))
    const [codes, buckets] = await prisma.$transaction([
      prisma.smsCode.deleteMany({ where: { phone: { in: phones } } }),
      prisma.rateLimitBucket.deleteMany({
        where: {
          OR: [
            { scope: 'SMS_PHONE_DAILY', subjectHash: { in: phoneHashes } },
            { scope: 'SMS_IP_DISTINCT_PHONE', targetHash: { in: phoneHashes } }
          ]
        }
      })
    ])

    console.log(`已重置 ${phones.join('、')} 的本地验证码测试状态。`)
    console.log(`清理验证码记录 ${codes.count} 条，限流记录 ${buckets.count} 条。`)
  } catch (error) {
    fail(error.message)
  } finally {
    await prisma.$disconnect()
  }
}
